-- Every member can explicitly connect the existing Telegram bot to their own
-- account. New in-app notifications are copied to a private, idempotent
-- delivery outbox only after opt-in. The browser never receives the bot token,
-- Telegram usernames are never used as delivery addresses, and a network call
-- is fenced by a durable claim before it starts.

alter table public.publishing_admin_connections
  add column workflow_notifications_enabled boolean not null default false,
  add column workflow_last_sent_at timestamptz,
  add column workflow_last_error text,
  add constraint publishing_connections_workflow_requires_link check (
    not workflow_notifications_enabled or connected_at is not null
  ),
  add constraint publishing_connections_workflow_error_length check (
    workflow_last_error is null or char_length(workflow_last_error) <= 300
  );

create index publishing_connections_workflow_delivery_idx
  on public.publishing_admin_connections (organization_id, user_id)
  where workflow_notifications_enabled and connected_at is not null;

create table private.telegram_notification_outbox (
  notification_id bigint primary key
    references public.notifications (id) on delete cascade,
  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  user_id uuid not null
    references public.profiles (id) on delete cascade,
  status text not null default 'pending',
  available_at timestamptz not null default now(),
  attempt_count integer not null default 0,
  claim_token uuid,
  claimed_at timestamptz,
  network_started_at timestamptz,
  telegram_message_id bigint,
  telegram_error_code integer,
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint telegram_notification_outbox_status_allowed check (
    status in ('pending', 'claimed', 'sent', 'failed', 'unknown', 'cancelled')
  ),
  constraint telegram_notification_outbox_attempts_valid check (
    attempt_count between 0 and 5
  ),
  constraint telegram_notification_outbox_error_length check (
    error is null or char_length(error) <= 500
  ),
  constraint telegram_notification_outbox_state_consistent check (
    (status = 'pending' and claim_token is null and claimed_at is null and network_started_at is null)
    or (status = 'claimed' and claim_token is not null and claimed_at is not null)
    or (status = 'sent' and telegram_message_id is not null and sent_at is not null)
    or status in ('failed', 'unknown', 'cancelled')
  )
);

create index telegram_notification_outbox_claim_idx
  on private.telegram_notification_outbox (status, available_at, notification_id)
  where status in ('pending', 'claimed');

revoke all on table private.telegram_notification_outbox
from public, anon, authenticated;

create or replace function public.create_member_telegram_link(
  target_organization_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
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

  insert into public.publishing_admin_connections (
    organization_id,
    user_id,
    notifications_enabled,
    workflow_notifications_enabled,
    link_code_hash,
    link_expires_at,
    updated_at
  ) values (
    target_organization_id,
    actor,
    false,
    false,
    encode(extensions.digest(convert_to(raw_code, 'UTF8'), 'sha256'), 'hex'),
    now() + interval '15 minutes',
    now()
  ) on conflict (organization_id, user_id) do update set
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
      link_code_hash = null,
      link_expires_at = null,
      connected_at = now(),
      workflow_notifications_enabled = true,
      workflow_last_error = null,
      updated_at = now()
    where connection.link_code_hash = link_hash
      and connection.link_expires_at > now()
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
      jsonb_build_object('workflow_notifications_enabled', true)
    from linked
    returning 1
  )
  select linked.organization_id, linked.user_id
  from linked
  cross join audited;
end;
$$;

create or replace function public.set_member_telegram_workflow_notifications(
  target_organization_id uuid,
  target_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  connection public.publishing_admin_connections%rowtype;
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

  select * into connection
  from public.publishing_admin_connections existing
  where existing.organization_id = target_organization_id
    and existing.user_id = actor
  for update;

  if connection.user_id is null then
    raise exception 'Connect Telegram before changing notification delivery';
  end if;
  if target_enabled and connection.connected_at is null then
    raise exception 'Connect Telegram before enabling notifications';
  end if;

  update public.publishing_admin_connections existing
  set workflow_notifications_enabled = target_enabled,
    workflow_last_error = case when target_enabled then null else existing.workflow_last_error end,
    updated_at = now()
  where existing.organization_id = target_organization_id
    and existing.user_id = actor;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id,
    actor,
    case when target_enabled
      then 'team.telegram_notifications_enabled'
      else 'team.telegram_notifications_disabled'
    end,
    'profile',
    actor,
    jsonb_build_object('workflow_notifications_enabled', target_enabled)
  );

  return true;
end;
$$;

create or replace function private.enqueue_telegram_workflow_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.publishing_admin_connections connection
    join public.memberships membership
      on membership.organization_id = connection.organization_id
      and membership.user_id = connection.user_id
      and membership.status = 'active'
    where connection.organization_id = new.organization_id
      and connection.user_id = new.user_id
      and connection.connected_at is not null
      and connection.telegram_chat_id is not null
      and connection.telegram_user_id is not null
      and connection.workflow_notifications_enabled
  ) then
    insert into private.telegram_notification_outbox (
      notification_id, organization_id, user_id
    ) values (
      new.id, new.organization_id, new.user_id
    ) on conflict (notification_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger notifications_enqueue_telegram_delivery
after insert on public.notifications
for each row execute function private.enqueue_telegram_workflow_notification();

create or replace function public.claim_telegram_notification_batch(
  target_batch_size integer default 20
)
returns table (
  notification_id bigint,
  claim_token uuid,
  organization_id uuid,
  user_id uuid,
  telegram_chat_id bigint,
  notification_kind text,
  notification_title text,
  notification_body text,
  notification_url text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'Service role required';
  end if;
  if target_batch_size not between 1 and 50 then
    raise exception 'Batch size must be between 1 and 50';
  end if;

  update private.telegram_notification_outbox delivery
  set status = 'pending',
    claim_token = null,
    claimed_at = null,
    network_started_at = null,
    available_at = now(),
    updated_at = now()
  where delivery.status = 'claimed'
    and delivery.network_started_at is null
    and delivery.claimed_at < now() - interval '5 minutes';

  update private.telegram_notification_outbox delivery
  set status = 'failed',
    error = 'Telegram notification retry limit reached',
    updated_at = now()
  where delivery.status = 'pending'
    and delivery.attempt_count >= 5;

  update private.telegram_notification_outbox delivery
  set status = 'cancelled',
    error = 'Telegram notification connection is inactive',
    updated_at = now()
  where delivery.status = 'pending'
    and not exists (
      select 1
      from public.publishing_admin_connections connection
      join public.memberships membership
        on membership.organization_id = connection.organization_id
        and membership.user_id = connection.user_id
        and membership.status = 'active'
      where connection.organization_id = delivery.organization_id
        and connection.user_id = delivery.user_id
        and connection.workflow_notifications_enabled
        and connection.connected_at is not null
        and connection.telegram_chat_id is not null
    );

  return query
  with candidates as (
    select delivery.notification_id
    from private.telegram_notification_outbox delivery
    join public.publishing_admin_connections connection
      on connection.organization_id = delivery.organization_id
      and connection.user_id = delivery.user_id
      and connection.workflow_notifications_enabled
      and connection.connected_at is not null
      and connection.telegram_chat_id is not null
    join public.memberships membership
      on membership.organization_id = delivery.organization_id
      and membership.user_id = delivery.user_id
      and membership.status = 'active'
    where delivery.status = 'pending'
      and delivery.available_at <= now()
      and delivery.attempt_count < 5
    order by delivery.notification_id
    for update of delivery skip locked
    limit target_batch_size
  ), claimed as (
    update private.telegram_notification_outbox delivery
    set status = 'claimed',
      claim_token = gen_random_uuid(),
      claimed_at = now(),
      network_started_at = null,
      attempt_count = delivery.attempt_count + 1,
      error = null,
      updated_at = now()
    from candidates
    where delivery.notification_id = candidates.notification_id
    returning delivery.*
  )
  select claimed.notification_id,
    claimed.claim_token,
    claimed.organization_id,
    claimed.user_id,
    connection.telegram_chat_id,
    notification.kind,
    notification.title,
    notification.body,
    notification.url
  from claimed
  join public.notifications notification
    on notification.id = claimed.notification_id
    and notification.organization_id = claimed.organization_id
    and notification.user_id = claimed.user_id
  join public.publishing_admin_connections connection
    on connection.organization_id = claimed.organization_id
    and connection.user_id = claimed.user_id
    and connection.workflow_notifications_enabled
    and connection.connected_at is not null;
end;
$$;

create or replace function public.mark_telegram_notification_network_started(
  target_notification_id bigint,
  target_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed_to_send boolean;
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'Service role required';
  end if;

  select exists (
    select 1
    from private.telegram_notification_outbox delivery
    join public.publishing_admin_connections connection
      on connection.organization_id = delivery.organization_id
      and connection.user_id = delivery.user_id
      and connection.workflow_notifications_enabled
      and connection.connected_at is not null
      and connection.telegram_chat_id is not null
    join public.memberships membership
      on membership.organization_id = delivery.organization_id
      and membership.user_id = delivery.user_id
      and membership.status = 'active'
    where delivery.notification_id = target_notification_id
      and delivery.status = 'claimed'
      and delivery.claim_token = target_claim_token
      and delivery.network_started_at is null
  ) into allowed_to_send;

  if not allowed_to_send then
    update private.telegram_notification_outbox delivery
    set status = 'cancelled',
      error = 'Telegram notification connection changed before delivery',
      updated_at = now()
    where delivery.notification_id = target_notification_id
      and delivery.status = 'claimed'
      and delivery.claim_token = target_claim_token
      and delivery.network_started_at is null;
    return false;
  end if;

  update private.telegram_notification_outbox delivery
  set network_started_at = now(), updated_at = now()
  where delivery.notification_id = target_notification_id
    and delivery.status = 'claimed'
    and delivery.claim_token = target_claim_token
    and delivery.network_started_at is null;
  return found;
end;
$$;

create or replace function public.defer_telegram_notification_delivery(
  target_notification_id bigint,
  target_claim_token uuid,
  target_retry_after_seconds integer,
  target_error text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'Service role required';
  end if;

  update private.telegram_notification_outbox delivery
  set status = 'pending',
    available_at = now() + make_interval(secs => greatest(1, least(coalesce(target_retry_after_seconds, 60), 3600))),
    claim_token = null,
    claimed_at = null,
    network_started_at = null,
    telegram_error_code = 429,
    error = left(coalesce(nullif(trim(target_error), ''), 'Telegram rate limit'), 500),
    updated_at = now()
  where delivery.notification_id = target_notification_id
    and delivery.status = 'claimed'
    and delivery.claim_token = target_claim_token
    and delivery.network_started_at is not null;
  return found;
end;
$$;

create or replace function public.complete_telegram_notification_delivery(
  target_notification_id bigint,
  target_claim_token uuid,
  target_terminal_status text,
  target_message_id bigint,
  target_telegram_error_code integer,
  target_error text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  delivery private.telegram_notification_outbox%rowtype;
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'Service role required';
  end if;
  if target_terminal_status not in ('sent', 'failed', 'unknown') then
    raise exception 'Unsupported Telegram notification terminal status';
  end if;
  if target_terminal_status = 'sent' and coalesce(target_message_id, 0) <= 0 then
    raise exception 'A Telegram message id is required for sent delivery';
  end if;

  select * into delivery
  from private.telegram_notification_outbox existing
  where existing.notification_id = target_notification_id
    and existing.status = 'claimed'
    and existing.claim_token = target_claim_token
    and existing.network_started_at is not null
  for update;
  if delivery.notification_id is null then return false; end if;

  update private.telegram_notification_outbox existing
  set status = target_terminal_status,
    telegram_message_id = case when target_terminal_status = 'sent' then target_message_id else null end,
    telegram_error_code = target_telegram_error_code,
    error = case when target_terminal_status = 'sent' then null
      else left(coalesce(nullif(trim(target_error), ''), 'Telegram notification delivery failed'), 500)
    end,
    sent_at = case when target_terminal_status = 'sent' then now() else null end,
    updated_at = now()
  where existing.notification_id = target_notification_id;

  update public.publishing_admin_connections connection
  set workflow_last_sent_at = case when target_terminal_status = 'sent' then now()
      else connection.workflow_last_sent_at end,
    workflow_last_error = case when target_terminal_status = 'sent' then null
      else left(coalesce(nullif(trim(target_error), ''), 'تعذّر إرسال آخر إشعار إلى Telegram'), 300)
    end,
    workflow_notifications_enabled = case
      when target_terminal_status = 'failed' and target_telegram_error_code = 403 then false
      else connection.workflow_notifications_enabled
    end,
    updated_at = now()
  where connection.organization_id = delivery.organization_id
    and connection.user_id = delivery.user_id;

  return true;
end;
$$;

revoke all on function public.create_member_telegram_link(uuid)
from public, anon, authenticated;
grant execute on function public.create_member_telegram_link(uuid)
to authenticated;

revoke all on function public.complete_member_telegram_link(text, bigint, bigint, text)
from public, anon, authenticated;
grant execute on function public.complete_member_telegram_link(text, bigint, bigint, text)
to service_role;

revoke all on function public.set_member_telegram_workflow_notifications(uuid, boolean)
from public, anon, authenticated;
grant execute on function public.set_member_telegram_workflow_notifications(uuid, boolean)
to authenticated;

revoke all on function public.claim_telegram_notification_batch(integer)
from public, anon, authenticated;
grant execute on function public.claim_telegram_notification_batch(integer)
to service_role;

revoke all on function public.mark_telegram_notification_network_started(bigint, uuid)
from public, anon, authenticated;
grant execute on function public.mark_telegram_notification_network_started(bigint, uuid)
to service_role;

revoke all on function public.defer_telegram_notification_delivery(bigint, uuid, integer, text)
from public, anon, authenticated;
grant execute on function public.defer_telegram_notification_delivery(bigint, uuid, integer, text)
to service_role;

revoke all on function public.complete_telegram_notification_delivery(bigint, uuid, text, bigint, integer, text)
from public, anon, authenticated;
grant execute on function public.complete_telegram_notification_delivery(bigint, uuid, text, bigint, integer, text)
to service_role;

revoke all on function private.enqueue_telegram_workflow_notification()
from public, anon, authenticated;
