-- Give every task a private discussion thread for its assignee, requester, and
-- platform leadership. Messages create durable, exact-link notifications. Also
-- require active members to keep a usable display name so tasks and chat never
-- fall back to an anonymous "team member" label.

update public.profiles profile
set full_name = 'سميح عجوة',
    updated_at = now()
from auth.users app_user
where profile.id = app_user.id
  and lower(app_user.email) = 'samihsmaih1234@gmail.com'
  and nullif(trim(profile.full_name), '') is null;

create or replace function private.require_active_member_display_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_name text;
begin
  if new.status <> 'active' then return new; end if;

  select nullif(trim(profile.full_name), '') into member_name
  from public.profiles profile
  where profile.id = new.user_id;

  if member_name is null or char_length(member_name) not between 2 and 120 then
    raise exception 'An active team member must have a display name';
  end if;
  return new;
end;
$$;

create trigger memberships_require_display_name
before insert or update of status, user_id on public.memberships
for each row execute function private.require_active_member_display_name();

create or replace function private.protect_active_member_display_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.memberships membership
    where membership.user_id = new.id
      and membership.status = 'active'
  ) and (
    nullif(trim(new.full_name), '') is null
    or char_length(trim(new.full_name)) not between 2 and 120
  ) then
    raise exception 'An active team member must keep a display name';
  end if;

  if new.full_name is not null then new.full_name := trim(new.full_name); end if;
  return new;
end;
$$;

create trigger profiles_protect_active_display_name
before update of full_name on public.profiles
for each row execute function private.protect_active_member_display_name();

create table public.task_discussion_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete restrict,
  body text not null,
  created_at timestamptz not null default now(),
  constraint task_discussion_messages_body_length check (
    char_length(trim(body)) between 2 and 4000
  )
);

create index task_discussion_messages_task_time_idx
  on public.task_discussion_messages (task_id, created_at, id);
create index task_discussion_messages_author_time_idx
  on public.task_discussion_messages (author_id, created_at desc, id);

alter table public.task_discussion_messages enable row level security;

create policy "task_discussion_select_participants"
on public.task_discussion_messages for select to authenticated
using (
  exists (
    select 1
    from public.tasks task
    where task.id = task_discussion_messages.task_id
      and task.organization_id = task_discussion_messages.organization_id
      and (
        task.owner_id = (select auth.uid())
        or task.created_by = (select auth.uid())
        or private.is_org_owner_or_admin_actor(
          (select auth.uid()),
          task_discussion_messages.organization_id
        )
      )
  )
);

create policy "task_discussion_insert_participants"
on public.task_discussion_messages for insert to authenticated
with check (
  author_id = (select auth.uid())
  and exists (
    select 1
    from public.tasks task
    where task.id = task_discussion_messages.task_id
      and task.organization_id = task_discussion_messages.organization_id
      and (
        task.owner_id = (select auth.uid())
        or task.created_by = (select auth.uid())
        or private.is_org_owner_or_admin_actor(
          (select auth.uid()),
          task_discussion_messages.organization_id
        )
      )
  )
);

create policy "section_scope_task_discussion_messages"
on public.task_discussion_messages
as restrictive for all to authenticated
using (
  private.can_access_any_section(
    organization_id,
    array['tasks','content','scripts','campaigns','crm']::text[]
  )
)
with check (
  private.can_access_any_section(
    organization_id,
    array['tasks','content','scripts','campaigns','crm']::text[]
  )
);

revoke all on table public.task_discussion_messages from anon, authenticated;
grant select on table public.task_discussion_messages to authenticated;
grant insert (task_id, body) on table public.task_discussion_messages to authenticated;

create or replace function private.prepare_task_discussion_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  task_record public.tasks%rowtype;
begin
  if actor is null then raise exception 'An authenticated actor is required'; end if;

  select task.* into task_record
  from public.tasks task
  where task.id = new.task_id;

  if task_record.id is null then raise exception 'Task was not found'; end if;
  if actor <> task_record.owner_id
    and actor <> task_record.created_by
    and not private.is_org_owner_or_admin_actor(actor, task_record.organization_id) then
    raise exception 'Only task participants can join this discussion';
  end if;
  if not private.can_access_any_section(
    task_record.organization_id,
    array['tasks','content','scripts','campaigns','crm']::text[]
  ) then
    raise exception 'Task discussion access is not allowed for this member';
  end if;
  if new.body is null or char_length(trim(new.body)) not between 2 and 4000 then
    raise exception 'Task discussion messages must contain between 2 and 4000 characters';
  end if;

  new.organization_id := task_record.organization_id;
  new.author_id := actor;
  new.body := trim(new.body);
  new.created_at := now();
  return new;
end;
$$;

create trigger task_discussion_messages_prepare
before insert on public.task_discussion_messages
for each row execute function private.prepare_task_discussion_message();

create or replace function private.notify_task_discussion_participants()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_record public.tasks%rowtype;
  author_name text;
  recipient uuid;
  notification_title text;
begin
  select task.* into task_record
  from public.tasks task
  where task.id = new.task_id;

  select coalesce(nullif(trim(profile.full_name), ''), 'عضو الفريق') into author_name
  from public.profiles profile
  where profile.id = new.author_id;

  for recipient in
    select distinct participant_id
    from (values (task_record.owner_id), (task_record.created_by)) participant(participant_id)
    where participant_id <> new.author_id
      and exists (
        select 1
        from public.memberships membership
        where membership.organization_id = new.organization_id
          and membership.user_id = participant_id
          and membership.status = 'active'
      )
  loop
    notification_title := case
      when new.author_id = task_record.owner_id and recipient = task_record.created_by
        then 'سؤال جديد على مهمة'
      when new.author_id = task_record.created_by and recipient = task_record.owner_id
        then 'رد أو توضيح على مهمة'
      else 'رسالة جديدة على مهمة'
    end;

    perform private.add_notification(
      new.organization_id,
      recipient,
      case when new.author_id = task_record.owner_id then 'task_question' else 'task_discussion' end,
      notification_title,
      author_name || ' على «' || task_record.title || '»: ' || left(new.body, 700),
      'task_discussion',
      new.id,
      '/tasks/' || task_record.id || '?message=' || new.id || '#discussion-' || new.id,
      'task:' || task_record.id || ':discussion:' || new.id || ':user:' || recipient
    );
  end loop;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    new.organization_id,
    new.author_id,
    'task.discussion_message_created',
    'task_discussion',
    new.id,
    jsonb_build_object('task_id', new.task_id, 'message_preview', left(new.body, 300))
  );
  return new;
end;
$$;

create trigger task_discussion_messages_notify
after insert on public.task_discussion_messages
for each row execute function private.notify_task_discussion_participants();

-- Preserve every existing exact-link rule and add exact task-discussion links.
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
      new.url := '/tasks/' || new.entity_id;
    when 'task_discussion' then
      select message.task_id into related_id
      from public.task_discussion_messages message
      where message.id = new.entity_id;
      if related_id is not null then
        new.url := '/tasks/' || related_id || '?message=' || new.entity_id || '#discussion-' || new.entity_id;
      end if;
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

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'task_discussion_messages'
    ) then
    alter publication supabase_realtime add table public.task_discussion_messages;
  end if;
end;
$$;

revoke all on function private.require_active_member_display_name()
from public, anon, authenticated;
revoke all on function private.protect_active_member_display_name()
from public, anon, authenticated;
revoke all on function private.prepare_task_discussion_message()
from public, anon, authenticated;
revoke all on function private.notify_task_discussion_participants()
from public, anon, authenticated;
revoke all on function private.canonicalize_notification_url()
from public, anon, authenticated;
