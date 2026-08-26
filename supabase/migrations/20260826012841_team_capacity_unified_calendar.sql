-- Unified workload calendar and atomic plan -> execution handoff.
-- Capacity is advisory: leadership sees the warning and may deliberately override it.

alter table public.tasks
  add column estimated_minutes integer not null default 60,
  add constraint tasks_estimated_minutes_range check (estimated_minutes between 15 and 1440);

alter table public.content_plan_items
  add column estimated_minutes integer not null default 120,
  add constraint content_plan_items_estimated_minutes_range check (estimated_minutes between 15 and 2880),
  add constraint content_plan_items_id_org_unique unique (id, organization_id);

alter table public.tasks
  add column source_plan_item_id uuid,
  add constraint tasks_source_plan_item_org_fkey
    foreign key (source_plan_item_id, organization_id)
    references public.content_plan_items (id, organization_id) on delete restrict;

create index tasks_owner_open_capacity_idx
  on public.tasks (organization_id, owner_id, due_at, id)
  where status not in ('done', 'cancelled') and is_work_item;

create index tasks_source_plan_item_idx
  on public.tasks (source_plan_item_id, due_at, id)
  where source_plan_item_id is not null;

create table public.team_capacity_settings (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  daily_capacity_minutes integer not null default 360,
  max_parallel_tasks integer not null default 5,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  updated_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id),
  foreign key (organization_id, user_id)
    references public.memberships (organization_id, user_id) on delete cascade,
  constraint team_capacity_daily_range check (daily_capacity_minutes between 60 and 1440),
  constraint team_capacity_parallel_range check (max_parallel_tasks between 1 and 30)
);

comment on table public.team_capacity_settings is
  'Leadership-managed focused-work capacity used for advisory overload warnings. Defaults are 6 hours and 5 parallel tasks.';

create or replace function private.prepare_team_capacity_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if actor is null then raise exception 'Authentication is required'; end if;
  if not exists (
    select 1 from public.memberships membership
    where membership.organization_id = new.organization_id
      and membership.user_id = new.user_id
      and membership.status = 'active'
      and membership.role <> 'viewer'
  ) then
    raise exception 'Capacity can only be configured for an active working member';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := actor;
    new.created_at := now();
  else
    if new.organization_id is distinct from old.organization_id
      or new.user_id is distinct from old.user_id
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at then
      raise exception 'Capacity identity fields are immutable';
    end if;
  end if;
  new.updated_by := actor;
  new.updated_at := now();
  return new;
end;
$$;

create trigger team_capacity_settings_prepare_write
before insert or update on public.team_capacity_settings
for each row execute function private.prepare_team_capacity_settings();

create or replace function private.is_org_planning_leadership(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and membership.role in ('owner', 'admin', 'manager')
      and private.can_access_any_section(target_organization_id, array['planning','tasks']::text[])
  );
$$;

create or replace function private.assert_capacity_leadership(target_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_org_planning_leadership(target_organization_id) then
    raise exception 'Only organization leadership with planning access can inspect team capacity';
  end if;
end;
$$;

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
    where item.organization_id = target_organization_id
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

create or replace function public.check_team_member_capacity(
  target_organization_id uuid,
  target_member_id uuid,
  target_due_at timestamptz,
  requested_minutes integer default 60,
  excluded_task_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.assert_capacity_leadership(target_organization_id);
  if target_due_at is null or requested_minutes not between 15 and 2880 then
    raise exception 'Capacity check inputs are invalid';
  end if;
  if not exists (
    select 1 from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = target_member_id
      and membership.status = 'active'
      and membership.role <> 'viewer'
  ) then
    raise exception 'The selected member is unavailable';
  end if;
  return private.member_capacity_snapshot(
    target_organization_id, target_member_id, target_due_at, requested_minutes, excluded_task_id
  );
end;
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
      where item.organization_id = target_organization_id
        and item.status not in ('published', 'cancelled')
        and (item.publish_at at time zone 'Africa/Cairo')::date between range_starts_on and range_ends_on
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function private.create_generic_planned_content_workflow(
  target_actor_id uuid,
  target_organization_id uuid,
  target_plan_item_id uuid,
  content_kind public.content_plan_item_kind,
  content_title text,
  content_goal text,
  content_hook text,
  content_cta text,
  content_platforms text[],
  target_publish_at timestamptz,
  creator_owner_id uuid,
  design_owner_id uuid,
  publishing_owner_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  content_id uuid;
  step_names public.content_step[];
  step_owners uuid[];
  step_estimates integer[];
  task_ids uuid[] := '{}'::uuid[];
  step_index integer;
  step_due timestamptz;
  task_id uuid;
  normalized_platforms text[];
  target_format public.content_format;
begin
  target_format := case content_kind
    when 'social_post' then 'post'::public.content_format
    when 'story' then 'story'::public.content_format
    when 'email' then 'email'::public.content_format
    when 'live' then 'live'::public.content_format
    when 'webinar' then 'long_video'::public.content_format
    else 'post'::public.content_format
  end;
  normalized_platforms := array(
    select distinct case lower(trim(platform))
      when 'instagram' then 'instagram' when 'facebook' then 'facebook'
      when 'tiktok' then 'tiktok' when 'youtube' then 'youtube'
      when 'linkedin' then 'linkedin' when 'telegram' then 'telegram'
      when 'email' then 'email' else null end
    from unnest(content_platforms) platform
    where case lower(trim(platform))
      when 'instagram' then 'instagram' when 'facebook' then 'facebook'
      when 'tiktok' then 'tiktok' when 'youtube' then 'youtube'
      when 'linkedin' then 'linkedin' when 'telegram' then 'telegram'
      when 'email' then 'email' else null end is not null
  );
  if cardinality(normalized_platforms) = 0 then
    normalized_platforms := case when content_kind = 'email' then array['email']::text[] else array['instagram']::text[] end;
  end if;

  if content_kind in ('social_post', 'ad') then
    step_names := array['caption','thumbnail','publishing']::public.content_step[];
    step_owners := array[creator_owner_id, design_owner_id, publishing_owner_id];
    step_estimates := array[90, 120, 30];
  elsif content_kind = 'story' then
    step_names := array['thumbnail','publishing']::public.content_step[];
    step_owners := array[design_owner_id, publishing_owner_id];
    step_estimates := array[90, 30];
  elsif content_kind in ('live', 'webinar') then
    step_names := array['recording','publishing']::public.content_step[];
    step_owners := array[creator_owner_id, publishing_owner_id];
    step_estimates := array[180, 30];
  else
    step_names := array['caption','publishing']::public.content_step[];
    step_owners := array[creator_owner_id, publishing_owner_id];
    step_estimates := array[90, 30];
  end if;

  insert into public.content_items (
    organization_id, title, format, goal, hook, cta, platforms, status, publish_at, created_by
  ) values (
    target_organization_id, trim(content_title), target_format, trim(content_goal),
    left(coalesce(nullif(trim(content_hook), ''), 'ابدأ من المشكلة الأساسية'), 1000),
    left(coalesce(nullif(trim(content_cta), ''), 'تفاعل مع المحتوى'), 500),
    normalized_platforms, 'planned', target_publish_at, target_actor_id
  ) returning id into content_id;

  for step_index in 1..cardinality(step_names) loop
    step_due := now() + ((target_publish_at - now()) * (step_index::numeric / cardinality(step_names)));
    insert into public.tasks (
      organization_id, title, description, status, priority, owner_id, created_by,
      acceptance_criteria, due_at, content_item_id, content_step, is_work_item,
      estimated_minutes, source_plan_item_id
    ) values (
      target_organization_id,
      case step_names[step_index]
        when 'caption' then 'كتابة الكابشن: '
        when 'thumbnail' then 'تنفيذ التصميم: '
        when 'recording' then 'تجهيز المحتوى: '
        else 'نشر المحتوى: ' end || trim(content_title),
      trim(content_goal) || case when nullif(trim(content_hook), '') is not null then chr(10) || 'اتجاه البداية: ' || trim(content_hook) else '' end,
      case when step_index = 1 then 'ready'::public.task_status else 'backlog'::public.task_status end,
      'normal', step_owners[step_index], target_actor_id, '', step_due,
      content_id, step_names[step_index], true, step_estimates[step_index], target_plan_item_id
    ) returning id into task_id;
    task_ids := array_append(task_ids, task_id);
    if step_index > 1 then
      insert into public.task_dependencies (task_id, depends_on_task_id)
      values (task_id, task_ids[step_index - 1]);
    end if;
  end loop;
  return content_id;
end;
$$;

create or replace function public.create_plan_item_execution(
  target_organization_id uuid,
  target_plan_id uuid,
  target_pillar_id uuid,
  target_kind public.content_plan_item_kind,
  content_title text,
  content_objective text,
  content_hook text,
  content_cta text,
  content_platforms text[],
  target_publish_at timestamptz,
  accountable_owner_id uuid,
  editing_owner_id uuid,
  design_owner_id uuid,
  publishing_owner_id uuid,
  requested_minutes integer default 120,
  allow_capacity_override boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  plan_item_id uuid;
  content_id uuid;
  capacity jsonb;
  overloaded_members text[] := '{}'::text[];
  member_id uuid;
begin
  perform private.assert_capacity_leadership(target_organization_id);
  if target_publish_at <= now() + interval '2 hours' then
    raise exception 'Publish time must be at least two hours in the future';
  end if;
  if requested_minutes not between 15 and 2880 then raise exception 'Estimated time is invalid'; end if;

  foreach member_id in array array[
    accountable_owner_id, editing_owner_id, design_owner_id, publishing_owner_id
  ] loop
    if member_id is null or not exists (
      select 1 from public.memberships membership
      where membership.organization_id = target_organization_id
        and membership.user_id = member_id and membership.status = 'active' and membership.role <> 'viewer'
    ) then raise exception 'Every execution owner must be an active working member'; end if;
    capacity := private.member_capacity_snapshot(
      target_organization_id, member_id, target_publish_at,
      case when member_id = accountable_owner_id then requested_minutes else 60 end, null
    );
    if coalesce((capacity->>'overloaded')::boolean, false) and not member_id::text = any(overloaded_members) then
      overloaded_members := array_append(overloaded_members, member_id::text);
    end if;
  end loop;
  if cardinality(overloaded_members) > 0 and not allow_capacity_override then
    raise exception 'TEAM_CAPACITY_EXCEEDED:%', array_to_string(overloaded_members, ',');
  end if;

  insert into public.content_plan_items (
    organization_id, plan_id, pillar_id, kind, title, objective, hook_direction,
    cta, platforms, owner_id, publish_at, status, estimated_minutes, created_by, updated_by
  ) values (
    target_organization_id, target_plan_id, target_pillar_id, target_kind,
    content_title, content_objective, nullif(trim(content_hook), ''), nullif(trim(content_cta), ''),
    content_platforms, accountable_owner_id, target_publish_at, 'planned', requested_minutes, actor, actor
  ) returning id into plan_item_id;

  if target_kind = 'reel' then
    content_id := public.create_reel_production_workflow_v3(
      actor, target_organization_id, content_title, content_objective,
      coalesce(nullif(trim(content_hook), ''), 'ابدأ من المشكلة الأساسية'),
      coalesce(nullif(trim(content_cta), ''), 'تفاعل مع المحتوى'),
      content_objective, 'نفّذ المونتاج وفق ملف المحتوى النهائي بعد اعتماد النص.',
      'اقترح غلافًا واضحًا من الفكرة والنص النهائي.', '', target_publish_at,
      accountable_owner_id, editing_owner_id, design_owner_id,
      publishing_owner_id, publishing_owner_id, '', '', '', '{}'::uuid[]
    );
    perform set_config('app.plan_execution_item_id', plan_item_id::text, true);
    update public.tasks task set
      source_plan_item_id = plan_item_id,
      estimated_minutes = case task.content_step
        when 'recording' then greatest(60, requested_minutes)
        when 'editing' then 180 when 'thumbnail' then 90 when 'publishing' then 30
        else task.estimated_minutes end
    where task.content_item_id = content_id;
  else
    content_id := private.create_generic_planned_content_workflow(
      actor, target_organization_id, plan_item_id, target_kind, content_title,
      content_objective, content_hook, content_cta, content_platforms,
      target_publish_at, accountable_owner_id, design_owner_id, publishing_owner_id
    );
  end if;

  update public.content_plan_items
  set content_item_id = content_id
  where id = plan_item_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id, actor, 'planning.execution_created', 'content_plan_item', plan_item_id,
    jsonb_build_object('content_item_id', content_id, 'capacity_override', allow_capacity_override)
  );
  return jsonb_build_object('plan_item_id', plan_item_id, 'content_item_id', content_id);
end;
$$;

create or replace function private.prevent_task_plan_link_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source_plan_item_id is distinct from old.source_plan_item_id
    and nullif(current_setting('app.plan_execution_item_id', true), '') is distinct from new.source_plan_item_id::text then
    raise exception 'Task planning source is immutable';
  end if;
  return new;
end;
$$;

create trigger tasks_prevent_plan_link_mutation
before update of source_plan_item_id on public.tasks
for each row execute function private.prevent_task_plan_link_mutation();

alter table public.team_capacity_settings enable row level security;

create policy "team_capacity_settings_select_members"
on public.team_capacity_settings for select to authenticated
using (private.is_org_member(organization_id));

create policy "team_capacity_settings_write_leadership"
on public.team_capacity_settings for all to authenticated
using (private.is_org_planning_leadership(organization_id))
with check (private.is_org_planning_leadership(organization_id));

revoke all on table public.team_capacity_settings from public, anon, authenticated;
grant select, insert, update on table public.team_capacity_settings to authenticated;
grant select, insert, update, delete on table public.team_capacity_settings to service_role;

grant select, insert (estimated_minutes, source_plan_item_id), update (estimated_minutes) on table public.tasks to authenticated;
grant select, insert (estimated_minutes), update (estimated_minutes) on table public.content_plan_items to authenticated;

revoke all on function public.check_team_member_capacity(uuid, uuid, timestamptz, integer, uuid)
from public, anon;
grant execute on function public.check_team_member_capacity(uuid, uuid, timestamptz, integer, uuid)
to authenticated, service_role;

revoke all on function public.get_team_capacity_calendar(uuid, date, date)
from public, anon;
grant execute on function public.get_team_capacity_calendar(uuid, date, date)
to authenticated, service_role;

revoke all on function public.create_plan_item_execution(
  uuid, uuid, uuid, public.content_plan_item_kind, text, text, text, text, text[],
  timestamptz, uuid, uuid, uuid, uuid, integer, boolean
) from public, anon;
grant execute on function public.create_plan_item_execution(
  uuid, uuid, uuid, public.content_plan_item_kind, text, text, text, text, text[],
  timestamptz, uuid, uuid, uuid, uuid, integer, boolean
) to authenticated, service_role;

revoke all on function private.prepare_team_capacity_settings() from public, anon, authenticated;
revoke all on function private.is_org_planning_leadership(uuid) from public, anon, authenticated;
revoke all on function private.assert_capacity_leadership(uuid) from public, anon, authenticated;
revoke all on function private.member_capacity_snapshot(uuid, uuid, timestamptz, integer, uuid) from public, anon, authenticated;
revoke all on function private.create_generic_planned_content_workflow(
  uuid, uuid, uuid, public.content_plan_item_kind, text, text, text, text,
  text[], timestamptz, uuid, uuid, uuid
) from public, anon, authenticated;
revoke all on function private.prevent_task_plan_link_mutation() from public, anon, authenticated;
