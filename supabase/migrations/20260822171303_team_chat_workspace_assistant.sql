-- Team community chat and permission-scoped workspace assistant foundation.
-- Chat writes are command-only, while reads stay tenant and section scoped.

create or replace function private.valid_workspace_sections(target_sections text[])
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select target_sections is not null
    and cardinality(target_sections) > 0
    and target_sections <@ array[
      'dashboard', 'tasks', 'planning', 'content', 'scripts', 'publishing',
      'brand', 'campaigns', 'crm', 'analytics', 'chat', 'team', 'settings'
    ]::text[];
$$;

alter table public.memberships
  alter column allowed_sections set default array['tasks', 'chat']::text[];

alter table public.team_invitations
  alter column allowed_sections set default array['tasks', 'chat']::text[];

update public.memberships
set allowed_sections = array_append(allowed_sections, 'chat')
where not ('chat' = any(allowed_sections));

update public.team_invitations
set allowed_sections = array_append(allowed_sections, 'chat')
where status = 'pending'
  and not ('chat' = any(allowed_sections));

create or replace function private.enforce_membership_section_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  invited_sections text[];
begin
  if new.role = 'owner' then
    new.allowed_sections := array[
      'dashboard', 'tasks', 'planning', 'content', 'scripts', 'publishing',
      'brand', 'campaigns', 'crm', 'analytics', 'chat', 'team', 'settings'
    ]::text[];
    return new;
  end if;

  if (tg_op = 'INSERT' or (tg_op = 'UPDATE' and old.status <> 'active' and new.status = 'active')) then
    select invitation.allowed_sections
      into invited_sections
    from public.team_invitations invitation
    join auth.users auth_user
      on lower(auth_user.email) = invitation.email
    where invitation.organization_id = new.organization_id
      and auth_user.id = new.user_id
      and invitation.status = 'pending'
      and invitation.expires_at > now()
    order by invitation.created_at desc
    limit 1;

    if invited_sections is not null then
      new.allowed_sections := invited_sections;
    end if;
  end if;

  if not private.valid_workspace_sections(new.allowed_sections) then
    raise exception 'Choose at least one valid workspace section';
  end if;
  return new;
end;
$$;

alter table public.member_presence
  drop constraint member_presence_section_allowed;

alter table public.member_presence
  add constraint member_presence_section_allowed check (
    current_section in (
      'dashboard', 'tasks', 'planning', 'content', 'scripts', 'publishing',
      'brand', 'campaigns', 'crm', 'analytics', 'chat', 'team', 'settings'
    )
  );

create or replace function public.record_member_presence(
  target_organization_id uuid,
  target_section text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if actor is null then raise exception 'Authentication is required'; end if;
  if target_section not in (
    'dashboard', 'tasks', 'planning', 'content', 'scripts', 'publishing',
    'brand', 'campaigns', 'crm', 'analytics', 'chat', 'team', 'settings'
  ) then raise exception 'Unknown workspace section'; end if;
  insert into public.member_presence (
    organization_id, user_id, current_section, session_started_at, last_seen_at, updated_at
  ) values (
    target_organization_id, actor, target_section, now(), now(), now()
  )
  on conflict (organization_id, user_id) do update
  set current_section = excluded.current_section;
  return true;
end;
$$;

create table public.team_chat_rooms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  created_by uuid not null references public.profiles (id) on delete restrict,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, slug),
  constraint team_chat_rooms_name_length check (char_length(trim(name)) between 2 and 80),
  constraint team_chat_rooms_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint team_chat_rooms_description_length check (description is null or char_length(description) <= 500)
);

create table public.team_chat_messages (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  room_id uuid not null,
  author_id uuid not null references public.profiles (id) on delete restrict,
  body text not null,
  reply_to_id bigint references public.team_chat_messages (id) on delete set null,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint team_chat_messages_room_org_fkey
    foreign key (room_id, organization_id)
    references public.team_chat_rooms (id, organization_id) on delete cascade,
  constraint team_chat_messages_body_length check (char_length(trim(body)) between 1 and 4000)
);

create index team_chat_rooms_org_active_idx
  on public.team_chat_rooms (organization_id, is_archived, created_at, id);
create index team_chat_rooms_creator_idx on public.team_chat_rooms (created_by);
create index team_chat_messages_room_time_idx
  on public.team_chat_messages (room_id, created_at desc, id desc);
create index team_chat_messages_org_time_idx
  on public.team_chat_messages (organization_id, created_at desc, id desc);
create index team_chat_messages_author_idx on public.team_chat_messages (author_id, created_at desc);
create index team_chat_messages_reply_idx on public.team_chat_messages (reply_to_id) where reply_to_id is not null;

create trigger team_chat_rooms_set_updated_at
before update on public.team_chat_rooms
for each row execute function private.set_updated_at();

insert into public.team_chat_rooms (organization_id, name, slug, description, created_by)
select organization.id, 'عام الفريق', 'general', 'المكان اليومي للنقاش والتنسيق بين أعضاء الفريق.', organization.created_by
from public.organizations organization
where not exists (
  select 1 from public.team_chat_rooms room
  where room.organization_id = organization.id and room.slug = 'general'
);

alter table public.team_chat_rooms enable row level security;
alter table public.team_chat_messages enable row level security;

create policy "team_chat_rooms_read_section"
on public.team_chat_rooms for select to authenticated
using (private.can_access_any_section(organization_id, array['chat']::text[]));

create policy "team_chat_messages_read_section"
on public.team_chat_messages for select to authenticated
using (private.can_access_any_section(organization_id, array['chat']::text[]));

revoke all on table public.team_chat_rooms from anon, authenticated;
revoke all on table public.team_chat_messages from anon, authenticated;
grant select on table public.team_chat_rooms to authenticated;
grant select on table public.team_chat_messages to authenticated;

create or replace function public.send_team_chat_message(
  target_organization_id uuid,
  target_room_id uuid,
  message_body text,
  target_reply_to_id bigint default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  new_message_id bigint;
  reply_author uuid;
begin
  if actor is null then raise exception 'Authentication is required'; end if;
  if not private.can_access_any_section(target_organization_id, array['chat']::text[]) then
    raise exception 'Chat section access is required';
  end if;
  if char_length(trim(coalesce(message_body, ''))) not between 1 and 4000 then
    raise exception 'Message must contain between 1 and 4000 characters';
  end if;
  if not exists (
    select 1 from public.team_chat_rooms room
    where room.id = target_room_id
      and room.organization_id = target_organization_id
      and not room.is_archived
  ) then raise exception 'Chat room is unavailable'; end if;

  if target_reply_to_id is not null then
    select message.author_id into reply_author
    from public.team_chat_messages message
    where message.id = target_reply_to_id
      and message.organization_id = target_organization_id
      and message.room_id = target_room_id
      and message.deleted_at is null;
    if reply_author is null then raise exception 'Reply target is unavailable'; end if;
  end if;

  insert into public.team_chat_messages (
    organization_id, room_id, author_id, body, reply_to_id
  ) values (
    target_organization_id, target_room_id, actor, trim(message_body), target_reply_to_id
  ) returning id into new_message_id;

  if reply_author is not null and reply_author <> actor then
    perform private.add_notification(
      target_organization_id, reply_author, 'chat_reply',
      'رد جديد في دردشة الفريق', left(trim(message_body), 180),
      'chat_message', null, '/chat?room=' || target_room_id || '#message-' || new_message_id,
      'chat:' || new_message_id || ':reply:user:' || reply_author
    );
  end if;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, after_data
  ) values (
    target_organization_id, actor, 'chat.message_sent', 'chat_message',
    jsonb_build_object('message_id', new_message_id, 'room_id', target_room_id, 'reply_to_id', target_reply_to_id)
  );
  return new_message_id;
end;
$$;

create or replace function public.edit_team_chat_message(
  target_message_id bigint,
  message_body text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  message_record public.team_chat_messages%rowtype;
begin
  if actor is null then raise exception 'Authentication is required'; end if;
  if char_length(trim(coalesce(message_body, ''))) not between 1 and 4000 then
    raise exception 'Message must contain between 1 and 4000 characters';
  end if;
  select * into message_record from public.team_chat_messages where id = target_message_id for update;
  if message_record.id is null or message_record.author_id <> actor or message_record.deleted_at is not null then
    raise exception 'Only the message author can edit this message';
  end if;
  if not private.can_access_any_section(message_record.organization_id, array['chat']::text[]) then
    raise exception 'Chat section access is required';
  end if;
  update public.team_chat_messages
  set body = trim(message_body), edited_at = now()
  where id = target_message_id;
  return true;
end;
$$;

create or replace function public.delete_team_chat_message(target_message_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  message_record public.team_chat_messages%rowtype;
  actor_is_moderator boolean;
begin
  if actor is null then raise exception 'Authentication is required'; end if;
  select * into message_record from public.team_chat_messages where id = target_message_id for update;
  if message_record.id is null then raise exception 'Message was not found'; end if;
  select exists (
    select 1 from public.memberships membership
    where membership.organization_id = message_record.organization_id
      and membership.user_id = actor
      and membership.status = 'active'
      and membership.role in ('owner', 'admin')
  ) into actor_is_moderator;
  if message_record.author_id <> actor and not actor_is_moderator then
    raise exception 'Only the author or workspace leadership can delete this message';
  end if;
  update public.team_chat_messages
  set body = 'تم حذف الرسالة', deleted_at = coalesce(deleted_at, now()), edited_at = null
  where id = target_message_id;
  return true;
end;
$$;

create or replace function public.create_team_chat_room(
  target_organization_id uuid,
  room_name text,
  room_slug text,
  room_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  room_id uuid;
begin
  if actor is null or not private.has_org_role(target_organization_id, array['owner','admin']::public.app_role[]) then
    raise exception 'Only workspace leadership can create chat rooms';
  end if;
  insert into public.team_chat_rooms (organization_id, name, slug, description, created_by)
  values (target_organization_id, trim(room_name), lower(trim(room_slug)), nullif(trim(room_description), ''), actor)
  returning id into room_id;
  return room_id;
end;
$$;

alter table public.notifications
  drop constraint notifications_kind_allowed;

alter table public.notifications
  add constraint notifications_kind_allowed check (
    kind in (
      'task_assigned', 'task_ready', 'task_review', 'task_blocked', 'task_done',
      'revision_requested', 'publication_published', 'publication_failed',
      'publication_held', 'script_assigned', 'script_ready', 'script_research_assigned',
      'content_brief_updated', 'team_joined', 'team_access_changed',
      'task_due_soon', 'task_overdue', 'task_overdue_escalated', 'chat_reply'
    )
  );

create or replace function public.get_workspace_assistant_provider_runtime(
  target_user_id uuid,
  target_organization_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  provider_record public.ai_providers%rowtype;
  api_key text;
begin
  if not exists (
    select 1 from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = target_user_id
      and membership.status = 'active'
  ) then raise exception 'Active workspace membership is required'; end if;

  select * into provider_record
  from public.ai_providers provider
  where provider.organization_id = target_organization_id
    and provider.is_enabled and provider.is_default
  limit 1;
  if provider_record.id is null then return null; end if;

  select decrypted.decrypted_secret into api_key
  from private.ai_provider_secrets secret_ref
  join vault.decrypted_secrets decrypted on decrypted.id = secret_ref.vault_secret_id
  where secret_ref.provider_id = provider_record.id;
  if api_key is null then return null; end if;

  return jsonb_build_object(
    'id', provider_record.id,
    'name', provider_record.name,
    'protocol', provider_record.protocol,
    'base_url', provider_record.base_url,
    'model', provider_record.model,
    'api_key', api_key
  );
end;
$$;

revoke all on function public.send_team_chat_message(uuid, uuid, text, bigint) from public, anon;
grant execute on function public.send_team_chat_message(uuid, uuid, text, bigint) to authenticated;
revoke all on function public.edit_team_chat_message(bigint, text) from public, anon;
grant execute on function public.edit_team_chat_message(bigint, text) to authenticated;
revoke all on function public.delete_team_chat_message(bigint) from public, anon;
grant execute on function public.delete_team_chat_message(bigint) to authenticated;
revoke all on function public.create_team_chat_room(uuid, text, text, text) from public, anon;
grant execute on function public.create_team_chat_room(uuid, text, text, text) to authenticated;
revoke all on function public.get_workspace_assistant_provider_runtime(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_workspace_assistant_provider_runtime(uuid, uuid) to service_role;

alter publication supabase_realtime add table public.team_chat_messages;
