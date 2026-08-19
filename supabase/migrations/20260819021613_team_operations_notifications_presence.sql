create table public.notifications (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  entity_type text not null,
  entity_id uuid,
  url text not null,
  dedupe_key text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_kind_allowed check (
    kind in ('task_assigned', 'task_ready', 'task_review', 'task_blocked', 'task_done', 'revision_requested')
  ),
  constraint notifications_title_length check (char_length(trim(title)) between 3 and 180),
  constraint notifications_body_length check (char_length(trim(body)) between 3 and 1000),
  constraint notifications_entity_type_length check (char_length(trim(entity_type)) between 3 and 80),
  constraint notifications_url_internal check (url ~ '^/[A-Za-z0-9/_?#=&.%:-]+$'),
  constraint notifications_dedupe_key_unique unique (dedupe_key)
);

create index notifications_user_unread_time_idx
  on public.notifications (user_id, created_at desc, id desc)
  where read_at is null;
create index notifications_user_time_idx
  on public.notifications (user_id, created_at desc, id desc);
create index notifications_org_time_idx
  on public.notifications (organization_id, created_at desc, id desc);

create table public.member_presence (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  current_section text not null,
  session_started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id),
  constraint member_presence_section_allowed check (
    current_section in ('dashboard', 'tasks', 'content', 'brand', 'campaigns', 'crm', 'analytics', 'team', 'settings')
  ),
  constraint member_presence_session_consistent check (session_started_at <= last_seen_at)
);

create index member_presence_org_last_seen_idx
  on public.member_presence (organization_id, last_seen_at desc, user_id);
create index member_presence_user_idx
  on public.member_presence (user_id);

create index tasks_org_creator_created_idx
  on public.tasks (organization_id, created_by, created_at desc, id);
create index tasks_org_owner_completed_idx
  on public.tasks (organization_id, owner_id, completed_at desc, id)
  where completed_at is not null;
create index task_events_org_actor_time_idx
  on public.task_events (organization_id, actor_id, occurred_at desc, id desc)
  where actor_id is not null;
create index content_revisions_org_requester_time_idx
  on public.content_revision_requests (organization_id, requested_by, requested_at desc, id);
create index content_revisions_org_assignee_time_idx
  on public.content_revision_requests (organization_id, assigned_to, requested_at desc, id);

create or replace function private.add_notification(
  target_organization_id uuid,
  target_user_id uuid,
  notification_kind text,
  notification_title text,
  notification_body text,
  target_entity_type text,
  target_entity_id uuid,
  target_url text,
  target_dedupe_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_user_id is null or not exists (
    select 1 from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = target_user_id
      and membership.status = 'active'
  ) then
    return;
  end if;

  insert into public.notifications (
    organization_id, user_id, kind, title, body,
    entity_type, entity_id, url, dedupe_key
  ) values (
    target_organization_id, target_user_id, notification_kind,
    left(trim(notification_title), 180), left(trim(notification_body), 1000),
    target_entity_type, target_entity_id, target_url, target_dedupe_key
  ) on conflict (dedupe_key) do nothing;
end;
$$;

create or replace function private.notify_task_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  reviewer_id uuid;
  target_url text := case
    when new.crm_contact_id is not null then '/crm#lead-' || new.crm_contact_id
    when new.content_item_id is not null then '/content#content-' || new.content_item_id
    when new.launch_deliverable_id is not null then '/campaigns#deliverable-' || new.launch_deliverable_id
    else '/tasks'
  end;
begin
  if tg_op = 'INSERT' then
    if new.owner_id is distinct from actor then
      perform private.add_notification(
        new.organization_id, new.owner_id, 'task_assigned',
        'مهمة جديدة وصلت لك', new.title, 'task', new.id, target_url,
        'task:' || new.id || ':assigned:v' || new.version || ':user:' || new.owner_id
      );
    end if;
    return new;
  end if;

  if new.owner_id is distinct from old.owner_id then
    perform private.add_notification(
      new.organization_id, new.owner_id, 'task_assigned',
      'تم إسناد مهمة لك', new.title, 'task', new.id, target_url,
      'task:' || new.id || ':reassigned:v' || new.version || ':user:' || new.owner_id
    );
  end if;

  if new.status is distinct from old.status and new.status = 'ready' and new.owner_id is distinct from actor then
    perform private.add_notification(
      new.organization_id, new.owner_id, 'task_ready',
      'الخطوة السابقة اكتملت', 'مهمتك جاهزة الآن: ' || new.title,
      'task', new.id, target_url,
      'task:' || new.id || ':ready:v' || new.version || ':user:' || new.owner_id
    );
  end if;

  if new.status is distinct from old.status and new.status = 'review' then
    if new.content_item_id is not null then
      select task.owner_id into reviewer_id
      from public.tasks task
      where task.content_item_id = new.content_item_id
        and task.content_step = 'approval';
    end if;
    reviewer_id := coalesce(reviewer_id, new.created_by);
    if reviewer_id is distinct from actor then
      perform private.add_notification(
        new.organization_id, reviewer_id, 'task_review',
        'تسليم جديد يحتاج مراجعتك', new.title,
        'task', new.id, target_url,
        'task:' || new.id || ':review:v' || new.version || ':user:' || reviewer_id
      );
    end if;
  end if;

  if new.status is distinct from old.status and new.status = 'blocked' and new.created_by is distinct from actor then
    perform private.add_notification(
      new.organization_id, new.created_by, 'task_blocked',
      'مهمة متوقفة وتحتاج تدخلًا', new.title,
      'task', new.id, target_url,
      'task:' || new.id || ':blocked:v' || new.version || ':user:' || new.created_by
    );
  end if;

  if new.status is distinct from old.status and new.status = 'done' and new.created_by is distinct from actor then
    perform private.add_notification(
      new.organization_id, new.created_by, 'task_done',
      'اكتملت مهمة', new.title,
      'task', new.id, target_url,
      'task:' || new.id || ':done:v' || new.version || ':user:' || new.created_by
    );
  end if;

  return new;
end;
$$;

create trigger tasks_create_notifications
after insert or update of owner_id, status on public.tasks
for each row execute function private.notify_task_change();

create or replace function private.notify_content_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_to is distinct from new.requested_by then
    perform private.add_notification(
      new.organization_id, new.assigned_to, 'revision_requested',
      'مطلوب تعديل على المحتوى', left(new.instructions, 1000),
      'content_revision', new.id, '/content#content-' || new.content_item_id,
      'revision:' || new.id || ':requested:user:' || new.assigned_to
    );
  end if;
  return new;
end;
$$;

create trigger content_revisions_create_notifications
after insert on public.content_revision_requests
for each row execute function private.notify_content_revision();

create or replace function public.mark_notification_read(target_notification_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  if (select auth.uid()) is null then raise exception 'Authentication is required'; end if;
  update public.notifications notification
  set read_at = coalesce(notification.read_at, now())
  where notification.id = target_notification_id
    and notification.user_id = (select auth.uid());
  get diagnostics changed = row_count;
  return changed > 0;
end;
$$;

create or replace function public.mark_all_notifications_read(target_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  if (select auth.uid()) is null then raise exception 'Authentication is required'; end if;
  update public.notifications notification
  set read_at = now()
  where notification.organization_id = target_organization_id
    and notification.user_id = (select auth.uid())
    and notification.read_at is null;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

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
  if target_section not in ('dashboard', 'tasks', 'content', 'brand', 'campaigns', 'crm', 'analytics', 'team', 'settings') then
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
  set
    current_section = excluded.current_section,
    session_started_at = case
      when public.member_presence.last_seen_at < now() - interval '30 minutes' then now()
      else public.member_presence.session_started_at
    end,
    last_seen_at = now(),
    updated_at = now();
  return true;
end;
$$;

create or replace function public.get_team_task_performance(
  target_organization_id uuid,
  range_starts_at timestamptz,
  range_ends_at timestamptz
)
returns table (
  user_id uuid,
  tasks_requested bigint,
  tasks_assigned bigint,
  tasks_completed bigint,
  completed_on_time bigint,
  completed_late bigint,
  overdue_open bigint,
  review_submissions bigint,
  revisions_requested bigint,
  revisions_received bigint,
  last_activity_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if range_starts_at is null or range_ends_at is null
    or range_starts_at >= range_ends_at
    or range_ends_at - range_starts_at > interval '366 days' then
    raise exception 'Choose a valid reporting period of no more than 366 days';
  end if;
  if not private.has_org_role(
    target_organization_id,
    array['owner', 'admin', 'manager']::public.app_role[]
  ) then
    raise exception 'Only organization leadership can view team performance';
  end if;

  return query
  select
    membership.user_id,
    (select count(*) from public.tasks task
      where task.organization_id = target_organization_id
        and task.created_by = membership.user_id
        and task.created_at >= range_starts_at and task.created_at < range_ends_at),
    (select count(*) from public.tasks task
      where task.organization_id = target_organization_id
        and task.owner_id = membership.user_id
        and task.created_at >= range_starts_at and task.created_at < range_ends_at),
    (select count(*) from public.tasks task
      where task.organization_id = target_organization_id
        and task.owner_id = membership.user_id
        and task.completed_at >= range_starts_at and task.completed_at < range_ends_at),
    (select count(*) from public.tasks task
      where task.organization_id = target_organization_id
        and task.owner_id = membership.user_id
        and task.completed_at >= range_starts_at and task.completed_at < range_ends_at
        and task.completed_at <= task.due_at),
    (select count(*) from public.tasks task
      where task.organization_id = target_organization_id
        and task.owner_id = membership.user_id
        and task.completed_at >= range_starts_at and task.completed_at < range_ends_at
        and task.completed_at > task.due_at),
    (select count(*) from public.tasks task
      where task.organization_id = target_organization_id
        and task.owner_id = membership.user_id
        and task.status not in ('done', 'cancelled') and task.due_at < now()),
    (select count(*) from public.task_events event
      join public.tasks task on task.id = event.task_id
      where event.organization_id = target_organization_id
        and task.owner_id = membership.user_id
        and event.to_status = 'review'
        and event.occurred_at >= range_starts_at and event.occurred_at < range_ends_at),
    (select count(*) from public.content_revision_requests revision
      where revision.organization_id = target_organization_id
        and revision.requested_by = membership.user_id
        and revision.requested_at >= range_starts_at and revision.requested_at < range_ends_at),
    (select count(*) from public.content_revision_requests revision
      where revision.organization_id = target_organization_id
        and revision.assigned_to = membership.user_id
        and revision.requested_at >= range_starts_at and revision.requested_at < range_ends_at),
    (select max(event.occurred_at) from public.task_events event
      where event.organization_id = target_organization_id
        and event.actor_id = membership.user_id)
  from public.memberships membership
  where membership.organization_id = target_organization_id
    and membership.status = 'active'
    and membership.role <> 'viewer'
  order by membership.joined_at nulls last, membership.user_id;
end;
$$;

alter table public.notifications enable row level security;
alter table public.member_presence enable row level security;

create policy "notifications_select_recipient"
on public.notifications for select to authenticated
using (user_id = (select auth.uid()) and private.is_org_member(organization_id));

create policy "member_presence_select_self_or_leadership"
on public.member_presence for select to authenticated
using (
  user_id = (select auth.uid())
  or private.has_org_role(
    organization_id,
    array['owner', 'admin', 'manager']::public.app_role[]
  )
);

revoke all on table public.notifications from anon, authenticated;
revoke all on table public.member_presence from anon, authenticated;
grant select on table public.notifications to authenticated;
grant select on table public.member_presence to authenticated;

revoke all on function private.add_notification(uuid, uuid, text, text, text, text, uuid, text, text)
from public, anon, authenticated;
revoke all on function private.notify_task_change() from public, anon, authenticated;
revoke all on function private.notify_content_revision() from public, anon, authenticated;

revoke all on function public.mark_notification_read(bigint) from public, anon, authenticated;
grant execute on function public.mark_notification_read(bigint) to authenticated;
revoke all on function public.mark_all_notifications_read(uuid) from public, anon, authenticated;
grant execute on function public.mark_all_notifications_read(uuid) to authenticated;
revoke all on function public.record_member_presence(uuid, text) from public, anon, authenticated;
grant execute on function public.record_member_presence(uuid, text) to authenticated;
revoke all on function public.get_team_task_performance(uuid, timestamptz, timestamptz)
from public, anon, authenticated;
grant execute on function public.get_team_task_performance(uuid, timestamptz, timestamptz) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
    ) then alter publication supabase_realtime add table public.notifications; end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'member_presence'
    ) then alter publication supabase_realtime add table public.member_presence; end if;
  end if;
end;
$$;

comment on table public.member_presence is
  'Transparent coarse workspace presence only: current section, session start, and last heartbeat. No clicks, keystrokes, or hidden surveillance.';
comment on function public.get_team_task_performance(uuid, timestamptz, timestamptz) is
  'Evidence-based task counts for leadership. It deliberately returns no productivity score or subjective employee ranking.';
