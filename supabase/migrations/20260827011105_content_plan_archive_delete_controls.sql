-- Owners can remove disposable planning drafts without risking production
-- history. Archive is reversible; permanent delete is owner-only, requires an
-- archived plan, and is blocked as soon as any plan item reached execution.

alter table public.content_plans
  add column archived_at timestamptz,
  add column archived_by uuid references public.profiles (id) on delete restrict;

alter table public.content_plans
  add constraint content_plans_archive_metadata_consistent check (
    (status = 'archived' and archived_at is not null and archived_by is not null)
    or (status <> 'archived' and archived_at is null and archived_by is null)
  );

create index content_plans_archived_by_idx
  on public.content_plans (archived_by)
  where archived_by is not null;

create or replace function private.prepare_content_plan_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if actor is null then raise exception 'Authentication is required'; end if;
    new.created_by := actor;
    new.updated_by := actor;
    new.version := 1;
    new.created_at := now();
    if new.status = 'archived' then
      new.archived_at := now();
      new.archived_by := actor;
    else
      new.archived_at := null;
      new.archived_by := null;
    end if;
  else
    if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id then
      raise exception 'Plan identity and organization cannot change';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := coalesce(actor, old.updated_by);
    new.version := old.version + 1;
    if new.status = 'archived' and old.status <> 'archived' then
      if actor is null then raise exception 'Authentication is required'; end if;
      new.archived_at := now();
      new.archived_by := actor;
    elsif new.status = 'archived' then
      new.archived_at := old.archived_at;
      new.archived_by := old.archived_by;
    else
      new.archived_at := null;
      new.archived_by := null;
    end if;
  end if;
  new.name := trim(new.name);
  new.objective := trim(new.objective);
  new.audience := trim(new.audience);
  new.offer := nullif(trim(coalesce(new.offer, '')), '');
  new.primary_metric := nullif(trim(coalesce(new.primary_metric, '')), '');
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.guard_and_audit_content_plan_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  planned_item_count integer;
begin
  if actor is null or not private.has_org_role(
    old.organization_id,
    array['owner']::public.app_role[]
  ) then
    raise exception 'Only the organization owner can permanently delete a content plan';
  end if;
  if old.status <> 'archived' then
    raise exception 'Archive the content plan before permanently deleting it';
  end if;
  if exists (
    select 1
    from public.content_plan_items item
    where item.plan_id = old.id
      and item.organization_id = old.organization_id
      and (item.content_item_id is not null or item.status in ('in_production', 'scheduled', 'published'))
  ) or exists (
    select 1
    from public.tasks task
    join public.content_plan_items item on item.id = task.source_plan_item_id
    where item.plan_id = old.id
      and item.organization_id = old.organization_id
  ) then
    raise exception 'A plan linked to execution cannot be permanently deleted; keep it archived';
  end if;

  select count(*)::integer into planned_item_count
  from public.content_plan_items item
  where item.plan_id = old.id and item.organization_id = old.organization_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, before_data
  ) values (
    old.organization_id,
    actor,
    'planning.plan_deleted',
    'content_plan',
    old.id,
    jsonb_build_object(
      'name', old.name,
      'status', old.status,
      'version', old.version,
      'created_at', old.created_at,
      'archived_at', old.archived_at,
      'planned_item_count', planned_item_count
    )
  );
  return old;
end;
$$;

create trigger content_plans_guard_and_audit_delete
before delete on public.content_plans
for each row execute function private.guard_and_audit_content_plan_delete();

create policy "content_plans_delete_owner"
on public.content_plans for delete to authenticated
using (private.has_org_role(organization_id, array['owner']::public.app_role[]));

grant delete on table public.content_plans to authenticated;
revoke all on function private.guard_and_audit_content_plan_delete()
from public, anon, authenticated;

create or replace function private.member_capacity_snapshot(
  target_organization_id uuid,
  target_member_id uuid,
  target_due_at timestamptz,
  requested_minutes integer,
  excluded_task_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with settings as (
    select
      coalesce(capacity.daily_capacity_minutes, 360) as daily_capacity_minutes,
      coalesce(capacity.max_parallel_tasks, 5) as max_parallel_tasks
    from (select 1) seed
    left join public.team_capacity_settings capacity
      on capacity.organization_id = target_organization_id
     and capacity.user_id = target_member_id
  ), task_load as (
    select
      coalesce(sum(task.estimated_minutes), 0)::integer as allocated_minutes,
      count(*)::integer as task_count
    from public.tasks task
    where task.organization_id = target_organization_id
      and task.owner_id = target_member_id
      and task.status not in ('done', 'cancelled')
      and task.is_work_item
      and task.id is distinct from excluded_task_id
      and (task.due_at at time zone 'Africa/Cairo')::date = (target_due_at at time zone 'Africa/Cairo')::date
  ), planned_load as (
    select coalesce(sum(item.estimated_minutes), 0)::integer as allocated_minutes,
           count(*)::integer as item_count
    from public.content_plan_items item
    join public.content_plans plan
      on plan.id = item.plan_id and plan.organization_id = item.organization_id
    where item.organization_id = target_organization_id
      and plan.status <> 'archived'
      and item.owner_id = target_member_id
      and item.content_item_id is null
      and item.status in ('idea', 'planned')
      and (item.publish_at at time zone 'Africa/Cairo')::date = (target_due_at at time zone 'Africa/Cairo')::date
  )
  select jsonb_build_object(
    'user_id', target_member_id,
    'date', (target_due_at at time zone 'Africa/Cairo')::date,
    'daily_capacity_minutes', settings.daily_capacity_minutes,
    'max_parallel_tasks', settings.max_parallel_tasks,
    'task_minutes', task_load.allocated_minutes,
    'planned_minutes', planned_load.allocated_minutes,
    'allocated_minutes', task_load.allocated_minutes + planned_load.allocated_minutes,
    'requested_minutes', requested_minutes,
    'projected_minutes', task_load.allocated_minutes + planned_load.allocated_minutes + requested_minutes,
    'task_count', task_load.task_count,
    'planned_count', planned_load.item_count,
    'projected_count', task_load.task_count + planned_load.item_count + 1,
    'overloaded',
      task_load.allocated_minutes + planned_load.allocated_minutes + requested_minutes > settings.daily_capacity_minutes
      or task_load.task_count + planned_load.item_count + 1 > settings.max_parallel_tasks
  )
  from settings cross join task_load cross join planned_load;
$$;

create or replace function public.get_team_capacity_calendar(
  target_organization_id uuid,
  range_starts_on date,
  range_ends_on date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_capacity_leadership(target_organization_id);
  if range_starts_on is null or range_ends_on is null
    or range_ends_on < range_starts_on
    or range_ends_on > range_starts_on + 62 then
    raise exception 'Capacity calendar range must be between 1 and 63 days';
  end if;
  return jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', membership.user_id,
        'name', coalesce(nullif(trim(profile.full_name), ''), 'عضو فريق'),
        'role', membership.role,
        'daily_capacity_minutes', coalesce(capacity.daily_capacity_minutes, 360),
        'max_parallel_tasks', coalesce(capacity.max_parallel_tasks, 5)
      ) order by coalesce(nullif(trim(profile.full_name), ''), 'عضو فريق'))
      from public.memberships membership
      join public.profiles profile on profile.id = membership.user_id
      left join public.team_capacity_settings capacity
        on capacity.organization_id = membership.organization_id and capacity.user_id = membership.user_id
      where membership.organization_id = target_organization_id
        and membership.status = 'active' and membership.role <> 'viewer'
    ), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', task.id, 'title', task.title, 'owner_id', task.owner_id,
        'due_at', task.due_at, 'status', task.status,
        'estimated_minutes', task.estimated_minutes,
        'content_item_id', task.content_item_id,
        'source_plan_item_id', task.source_plan_item_id,
        'url', '/tasks/' || task.id
      ) order by task.due_at, task.id)
      from public.tasks task
      where task.organization_id = target_organization_id
        and task.status not in ('done', 'cancelled')
        and task.is_work_item
        and (task.due_at at time zone 'Africa/Cairo')::date between range_starts_on and range_ends_on
    ), '[]'::jsonb),
    'planned_items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.id, 'title', item.title, 'owner_id', item.owner_id,
        'publish_at', item.publish_at, 'status', item.status,
        'kind', item.kind, 'estimated_minutes', item.estimated_minutes,
        'content_item_id', item.content_item_id,
        'url', '/planning?plan_item=' || item.id || '#plan-item-' || item.id
      ) order by item.publish_at, item.id)
      from public.content_plan_items item
      join public.content_plans plan
        on plan.id = item.plan_id and plan.organization_id = item.organization_id
      where item.organization_id = target_organization_id
        and plan.status <> 'archived'
        and item.status not in ('published', 'cancelled')
        and (item.publish_at at time zone 'Africa/Cairo')::date between range_starts_on and range_ends_on
    ), '[]'::jsonb)
  );
end;
$$;
