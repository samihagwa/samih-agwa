-- Team-readiness foundation: an accountable quarterly content calendar,
-- non-spamming in-app deadline reminders, and an owner-facing readiness audit.
-- No external message, invitation, channel post, or customer import is performed.

create type public.content_plan_status as enum (
  'draft',
  'active',
  'completed',
  'archived'
);

create type public.content_plan_item_kind as enum (
  'reel',
  'social_post',
  'story',
  'telegram_post',
  'email',
  'ad',
  'live',
  'webinar',
  'other'
);

create type public.content_plan_item_status as enum (
  'idea',
  'planned',
  'in_production',
  'scheduled',
  'published',
  'cancelled'
);

create table public.content_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  starts_on date not null,
  ends_on date not null,
  objective text not null,
  audience text not null,
  offer text,
  primary_metric text,
  status public.content_plan_status not null default 'draft',
  created_by uuid not null references public.profiles (id) on delete restrict,
  updated_by uuid not null references public.profiles (id) on delete restrict,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_plans_id_org_unique unique (id, organization_id),
  constraint content_plans_name_length check (char_length(trim(name)) between 3 and 160),
  constraint content_plans_objective_length check (char_length(trim(objective)) between 10 and 3000),
  constraint content_plans_audience_length check (char_length(trim(audience)) between 3 and 2000),
  constraint content_plans_offer_length check (offer is null or char_length(trim(offer)) between 2 and 1000),
  constraint content_plans_metric_length check (primary_metric is null or char_length(trim(primary_metric)) between 2 and 500),
  constraint content_plans_period_valid check (
    ends_on >= starts_on + 27
    and ends_on <= starts_on + 123
  ),
  constraint content_plans_version_positive check (version > 0)
);

create unique index content_plans_one_active_per_org_idx
  on public.content_plans (organization_id)
  where status = 'active';
create index content_plans_org_period_idx
  on public.content_plans (organization_id, starts_on desc, ends_on desc, id);

create table public.content_plan_pillars (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  plan_id uuid not null,
  title text not null,
  purpose text not null,
  target_quantity integer not null default 1,
  sort_order integer not null default 0,
  created_by uuid not null references public.profiles (id) on delete restrict,
  updated_by uuid not null references public.profiles (id) on delete restrict,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_plan_pillars_id_org_unique unique (id, organization_id),
  constraint content_plan_pillars_plan_org_fkey
    foreign key (plan_id, organization_id)
    references public.content_plans (id, organization_id) on delete cascade,
  constraint content_plan_pillars_title_length check (char_length(trim(title)) between 2 and 120),
  constraint content_plan_pillars_purpose_length check (char_length(trim(purpose)) between 5 and 1500),
  constraint content_plan_pillars_quantity_positive check (target_quantity between 1 and 1000),
  constraint content_plan_pillars_sort_nonnegative check (sort_order >= 0),
  constraint content_plan_pillars_version_positive check (version > 0),
  unique (plan_id, title)
);

create index content_plan_pillars_plan_sort_idx
  on public.content_plan_pillars (plan_id, sort_order, created_at, id);
create index content_plan_pillars_org_idx
  on public.content_plan_pillars (organization_id, plan_id, id);

create table public.content_plan_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  plan_id uuid not null,
  pillar_id uuid,
  content_item_id uuid,
  kind public.content_plan_item_kind not null,
  title text not null,
  objective text not null,
  hook_direction text,
  cta text,
  platforms text[] not null default '{}',
  owner_id uuid not null references public.profiles (id) on delete restrict,
  publish_at timestamptz not null,
  status public.content_plan_item_status not null default 'planned',
  created_by uuid not null references public.profiles (id) on delete restrict,
  updated_by uuid not null references public.profiles (id) on delete restrict,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_plan_items_plan_org_fkey
    foreign key (plan_id, organization_id)
    references public.content_plans (id, organization_id) on delete cascade,
  constraint content_plan_items_pillar_org_fkey
    foreign key (pillar_id, organization_id)
    references public.content_plan_pillars (id, organization_id) on delete restrict,
  constraint content_plan_items_content_org_fkey
    foreign key (content_item_id, organization_id)
    references public.content_items (id, organization_id) on delete restrict,
  constraint content_plan_items_title_length check (char_length(trim(title)) between 3 and 180),
  constraint content_plan_items_objective_length check (char_length(trim(objective)) between 5 and 2000),
  constraint content_plan_items_hook_length check (hook_direction is null or char_length(trim(hook_direction)) between 2 and 2000),
  constraint content_plan_items_cta_length check (cta is null or char_length(trim(cta)) between 2 and 1000),
  constraint content_plan_items_platforms_nonempty check (
    cardinality(platforms) between 1 and 12
    and array_position(platforms, '') is null
  ),
  constraint content_plan_items_version_positive check (version > 0),
  unique (content_item_id)
);

create index content_plan_items_plan_time_idx
  on public.content_plan_items (plan_id, publish_at, id);
create index content_plan_items_org_status_time_idx
  on public.content_plan_items (organization_id, status, publish_at, id);
create index content_plan_items_owner_status_time_idx
  on public.content_plan_items (owner_id, status, publish_at, id);
create index content_plan_items_pillar_idx
  on public.content_plan_items (pillar_id, publish_at, id)
  where pillar_id is not null;
create index content_plan_items_content_org_idx
  on public.content_plan_items (content_item_id, organization_id)
  where content_item_id is not null;

create index if not exists publishing_posts_media_asset_org_idx
  on public.publishing_posts (organization_id, media_asset_id)
  where media_asset_id is not null;

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
  else
    if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id then
      raise exception 'Plan identity and organization cannot change';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := coalesce(actor, old.updated_by);
    new.version := old.version + 1;
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

create or replace function private.prepare_content_plan_pillar_write()
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
  else
    if new.id is distinct from old.id
      or new.organization_id is distinct from old.organization_id
      or new.plan_id is distinct from old.plan_id then
      raise exception 'Pillar identity, organization, and plan cannot change';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := coalesce(actor, old.updated_by);
    new.version := old.version + 1;
  end if;
  new.title := trim(new.title);
  new.purpose := trim(new.purpose);
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.prepare_content_plan_item_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target_plan public.content_plans%rowtype;
  target_content_status public.content_status;
begin
  select * into target_plan
  from public.content_plans plan
  where plan.id = new.plan_id and plan.organization_id = new.organization_id;
  if not found then raise exception 'Content plan is unavailable'; end if;

  if (new.publish_at at time zone 'Africa/Cairo')::date < target_plan.starts_on
    or (new.publish_at at time zone 'Africa/Cairo')::date > target_plan.ends_on then
    raise exception 'Planned publish time must be inside the plan period';
  end if;

  if not exists (
    select 1 from public.memberships membership
    where membership.organization_id = new.organization_id
      and membership.user_id = new.owner_id
      and membership.status = 'active'
      and membership.role <> 'viewer'
  ) then
    raise exception 'Choose an active working member as owner';
  end if;

  if new.pillar_id is not null and not exists (
    select 1 from public.content_plan_pillars pillar
    where pillar.id = new.pillar_id
      and pillar.plan_id = new.plan_id
      and pillar.organization_id = new.organization_id
  ) then
    raise exception 'The selected pillar does not belong to this plan';
  end if;

  if new.content_item_id is not null then
    select item.status into target_content_status
    from public.content_items item
    where item.id = new.content_item_id and item.organization_id = new.organization_id;
    if not found then raise exception 'Content item is unavailable'; end if;
    new.status := case target_content_status
      when 'planned' then 'planned'::public.content_plan_item_status
      when 'production' then 'in_production'::public.content_plan_item_status
      when 'review' then 'in_production'::public.content_plan_item_status
      when 'scheduled' then 'scheduled'::public.content_plan_item_status
      when 'published' then 'published'::public.content_plan_item_status
      when 'cancelled' then 'cancelled'::public.content_plan_item_status
    end;
  elsif new.status not in ('idea', 'planned', 'cancelled') then
    raise exception 'Production status requires a linked content item';
  end if;

  if tg_op = 'INSERT' then
    if actor is null then raise exception 'Authentication is required'; end if;
    new.created_by := actor;
    new.updated_by := actor;
    new.version := 1;
    new.created_at := now();
  else
    if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id then
      raise exception 'Plan item identity and organization cannot change';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := coalesce(actor, old.updated_by);
    new.version := old.version + 1;
  end if;

  new.title := trim(new.title);
  new.objective := trim(new.objective);
  new.hook_direction := nullif(trim(coalesce(new.hook_direction, '')), '');
  new.cta := nullif(trim(coalesce(new.cta, '')), '');
  new.platforms := array(
    select distinct lower(trim(platform))
    from unnest(new.platforms) platform
    where trim(platform) <> ''
    order by lower(trim(platform))
  );
  new.updated_at := now();
  return new;
end;
$$;

create trigger content_plans_prepare_write
before insert or update on public.content_plans
for each row execute function private.prepare_content_plan_write();

create trigger content_plan_pillars_prepare_write
before insert or update on public.content_plan_pillars
for each row execute function private.prepare_content_plan_pillar_write();

create trigger content_plan_items_prepare_write
before insert or update on public.content_plan_items
for each row execute function private.prepare_content_plan_item_write();

create or replace function private.audit_content_planning_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    new.organization_id,
    coalesce((select auth.uid()), new.updated_by, new.created_by),
    lower(tg_op) || '_content_planning',
    tg_table_name,
    new.id,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new)
  );
  return new;
end;
$$;

create trigger content_plans_audit
after insert or update on public.content_plans
for each row execute function private.audit_content_planning_change();
create trigger content_plan_pillars_audit
after insert or update on public.content_plan_pillars
for each row execute function private.audit_content_planning_change();
create trigger content_plan_items_audit
after insert or update on public.content_plan_items
for each row execute function private.audit_content_planning_change();

create or replace function private.sync_content_plan_item_from_content()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.content_plan_items plan_item
  set status = case new.status
      when 'planned' then 'planned'::public.content_plan_item_status
      when 'production' then 'in_production'::public.content_plan_item_status
      when 'review' then 'in_production'::public.content_plan_item_status
      when 'scheduled' then 'scheduled'::public.content_plan_item_status
      when 'published' then 'published'::public.content_plan_item_status
      when 'cancelled' then 'cancelled'::public.content_plan_item_status
    end,
    updated_by = coalesce((select auth.uid()), new.created_by),
    updated_at = now()
  where plan_item.content_item_id = new.id
    and plan_item.organization_id = new.organization_id
    and plan_item.status is distinct from case new.status
      when 'planned' then 'planned'::public.content_plan_item_status
      when 'production' then 'in_production'::public.content_plan_item_status
      when 'review' then 'in_production'::public.content_plan_item_status
      when 'scheduled' then 'scheduled'::public.content_plan_item_status
      when 'published' then 'published'::public.content_plan_item_status
      when 'cancelled' then 'cancelled'::public.content_plan_item_status
    end;
  return new;
end;
$$;

create trigger content_items_sync_plan_item
after update of status on public.content_items
for each row
when (new.status is distinct from old.status)
execute function private.sync_content_plan_item_from_content();

alter table public.content_plans enable row level security;
alter table public.content_plan_pillars enable row level security;
alter table public.content_plan_items enable row level security;

create policy "content_plans_select_members"
on public.content_plans for select to authenticated
using (private.is_org_member(organization_id));
create policy "content_plans_insert_leadership"
on public.content_plans for insert to authenticated
with check (private.has_org_role(organization_id, array['owner','admin','manager']::public.app_role[]));
create policy "content_plans_update_leadership"
on public.content_plans for update to authenticated
using (private.has_org_role(organization_id, array['owner','admin','manager']::public.app_role[]))
with check (private.has_org_role(organization_id, array['owner','admin','manager']::public.app_role[]));

create policy "content_plan_pillars_select_members"
on public.content_plan_pillars for select to authenticated
using (private.is_org_member(organization_id));
create policy "content_plan_pillars_insert_leadership"
on public.content_plan_pillars for insert to authenticated
with check (private.has_org_role(organization_id, array['owner','admin','manager']::public.app_role[]));
create policy "content_plan_pillars_update_leadership"
on public.content_plan_pillars for update to authenticated
using (private.has_org_role(organization_id, array['owner','admin','manager']::public.app_role[]))
with check (private.has_org_role(organization_id, array['owner','admin','manager']::public.app_role[]));

create policy "content_plan_items_select_members"
on public.content_plan_items for select to authenticated
using (private.is_org_member(organization_id));
create policy "content_plan_items_insert_leadership"
on public.content_plan_items for insert to authenticated
with check (private.has_org_role(organization_id, array['owner','admin','manager']::public.app_role[]));
create policy "content_plan_items_update_leadership"
on public.content_plan_items for update to authenticated
using (private.has_org_role(organization_id, array['owner','admin','manager']::public.app_role[]))
with check (private.has_org_role(organization_id, array['owner','admin','manager']::public.app_role[]));

revoke all on table public.content_plans from anon, authenticated;
revoke all on table public.content_plan_pillars from anon, authenticated;
revoke all on table public.content_plan_items from anon, authenticated;
grant select, insert, update on table public.content_plans to authenticated;
grant select, insert, update on table public.content_plan_pillars to authenticated;
grant select, insert, update on table public.content_plan_items to authenticated;

revoke all on function private.prepare_content_plan_write() from public, anon, authenticated;
revoke all on function private.prepare_content_plan_pillar_write() from public, anon, authenticated;
revoke all on function private.prepare_content_plan_item_write() from public, anon, authenticated;
revoke all on function private.audit_content_planning_change() from public, anon, authenticated;
revoke all on function private.sync_content_plan_item_from_content() from public, anon, authenticated;

alter table public.notifications drop constraint if exists notifications_kind_allowed;
alter table public.notifications add constraint notifications_kind_allowed check (
  kind in (
    'task_assigned', 'task_ready', 'task_review', 'task_blocked', 'task_done',
    'revision_requested', 'publication_published', 'publication_failed',
    'publication_held', 'script_assigned', 'script_ready', 'script_research_assigned',
    'content_brief_updated', 'team_joined', 'team_access_changed',
    'task_due_soon', 'task_overdue', 'task_overdue_escalated'
  )
);

create or replace function private.materialize_task_deadline_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_record record;
  leader_record record;
  processed integer := 0;
  target_url text;
  due_epoch bigint;
begin
  for task_record in
    select task.*
    from public.tasks task
    where task.status not in ('done', 'cancelled', 'backlog')
      and task.due_at > now()
      and task.due_at <= now() + interval '24 hours'
      and (select count(*) from public.memberships membership
        where membership.organization_id = task.organization_id
          and membership.status = 'active') > 1
  loop
    target_url := case
      when task_record.crm_contact_id is not null then '/crm#crm-' || task_record.crm_contact_id
      when task_record.content_item_id is not null then '/content#content-' || task_record.content_item_id
      when task_record.launch_id is not null then '/campaigns#launch-' || task_record.launch_id
      else '/tasks'
    end;
    due_epoch := extract(epoch from task_record.due_at)::bigint;
    perform private.add_notification(
      task_record.organization_id, task_record.owner_id, 'task_due_soon',
      'موعد المهمة خلال 24 ساعة',
      task_record.title || ' — الموعد ' || to_char(task_record.due_at at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI'),
      'task', task_record.id, target_url,
      'task:' || task_record.id || ':due-soon:' || due_epoch || ':user:' || task_record.owner_id
    );
    processed := processed + 1;
  end loop;

  for task_record in
    select task.*
    from public.tasks task
    where task.status not in ('done', 'cancelled')
      and task.due_at <= now()
      and (select count(*) from public.memberships membership
        where membership.organization_id = task.organization_id
          and membership.status = 'active') > 1
  loop
    target_url := case
      when task_record.crm_contact_id is not null then '/crm#crm-' || task_record.crm_contact_id
      when task_record.content_item_id is not null then '/content#content-' || task_record.content_item_id
      when task_record.launch_id is not null then '/campaigns#launch-' || task_record.launch_id
      else '/tasks'
    end;
    due_epoch := extract(epoch from task_record.due_at)::bigint;
    perform private.add_notification(
      task_record.organization_id, task_record.owner_id, 'task_overdue',
      'المهمة متأخرة عن موعدها', task_record.title,
      'task', task_record.id, target_url,
      'task:' || task_record.id || ':overdue:' || due_epoch || ':user:' || task_record.owner_id
    );
    processed := processed + 1;

    if task_record.due_at <= now() - interval '24 hours' then
      for leader_record in
        select membership.user_id
        from public.memberships membership
        where membership.organization_id = task_record.organization_id
          and membership.status = 'active'
          and membership.role in ('owner', 'admin', 'manager')
          and membership.user_id <> task_record.owner_id
      loop
        perform private.add_notification(
          task_record.organization_id, leader_record.user_id, 'task_overdue_escalated',
          'مهمة متأخرة أكثر من 24 ساعة', task_record.title,
          'task', task_record.id, target_url,
          'task:' || task_record.id || ':overdue-escalated:' || due_epoch || ':user:' || leader_record.user_id
        );
      end loop;
    end if;
  end loop;
  return processed;
end;
$$;

revoke all on function private.materialize_task_deadline_notifications()
from public, anon, authenticated;

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'market-whales-task-deadline-reminders';
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
  perform cron.schedule(
    'market-whales-task-deadline-reminders',
    '*/10 * * * *',
    $job$select private.materialize_task_deadline_notifications();$job$
  );
end;
$$;

alter table public.member_presence drop constraint if exists member_presence_section_allowed;
alter table public.member_presence add constraint member_presence_section_allowed check (
  current_section in (
    'dashboard', 'tasks', 'planning', 'content', 'scripts', 'publishing', 'brand',
    'campaigns', 'crm', 'analytics', 'team', 'settings'
  )
);

create or replace function public.record_member_presence(
  target_organization_id uuid,
  target_section text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if actor is null then raise exception 'Authentication is required'; end if;
  if target_section not in (
    'dashboard', 'tasks', 'planning', 'content', 'scripts', 'publishing', 'brand',
    'campaigns', 'crm', 'analytics', 'team', 'settings'
  ) then
    raise exception 'Unknown workspace section';
  end if;
  if not exists (
    select 1 from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = actor
      and membership.status = 'active'
  ) then
    raise exception 'Active organization membership is required';
  end if;

  insert into public.member_presence (
    organization_id, user_id, current_section, session_started_at, last_seen_at, updated_at
  ) values (
    target_organization_id, actor, target_section, now(), now(), now()
  )
  on conflict (organization_id, user_id) do update
  set current_section = excluded.current_section,
      session_started_at = case
        when public.member_presence.last_seen_at < now() - interval '30 minutes' then now()
        else public.member_presence.session_started_at
      end,
      last_seen_at = now(),
      updated_at = now();
  return true;
end;
$$;

revoke all on function public.record_member_presence(uuid, text)
from public, anon, authenticated;
grant execute on function public.record_member_presence(uuid, text) to authenticated;

create or replace function public.get_workspace_readiness(target_organization_id uuid)
returns table (
  check_key text,
  label text,
  ready boolean,
  detail text,
  href text,
  blocking boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not private.has_org_role(
    target_organization_id,
    array['owner', 'admin', 'manager']::public.app_role[]
  ) then
    raise exception 'Only organization leadership can view readiness';
  end if;

  return query
  select 'team_pilot', 'عضو تجريبي أكمل التعريف',
    exists (
      select 1 from public.memberships membership
      where membership.organization_id = target_organization_id
        and membership.status = 'active'
        and membership.role <> 'owner'
        and membership.onboarding_completed_at is not null
    ),
    'نختبر دورة عمل كاملة بحساب محدود قبل دخول الفريق الحقيقي.', '/team', true
  union all
  select 'brand_base', 'مراجع البراند الأساسية',
    (select count(*) from public.brand_articles article
      where article.organization_id = target_organization_id and article.status = 'approved') >= 4,
    'الحد العملي: هوية وصوت، تصميم، مونتاج، وتسليم/نشر.', '/brand', true
  union all
  select 'active_plan', 'خطة محتوى فعّالة',
    exists (select 1 from public.content_plans plan
      where plan.organization_id = target_organization_id and plan.status = 'active'),
    'خطة واحدة فعّالة تربط الهدف بالأعمدة ومواعيد النشر.', '/planning', true
  union all
  select 'calendar_loaded', 'أول أسبوع مخطط',
    (select count(*) from public.content_plan_items item
      join public.content_plans plan on plan.id = item.plan_id
      where item.organization_id = target_organization_id
        and plan.status = 'active'
        and item.status <> 'cancelled') >= 4,
    'أربع قطع على الأقل بمسؤول وموعد قبل بدء التشغيل.', '/planning', true
  union all
  select 'ai_ready', 'مزوّد AI مختبر',
    exists (select 1 from public.ai_providers provider
      where provider.organization_id = target_organization_id
        and provider.is_enabled and provider.is_default
        and provider.last_test_status = 'success'),
    'المزوّد الافتراضي ناجح ولا يحتاج كشف المفتاح للفريق.', '/settings', false
  union all
  select 'telegram_ready', 'قناة Telegram مسموحة',
    exists (select 1 from public.publishing_channels channel
      where channel.organization_id = target_organization_id
        and channel.allowlisted and channel.bot_can_post),
    'وجود قناة لا يعني السماح بالاختبار عليها؛ استخدم قناة الاختبار فقط.', '/publishing', false
  union all
  select 'no_overdue', 'لا توجد مهام متأخرة',
    not exists (select 1 from public.tasks task
      where task.organization_id = target_organization_id
        and task.status not in ('done', 'cancelled') and task.due_at < now()),
    'أغلق أو ألغِ بيانات الاختبار القديمة قبل بدء الفريق.', '/tasks?filter=overdue', true
  union all
  select 'publishing_certain', 'لا توجد نتيجة نشر غير مؤكدة',
    not exists (select 1 from public.publishing_occurrences occurrence
      where occurrence.organization_id = target_organization_id and occurrence.status = 'unknown'),
    'أي نتيجة غير مؤكدة تحتاج فحص القناة يدويًا قبل أي إعادة.', '/publishing', true;
end;
$$;

revoke all on function public.get_workspace_readiness(uuid)
from public, anon, authenticated;
grant execute on function public.get_workspace_readiness(uuid) to authenticated;
