-- CRM foundation: one governed lead record, deduplicated contact identity,
-- immutable follow-up history, and an accountable task for every next action.

create type public.crm_lead_stage as enum (
  'new',
  'contacted',
  'qualified',
  'follow_up',
  'won',
  'lost',
  'do_not_contact'
);

create type public.crm_source as enum (
  'manual',
  'whales_zone',
  'samihagwa_site',
  'telegram',
  'meta',
  'market_whales_app',
  'exness',
  'tickmill',
  'referral',
  'other'
);

create type public.crm_interest as enum (
  'indicator',
  'signals_gold',
  'signals_fx',
  'course',
  'brokerage',
  'book',
  'service',
  'other'
);

create type public.crm_identity_kind as enum (
  'phone',
  'email',
  'telegram'
);

create type public.crm_consent_status as enum (
  'unknown',
  'granted',
  'denied'
);

create type public.crm_activity_kind as enum (
  'created',
  'call',
  'message',
  'email',
  'note'
);

create table public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  full_name text not null,
  stage public.crm_lead_stage not null default 'new',
  source public.crm_source not null,
  interest public.crm_interest not null,
  owner_id uuid not null references public.profiles (id) on delete restrict,
  consent_status public.crm_consent_status not null default 'unknown',
  next_follow_up_at timestamptz,
  last_contacted_at timestamptz,
  converted_at timestamptz,
  closure_reason text,
  notes text,
  created_by uuid not null references public.profiles (id) on delete restrict,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  constraint crm_contacts_name_length check (char_length(trim(full_name)) between 2 and 160),
  constraint crm_contacts_notes_length check (notes is null or char_length(notes) <= 5000),
  constraint crm_contacts_closure_reason_length check (closure_reason is null or char_length(trim(closure_reason)) between 3 and 1000),
  constraint crm_contacts_version_positive check (version > 0),
  constraint crm_contacts_follow_up_contract check (
    (stage in ('new', 'contacted', 'qualified', 'follow_up') and next_follow_up_at is not null)
    or (stage in ('won', 'lost', 'do_not_contact') and next_follow_up_at is null)
  ),
  constraint crm_contacts_conversion_consistent check (
    (stage = 'won' and converted_at is not null)
    or (stage <> 'won' and converted_at is null)
  ),
  constraint crm_contacts_closure_consistent check (
    (stage in ('lost', 'do_not_contact') and closure_reason is not null)
    or (stage not in ('lost', 'do_not_contact') and closure_reason is null)
  ),
  constraint crm_contacts_consent_consistent check (
    (stage = 'do_not_contact' and consent_status = 'denied')
    or (stage <> 'do_not_contact' and consent_status <> 'denied')
  )
);

create table public.crm_identities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contact_id uuid not null,
  kind public.crm_identity_kind not null,
  value text not null,
  normalized_value text not null,
  is_primary boolean not null default false,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint crm_identities_contact_org_fkey
    foreign key (contact_id, organization_id)
    references public.crm_contacts (id, organization_id)
    on delete cascade,
  constraint crm_identities_value_length check (char_length(trim(value)) between 3 and 320),
  constraint crm_identities_normalized_length check (char_length(normalized_value) between 3 and 320),
  unique (organization_id, kind, normalized_value)
);

create unique index crm_identities_one_primary_idx
  on public.crm_identities (contact_id)
  where is_primary;

create table public.crm_activities (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contact_id uuid not null,
  actor_id uuid references public.profiles (id) on delete set null,
  kind public.crm_activity_kind not null,
  from_stage public.crm_lead_stage,
  to_stage public.crm_lead_stage not null,
  summary text not null,
  next_follow_up_at timestamptz,
  occurred_at timestamptz not null default now(),
  constraint crm_activities_contact_org_fkey
    foreign key (contact_id, organization_id)
    references public.crm_contacts (id, organization_id)
    on delete cascade,
  constraint crm_activities_summary_length check (char_length(trim(summary)) between 3 and 4000)
);

create index crm_contacts_org_stage_follow_up_idx
  on public.crm_contacts (organization_id, stage, next_follow_up_at, id);

create index crm_contacts_owner_stage_follow_up_idx
  on public.crm_contacts (owner_id, stage, next_follow_up_at, id);

create index crm_contacts_org_due_idx
  on public.crm_contacts (organization_id, next_follow_up_at, id)
  where stage in ('new', 'contacted', 'qualified', 'follow_up');

create index crm_contacts_source_idx
  on public.crm_contacts (organization_id, source, created_at desc, id);

create index crm_contacts_creator_idx
  on public.crm_contacts (created_by);

create index crm_identities_contact_org_idx
  on public.crm_identities (contact_id, organization_id, id);

create index crm_identities_creator_idx
  on public.crm_identities (created_by);

create index crm_activities_contact_time_idx
  on public.crm_activities (contact_id, organization_id, occurred_at desc, id desc);

create index crm_activities_org_time_idx
  on public.crm_activities (organization_id, occurred_at desc, id desc);

create index crm_activities_actor_idx
  on public.crm_activities (actor_id);

alter table public.tasks
  add column crm_contact_id uuid;

alter table public.tasks
  drop constraint tasks_workflow_link_exclusive,
  add constraint tasks_workflow_link_exclusive check (
    num_nonnulls(content_item_id, launch_id, crm_contact_id) <= 1
  ),
  add constraint tasks_crm_contact_org_fkey
    foreign key (crm_contact_id, organization_id)
    references public.crm_contacts (id, organization_id)
    on delete restrict;

create index tasks_crm_contact_status_idx
  on public.tasks (crm_contact_id, status, due_at, id)
  where crm_contact_id is not null;

create index tasks_crm_contact_org_fk_idx
  on public.tasks (crm_contact_id, organization_id)
  where crm_contact_id is not null;

create unique index tasks_one_open_crm_follow_up_idx
  on public.tasks (crm_contact_id)
  where crm_contact_id is not null
    and status not in ('done', 'cancelled');

create or replace function private.normalize_crm_identity(
  identity_kind public.crm_identity_kind,
  identity_value text
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case identity_kind
    when 'email' then lower(trim(identity_value))
    when 'phone' then regexp_replace(identity_value, '[^0-9+]', '', 'g')
    when 'telegram' then lower(regexp_replace(trim(identity_value), '^@', ''))
  end;
$$;

create or replace function private.is_valid_crm_transition(
  previous_stage public.crm_lead_stage,
  next_stage public.crm_lead_stage
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select
    previous_stage = next_stage
    or (previous_stage = 'new' and next_stage in ('contacted', 'qualified', 'follow_up', 'won', 'lost', 'do_not_contact'))
    or (previous_stage = 'contacted' and next_stage in ('qualified', 'follow_up', 'won', 'lost', 'do_not_contact'))
    or (previous_stage = 'qualified' and next_stage in ('follow_up', 'won', 'lost', 'do_not_contact'))
    or (previous_stage = 'follow_up' and next_stage in ('contacted', 'qualified', 'won', 'lost', 'do_not_contact'))
    or (previous_stage = 'lost' and next_stage = 'follow_up');
$$;

create or replace function private.can_access_crm_contact(
  target_contact_id uuid,
  target_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.crm_contacts contact
    join public.memberships membership
      on membership.organization_id = contact.organization_id
     and membership.user_id = (select auth.uid())
     and membership.status = 'active'
    where contact.id = target_contact_id
      and contact.organization_id = target_organization_id
      and (
        contact.owner_id = (select auth.uid())
        or membership.role in ('owner', 'admin', 'manager')
      )
  );
$$;

create or replace function private.enforce_task_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  actor_is_manager boolean;
  owner_is_active boolean;
  actor_owns_crm_contact boolean := false;
  crm_command_contact_id text := nullif(current_setting('app.crm_contact_id', true), '');
begin
  if actor is null then
    raise exception 'An authenticated actor is required';
  end if;

  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then
    if (old.content_item_id is null and old.launch_id is null and old.crm_contact_id is null)
      or old.status <> 'backlog'
      or new.status <> 'ready'
      or (to_jsonb(new) - array['status', 'version', 'updated_at']::text[])
        is distinct from
        (to_jsonb(old) - array['status', 'version', 'updated_at']::text[]) then
      raise exception 'Invalid internal task transition';
    end if;

    new.version := old.version + 1;
    new.updated_at := now();
    return new;
  end if;

  select exists (
    select 1
    from public.memberships membership
    where membership.organization_id = new.organization_id
      and membership.user_id = actor
      and membership.status = 'active'
      and membership.role in ('owner', 'admin', 'manager')
  ) into actor_is_manager;

  select exists (
    select 1
    from public.memberships membership
    where membership.organization_id = new.organization_id
      and membership.user_id = new.owner_id
      and membership.status = 'active'
  ) into owner_is_active;

  if not owner_is_active then
    raise exception 'Task owner must be an active member of the organization';
  end if;

  if new.crm_contact_id is not null then
    select exists (
      select 1
      from public.crm_contacts contact
      where contact.id = new.crm_contact_id
        and contact.organization_id = new.organization_id
        and contact.owner_id = actor
    ) into actor_owns_crm_contact;

    if crm_command_contact_id is distinct from new.crm_contact_id::text then
      raise exception 'CRM follow-up tasks are managed through the CRM workflow only';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if not actor_is_manager and not actor_owns_crm_contact then
      raise exception 'Only organization leadership can create tasks, except a CRM owner creating their own follow-up';
    end if;

    if new.status not in ('backlog', 'ready') then
      raise exception 'New tasks must start in backlog or ready';
    end if;

    if new.due_at <= now() then
      raise exception 'New task deadline must be in the future';
    end if;

    new.created_by := actor;
    new.version := 1;
    new.started_at := null;
    new.completed_at := null;
    return new;
  end if;

  if new.organization_id <> old.organization_id
    or new.id <> old.id
    or new.created_by <> old.created_by
    or new.created_at <> old.created_at
    or new.content_item_id is distinct from old.content_item_id
    or new.content_step is distinct from old.content_step
    or new.launch_id is distinct from old.launch_id
    or new.launch_gate is distinct from old.launch_gate
    or new.crm_contact_id is distinct from old.crm_contact_id then
    raise exception 'Task identity, organization, and workflow link fields are immutable';
  end if;

  if not actor_is_manager then
    if old.owner_id <> actor then
      raise exception 'Only task owners or organization leadership can update tasks';
    end if;

    if new.title is distinct from old.title
      or new.description is distinct from old.description
      or new.priority is distinct from old.priority
      or new.owner_id is distinct from old.owner_id
      or new.acceptance_criteria is distinct from old.acceptance_criteria
      or new.due_at is distinct from old.due_at then
      raise exception 'Task owners may change status only';
    end if;
  end if;

  if not private.is_valid_task_transition(old.status, new.status) then
    raise exception 'Invalid task status transition from % to %', old.status, new.status;
  end if;

  if old.status <> 'in_progress' and new.status = 'in_progress' and new.started_at is null then
    new.started_at := now();
  end if;

  if new.status = 'done' then
    new.completed_at := coalesce(old.completed_at, now());
  elsif old.status = 'done' then
    new.completed_at := null;
  end if;

  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.create_crm_lead(
  target_user_id uuid,
  target_organization_id uuid,
  contact_full_name text,
  contact_source public.crm_source,
  contact_interest public.crm_interest,
  contact_owner_id uuid,
  contact_consent_status public.crm_consent_status,
  identity_kind public.crm_identity_kind,
  identity_value text,
  initial_notes text,
  target_follow_up_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.app_role;
  normalized_identity text;
  contact_id uuid;
begin
  if target_user_id is null then
    raise exception 'A verified target user is required';
  end if;

  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  select membership.role
  into actor_role
  from public.memberships membership
  where membership.organization_id = target_organization_id
    and membership.user_id = target_user_id
    and membership.status = 'active';

  if actor_role is null or actor_role = 'viewer' then
    raise exception 'Only an active working member can create CRM leads';
  end if;

  if actor_role not in ('owner', 'admin', 'manager')
    and contact_owner_id <> target_user_id then
    raise exception 'Team members can create CRM leads for themselves only';
  end if;

  if not exists (
    select 1
    from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = contact_owner_id
      and membership.status = 'active'
  ) then
    raise exception 'CRM owner must be an active organization member';
  end if;

  if contact_consent_status = 'denied' then
    raise exception 'A denied contact cannot be created with an active follow-up';
  end if;

  if trim(contact_full_name) is null
    or char_length(trim(contact_full_name)) not between 2 and 160 then
    raise exception 'CRM contact name must contain between 2 and 160 characters';
  end if;

  if target_follow_up_at is null or target_follow_up_at <= now() then
    raise exception 'CRM follow-up time must be in the future';
  end if;

  normalized_identity := private.normalize_crm_identity(identity_kind, identity_value);

  if identity_kind = 'email' and normalized_identity !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Email identity is invalid';
  elsif identity_kind = 'phone' and normalized_identity !~ '^\+?[0-9]{7,16}$' then
    raise exception 'Phone identity is invalid';
  elsif identity_kind = 'telegram' and normalized_identity !~ '^[a-z0-9_]{5,32}$' then
    raise exception 'Telegram username is invalid';
  end if;

  if exists (
    select 1
    from public.crm_identities identity
    where identity.organization_id = target_organization_id
      and identity.kind = identity_kind
      and identity.normalized_value = normalized_identity
  ) then
    raise exception 'This contact identity already belongs to another CRM record';
  end if;

  insert into public.crm_contacts (
    organization_id,
    full_name,
    stage,
    source,
    interest,
    owner_id,
    consent_status,
    next_follow_up_at,
    notes,
    created_by
  ) values (
    target_organization_id,
    trim(contact_full_name),
    'new',
    contact_source,
    contact_interest,
    contact_owner_id,
    contact_consent_status,
    target_follow_up_at,
    nullif(trim(initial_notes), ''),
    target_user_id
  ) returning id into contact_id;

  insert into public.crm_identities (
    organization_id,
    contact_id,
    kind,
    value,
    normalized_value,
    is_primary,
    created_by
  ) values (
    target_organization_id,
    contact_id,
    identity_kind,
    trim(identity_value),
    normalized_identity,
    true,
    target_user_id
  );

  insert into public.crm_activities (
    organization_id,
    contact_id,
    actor_id,
    kind,
    from_stage,
    to_stage,
    summary,
    next_follow_up_at
  ) values (
    target_organization_id,
    contact_id,
    target_user_id,
    'created',
    null,
    'new',
    'تم إنشاء سجل العميل المحتمل وتحديد أول متابعة.',
    target_follow_up_at
  );

  perform set_config('app.crm_contact_id', contact_id::text, true);

  insert into public.tasks (
    organization_id,
    title,
    description,
    status,
    priority,
    owner_id,
    created_by,
    acceptance_criteria,
    due_at,
    crm_contact_id
  ) values (
    target_organization_id,
    'متابعة عميل محتمل',
    'افتح ملف CRM المرتبط وسجّل نتيجة التواصل والموعد التالي.',
    'ready',
    case when target_follow_up_at <= now() + interval '24 hours'
      then 'high'::public.task_priority
      else 'normal'::public.task_priority
    end,
    contact_owner_id,
    target_user_id,
    'نتيجة التواصل مسجلة في CRM مع المرحلة والموعد التالي أو سبب الإغلاق.',
    target_follow_up_at,
    contact_id
  );

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id,
    target_user_id,
    'crm.lead_created',
    'crm_contact',
    contact_id,
    jsonb_build_object(
      'source', contact_source,
      'interest', contact_interest,
      'owner_id', contact_owner_id,
      'identity_kind', identity_kind,
      'follow_up_at', target_follow_up_at
    )
  );

  return contact_id;
end;
$$;

create or replace function public.record_crm_activity(
  target_user_id uuid,
  target_contact_id uuid,
  activity_kind public.crm_activity_kind,
  next_stage public.crm_lead_stage,
  activity_summary text,
  target_next_follow_up_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  contact_record public.crm_contacts%rowtype;
  actor_role public.app_role;
begin
  if target_user_id is null then
    raise exception 'A verified target user is required';
  end if;

  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  select contact.*
  into contact_record
  from public.crm_contacts contact
  where contact.id = target_contact_id
  for update;

  if contact_record.id is null then
    raise exception 'CRM contact was not found';
  end if;

  select membership.role
  into actor_role
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

  if next_stage in ('new', 'contacted', 'qualified', 'follow_up') then
    if target_next_follow_up_at is null or target_next_follow_up_at <= now() then
      raise exception 'An active CRM lead requires a future follow-up time';
    end if;
  elsif target_next_follow_up_at is not null then
    raise exception 'Closed CRM stages cannot keep an open follow-up time';
  end if;

  perform set_config('app.crm_contact_id', target_contact_id::text, true);

  update public.tasks task
  set status = 'ready'
  where task.crm_contact_id = target_contact_id
    and task.status = 'backlog';

  update public.tasks task
  set status = 'in_progress'
  where task.crm_contact_id = target_contact_id
    and task.status in ('ready', 'blocked');

  update public.tasks task
  set status = 'review'
  where task.crm_contact_id = target_contact_id
    and task.status = 'in_progress';

  update public.tasks task
  set status = 'done'
  where task.crm_contact_id = target_contact_id
    and task.status = 'review';

  update public.crm_contacts contact
  set
    stage = next_stage,
    next_follow_up_at = case
      when next_stage in ('new', 'contacted', 'qualified', 'follow_up') then target_next_follow_up_at
      else null
    end,
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
      else contact.consent_status
    end,
    version = contact.version + 1,
    updated_at = now()
  where contact.id = target_contact_id;

  insert into public.crm_activities (
    organization_id,
    contact_id,
    actor_id,
    kind,
    from_stage,
    to_stage,
    summary,
    next_follow_up_at
  ) values (
    contact_record.organization_id,
    target_contact_id,
    target_user_id,
    activity_kind,
    contact_record.stage,
    next_stage,
    trim(activity_summary),
    case
      when next_stage in ('new', 'contacted', 'qualified', 'follow_up') then target_next_follow_up_at
      else null
    end
  );

  if next_stage in ('new', 'contacted', 'qualified', 'follow_up') then
    insert into public.tasks (
      organization_id,
      title,
      description,
      status,
      priority,
      owner_id,
      created_by,
      acceptance_criteria,
      due_at,
      crm_contact_id
    ) values (
      contact_record.organization_id,
      'متابعة عميل محتمل',
      'افتح ملف CRM المرتبط وسجّل نتيجة التواصل والموعد التالي.',
      'ready',
      case when target_next_follow_up_at <= now() + interval '24 hours'
        then 'high'::public.task_priority
        else 'normal'::public.task_priority
      end,
      contact_record.owner_id,
      target_user_id,
      'نتيجة التواصل مسجلة في CRM مع المرحلة والموعد التالي أو سبب الإغلاق.',
      target_next_follow_up_at,
      target_contact_id
    );
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
      'next_follow_up_at', contact_record.next_follow_up_at,
      'version', contact_record.version
    ),
    jsonb_build_object(
      'stage', next_stage,
      'next_follow_up_at', target_next_follow_up_at,
      'version', contact_record.version + 1,
      'activity_kind', activity_kind
    )
  );

  return true;
end;
$$;

alter table public.crm_contacts enable row level security;
alter table public.crm_identities enable row level security;
alter table public.crm_activities enable row level security;

create policy "crm_contacts_select_owner_or_leadership"
on public.crm_contacts
for select
to authenticated
using (
  owner_id = (select auth.uid())
  or private.has_org_role(
    organization_id,
    array['owner', 'admin', 'manager']::public.app_role[]
  )
);

create policy "crm_identities_select_contact_access"
on public.crm_identities
for select
to authenticated
using (private.can_access_crm_contact(contact_id, organization_id));

create policy "crm_activities_select_contact_access"
on public.crm_activities
for select
to authenticated
using (private.can_access_crm_contact(contact_id, organization_id));

revoke all on table public.crm_contacts from anon, authenticated;
revoke all on table public.crm_identities from anon, authenticated;
revoke all on table public.crm_activities from anon, authenticated;

grant select on table public.crm_contacts to authenticated;
grant select on table public.crm_identities to authenticated;
grant select on table public.crm_activities to authenticated;

revoke all on function private.normalize_crm_identity(public.crm_identity_kind, text)
from public, anon, authenticated;
revoke all on function private.is_valid_crm_transition(public.crm_lead_stage, public.crm_lead_stage)
from public, anon, authenticated;
revoke all on function private.can_access_crm_contact(uuid, uuid)
from public, anon, authenticated;
grant execute on function private.can_access_crm_contact(uuid, uuid)
to authenticated;
revoke all on function private.enforce_task_rules()
from public, anon, authenticated;

revoke all on function public.create_crm_lead(
  uuid, uuid, text, public.crm_source, public.crm_interest, uuid,
  public.crm_consent_status, public.crm_identity_kind, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.create_crm_lead(
  uuid, uuid, text, public.crm_source, public.crm_interest, uuid,
  public.crm_consent_status, public.crm_identity_kind, text, text, timestamptz
) to service_role;

revoke all on function public.record_crm_activity(
  uuid, uuid, public.crm_activity_kind, public.crm_lead_stage, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.record_crm_activity(
  uuid, uuid, public.crm_activity_kind, public.crm_lead_stage, text, timestamptz
) to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'crm_contacts'
    ) then
      alter publication supabase_realtime add table public.crm_contacts;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'crm_activities'
    ) then
      alter publication supabase_realtime add table public.crm_activities;
    end if;
  end if;
end;
$$;
