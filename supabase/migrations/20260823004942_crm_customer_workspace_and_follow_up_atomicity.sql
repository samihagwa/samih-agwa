-- Give every CRM contact a durable sales workspace and make recording a
-- communication result one atomic transition: contact + activity + task.

create table public.crm_sales_profiles (
  contact_id uuid primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  lead_temperature text not null default 'warm',
  preferred_contact_method text,
  preferred_contact_time text,
  needs text,
  objections text,
  next_action text,
  tags text[] not null default '{}',
  version bigint not null default 1,
  created_by uuid not null references public.profiles (id) on delete restrict,
  updated_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_sales_profiles_contact_org_fkey
    foreign key (contact_id, organization_id)
    references public.crm_contacts (id, organization_id)
    on delete cascade,
  constraint crm_sales_profiles_temperature_allowed check (
    lead_temperature in ('cold', 'warm', 'hot')
  ),
  constraint crm_sales_profiles_method_allowed check (
    preferred_contact_method is null
    or preferred_contact_method in (
      'phone', 'email', 'telegram', 'whatsapp', 'instagram',
      'facebook', 'messenger', 'other'
    )
  ),
  constraint crm_sales_profiles_contact_time_length check (
    preferred_contact_time is null or char_length(preferred_contact_time) <= 120
  ),
  constraint crm_sales_profiles_needs_length check (needs is null or char_length(needs) <= 4000),
  constraint crm_sales_profiles_objections_length check (objections is null or char_length(objections) <= 4000),
  constraint crm_sales_profiles_next_action_length check (next_action is null or char_length(next_action) <= 1000),
  constraint crm_sales_profiles_tags_contract check (
    coalesce(cardinality(tags), 0) <= 20
  ),
  constraint crm_sales_profiles_version_positive check (version > 0)
);

create index crm_sales_profiles_org_updated_idx
  on public.crm_sales_profiles (organization_id, updated_at desc, contact_id);

alter table public.crm_sales_profiles enable row level security;

create policy "crm_sales_profiles_select_contact_access"
on public.crm_sales_profiles
for select
to authenticated
using (private.can_access_crm_contact(contact_id, organization_id));

create policy "section_scope_crm_sales_profiles"
on public.crm_sales_profiles
as restrictive
for select
to authenticated
using (private.can_access_any_section(organization_id, array['crm']::text[]));

revoke all on table public.crm_sales_profiles from public, anon, authenticated;
grant select on table public.crm_sales_profiles to authenticated;
grant select, insert, update, delete on table public.crm_sales_profiles to service_role;

create or replace function public.record_crm_activity_v2(
  target_user_id uuid,
  target_contact_id uuid,
  expected_contact_version bigint,
  activity_kind public.crm_activity_kind,
  next_stage public.crm_lead_stage,
  activity_summary text,
  target_next_follow_up_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  contact_record public.crm_contacts%rowtype;
  actor_role public.app_role;
  activity_id bigint;
  follow_up_task_id uuid;
  active_follow_up boolean := next_stage in ('new', 'contacted', 'qualified', 'follow_up');
begin
  if target_user_id is null then
    raise exception 'A verified target user is required';
  end if;

  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  select contact.* into contact_record
  from public.crm_contacts contact
  where contact.id = target_contact_id
  for update;

  if contact_record.id is null then
    raise exception 'CRM contact was not found';
  end if;

  if expected_contact_version is not null
    and contact_record.version <> expected_contact_version then
    raise exception 'CRM contact changed. Refresh the customer file and try again';
  end if;

  select membership.role into actor_role
  from public.memberships membership
  where membership.organization_id = contact_record.organization_id
    and membership.user_id = target_user_id
    and membership.status = 'active';

  if actor_role is null
    or (contact_record.owner_id <> target_user_id and actor_role not in ('owner', 'admin', 'manager')) then
    raise exception 'Only the CRM owner or organization leadership can record follow-up';
  end if;

  if activity_kind = 'created' then
    raise exception 'Created is reserved for the initial CRM event';
  end if;

  if activity_summary is null
    or char_length(trim(activity_summary)) not between 3 and 4000 then
    raise exception 'CRM activity summary must contain between 3 and 4000 characters';
  end if;

  if not private.is_valid_crm_transition(contact_record.stage, next_stage) then
    raise exception 'Invalid CRM stage transition from % to %', contact_record.stage, next_stage;
  end if;

  if active_follow_up then
    if target_next_follow_up_at is null or target_next_follow_up_at <= now() then
      raise exception 'An active CRM lead requires a future follow-up time';
    end if;
  elsif target_next_follow_up_at is not null then
    raise exception 'Closed CRM stages cannot keep an open follow-up time';
  end if;

  perform set_config('app.crm_contact_id', target_contact_id::text, true);

  -- Complete every open follow-up task through the canonical task transitions.
  update public.tasks task set status = 'ready'
  where task.crm_contact_id = target_contact_id and task.status = 'backlog';

  update public.tasks task set status = 'in_progress'
  where task.crm_contact_id = target_contact_id and task.status in ('ready', 'blocked');

  update public.tasks task set status = 'review'
  where task.crm_contact_id = target_contact_id and task.status = 'in_progress';

  update public.tasks task set status = 'done'
  where task.crm_contact_id = target_contact_id and task.status = 'review';

  update public.crm_contacts contact
  set stage = next_stage,
      follow_up_required = active_follow_up,
      next_follow_up_at = case when active_follow_up then target_next_follow_up_at else null end,
      last_contacted_at = case
        when activity_kind in ('call', 'message', 'email') then now()
        else contact.last_contacted_at
      end,
      converted_at = case
        when next_stage = 'won' then coalesce(contact.converted_at, now())
        else null
      end,
      closure_reason = case
        when next_stage in ('lost', 'do_not_contact') then trim(activity_summary)
        else null
      end,
      consent_status = case
        when next_stage = 'do_not_contact' then 'denied'::public.crm_consent_status
        when contact.consent_status = 'denied' then 'unknown'::public.crm_consent_status
        else contact.consent_status
      end,
      version = contact.version + 1,
      updated_at = now()
  where contact.id = target_contact_id;

  insert into public.crm_activities (
    organization_id, contact_id, actor_id, kind, from_stage, to_stage,
    summary, next_follow_up_at
  ) values (
    contact_record.organization_id, target_contact_id, target_user_id,
    activity_kind, contact_record.stage, next_stage, trim(activity_summary),
    case when active_follow_up then target_next_follow_up_at else null end
  ) returning id into activity_id;

  if active_follow_up then
    insert into public.tasks (
      organization_id, title, description, status, priority, owner_id,
      created_by, acceptance_criteria, due_at, crm_contact_id
    ) values (
      contact_record.organization_id,
      'متابعة: ' || contact_record.full_name,
      'افتح ملف العميل، تواصل معه، ثم سجّل النتيجة وحدد الخطوة التالية.',
      'ready',
      case when target_next_follow_up_at <= now() + interval '24 hours'
        then 'high'::public.task_priority
        else 'normal'::public.task_priority
      end,
      contact_record.owner_id,
      target_user_id,
      'تسجيل نتيجة التواصل في ملف العميل مع المرحلة التالية وموعد المتابعة أو سبب الإغلاق.',
      target_next_follow_up_at,
      target_contact_id
    ) returning id into follow_up_task_id;
  end if;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    contact_record.organization_id,
    target_user_id,
    'crm.follow_up_recorded',
    'crm_contact',
    target_contact_id,
    jsonb_build_object(
      'stage', contact_record.stage,
      'follow_up_required', contact_record.follow_up_required,
      'next_follow_up_at', contact_record.next_follow_up_at,
      'version', contact_record.version
    ),
    jsonb_build_object(
      'stage', next_stage,
      'follow_up_required', active_follow_up,
      'next_follow_up_at', case when active_follow_up then target_next_follow_up_at else null end,
      'version', contact_record.version + 1,
      'activity_kind', activity_kind,
      'activity_id', activity_id,
      'task_id', follow_up_task_id
    )
  );

  return jsonb_build_object(
    'changed', true,
    'contact_id', target_contact_id,
    'contact_version', contact_record.version + 1,
    'activity_id', activity_id,
    'task_id', follow_up_task_id,
    'follow_up_required', active_follow_up,
    'next_follow_up_at', case when active_follow_up then target_next_follow_up_at else null end
  );
end;
$$;

create or replace function public.save_crm_sales_profile(
  target_user_id uuid,
  target_contact_id uuid,
  expected_profile_version bigint,
  target_lead_temperature text,
  target_preferred_contact_method text,
  target_preferred_contact_time text,
  target_needs text,
  target_objections text,
  target_next_action text,
  target_tags text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  contact_record public.crm_contacts%rowtype;
  profile_record public.crm_sales_profiles%rowtype;
  saved_version bigint;
  clean_tags text[];
begin
  if target_user_id is null then
    raise exception 'A verified target user is required';
  end if;

  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  select contact.* into contact_record
  from public.crm_contacts contact
  where contact.id = target_contact_id
  for update;

  if contact_record.id is null then
    raise exception 'CRM contact was not found';
  end if;

  if not private.can_access_crm_contact(contact_record.id, contact_record.organization_id) then
    raise exception 'Only the CRM owner or organization leadership can update the sales profile';
  end if;

  if target_lead_temperature not in ('cold', 'warm', 'hot') then
    raise exception 'CRM lead temperature is invalid';
  end if;

  if nullif(trim(target_preferred_contact_method), '') is not null
    and trim(target_preferred_contact_method) not in (
      'phone', 'email', 'telegram', 'whatsapp', 'instagram',
      'facebook', 'messenger', 'other'
    ) then
    raise exception 'Preferred contact method is invalid';
  end if;

  if exists (
    select 1 from unnest(coalesce(target_tags, array[]::text[])) tag
    where nullif(trim(tag), '') is not null and char_length(trim(tag)) > 40
  ) then
    raise exception 'CRM sales profile tags must not exceed 40 characters';
  end if;

  select profile.* into profile_record
  from public.crm_sales_profiles profile
  where profile.contact_id = target_contact_id
  for update;

  if profile_record.contact_id is not null
    and expected_profile_version is not null
    and profile_record.version <> expected_profile_version then
    raise exception 'CRM sales profile changed. Refresh the customer file and try again';
  end if;

  if profile_record.contact_id is null
    and expected_profile_version is not null
    and expected_profile_version <> 0 then
    raise exception 'CRM sales profile changed. Refresh the customer file and try again';
  end if;

  select coalesce(array_agg(tag order by first_position), array[]::text[]) into clean_tags
  from (
    select min(position) as first_position, trim(value) as tag
    from unnest(coalesce(target_tags, '{}')) with ordinality values_with_position(value, position)
    where nullif(trim(value), '') is not null
    group by trim(value)
    order by min(position)
    limit 20
  ) normalized;

  insert into public.crm_sales_profiles (
    contact_id, organization_id, lead_temperature, preferred_contact_method,
    preferred_contact_time, needs, objections, next_action, tags, version,
    created_by, updated_by
  ) values (
    contact_record.id,
    contact_record.organization_id,
    target_lead_temperature,
    nullif(trim(target_preferred_contact_method), ''),
    nullif(trim(target_preferred_contact_time), ''),
    nullif(trim(target_needs), ''),
    nullif(trim(target_objections), ''),
    nullif(trim(target_next_action), ''),
    clean_tags,
    1,
    target_user_id,
    target_user_id
  )
  on conflict (contact_id) do update
  set lead_temperature = excluded.lead_temperature,
      preferred_contact_method = excluded.preferred_contact_method,
      preferred_contact_time = excluded.preferred_contact_time,
      needs = excluded.needs,
      objections = excluded.objections,
      next_action = excluded.next_action,
      tags = excluded.tags,
      version = crm_sales_profiles.version + 1,
      updated_by = target_user_id,
      updated_at = now()
  returning version into saved_version;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    contact_record.organization_id,
    target_user_id,
    'crm.sales_profile_saved',
    'crm_contact',
    target_contact_id,
    jsonb_build_object(
      'profile_version', saved_version,
      'lead_temperature', target_lead_temperature,
      'preferred_contact_method', nullif(trim(target_preferred_contact_method), ''),
      'tag_count', cardinality(clean_tags)
    )
  );

  return jsonb_build_object('saved', true, 'profile_version', saved_version);
end;
$$;

create or replace function public.add_crm_conversation_link(
  target_user_id uuid,
  target_contact_id uuid,
  target_channel public.crm_conversation_channel,
  target_url text,
  target_label text,
  make_primary boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  contact_record public.crm_contacts%rowtype;
  link_id uuid;
  clean_url text := nullif(trim(target_url), '');
  clean_label text := nullif(trim(target_label), '');
begin
  if target_user_id is null then
    raise exception 'A verified target user is required';
  end if;

  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  select contact.* into contact_record
  from public.crm_contacts contact
  where contact.id = target_contact_id
  for update;

  if contact_record.id is null then
    raise exception 'CRM contact was not found';
  end if;

  if not private.can_access_crm_contact(contact_record.id, contact_record.organization_id) then
    raise exception 'Only the CRM owner or organization leadership can add conversation links';
  end if;

  if clean_url is null
    or char_length(clean_url) not between 8 and 2000
    or clean_url !~* '^https?://[^[:space:]]+$' then
    raise exception 'Conversation link must be a valid HTTP or HTTPS URL';
  end if;

  if clean_label is not null and char_length(clean_label) not between 2 and 80 then
    raise exception 'Conversation label must contain between 2 and 80 characters';
  end if;

  if make_primary then
    update public.crm_conversation_links link
    set is_primary = false
    where link.contact_id = target_contact_id and link.is_primary;
  end if;

  insert into public.crm_conversation_links (
    organization_id, contact_id, channel, label, url, is_primary, created_by
  ) values (
    contact_record.organization_id, target_contact_id, target_channel,
    clean_label, clean_url, make_primary, target_user_id
  ) returning id into link_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    contact_record.organization_id,
    target_user_id,
    'crm.conversation_link_added',
    'crm_contact',
    target_contact_id,
    jsonb_build_object('channel', target_channel, 'made_primary', make_primary)
  );

  return link_id;
end;
$$;

revoke all on function public.record_crm_activity_v2(
  uuid, uuid, bigint, public.crm_activity_kind, public.crm_lead_stage, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.record_crm_activity_v2(
  uuid, uuid, bigint, public.crm_activity_kind, public.crm_lead_stage, text, timestamptz
) to service_role;

revoke all on function public.save_crm_sales_profile(
  uuid, uuid, bigint, text, text, text, text, text, text, text[]
) from public, anon, authenticated;
grant execute on function public.save_crm_sales_profile(
  uuid, uuid, bigint, text, text, text, text, text, text, text[]
) to service_role;

revoke all on function public.add_crm_conversation_link(
  uuid, uuid, public.crm_conversation_channel, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.add_crm_conversation_link(
  uuid, uuid, public.crm_conversation_channel, text, text, boolean
) to service_role;

create or replace function private.canonicalize_notification_url()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  related_id uuid;
begin
  if new.entity_id is null then return new; end if;

  case new.entity_type
    when 'task' then
      new.url := '/tasks?task=' || new.entity_id || '#task-' || new.entity_id;
    when 'crm_contact' then
      new.url := '/crm/' || new.entity_id;
    when 'content_item' then
      new.url := '/content?content=' || new.entity_id || '#content-' || new.entity_id;
    when 'content_revision' then
      select revision.content_item_id into related_id
      from public.content_revision_requests revision
      where revision.id = new.entity_id;
      if related_id is not null then
        new.url := '/content?content=' || related_id || '&revision=' || new.entity_id || '#revision-' || new.entity_id;
      end if;
    when 'script' then
      new.url := '/scripts/' || new.entity_id;
    when 'script_research' then
      new.url := '/scripts?tab=radar&research=' || new.entity_id || '#research-' || new.entity_id;
    when 'publishing_occurrence' then
      new.url := '/publishing?occurrence=' || new.entity_id || '#occurrence-' || new.entity_id;
    when 'launch' then
      new.url := '/campaigns?launch=' || new.entity_id || '#launch-' || new.entity_id;
    when 'launch_deliverable' then
      new.url := '/campaigns?deliverable=' || new.entity_id || '#deliverable-' || new.entity_id;
    when 'membership' then
      select membership.user_id into related_id
      from public.memberships membership
      where membership.id = new.entity_id;
      related_id := coalesce(related_id, new.entity_id);
      new.url := '/team?member=' || related_id || '#member-' || related_id;
    else
      null;
  end case;

  return new;
end;
$$;

-- Re-canonicalize existing customer notifications without touching task links.
update public.notifications notification
set url = notification.url
where notification.entity_type = 'crm_contact';

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'crm_sales_profiles'
    ) then
    alter publication supabase_realtime add table public.crm_sales_profiles;
  end if;
end;
$$;

comment on table public.crm_sales_profiles is
  'Private structured sales context for one CRM customer file; readable only by the assigned CRM owner or leadership with CRM section access.';
comment on function public.record_crm_activity_v2(
  uuid, uuid, bigint, public.crm_activity_kind, public.crm_lead_stage, text, timestamptz
) is 'Atomically completes current CRM tasks, updates the contact, records the activity, and creates the next follow-up task.';
