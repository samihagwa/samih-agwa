-- Workflow notifications belong to every active member, even when that member
-- cannot open the publishing section. A typed username is used only to verify
-- the account that presses Start; delivery always uses Telegram's private
-- chat_id. Members can enqueue a rate-limited test through the durable outbox.

alter table public.publishing_admin_connections
  add column workflow_expected_username text;

alter table public.publishing_admin_connections
  add constraint publishing_connections_workflow_username_format check (
    workflow_expected_username is null
    or workflow_expected_username ~ '^[a-z0-9_]{5,32}$'
  );

update public.publishing_admin_connections connection
set workflow_expected_username = lower(nullif(trim(leading '@' from connection.telegram_username), ''))
where connection.telegram_username is not null;

drop policy if exists "section_scope_publishing_connections"
on public.publishing_admin_connections;

create policy "section_scope_publishing_connections"
on public.publishing_admin_connections
as restrictive for select to authenticated
using (
  private.can_access_any_section(organization_id, array['publishing']::text[])
  or (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.memberships membership
      where membership.organization_id = publishing_admin_connections.organization_id
        and membership.user_id = (select auth.uid())
        and membership.status = 'active'
    )
  )
);

create or replace function private.guard_publishing_section_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target_organization_id uuid;
  target_user_id uuid;
begin
  if actor is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  target_organization_id := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  if private.can_access_any_section(target_organization_id, array['publishing']::text[]) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_table_name <> 'publishing_admin_connections' or tg_op = 'DELETE' then
    raise exception 'Publishing section access is required';
  end if;

  target_user_id := new.user_id;
  if target_user_id <> actor or not exists (
    select 1
    from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = actor
      and membership.status = 'active'
  ) then
    raise exception 'Active organization membership is required';
  end if;

  if tg_op = 'INSERT' then
    if new.notifications_enabled
      or new.workflow_notifications_enabled
      or new.telegram_chat_id is not null
      or new.telegram_user_id is not null
      or new.telegram_username is not null
      or new.connected_at is not null then
      raise exception 'A member may only start their own Telegram workflow link';
    end if;
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id
    or new.user_id is distinct from old.user_id
    or new.telegram_chat_id is distinct from old.telegram_chat_id
    or new.telegram_user_id is distinct from old.telegram_user_id
    or new.telegram_username is distinct from old.telegram_username
    or new.connected_at is distinct from old.connected_at
    or new.notifications_enabled is distinct from old.notifications_enabled then
    raise exception 'A member may only change their own workflow notification settings';
  end if;

  return new;
end;
$$;

drop function if exists public.create_member_telegram_link(uuid);

create function public.create_member_telegram_link(
  target_organization_id uuid,
  target_telegram_username text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  normalized_username text := lower(trim(leading '@' from trim(coalesce(target_telegram_username, ''))));
  raw_code text := encode(extensions.gen_random_bytes(18), 'hex');
begin
  if actor is null or not exists (
    select 1
    from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = actor
      and membership.status = 'active'
  ) then
    raise exception 'Active organization membership is required';
  end if;
  if normalized_username !~ '^[a-z0-9_]{5,32}$' then
    raise exception 'A valid Telegram username is required';
  end if;

  insert into public.publishing_admin_connections (
    organization_id,
    user_id,
    notifications_enabled,
    workflow_notifications_enabled,
    workflow_expected_username,
    link_code_hash,
    link_expires_at,
    updated_at
  ) values (
    target_organization_id,
    actor,
    false,
    false,
    normalized_username,
    encode(extensions.digest(convert_to(raw_code, 'UTF8'), 'sha256'), 'hex'),
    now() + interval '15 minutes',
    now()
  ) on conflict (organization_id, user_id) do update set
    workflow_expected_username = excluded.workflow_expected_username,
    link_code_hash = excluded.link_code_hash,
    link_expires_at = excluded.link_expires_at,
    updated_at = now();

  return raw_code;
end;
$$;

create or replace function public.complete_member_telegram_link(
  raw_link_code text,
  target_telegram_chat_id bigint,
  target_telegram_user_id bigint,
  target_telegram_username text
)
returns table (organization_id uuid, user_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  link_hash text := encode(
    extensions.digest(convert_to(trim(raw_link_code), 'UTF8'), 'sha256'),
    'hex'
  );
  normalized_username text := lower(trim(leading '@' from trim(coalesce(target_telegram_username, ''))));
begin
  if nullif(trim(raw_link_code), '') is null
    or target_telegram_chat_id is null
    or target_telegram_chat_id <= 0
    or target_telegram_user_id is null
    or target_telegram_user_id <= 0 then
    raise exception 'A valid connection code and private Telegram identity are required';
  end if;

  return query
  with linked as (
    update public.publishing_admin_connections connection
    set telegram_chat_id = target_telegram_chat_id,
      telegram_user_id = target_telegram_user_id,
      telegram_username = nullif(left(trim(target_telegram_username), 64), ''),
      workflow_expected_username = nullif(normalized_username, ''),
      link_code_hash = null,
      link_expires_at = null,
      connected_at = now(),
      workflow_notifications_enabled = true,
      workflow_last_error = null,
      updated_at = now()
    where connection.link_code_hash = link_hash
      and connection.link_expires_at > now()
      and connection.workflow_expected_username = normalized_username
      and exists (
        select 1
        from public.memberships membership
        where membership.organization_id = connection.organization_id
          and membership.user_id = connection.user_id
          and membership.status = 'active'
      )
    returning connection.organization_id, connection.user_id
  ), audited as (
    insert into public.audit_events (
      organization_id, actor_id, action, entity_type, entity_id, after_data
    )
    select linked.organization_id, linked.user_id,
      'team.telegram_notifications_connected', 'profile', linked.user_id,
      jsonb_build_object(
        'workflow_notifications_enabled', true,
        'telegram_username_verified', true
      )
    from linked
    returning 1
  )
  select linked.organization_id, linked.user_id
  from linked
  cross join audited;
end;
$$;

alter table public.notifications
  drop constraint notifications_kind_allowed;

alter table public.notifications
  add constraint notifications_kind_allowed check (kind = any (array[
    'task_assigned',
    'task_ready',
    'task_review',
    'task_blocked',
    'task_done',
    'revision_requested',
    'publication_published',
    'publication_failed',
    'publication_held',
    'script_assigned',
    'script_ready',
    'script_research_assigned',
    'content_brief_updated',
    'team_joined',
    'team_access_changed',
    'task_due_soon',
    'task_overdue',
    'task_overdue_escalated',
    'chat_reply',
    'task_question',
    'task_discussion',
    'telegram_test'
  ]));

create or replace function public.send_member_telegram_test_notification(
  target_organization_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  notification_id bigint;
begin
  if actor is null or not exists (
    select 1
    from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = actor
      and membership.status = 'active'
  ) then
    raise exception 'Active organization membership is required';
  end if;
  if not exists (
    select 1
    from public.publishing_admin_connections connection
    where connection.organization_id = target_organization_id
      and connection.user_id = actor
      and connection.connected_at is not null
      and connection.telegram_chat_id is not null
      and connection.workflow_notifications_enabled
  ) then
    raise exception 'Connect Telegram and enable workflow notifications first';
  end if;
  if exists (
    select 1
    from public.notifications notification
    where notification.organization_id = target_organization_id
      and notification.user_id = actor
      and notification.kind = 'telegram_test'
      and notification.created_at > now() - interval '30 seconds'
  ) then
    raise exception 'Wait before sending another Telegram test';
  end if;

  insert into public.notifications (
    organization_id, user_id, kind, title, body,
    entity_type, entity_id, url, dedupe_key
  ) values (
    target_organization_id,
    actor,
    'telegram_test',
    'اختبار إشعارات Telegram',
    'تمام يا حوت — الربط شغال، وأي مهمة أو تعديل يخص حسابك هيوصلك هنا برابط مباشر.',
    'telegram_test',
    null,
    '/tasks',
    'telegram-test:' || actor || ':' || gen_random_uuid()
  ) returning id into notification_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id, actor, 'team.telegram_test_enqueued',
    'profile', actor, jsonb_build_object('notification_id', notification_id)
  );

  return notification_id;
end;
$$;

revoke all on function private.guard_publishing_section_write()
from public, anon, authenticated;

revoke all on function public.create_member_telegram_link(uuid, text)
from public, anon, authenticated;
grant execute on function public.create_member_telegram_link(uuid, text)
to authenticated;

revoke all on function public.complete_member_telegram_link(text, bigint, bigint, text)
from public, anon, authenticated;
grant execute on function public.complete_member_telegram_link(text, bigint, bigint, text)
to service_role;

revoke all on function public.send_member_telegram_test_notification(uuid)
from public, anon, authenticated;
grant execute on function public.send_member_telegram_test_notification(uuid)
to authenticated;
