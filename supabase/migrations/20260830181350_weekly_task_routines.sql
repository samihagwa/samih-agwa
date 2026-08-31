-- Weekly work is stored as a small rule, while the team only sees ordinary
-- task occurrences in My Work. One rolling week is materialized idempotently.

create table public.recurring_task_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null,
  description text not null,
  priority public.task_priority not null default 'normal',
  owner_id uuid not null references public.profiles (id) on delete restrict,
  created_by uuid not null references public.profiles (id) on delete restrict,
  acceptance_criteria text not null default '',
  requires_review boolean not null default false,
  estimated_minutes integer not null default 60,
  weekday smallint not null,
  time_local time without time zone not null,
  starts_on date not null,
  ends_on date,
  paused boolean not null default false,
  archived_at timestamptz,
  version bigint not null default 1,
  last_materialized_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_task_templates_id_organization_unique unique (id, organization_id),
  constraint recurring_task_templates_title_length check (char_length(trim(title)) between 3 and 180),
  constraint recurring_task_templates_description_length check (char_length(trim(description)) between 5 and 5000),
  constraint recurring_task_templates_acceptance_length check (char_length(trim(acceptance_criteria)) <= 4000),
  -- Concrete tasks enforce the same lower bound. Keeping the template looser
  -- would allow a valid rule that can never be materialized.
  constraint recurring_task_templates_estimate_positive check (estimated_minutes between 15 and 1440),
  constraint recurring_task_templates_weekday_valid check (weekday between 1 and 7),
  constraint recurring_task_templates_date_range check (ends_on is null or ends_on >= starts_on),
  constraint recurring_task_templates_version_positive check (version > 0),
  constraint recurring_task_templates_last_error_length check (
    last_error is null or char_length(last_error) <= 1000
  )
);

create index recurring_task_templates_org_active_idx
  on public.recurring_task_templates (organization_id, paused, weekday, starts_on, id)
  where archived_at is null;
create index recurring_task_templates_owner_idx
  on public.recurring_task_templates (owner_id);
create index recurring_task_templates_creator_idx
  on public.recurring_task_templates (created_by);

alter table public.tasks
  add column recurring_template_id uuid,
  add column recurrence_slot_at timestamptz,
  add constraint tasks_recurrence_fields_together check (
    (recurring_template_id is null and recurrence_slot_at is null)
    or (recurring_template_id is not null and recurrence_slot_at is not null)
  ),
  add constraint tasks_recurring_template_org_fkey
    foreign key (recurring_template_id, organization_id)
    references public.recurring_task_templates (id, organization_id)
    on delete restrict,
  add constraint tasks_recurring_template_slot_unique
    unique (recurring_template_id, recurrence_slot_at);

create index tasks_recurring_template_org_idx
  on public.tasks (recurring_template_id, organization_id)
  where recurring_template_id is not null;

create or replace function private.enforce_recurring_task_template_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if actor is null then raise exception 'Authentication is required'; end if;

  -- Lock the permission row so access cannot be revoked between authorization
  -- and the template write. Membership updates lock this same row first.
  perform 1
  from public.memberships membership
  where membership.organization_id = new.organization_id
    and membership.user_id = actor
    and membership.status = 'active'
    and membership.role in ('owner', 'admin', 'manager')
    and (membership.role = 'owner' or 'tasks' = any(membership.allowed_sections))
  for share;
  if not found then
    raise exception 'Task management access is required';
  end if;

  -- Pausing or archiving must remain possible even if the assignee has already
  -- lost access through an administrative repair. Active rules, including an
  -- unpause, always require a reachable working member.
  if tg_op = 'INSERT' or (new.archived_at is null and not new.paused) then
    perform 1
    from public.memberships membership
    where membership.organization_id = new.organization_id
      and membership.user_id = new.owner_id
      and membership.status = 'active'
      and membership.role <> 'viewer'
      and (membership.role = 'owner' or 'tasks' = any(membership.allowed_sections))
    for share;
    if not found then
      raise exception 'The recurring task owner must be an active Tasks member';
    end if;
  end if;

  if new.requires_review
    and new.owner_id = actor
    and (
      tg_op = 'INSERT'
      or new.owner_id is distinct from old.owner_id
      or new.requires_review is distinct from old.requires_review
    ) then
    raise exception 'A self-assigned recurring task cannot require self-review';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := actor;
    new.version := 1;
    new.updated_at := now();
    return new;
  end if;

  if new.id <> old.id
    or new.organization_id <> old.organization_id
    or new.created_by <> old.created_by
    or new.created_at <> old.created_at then
    raise exception 'Recurring task identity fields are immutable';
  end if;

  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

-- Keep scheduler health metadata out of optimistic user-edit versions. The
-- browser cannot write these columns, and the materializer updates them hourly;
-- firing the user-write trigger for those updates would churn versions and can
-- make a broken owner impossible to pause or archive.
create trigger recurring_task_templates_enforce_insert
before insert on public.recurring_task_templates
for each row execute function private.enforce_recurring_task_template_rules();

create trigger recurring_task_templates_enforce_update
before update of
  id, organization_id, title, description, priority, owner_id, created_by,
  acceptance_criteria, requires_review, estimated_minutes, weekday,
  time_local, starts_on, ends_on, paused, archived_at, version, created_at
on public.recurring_task_templates
for each row execute function private.enforce_recurring_task_template_rules();

create or replace function private.guard_task_recurrence_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  materializer_template_id text := nullif(
    current_setting('app.recurring_task_template_id', true),
    ''
  );
begin
  if tg_op = 'INSERT' then
    if new.recurring_template_id is null then return new; end if;
    if materializer_template_id is distinct from new.recurring_template_id::text then
      raise exception 'Recurring task occurrences must be created by the scheduler';
    end if;
    if new.due_at is distinct from new.recurrence_slot_at then
      raise exception 'A recurring task must start with its canonical schedule slot as the deadline';
    end if;
    return new;
  end if;

  if new.recurring_template_id is distinct from old.recurring_template_id
    or new.recurrence_slot_at is distinct from old.recurrence_slot_at then
    raise exception 'Recurring task identity is immutable';
  end if;
  return new;
end;
$$;

create trigger tasks_guard_recurrence_insert
before insert on public.tasks
for each row execute function private.guard_task_recurrence_identity();

create trigger tasks_guard_recurrence_update
before update on public.tasks
for each row execute function private.guard_task_recurrence_identity();

alter table public.recurring_task_templates enable row level security;

create policy "recurring_task_templates_leadership_select"
on public.recurring_task_templates for select to authenticated
using (
  private.has_org_role(
    organization_id,
    array['owner', 'admin', 'manager']::public.app_role[]
  )
  and private.can_access_any_section(organization_id, array['tasks']::text[])
);

create policy "recurring_task_templates_leadership_insert"
on public.recurring_task_templates for insert to authenticated
with check (
  created_by = (select auth.uid())
  and private.has_org_role(
    organization_id,
    array['owner', 'admin', 'manager']::public.app_role[]
  )
  and private.can_access_any_section(organization_id, array['tasks']::text[])
);

create policy "recurring_task_templates_leadership_update"
on public.recurring_task_templates for update to authenticated
using (
  private.has_org_role(
    organization_id,
    array['owner', 'admin', 'manager']::public.app_role[]
  )
  and private.can_access_any_section(organization_id, array['tasks']::text[])
)
with check (
  private.has_org_role(
    organization_id,
    array['owner', 'admin', 'manager']::public.app_role[]
  )
  and private.can_access_any_section(organization_id, array['tasks']::text[])
);

revoke all on table public.recurring_task_templates from public, anon, authenticated;
grant select on table public.recurring_task_templates to authenticated;
grant insert (
  organization_id, title, description, priority, owner_id, created_by,
  acceptance_criteria, requires_review, estimated_minutes, weekday,
  time_local, starts_on, ends_on
) on table public.recurring_task_templates to authenticated;
grant update (
  title, description, priority, owner_id, acceptance_criteria,
  requires_review, estimated_minutes, weekday, time_local, starts_on,
  ends_on, paused, archived_at
) on table public.recurring_task_templates to authenticated;

revoke all on function private.enforce_recurring_task_template_rules()
from public, anon, authenticated;
revoke all on function private.guard_task_recurrence_identity()
from public, anon, authenticated;

create or replace function private.audit_recurring_task_template_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  audit_action text;
begin
  audit_action := case
    when tg_op = 'INSERT' then 'task.recurring_rule_created'
    when new.archived_at is not null and old.archived_at is null then 'task.recurring_rule_archived'
    when new.paused is distinct from old.paused and new.paused then 'task.recurring_rule_paused'
    when new.paused is distinct from old.paused and not new.paused then 'task.recurring_rule_resumed'
    else 'task.recurring_rule_updated'
  end;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id,
    before_data, after_data
  ) values (
    new.organization_id, actor, audit_action, 'recurring_task_template', new.id,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new)
  );
  return new;
end;
$$;

create trigger recurring_task_templates_audit_insert
after insert on public.recurring_task_templates
for each row execute function private.audit_recurring_task_template_change();

create trigger recurring_task_templates_audit_update
after update of
  title, description, priority, owner_id, acceptance_criteria,
  requires_review, estimated_minutes, weekday, time_local, starts_on,
  ends_on, paused, archived_at
on public.recurring_task_templates
for each row execute function private.audit_recurring_task_template_change();

revoke all on function private.audit_recurring_task_template_change()
from public, anon, authenticated;

-- Do not let a membership change strand an active weekly responsibility. A
-- paused, archived, or already-ended rule is harmless and does not block access
-- changes; otherwise leadership must pause, archive, or reassign it first.
create or replace function private.enforce_open_task_member_reachability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  loses_task_access boolean;
begin
  loses_task_access := (
    new.status <> 'active'
    or new.role = 'viewer'
    or (
      new.role <> 'owner'
      and not ('tasks' = any(new.allowed_sections))
    )
  );
  if not loses_task_access then return new; end if;

  if exists (
    select 1
    from public.tasks task
    where task.organization_id = new.organization_id
      and task.owner_id = new.user_id
      and task.status not in ('done', 'cancelled')
  ) then
    raise exception 'Reassign or close this member''s open tasks before removing Tasks access or making the account read-only';
  end if;

  if exists (
    select 1
    from public.recurring_task_templates template
    where template.organization_id = new.organization_id
      and template.owner_id = new.user_id
      and template.archived_at is null
      and not template.paused
      and (
        template.ends_on is null
        or template.ends_on >= (now() at time zone 'Africa/Cairo')::date
      )
  ) then
    raise exception 'Pause, archive, or reassign this member''s weekly tasks before removing Tasks access or making the account read-only';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_open_task_member_reachability()
from public, anon, authenticated;

create or replace function private.materialize_weekly_task_routines(
  target_now timestamptz default now(),
  target_organization_id uuid default null,
  preferred_actor uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  routine_record record;
  task_actor uuid;
  original_actor uuid := (select auth.uid());
  original_template_context text := nullif(
    current_setting('app.recurring_task_template_id', true),
    ''
  );
  local_today date := (target_now at time zone 'Africa/Cairo')::date;
  inserted_count integer;
  total_inserted integer := 0;
  generated_task_id uuid;
begin
  for routine_record in
    select
      routine.*,
      occurrence_day::date as occurrence_day,
      ((occurrence_day::date + routine.time_local) at time zone 'Africa/Cairo') as occurrence_slot
    from public.recurring_task_templates routine
    cross join lateral generate_series(
      local_today::timestamp,
      (local_today + 6)::timestamp,
      interval '1 day'
    ) occurrence_day
    where routine.archived_at is null
      and not routine.paused
      and (target_organization_id is null or routine.organization_id = target_organization_id)
      and occurrence_day::date >= routine.starts_on
      and (routine.ends_on is null or occurrence_day::date <= routine.ends_on)
      and extract(isodow from occurrence_day)::smallint = routine.weekday
      and ((occurrence_day::date + routine.time_local) at time zone 'Africa/Cairo') > target_now
    order by occurrence_slot, routine.id
    for update of routine skip locked
  loop
    begin
      task_actor := null;
      select membership.user_id into task_actor
      from public.memberships membership
      where membership.organization_id = routine_record.organization_id
        and membership.status = 'active'
        and membership.role in ('owner', 'admin', 'manager')
        and (membership.role = 'owner' or 'tasks' = any(membership.allowed_sections))
        and (
          not routine_record.requires_review
          or membership.user_id <> routine_record.owner_id
        )
      order by
        (membership.user_id = routine_record.created_by) desc,
        (preferred_actor is not null and membership.user_id = preferred_actor) desc,
        case membership.role when 'owner' then 1 when 'admin' then 2 else 3 end,
        membership.user_id
      for share of membership
      limit 1;

      if task_actor is null then
        update public.recurring_task_templates template
        set last_error = 'No active Tasks leader can create this recurring task',
            updated_at = now()
        where template.id = routine_record.id
          and template.last_error is distinct from 'No active Tasks leader can create this recurring task';
        continue;
      end if;

      if not exists (
        select 1 from public.memberships membership
        where membership.organization_id = routine_record.organization_id
          and membership.user_id = routine_record.owner_id
          and membership.status = 'active'
          and membership.role <> 'viewer'
          and (membership.role = 'owner' or 'tasks' = any(membership.allowed_sections))
      ) then
        update public.recurring_task_templates template
        set last_error = 'The assigned member can no longer receive tasks',
            updated_at = now()
        where template.id = routine_record.id
          and template.last_error is distinct from 'The assigned member can no longer receive tasks';
        continue;
      end if;

      perform set_config('request.jwt.claim.sub', task_actor::text, true);
      perform set_config(
        'app.recurring_task_template_id',
        routine_record.id::text,
        true
      );

      generated_task_id := null;
      insert into public.tasks (
        organization_id, title, description, status, priority, owner_id,
        created_by, acceptance_criteria, requires_review, due_at,
        estimated_minutes, is_work_item, recurring_template_id,
        recurrence_slot_at
      ) values (
        routine_record.organization_id, routine_record.title,
        routine_record.description, 'ready', routine_record.priority,
        routine_record.owner_id, task_actor, routine_record.acceptance_criteria,
        routine_record.requires_review, routine_record.occurrence_slot,
        routine_record.estimated_minutes, true, routine_record.id,
        routine_record.occurrence_slot
      )
      on conflict (recurring_template_id, recurrence_slot_at) do nothing
      returning id into generated_task_id;

      get diagnostics inserted_count = row_count;
      total_inserted := total_inserted + inserted_count;

      if inserted_count > 0 then
        insert into public.audit_events (
          organization_id, actor_id, action, entity_type, entity_id, after_data
        ) values (
          routine_record.organization_id,
          null,
          'task.recurring_materialized',
          'task',
          generated_task_id,
          jsonb_build_object(
            'recurring_template_id', routine_record.id,
            'recurrence_slot_at', routine_record.occurrence_slot,
            'delegated_requester_id', task_actor,
            'generated_automatically', true
          )
        );

        update public.recurring_task_templates template
        set last_materialized_at = now(),
            last_error = null,
            updated_at = now()
        where template.id = routine_record.id;
      elsif routine_record.last_error is not null then
        update public.recurring_task_templates template
        set last_error = null,
            updated_at = now()
        where template.id = routine_record.id;
      end if;
    exception when others then
      update public.recurring_task_templates template
      set last_error = left(sqlerrm, 1000),
          updated_at = now()
      where template.id = routine_record.id
        and template.last_error is distinct from left(sqlerrm, 1000);
    end;

    -- The EXCEPTION block is a subtransaction, so a failed insert already rolls
    -- its local GUC changes back. Restore explicitly after both success and a
    -- handled failure so no chosen actor/template context leaks to the next row.
    perform set_config('request.jwt.claim.sub', coalesce(original_actor::text, ''), true);
    perform set_config(
      'app.recurring_task_template_id',
      coalesce(original_template_context, ''),
      true
    );
  end loop;

  perform set_config('request.jwt.claim.sub', coalesce(original_actor::text, ''), true);
  perform set_config(
    'app.recurring_task_template_id',
    coalesce(original_template_context, ''),
    true
  );
  return total_inserted;
end;
$$;

revoke all on function private.materialize_weekly_task_routines(timestamptz, uuid, uuid)
from public, anon, authenticated;

create or replace function public.materialize_recurring_tasks(
  target_organization_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if actor is null then raise exception 'Authentication is required'; end if;
  if not private.has_org_role(
    target_organization_id,
    array['owner', 'admin', 'manager']::public.app_role[]
  ) or not private.can_access_any_section(
    target_organization_id,
    array['tasks']::text[]
  ) then
    raise exception 'Task management access is required';
  end if;

  return private.materialize_weekly_task_routines(
    now(),
    target_organization_id,
    actor
  );
end;
$$;

revoke all on function public.materialize_recurring_tasks(uuid)
from public, anon;
grant execute on function public.materialize_recurring_tasks(uuid)
to authenticated;

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'market-whales-weekly-task-routines';
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
  perform cron.schedule(
    'market-whales-weekly-task-routines',
    '17 * * * *',
    $job$select private.materialize_weekly_task_routines();$job$
  );
end;
$$;

comment on table public.recurring_task_templates is
  'Weekly task rules managed by leadership. Members see only the concrete task occurrences generated from them.';
comment on column public.tasks.recurrence_slot_at is
  'Immutable Cairo schedule slot used for recurring-task idempotency; independent from editable due_at.';
