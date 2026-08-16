-- Real task management foundation.
-- Every task has one accountable owner, a deadline, acceptance criteria,
-- validated transitions, tenant-scoped RLS, and immutable activity history.

create type public.task_status as enum (
  'backlog',
  'ready',
  'in_progress',
  'review',
  'blocked',
  'done',
  'cancelled'
);

create type public.task_priority as enum (
  'low',
  'normal',
  'high',
  'urgent'
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null,
  description text,
  status public.task_status not null default 'backlog',
  priority public.task_priority not null default 'normal',
  owner_id uuid not null references public.profiles (id) on delete restrict,
  created_by uuid not null references public.profiles (id) on delete restrict,
  acceptance_criteria text not null,
  due_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_title_length check (char_length(trim(title)) between 3 and 180),
  constraint tasks_description_length check (description is null or char_length(description) <= 5000),
  constraint tasks_acceptance_criteria_length check (char_length(trim(acceptance_criteria)) between 5 and 4000),
  constraint tasks_version_positive check (version > 0),
  constraint tasks_done_has_completion check (status <> 'done' or completed_at is not null)
);

create table public.task_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete restrict,
  actor_id uuid references public.profiles (id) on delete set null,
  event_type text not null,
  from_status public.task_status,
  to_status public.task_status,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint task_events_type_allowed check (event_type in ('created', 'updated', 'status_changed', 'reassigned'))
);

create index tasks_org_status_due_idx
  on public.tasks (organization_id, status, due_at, id);

create index tasks_owner_status_due_idx
  on public.tasks (owner_id, status, due_at, id);

create index tasks_org_open_due_idx
  on public.tasks (organization_id, due_at, id)
  where status not in ('done', 'cancelled');

create index tasks_created_by_idx
  on public.tasks (created_by);

create index task_events_task_time_idx
  on public.task_events (task_id, occurred_at desc, id desc);

create index task_events_org_time_idx
  on public.task_events (organization_id, occurred_at desc, id desc);

create index task_events_actor_idx
  on public.task_events (actor_id);

create or replace function private.is_valid_task_transition(
  previous_status public.task_status,
  next_status public.task_status
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select
    previous_status = next_status
    or (previous_status = 'backlog' and next_status in ('ready', 'cancelled'))
    or (previous_status = 'ready' and next_status in ('backlog', 'in_progress', 'cancelled'))
    or (previous_status = 'in_progress' and next_status in ('ready', 'review', 'blocked', 'cancelled'))
    or (previous_status = 'blocked' and next_status in ('ready', 'in_progress', 'cancelled'))
    or (previous_status = 'review' and next_status in ('in_progress', 'blocked', 'done'))
    or (previous_status = 'done' and next_status = 'in_progress')
    or (previous_status = 'cancelled' and next_status = 'backlog');
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
begin
  if actor is null then
    raise exception 'An authenticated actor is required';
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

  if tg_op = 'INSERT' then
    if not actor_is_manager then
      raise exception 'Only organization leadership can create tasks';
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
    or new.created_at <> old.created_at then
    raise exception 'Task identity and organization fields are immutable';
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

create or replace function private.record_task_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_name text;
  actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    event_name := 'created';
  elsif new.status is distinct from old.status then
    event_name := 'status_changed';
  elsif new.owner_id is distinct from old.owner_id then
    event_name := 'reassigned';
  else
    event_name := 'updated';
  end if;

  insert into public.task_events (
    organization_id,
    task_id,
    actor_id,
    event_type,
    from_status,
    to_status,
    details
  ) values (
    new.organization_id,
    new.id,
    actor,
    event_name,
    case when tg_op = 'UPDATE' then old.status else null end,
    new.status,
    jsonb_build_object(
      'title_changed', case when tg_op = 'UPDATE' then new.title is distinct from old.title else false end,
      'owner_changed', case when tg_op = 'UPDATE' then new.owner_id is distinct from old.owner_id else false end,
      'deadline_changed', case when tg_op = 'UPDATE' then new.due_at is distinct from old.due_at else false end,
      'version', new.version
    )
  );

  insert into public.audit_events (
    organization_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data
  ) values (
    new.organization_id,
    actor,
    case when tg_op = 'INSERT' then 'task.created' else 'task.updated' end,
    'task',
    new.id,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new)
  );

  return new;
end;
$$;

create trigger tasks_enforce_rules
before insert or update on public.tasks
for each row execute function private.enforce_task_rules();

create trigger tasks_record_event
after insert or update on public.tasks
for each row execute function private.record_task_event();

alter table public.tasks enable row level security;
alter table public.task_events enable row level security;

create policy "tasks_select_organization_members"
on public.tasks
for select
to authenticated
using (private.is_org_member(organization_id));

create policy "tasks_insert_organization_leadership"
on public.tasks
for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and private.has_org_role(
    organization_id,
    array['owner', 'admin', 'manager']::public.app_role[]
  )
);

create policy "tasks_update_owner_or_leadership"
on public.tasks
for update
to authenticated
using (
  owner_id = (select auth.uid())
  or private.has_org_role(
    organization_id,
    array['owner', 'admin', 'manager']::public.app_role[]
  )
)
with check (
  private.is_org_member(organization_id)
  and (
    owner_id = (select auth.uid())
    or private.has_org_role(
      organization_id,
      array['owner', 'admin', 'manager']::public.app_role[]
    )
  )
);

create policy "task_events_select_organization_members"
on public.task_events
for select
to authenticated
using (private.is_org_member(organization_id));

revoke all on table public.tasks from anon, authenticated;
revoke all on table public.task_events from anon, authenticated;

grant select on table public.tasks to authenticated;
grant insert (
  organization_id,
  title,
  description,
  status,
  priority,
  owner_id,
  acceptance_criteria,
  due_at
) on table public.tasks to authenticated;
grant update (
  title,
  description,
  status,
  priority,
  owner_id,
  acceptance_criteria,
  due_at
) on table public.tasks to authenticated;
grant select on table public.task_events to authenticated;

revoke all on function private.is_valid_task_transition(public.task_status, public.task_status) from public, anon, authenticated;
revoke all on function private.enforce_task_rules() from public, anon, authenticated;
revoke all on function private.record_task_event() from public, anon, authenticated;

create or replace function public.bootstrap_market_whales_organization(
  target_user_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  organization_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('market-whales-os:first-organization', 0));

  select membership.organization_id
  into organization_id
  from public.memberships membership
  where membership.user_id = target_user_id
    and membership.role = 'owner'
    and membership.status = 'active'
  limit 1;

  if organization_id is not null then
    return organization_id;
  end if;

  if exists (select 1 from public.organizations) then
    raise exception 'Market Whales organization is already initialized';
  end if;

  if not exists (
    select 1 from public.profiles profile where profile.id = target_user_id
  ) then
    raise exception 'A verified user profile is required';
  end if;

  insert into public.organizations (name, slug, created_by)
  values ('Market Whales', 'market-whales', target_user_id)
  returning id into organization_id;

  insert into public.memberships (
    organization_id,
    user_id,
    role,
    status,
    invited_by,
    joined_at
  ) values (
    organization_id,
    target_user_id,
    'owner',
    'active',
    target_user_id,
    now()
  );

  insert into public.audit_events (
    organization_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    after_data
  ) values (
    organization_id,
    target_user_id,
    'organization.bootstrapped',
    'organization',
    organization_id,
    jsonb_build_object('name', 'Market Whales', 'slug', 'market-whales')
  );

  return organization_id;
end;
$$;

revoke all on function public.bootstrap_market_whales_organization(uuid) from public, anon, authenticated;
grant execute on function public.bootstrap_market_whales_organization(uuid) to service_role;

do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tasks'
  ) then
    alter publication supabase_realtime add table public.tasks;
  end if;
end;
$$;
