-- Move chat mutations behind an authenticated Edge command boundary. The
-- browser can read via RLS, but cannot execute SECURITY DEFINER writes itself.

create index team_chat_messages_room_org_idx
  on public.team_chat_messages (room_id, organization_id);

create or replace function private.user_can_access_section(
  target_user_id uuid,
  target_organization_id uuid,
  target_section text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = target_user_id
      and membership.status = 'active'
      and (membership.role = 'owner' or target_section = any(membership.allowed_sections))
  );
$$;

create or replace function public.send_team_chat_message_v2(
  target_actor_id uuid,
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
  new_message_id bigint;
  reply_author uuid;
begin
  if not private.user_can_access_section(target_actor_id, target_organization_id, 'chat') then
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

  insert into public.team_chat_messages (organization_id, room_id, author_id, body, reply_to_id)
  values (target_organization_id, target_room_id, target_actor_id, trim(message_body), target_reply_to_id)
  returning id into new_message_id;

  if reply_author is not null and reply_author <> target_actor_id then
    perform private.add_notification(
      target_organization_id, reply_author, 'chat_reply',
      'رد جديد في دردشة الفريق', left(trim(message_body), 180),
      'chat_message', null, '/chat?room=' || target_room_id || '#message-' || new_message_id,
      'chat:' || new_message_id || ':reply:user:' || reply_author
    );
  end if;
  insert into public.audit_events (organization_id, actor_id, action, entity_type, after_data)
  values (
    target_organization_id, target_actor_id, 'chat.message_sent', 'chat_message',
    jsonb_build_object('message_id', new_message_id, 'room_id', target_room_id, 'reply_to_id', target_reply_to_id)
  );
  return new_message_id;
end;
$$;

create or replace function public.edit_team_chat_message_v2(
  target_actor_id uuid,
  target_message_id bigint,
  message_body text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  message_record public.team_chat_messages%rowtype;
begin
  if char_length(trim(coalesce(message_body, ''))) not between 1 and 4000 then
    raise exception 'Message must contain between 1 and 4000 characters';
  end if;
  select * into message_record from public.team_chat_messages where id = target_message_id for update;
  if message_record.id is null or message_record.author_id <> target_actor_id or message_record.deleted_at is not null then
    raise exception 'Only the message author can edit this message';
  end if;
  if not private.user_can_access_section(target_actor_id, message_record.organization_id, 'chat') then
    raise exception 'Chat section access is required';
  end if;
  update public.team_chat_messages set body = trim(message_body), edited_at = now() where id = target_message_id;
  return true;
end;
$$;

create or replace function public.delete_team_chat_message_v2(
  target_actor_id uuid,
  target_message_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  message_record public.team_chat_messages%rowtype;
  actor_is_moderator boolean;
begin
  select * into message_record from public.team_chat_messages where id = target_message_id for update;
  if message_record.id is null then raise exception 'Message was not found'; end if;
  select exists (
    select 1 from public.memberships membership
    where membership.organization_id = message_record.organization_id
      and membership.user_id = target_actor_id
      and membership.status = 'active'
      and membership.role in ('owner', 'admin')
  ) into actor_is_moderator;
  if message_record.author_id <> target_actor_id and not actor_is_moderator then
    raise exception 'Only the author or workspace leadership can delete this message';
  end if;
  if not private.user_can_access_section(target_actor_id, message_record.organization_id, 'chat') then
    raise exception 'Chat section access is required';
  end if;
  update public.team_chat_messages
  set body = 'تم حذف الرسالة', deleted_at = coalesce(deleted_at, now()), edited_at = null
  where id = target_message_id;
  return true;
end;
$$;

create or replace function public.create_team_chat_room_v2(
  target_actor_id uuid,
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
declare room_id uuid;
begin
  if not exists (
    select 1 from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = target_actor_id
      and membership.status = 'active'
      and membership.role in ('owner', 'admin')
      and (membership.role = 'owner' or 'chat' = any(membership.allowed_sections))
  ) then raise exception 'Only workspace leadership can create chat rooms'; end if;
  insert into public.team_chat_rooms (organization_id, name, slug, description, created_by)
  values (target_organization_id, trim(room_name), lower(trim(room_slug)), nullif(trim(room_description), ''), target_actor_id)
  returning id into room_id;
  return room_id;
end;
$$;

revoke all on function private.user_can_access_section(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.send_team_chat_message_v2(uuid, uuid, uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.edit_team_chat_message_v2(uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.delete_team_chat_message_v2(uuid, bigint) from public, anon, authenticated;
revoke all on function public.create_team_chat_room_v2(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.send_team_chat_message_v2(uuid, uuid, uuid, text, bigint) to service_role;
grant execute on function public.edit_team_chat_message_v2(uuid, bigint, text) to service_role;
grant execute on function public.delete_team_chat_message_v2(uuid, bigint) to service_role;
grant execute on function public.create_team_chat_room_v2(uuid, uuid, text, text, text) to service_role;

revoke all on function public.send_team_chat_message(uuid, uuid, text, bigint) from authenticated;
revoke all on function public.edit_team_chat_message(bigint, text) from authenticated;
revoke all on function public.delete_team_chat_message(bigint) from authenticated;
revoke all on function public.create_team_chat_room(uuid, text, text, text) from authenticated;

drop function public.send_team_chat_message(uuid, uuid, text, bigint);
drop function public.edit_team_chat_message(bigint, text);
drop function public.delete_team_chat_message(bigint);
drop function public.create_team_chat_room(uuid, text, text, text);
