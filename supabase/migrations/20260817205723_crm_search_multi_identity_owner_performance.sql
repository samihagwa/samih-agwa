-- Scale CRM discovery without downloading every customer record, allow several
-- deduplicated identities per contact, and expose evidence-based owner metrics.

create extension if not exists pg_trgm with schema extensions;

create index crm_contacts_search_trgm_idx
  on public.crm_contacts using gin (
    lower(
      coalesce(full_name, '') || ' ' ||
      coalesce(notes, '') || ' ' ||
      coalesce(source_detail, '') || ' ' ||
      coalesce(interest_detail, '')
    ) extensions.gin_trgm_ops
  );

create index crm_identities_search_trgm_idx
  on public.crm_identities using gin (
    lower(coalesce(value, '') || ' ' || coalesce(normalized_value, '')) extensions.gin_trgm_ops
  );

create index crm_conversation_links_search_trgm_idx
  on public.crm_conversation_links using gin (
    lower(coalesce(label, '') || ' ' || coalesce(url, '')) extensions.gin_trgm_ops
  );

create index crm_activities_search_trgm_idx
  on public.crm_activities using gin (lower(summary) extensions.gin_trgm_ops);

create or replace function private.validate_crm_identity(
  target_kind public.crm_identity_kind,
  target_value text
)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  normalized_identity text;
begin
  if target_kind is null or char_length(trim(target_value)) not between 3 and 320 then
    raise exception 'CRM identity is incomplete';
  end if;

  normalized_identity := private.normalize_crm_identity(target_kind, target_value);

  if target_kind = 'email' and normalized_identity !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Email identity is invalid';
  elsif target_kind = 'phone' and normalized_identity !~ '^\+?[0-9]{7,16}$' then
    raise exception 'Phone identity is invalid';
  elsif target_kind = 'telegram' and normalized_identity !~ '^[a-z0-9_]{5,32}$' then
    raise exception 'Telegram username is invalid';
  end if;

  return normalized_identity;
end;
$$;

revoke all on function private.validate_crm_identity(public.crm_identity_kind, text)
from public, anon, authenticated;

create or replace function public.create_crm_lead_v3(
  target_user_id uuid,
  target_organization_id uuid,
  contact_full_name text,
  contact_source public.crm_source,
  contact_source_detail text,
  contact_interest public.crm_interest,
  contact_interest_detail text,
  contact_owner_id uuid,
  contact_consent_status public.crm_consent_status,
  contact_identities jsonb,
  initial_notes text,
  target_follow_up_at timestamptz,
  target_conversation_channel public.crm_conversation_channel,
  target_conversation_url text,
  target_conversation_label text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  identity_record record;
  primary_kind public.crm_identity_kind;
  primary_value text;
  normalized_identity text;
  contact_id uuid;
begin
  if jsonb_typeof(contact_identities) <> 'array'
    or jsonb_array_length(contact_identities) not between 1 and 3 then
    raise exception 'Provide between one and three CRM contact identities';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(contact_identities) item
    where jsonb_typeof(item) <> 'object'
      or item->>'kind' not in ('phone', 'email', 'telegram')
      or char_length(trim(item->>'value')) not between 3 and 320
      or coalesce(item->>'is_primary', 'false') not in ('true', 'false')
  ) then
    raise exception 'One or more CRM identities are invalid';
  end if;

  if (
    select count(distinct item->>'kind')
    from jsonb_array_elements(contact_identities) item
  ) <> jsonb_array_length(contact_identities) then
    raise exception 'Provide each CRM identity kind only once when creating a lead';
  end if;

  if (
    select count(*)
    from jsonb_array_elements(contact_identities) item
    where coalesce((item->>'is_primary')::boolean, false)
  ) <> 1 then
    raise exception 'Choose exactly one primary CRM identity';
  end if;

  for identity_record in
    select
      (item->>'kind')::public.crm_identity_kind as kind,
      trim(item->>'value') as value,
      coalesce((item->>'is_primary')::boolean, false) as is_primary
    from jsonb_array_elements(contact_identities) item
  loop
    normalized_identity := private.validate_crm_identity(identity_record.kind, identity_record.value);

    if exists (
      select 1
      from public.crm_identities identity
      where identity.organization_id = target_organization_id
        and identity.kind = identity_record.kind
        and identity.normalized_value = normalized_identity
    ) then
      raise exception 'This contact identity already belongs to another CRM record';
    end if;

    if identity_record.is_primary then
      primary_kind := identity_record.kind;
      primary_value := identity_record.value;
    end if;
  end loop;

  contact_id := public.create_crm_lead_v2(
    target_user_id,
    target_organization_id,
    contact_full_name,
    contact_source,
    contact_source_detail,
    contact_interest,
    contact_interest_detail,
    contact_owner_id,
    contact_consent_status,
    primary_kind,
    primary_value,
    initial_notes,
    target_follow_up_at,
    target_conversation_channel,
    target_conversation_url,
    target_conversation_label
  );

  for identity_record in
    select
      (item->>'kind')::public.crm_identity_kind as kind,
      trim(item->>'value') as value,
      coalesce((item->>'is_primary')::boolean, false) as is_primary
    from jsonb_array_elements(contact_identities) item
    where not coalesce((item->>'is_primary')::boolean, false)
  loop
    insert into public.crm_identities (
      organization_id, contact_id, kind, value, normalized_value, is_primary, created_by
    ) values (
      target_organization_id,
      contact_id,
      identity_record.kind,
      identity_record.value,
      private.validate_crm_identity(identity_record.kind, identity_record.value),
      false,
      target_user_id
    );
  end loop;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id,
    target_user_id,
    'crm.identities_created',
    'crm_contact',
    contact_id,
    jsonb_build_object(
      'identity_kinds', (
        select jsonb_agg(item->>'kind' order by item->>'kind')
        from jsonb_array_elements(contact_identities) item
      )
    )
  );

  return contact_id;
end;
$$;

create or replace function public.add_crm_identity(
  target_user_id uuid,
  target_contact_id uuid,
  identity_kind public.crm_identity_kind,
  identity_value text,
  make_primary boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  contact_record public.crm_contacts%rowtype;
  normalized_identity text;
  identity_id uuid;
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
    raise exception 'Only the CRM owner or organization leadership can add contact identities';
  end if;

  normalized_identity := private.validate_crm_identity(identity_kind, identity_value);

  if exists (
    select 1 from public.crm_identities identity
    where identity.organization_id = contact_record.organization_id
      and identity.kind = identity_kind
      and identity.normalized_value = normalized_identity
  ) then
    raise exception 'This contact identity already belongs to another CRM record';
  end if;

  if make_primary then
    update public.crm_identities identity
    set is_primary = false
    where identity.contact_id = contact_record.id
      and identity.is_primary;
  end if;

  insert into public.crm_identities (
    organization_id, contact_id, kind, value, normalized_value, is_primary, created_by
  ) values (
    contact_record.organization_id,
    contact_record.id,
    identity_kind,
    trim(identity_value),
    normalized_identity,
    make_primary,
    target_user_id
  ) returning id into identity_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    contact_record.organization_id,
    target_user_id,
    'crm.identity_added',
    'crm_contact',
    contact_record.id,
    jsonb_build_object('identity_kind', identity_kind, 'made_primary', make_primary)
  );

  return identity_id;
end;
$$;

create or replace function public.search_crm_contacts(
  target_organization_id uuid,
  search_query text,
  target_owner_id uuid,
  target_stage public.crm_lead_stage,
  target_scope text,
  result_limit integer,
  result_offset integer
)
returns table (contact_id uuid, total_count bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  clean_query text := nullif(lower(trim(search_query)), '');
  query_pattern text;
begin
  if target_scope not in ('all', 'mine', 'overdue') then
    raise exception 'CRM search scope is invalid';
  end if;

  if clean_query is not null and char_length(clean_query) < 2 then
    raise exception 'CRM search needs at least two characters';
  end if;

  if result_limit not between 1 and 100 or result_offset not between 0 and 1000000 then
    raise exception 'CRM result page is invalid';
  end if;

  if clean_query is not null then
    query_pattern := '%' ||
      replace(replace(replace(clean_query, '\', '\\'), '%', '\%'), '_', '\_') ||
      '%';
  end if;

  return query
  select
    contact.id,
    count(*) over () as total_count
  from public.crm_contacts contact
  where contact.organization_id = target_organization_id
    and (target_owner_id is null or contact.owner_id = target_owner_id)
    and (target_stage is null or contact.stage = target_stage)
    and (
      target_scope = 'all'
      or (target_scope = 'mine' and contact.owner_id = (select auth.uid()))
      or (
        target_scope = 'overdue'
        and contact.stage in ('new', 'contacted', 'qualified', 'follow_up')
        and contact.next_follow_up_at < now()
      )
    )
    and (
      clean_query is null
      or lower(
        coalesce(contact.full_name, '') || ' ' ||
        coalesce(contact.notes, '') || ' ' ||
        coalesce(contact.source_detail, '') || ' ' ||
        coalesce(contact.interest_detail, '')
      ) like query_pattern escape '\'
      or exists (
        select 1 from public.crm_identities identity
        where identity.contact_id = contact.id
          and identity.organization_id = contact.organization_id
          and lower(coalesce(identity.value, '') || ' ' || coalesce(identity.normalized_value, ''))
            like query_pattern escape '\'
      )
      or exists (
        select 1 from public.crm_conversation_links conversation
        where conversation.contact_id = contact.id
          and conversation.organization_id = contact.organization_id
          and lower(coalesce(conversation.label, '') || ' ' || coalesce(conversation.url, ''))
            like query_pattern escape '\'
      )
      or exists (
        select 1 from public.crm_activities activity
        where activity.contact_id = contact.id
          and activity.organization_id = contact.organization_id
          and lower(activity.summary) like query_pattern escape '\'
      )
    )
  order by contact.next_follow_up_at asc nulls last, contact.created_at desc, contact.id
  limit result_limit
  offset result_offset;
end;
$$;

create or replace function public.get_crm_owner_performance(
  target_organization_id uuid,
  target_range_days integer
)
returns table (
  owner_id uuid,
  total_contacts bigint,
  active_contacts bigint,
  new_contacts bigint,
  won_contacts bigint,
  won_in_period bigint,
  lost_contacts bigint,
  overdue_contacts bigint,
  activities_in_period bigint,
  completed_follow_ups bigint,
  on_time_follow_ups bigint,
  last_activity_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  period_start timestamptz;
begin
  if target_range_days not between 1 and 365 then
    raise exception 'CRM performance range must be between 1 and 365 days';
  end if;

  period_start := now() - make_interval(days => target_range_days);

  return query
  with team as (
    select membership.user_id
    from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.status = 'active'
      and membership.role <> 'viewer'
  ),
  contact_stats as (
    select
      contact.owner_id,
      count(*) as total_contacts,
      count(*) filter (where contact.stage in ('new', 'contacted', 'qualified', 'follow_up')) as active_contacts,
      count(*) filter (where contact.stage = 'new') as new_contacts,
      count(*) filter (where contact.stage = 'won') as won_contacts,
      count(*) filter (where contact.stage = 'won' and contact.converted_at >= period_start) as won_in_period,
      count(*) filter (where contact.stage = 'lost') as lost_contacts,
      count(*) filter (
        where contact.stage in ('new', 'contacted', 'qualified', 'follow_up')
          and contact.next_follow_up_at < now()
      ) as overdue_contacts
    from public.crm_contacts contact
    where contact.organization_id = target_organization_id
    group by contact.owner_id
  ),
  activity_stats as (
    select
      contact.owner_id,
      count(*) filter (
        where activity.kind <> 'created' and activity.occurred_at >= period_start
      ) as activities_in_period,
      max(activity.occurred_at) filter (where activity.kind <> 'created') as last_activity_at
    from public.crm_contacts contact
    join public.crm_activities activity
      on activity.contact_id = contact.id
     and activity.organization_id = contact.organization_id
    where contact.organization_id = target_organization_id
    group by contact.owner_id
  ),
  task_stats as (
    select
      contact.owner_id,
      count(*) filter (
        where task.status = 'done' and task.completed_at >= period_start
      ) as completed_follow_ups,
      count(*) filter (
        where task.status = 'done'
          and task.completed_at >= period_start
          and task.completed_at <= task.due_at
      ) as on_time_follow_ups
    from public.crm_contacts contact
    join public.tasks task
      on task.crm_contact_id = contact.id
     and task.organization_id = contact.organization_id
    where contact.organization_id = target_organization_id
    group by contact.owner_id
  )
  select
    team.user_id,
    coalesce(contact_stats.total_contacts, 0),
    coalesce(contact_stats.active_contacts, 0),
    coalesce(contact_stats.new_contacts, 0),
    coalesce(contact_stats.won_contacts, 0),
    coalesce(contact_stats.won_in_period, 0),
    coalesce(contact_stats.lost_contacts, 0),
    coalesce(contact_stats.overdue_contacts, 0),
    coalesce(activity_stats.activities_in_period, 0),
    coalesce(task_stats.completed_follow_ups, 0),
    coalesce(task_stats.on_time_follow_ups, 0),
    activity_stats.last_activity_at
  from team
  left join contact_stats on contact_stats.owner_id = team.user_id
  left join activity_stats on activity_stats.owner_id = team.user_id
  left join task_stats on task_stats.owner_id = team.user_id
  order by coalesce(contact_stats.won_in_period, 0) desc,
    coalesce(activity_stats.activities_in_period, 0) desc,
    team.user_id;
end;
$$;

revoke all on function public.create_crm_lead_v3(
  uuid, uuid, text, public.crm_source, text, public.crm_interest, text, uuid,
  public.crm_consent_status, jsonb, text, timestamptz,
  public.crm_conversation_channel, text, text
) from public, anon, authenticated;
grant execute on function public.create_crm_lead_v3(
  uuid, uuid, text, public.crm_source, text, public.crm_interest, text, uuid,
  public.crm_consent_status, jsonb, text, timestamptz,
  public.crm_conversation_channel, text, text
) to service_role;

revoke all on function public.add_crm_identity(
  uuid, uuid, public.crm_identity_kind, text, boolean
) from public, anon, authenticated;
grant execute on function public.add_crm_identity(
  uuid, uuid, public.crm_identity_kind, text, boolean
) to service_role;

revoke all on function public.search_crm_contacts(
  uuid, text, uuid, public.crm_lead_stage, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.search_crm_contacts(
  uuid, text, uuid, public.crm_lead_stage, text, integer, integer
) to authenticated;

revoke all on function public.get_crm_owner_performance(uuid, integer)
from public, anon, authenticated;
grant execute on function public.get_crm_owner_performance(uuid, integer)
to authenticated;

comment on function public.search_crm_contacts(
  uuid, text, uuid, public.crm_lead_stage, text, integer, integer
) is 'RLS-aware paginated CRM search across contact, identity, conversation, and activity fields.';

comment on function public.get_crm_owner_performance(uuid, integer)
is 'RLS-aware owner activity, conversion, due-work, and timeliness evidence; no subjective performance label.';
