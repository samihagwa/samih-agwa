-- Durable Telegram auto-publishing. All public tables are tenant-isolated and
-- read-only to browser clients; mutations go through role-checked commands.
-- External calls happen only in Edge Functions after an atomic database claim.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists supabase_vault with schema vault;

alter table public.notifications
  drop constraint notifications_kind_allowed,
  add constraint notifications_kind_allowed check (
    kind in (
      'task_assigned', 'task_ready', 'task_review', 'task_blocked',
      'task_done', 'revision_requested', 'publication_published',
      'publication_failed', 'publication_held'
    )
  );

create table public.publishing_channels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  platform text not null default 'telegram',
  telegram_chat_id bigint not null,
  telegram_username text,
  title text not null,
  bot_username text,
  bot_user_id bigint,
  allowlisted boolean not null default false,
  bot_can_post boolean not null default false,
  verification_status text not null default 'unverified',
  verified_at timestamptz,
  last_error text,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint publishing_channels_platform_allowed check (platform = 'telegram'),
  constraint publishing_channels_title_length check (char_length(trim(title)) between 2 and 160),
  constraint publishing_channels_username_valid check (
    telegram_username is null or telegram_username ~ '^@[A-Za-z0-9_]{5,32}$'
  ),
  constraint publishing_channels_status_allowed check (
    verification_status in ('unverified', 'ready', 'error')
  ),
  constraint publishing_channels_ready_consistent check (
    verification_status <> 'ready' or (allowlisted and bot_can_post and verified_at is not null)
  ),
  constraint publishing_channels_org_chat_unique unique (organization_id, telegram_chat_id)
);

create table public.publishing_posts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  content_item_id uuid references public.content_items (id) on delete set null,
  name text not null,
  post_text text not null default '',
  link_url text,
  media_kind text not null default 'none',
  media_source text,
  disable_link_preview boolean not null default false,
  status text not null default 'active',
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint publishing_posts_name_length check (char_length(trim(name)) between 2 and 180),
  constraint publishing_posts_text_length check (char_length(post_text) <= 3800),
  constraint publishing_posts_link_valid check (
    link_url is null or (char_length(link_url) <= 2000 and link_url ~* '^https://[^[:space:]]+$')
  ),
  constraint publishing_posts_media_kind_allowed check (media_kind in ('none', 'photo', 'video')),
  constraint publishing_posts_media_source_required check (
    (media_kind = 'none' and media_source is null)
    or (media_kind in ('photo', 'video') and media_source is not null and char_length(media_source) <= 2000)
  ),
  constraint publishing_posts_status_allowed check (status in ('active', 'archived')),
  constraint publishing_posts_has_content check (
    nullif(trim(post_text), '') is not null or link_url is not null or media_source is not null
  )
);

create table public.publishing_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  post_id uuid not null references public.publishing_posts (id) on delete cascade,
  schedule_type text not null,
  once_at timestamptz,
  weekdays smallint[],
  time_local time,
  timezone_name text not null default 'Africa/Cairo',
  starts_on date,
  ends_on date,
  occurrence_limit integer,
  preview_policy text not null default 'review_window',
  preview_lead_minutes integer not null default 60,
  missed_grace_minutes integer not null default 10,
  paused boolean not null default false,
  deleted_at timestamptz,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint publishing_schedules_type_allowed check (schedule_type in ('once', 'weekly')),
  constraint publishing_schedules_shape_valid check (
    (schedule_type = 'once' and once_at is not null and weekdays is null and time_local is null)
    or (
      schedule_type = 'weekly' and once_at is null and time_local is not null
      and weekdays is not null and cardinality(weekdays) between 1 and 7
      and weekdays <@ array[1,2,3,4,5,6,7]::smallint[]
      and starts_on is not null
    )
  ),
  constraint publishing_schedules_dates_valid check (ends_on is null or starts_on is null or ends_on >= starts_on),
  constraint publishing_schedules_limit_valid check (occurrence_limit is null or occurrence_limit between 1 and 1000),
  constraint publishing_schedules_policy_allowed check (
    preview_policy in ('automatic', 'review_window', 'approval_required')
  ),
  constraint publishing_schedules_preview_lead_valid check (preview_lead_minutes between 5 and 10080),
  constraint publishing_schedules_grace_valid check (missed_grace_minutes between 1 and 1440),
  constraint publishing_schedules_timezone_valid check (timezone_name = 'Africa/Cairo')
);

create table public.publishing_schedule_channels (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  schedule_id uuid not null references public.publishing_schedules (id) on delete cascade,
  channel_id uuid not null references public.publishing_channels (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (schedule_id, channel_id)
);

create table public.publishing_controls (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  kill_switch boolean not null default false,
  generation bigint not null default 1,
  reason text,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint publishing_controls_generation_valid check (generation > 0),
  constraint publishing_controls_reason_length check (reason is null or char_length(reason) <= 500)
);

create table public.publishing_admin_connections (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  telegram_chat_id bigint,
  telegram_user_id bigint,
  telegram_username text,
  link_code_hash text,
  link_expires_at timestamptz,
  connected_at timestamptz,
  notifications_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id),
  constraint publishing_admin_link_hash_length check (link_code_hash is null or char_length(link_code_hash) = 64),
  constraint publishing_admin_connection_consistent check (
    connected_at is null or (telegram_chat_id is not null and telegram_user_id is not null)
  )
);

create table public.publishing_occurrences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  schedule_id uuid not null references public.publishing_schedules (id) on delete cascade,
  post_id uuid not null references public.publishing_posts (id) on delete cascade,
  scheduled_at timestamptz not null,
  status text not null default 'pending',
  snapshot_payload jsonb,
  snapshot_hash text,
  approved_snapshot_hash text,
  callback_token text not null default encode(extensions.gen_random_bytes(9), 'hex'),
  callback_consumed_at timestamptz,
  preview_claim_token uuid,
  preview_claimed_at timestamptz,
  preview_chat_id bigint,
  preview_message_id bigint,
  preview_sent_at timestamptz,
  automation_generation bigint,
  hold_reason text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint publishing_occurrences_status_allowed check (
    status in (
      'pending', 'previewing', 'previewed', 'awaiting_approval', 'approved',
      'ready', 'publishing', 'published', 'skipped', 'held',
      'held_changed', 'failed', 'unknown', 'cancelled'
    )
  ),
  constraint publishing_occurrences_snapshot_hash_length check (snapshot_hash is null or char_length(snapshot_hash) = 64),
  constraint publishing_occurrences_approved_hash_length check (approved_snapshot_hash is null or char_length(approved_snapshot_hash) = 64),
  constraint publishing_occurrences_callback_token_unique unique (callback_token),
  constraint publishing_occurrences_schedule_time_unique unique (schedule_id, scheduled_at)
);

create table public.publishing_publication_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  occurrence_id uuid not null references public.publishing_occurrences (id) on delete cascade,
  post_id uuid not null references public.publishing_posts (id) on delete cascade,
  channel_id uuid not null references public.publishing_channels (id) on delete restrict,
  status text not null,
  claim_token uuid not null,
  claim_generation bigint not null,
  claim_expires_at timestamptz not null,
  attempt_count integer not null default 1,
  network_started_at timestamptz,
  message_id bigint,
  message_url text,
  telegram_error_code integer,
  error text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint publishing_logs_status_allowed check (
    status in ('claimed', 'publishing', 'published', 'failed', 'unknown', 'held')
  ),
  constraint publishing_logs_generation_valid check (claim_generation > 0),
  constraint publishing_logs_attempt_valid check (attempt_count between 1 and 100),
  constraint publishing_logs_url_valid check (
    message_url is null or (char_length(message_url) <= 2000 and message_url ~* '^https://t\.me/[^[:space:]]+$')
  ),
  constraint publishing_logs_occurrence_channel_unique unique (occurrence_id, channel_id)
);

create index publishing_channels_org_status_idx on public.publishing_channels (organization_id, verification_status, id);
create index publishing_posts_org_time_idx on public.publishing_posts (organization_id, created_at desc, id);
create index publishing_posts_content_idx on public.publishing_posts (content_item_id) where content_item_id is not null;
create index publishing_schedules_org_active_idx on public.publishing_schedules (organization_id, paused, once_at, id) where deleted_at is null;
create index publishing_schedules_post_idx on public.publishing_schedules (post_id);
create index publishing_schedule_channels_org_channel_idx on public.publishing_schedule_channels (organization_id, channel_id, schedule_id);
create index publishing_occurrences_due_idx on public.publishing_occurrences (status, scheduled_at, id)
  where status in ('pending', 'previewing', 'previewed', 'awaiting_approval', 'approved', 'ready', 'publishing');
create index publishing_occurrences_org_time_idx on public.publishing_occurrences (organization_id, scheduled_at desc, id);
create index publishing_occurrences_post_idx on public.publishing_occurrences (post_id);
create index publishing_logs_claim_idx on public.publishing_publication_logs (status, claim_expires_at, id)
  where status in ('claimed', 'publishing');
create index publishing_logs_org_time_idx on public.publishing_publication_logs (organization_id, created_at desc, id);
create index publishing_logs_post_idx on public.publishing_publication_logs (post_id);
create index publishing_logs_channel_idx on public.publishing_publication_logs (channel_id);
create unique index publishing_admin_connections_org_telegram_user_idx
  on public.publishing_admin_connections (organization_id, telegram_user_id)
  where telegram_user_id is not null;

alter table public.publishing_channels enable row level security;
alter table public.publishing_posts enable row level security;
alter table public.publishing_schedules enable row level security;
alter table public.publishing_schedule_channels enable row level security;
alter table public.publishing_controls enable row level security;
alter table public.publishing_admin_connections enable row level security;
alter table public.publishing_occurrences enable row level security;
alter table public.publishing_publication_logs enable row level security;

create policy "publishing_channels_select_members" on public.publishing_channels
for select to authenticated using ((select private.is_org_member(organization_id)));
create policy "publishing_posts_select_members" on public.publishing_posts
for select to authenticated using ((select private.is_org_member(organization_id)));
create policy "publishing_schedules_select_members" on public.publishing_schedules
for select to authenticated using ((select private.is_org_member(organization_id)));
create policy "publishing_schedule_channels_select_members" on public.publishing_schedule_channels
for select to authenticated using ((select private.is_org_member(organization_id)));
create policy "publishing_controls_select_members" on public.publishing_controls
for select to authenticated using ((select private.is_org_member(organization_id)));
create policy "publishing_admin_connections_select_self_or_leadership" on public.publishing_admin_connections
for select to authenticated using (
  user_id = (select auth.uid())
  or (select private.has_org_role(organization_id, array['owner', 'admin', 'manager']::public.app_role[]))
);
create policy "publishing_occurrences_select_members" on public.publishing_occurrences
for select to authenticated using ((select private.is_org_member(organization_id)));
create policy "publishing_logs_select_members" on public.publishing_publication_logs
for select to authenticated using ((select private.is_org_member(organization_id)));

revoke all on table public.publishing_channels from anon, authenticated;
revoke all on table public.publishing_posts from anon, authenticated;
revoke all on table public.publishing_schedules from anon, authenticated;
revoke all on table public.publishing_schedule_channels from anon, authenticated;
revoke all on table public.publishing_controls from anon, authenticated;
revoke all on table public.publishing_admin_connections from anon, authenticated;
revoke all on table public.publishing_occurrences from anon, authenticated;
revoke all on table public.publishing_publication_logs from anon, authenticated;
grant select on table public.publishing_channels to authenticated;
grant select on table public.publishing_posts to authenticated;
grant select on table public.publishing_schedules to authenticated;
grant select on table public.publishing_schedule_channels to authenticated;
grant select on table public.publishing_controls to authenticated;
grant select on table public.publishing_admin_connections to authenticated;
grant select on table public.publishing_occurrences to authenticated;
grant select on table public.publishing_publication_logs to authenticated;

create or replace function private.publication_payload(target_occurrence_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'post_id', post.id,
    'name', post.name,
    'post_text', post.post_text,
    'link_url', post.link_url,
    'media_kind', post.media_kind,
    'media_source', post.media_source,
    'disable_link_preview', post.disable_link_preview,
    'channels', coalesce((
      select jsonb_agg(jsonb_build_object(
        'channel_id', channel.id,
        'chat_id', channel.telegram_chat_id,
        'username', channel.telegram_username,
        'title', channel.title
      ) order by channel.id)
      from public.publishing_schedule_channels schedule_channel
      join public.publishing_channels channel on channel.id = schedule_channel.channel_id
      where schedule_channel.schedule_id = occurrence.schedule_id
    ), '[]'::jsonb)
  )
  from public.publishing_occurrences occurrence
  join public.publishing_posts post on post.id = occurrence.post_id
  where occurrence.id = target_occurrence_id;
$$;

create or replace function private.publication_payload_hash(target_payload jsonb)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(coalesce(target_payload, '{}'::jsonb)::text, 'UTF8'), 'sha256'), 'hex');
$$;

create or replace function private.materialize_publishing_occurrences(target_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  schedule_record public.publishing_schedules%rowtype;
  local_day date;
  scheduled_moment timestamptz;
  existing_count integer;
  inserted_count integer := 0;
begin
  insert into public.publishing_controls (organization_id)
  select distinct schedule.organization_id
  from public.publishing_schedules schedule
  where schedule.deleted_at is null
  on conflict (organization_id) do nothing;

  insert into public.publishing_occurrences (
    organization_id, schedule_id, post_id, scheduled_at, status
  )
  select schedule.organization_id, schedule.id, schedule.post_id, schedule.once_at, 'pending'
  from public.publishing_schedules schedule
  where schedule.schedule_type = 'once'
    and not schedule.paused
    and schedule.deleted_at is null
    and schedule.once_at is not null
  on conflict (schedule_id, scheduled_at) do nothing;
  get diagnostics inserted_count = row_count;

  for schedule_record in
    select schedule.*
    from public.publishing_schedules schedule
    where schedule.schedule_type = 'weekly'
      and not schedule.paused
      and schedule.deleted_at is null
  loop
    select count(*) into existing_count
    from public.publishing_occurrences occurrence
    where occurrence.schedule_id = schedule_record.id;

    for local_day in
      select day_value::date
      from generate_series(
        (target_now at time zone schedule_record.timezone_name)::date,
        (target_now at time zone schedule_record.timezone_name)::date + 7,
        interval '1 day'
      ) day_value
      order by day_value
    loop
      exit when schedule_record.occurrence_limit is not null
        and existing_count >= schedule_record.occurrence_limit;
      continue when local_day < schedule_record.starts_on;
      continue when schedule_record.ends_on is not null and local_day > schedule_record.ends_on;
      continue when extract(isodow from local_day)::smallint <> all(schedule_record.weekdays);

      scheduled_moment := (local_day + schedule_record.time_local) at time zone schedule_record.timezone_name;
      insert into public.publishing_occurrences (
        organization_id, schedule_id, post_id, scheduled_at, status
      ) values (
        schedule_record.organization_id, schedule_record.id,
        schedule_record.post_id, scheduled_moment, 'pending'
      ) on conflict (schedule_id, scheduled_at) do nothing;
      if found then
        inserted_count := inserted_count + 1;
        existing_count := existing_count + 1;
      end if;
    end loop;
  end loop;
  return inserted_count;
end;
$$;

create or replace function public.upsert_verified_publishing_channel(
  target_user_id uuid,
  target_organization_id uuid,
  target_chat_id bigint,
  target_username text,
  target_title text,
  verified_bot_username text,
  verified_bot_user_id bigint,
  verified_can_post boolean,
  verification_error text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  channel_id uuid;
  normalized_username text;
begin
  if target_user_id is null then raise exception 'A verified target user is required'; end if;
  perform set_config('request.jwt.claim.sub', target_user_id::text, true);
  if not private.has_org_role(target_organization_id, array['owner', 'admin', 'manager']::public.app_role[]) then
    raise exception 'Only organization leadership can manage publishing channels';
  end if;
  if target_chat_id >= 0 then raise exception 'Telegram channel ID must be a negative channel identifier'; end if;
  if char_length(trim(target_title)) not between 2 and 160 then raise exception 'Channel title is invalid'; end if;
  normalized_username := nullif(trim(target_username), '');
  if normalized_username is not null and left(normalized_username, 1) <> '@' then
    normalized_username := '@' || normalized_username;
  end if;
  if normalized_username is not null and normalized_username !~ '^@[A-Za-z0-9_]{5,32}$' then
    raise exception 'Telegram username is invalid';
  end if;

  insert into public.publishing_channels (
    organization_id, telegram_chat_id, telegram_username, title,
    bot_username, bot_user_id, allowlisted, bot_can_post,
    verification_status, verified_at, last_error, created_by
  ) values (
    target_organization_id, target_chat_id, normalized_username, trim(target_title),
    nullif(trim(verified_bot_username), ''), verified_bot_user_id,
    verified_can_post and verification_error is null,
    verified_can_post,
    case when verified_can_post and verification_error is null then 'ready' else 'error' end,
    case when verified_can_post and verification_error is null then now() else null end,
    nullif(left(trim(verification_error), 1000), ''), target_user_id
  )
  on conflict (organization_id, telegram_chat_id) do update set
    telegram_username = excluded.telegram_username,
    title = excluded.title,
    bot_username = excluded.bot_username,
    bot_user_id = excluded.bot_user_id,
    allowlisted = excluded.allowlisted,
    bot_can_post = excluded.bot_can_post,
    verification_status = excluded.verification_status,
    verified_at = excluded.verified_at,
    last_error = excluded.last_error,
    updated_at = now()
  returning id into channel_id;

  insert into public.publishing_controls (organization_id, updated_by)
  values (target_organization_id, target_user_id)
  on conflict (organization_id) do nothing;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id, target_user_id, 'publishing.channel_verified',
    'publishing_channel', channel_id,
    jsonb_build_object(
      'telegram_chat_id', target_chat_id,
      'allowlisted', verified_can_post and verification_error is null,
      'bot_can_post', verified_can_post
    )
  );
  return channel_id;
end;
$$;

create or replace function public.create_telegram_publication(
  target_organization_id uuid,
  target_content_item_id uuid,
  post_name text,
  post_text text,
  post_link_url text,
  post_media_kind text,
  post_media_source text,
  post_disable_link_preview boolean,
  target_schedule_type text,
  target_once_at timestamptz,
  target_weekdays smallint[],
  target_time_local time,
  target_starts_on date,
  target_ends_on date,
  target_occurrence_limit integer,
  target_preview_policy text,
  target_preview_lead_minutes integer,
  target_missed_grace_minutes integer,
  target_channel_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  new_post_id uuid;
  new_schedule_id uuid;
  normalized_link text := nullif(trim(post_link_url), '');
  normalized_media text := nullif(trim(post_media_source), '');
begin
  if actor is null then raise exception 'Authentication is required'; end if;
  if not private.has_org_role(target_organization_id, array['owner', 'admin', 'manager']::public.app_role[]) then
    raise exception 'Only organization leadership can schedule publications';
  end if;
  if target_content_item_id is not null and not exists (
    select 1 from public.content_items item
    where item.id = target_content_item_id and item.organization_id = target_organization_id
  ) then raise exception 'Linked content item was not found in this organization'; end if;
  if char_length(trim(post_name)) not between 2 and 180 then raise exception 'Post name is invalid'; end if;
  if char_length(coalesce(post_text, '')) > 3800 then raise exception 'Telegram text is too long'; end if;
  if normalized_link is not null and normalized_link !~* '^https://[^[:space:]]+$' then raise exception 'Post link must be HTTPS'; end if;
  if post_media_kind not in ('none', 'photo', 'video') then raise exception 'Unsupported Telegram media kind'; end if;
  if (post_media_kind = 'none' and normalized_media is not null)
    or (post_media_kind in ('photo', 'video') and normalized_media is null) then
    raise exception 'Choose a valid media source for the selected media kind';
  end if;
  if nullif(trim(coalesce(post_text, '')), '') is null and normalized_link is null and normalized_media is null then
    raise exception 'Add text, a link, or media before scheduling';
  end if;
  if target_schedule_type not in ('once', 'weekly') then raise exception 'Unknown schedule type'; end if;
  if target_schedule_type = 'once' and (target_once_at is null or target_once_at <= now() + interval '30 seconds') then
    raise exception 'Choose a publication time at least 30 seconds in the future';
  end if;
  if target_schedule_type = 'weekly' and (
    target_time_local is null or target_starts_on is null or target_weekdays is null
    or cardinality(target_weekdays) not between 1 and 7
    or not target_weekdays <@ array[1,2,3,4,5,6,7]::smallint[]
  ) then raise exception 'Complete the weekly schedule details'; end if;
  if target_preview_policy not in ('automatic', 'review_window', 'approval_required') then
    raise exception 'Unknown preview policy';
  end if;
  if target_preview_lead_minutes not between 5 and 10080
    or target_missed_grace_minutes not between 1 and 1440 then
    raise exception 'Preview or grace period is invalid';
  end if;
  if target_channel_ids is null or cardinality(target_channel_ids) = 0 then
    raise exception 'Choose at least one verified Telegram channel';
  end if;
  if (select count(distinct channel.id) from public.publishing_channels channel
      where channel.id = any(target_channel_ids)
        and channel.organization_id = target_organization_id
        and channel.allowlisted and channel.bot_can_post
        and channel.verification_status = 'ready')
    <> (select count(distinct requested_id) from unnest(target_channel_ids) requested_id) then
    raise exception 'Every selected channel must be verified and allowlisted';
  end if;

  insert into public.publishing_posts (
    organization_id, content_item_id, name, post_text, link_url,
    media_kind, media_source, disable_link_preview, created_by
  ) values (
    target_organization_id, target_content_item_id, trim(post_name), coalesce(post_text, ''),
    normalized_link, post_media_kind, normalized_media,
    coalesce(post_disable_link_preview, false), actor
  ) returning id into new_post_id;

  insert into public.publishing_schedules (
    organization_id, post_id, schedule_type, once_at, weekdays, time_local,
    timezone_name, starts_on, ends_on, occurrence_limit, preview_policy,
    preview_lead_minutes, missed_grace_minutes, created_by
  ) values (
    target_organization_id, new_post_id, target_schedule_type,
    case when target_schedule_type = 'once' then target_once_at else null end,
    case when target_schedule_type = 'weekly' then target_weekdays else null end,
    case when target_schedule_type = 'weekly' then target_time_local else null end,
    'Africa/Cairo',
    case when target_schedule_type = 'weekly' then target_starts_on else null end,
    case when target_schedule_type = 'weekly' then target_ends_on else null end,
    case when target_schedule_type = 'weekly' then target_occurrence_limit else 1 end,
    target_preview_policy, target_preview_lead_minutes,
    target_missed_grace_minutes, actor
  ) returning id into new_schedule_id;

  insert into public.publishing_schedule_channels (organization_id, schedule_id, channel_id)
  select target_organization_id, new_schedule_id, channel_id
  from unnest(target_channel_ids) channel_id
  group by channel_id;

  insert into public.publishing_controls (organization_id, updated_by)
  values (target_organization_id, actor)
  on conflict (organization_id) do nothing;

  perform private.materialize_publishing_occurrences(now());

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id, actor, 'publishing.schedule_created',
    'publishing_schedule', new_schedule_id,
    jsonb_build_object(
      'post_id', new_post_id, 'schedule_type', target_schedule_type,
      'preview_policy', target_preview_policy,
      'channel_count', cardinality(target_channel_ids),
      'timezone', 'Africa/Cairo'
    )
  );
  return new_schedule_id;
end;
$$;

create or replace function public.set_publishing_schedule_paused(
  target_schedule_id uuid,
  target_paused boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target_organization_id uuid;
begin
  select schedule.organization_id into target_organization_id
  from public.publishing_schedules schedule where schedule.id = target_schedule_id for update;
  if actor is null or target_organization_id is null then return false; end if;
  if not private.has_org_role(target_organization_id, array['owner', 'admin', 'manager']::public.app_role[]) then
    raise exception 'Only organization leadership can pause publishing schedules';
  end if;
  update public.publishing_schedules schedule
  set paused = target_paused, updated_at = now()
  where schedule.id = target_schedule_id;
  update public.publishing_occurrences occurrence
  set status = case when target_paused then 'held' else 'pending' end,
    hold_reason = case when target_paused then 'schedule_paused' else null end,
    updated_at = now()
  where occurrence.schedule_id = target_schedule_id
    and occurrence.status in ('pending', 'previewing', 'previewed', 'awaiting_approval', 'approved', 'ready', 'held')
    and occurrence.scheduled_at > now();
  return true;
end;
$$;

create or replace function public.set_publishing_kill_switch(
  target_organization_id uuid,
  target_enabled boolean,
  target_reason text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  next_generation bigint;
begin
  if actor is null then raise exception 'Authentication is required'; end if;
  if not private.has_org_role(target_organization_id, array['owner', 'admin', 'manager']::public.app_role[]) then
    raise exception 'Only organization leadership can use the publishing kill switch';
  end if;
  insert into public.publishing_controls (
    organization_id, kill_switch, generation, reason, updated_by, updated_at
  ) values (
    target_organization_id, target_enabled, 1,
    nullif(left(trim(target_reason), 500), ''), actor, now()
  ) on conflict (organization_id) do update set
    kill_switch = excluded.kill_switch,
    generation = public.publishing_controls.generation + 1,
    reason = excluded.reason,
    updated_by = excluded.updated_by,
    updated_at = now()
  returning generation into next_generation;

  if target_enabled then
    update public.publishing_occurrences occurrence
    set status = 'held', hold_reason = 'kill_switch',
      automation_generation = next_generation, updated_at = now()
    where occurrence.organization_id = target_organization_id
      and occurrence.status in ('pending', 'previewing', 'previewed', 'awaiting_approval', 'approved', 'ready');
  else
    update public.publishing_occurrences occurrence
    set status = 'pending', hold_reason = null,
      automation_generation = next_generation, updated_at = now()
    where occurrence.organization_id = target_organization_id
      and occurrence.status = 'held'
      and occurrence.hold_reason = 'kill_switch'
      and occurrence.scheduled_at > now();
  end if;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id, actor,
    case when target_enabled then 'publishing.kill_switch_enabled' else 'publishing.kill_switch_disabled' end,
    'organization', target_organization_id,
    jsonb_build_object('generation', next_generation, 'reason', nullif(left(trim(target_reason), 500), ''))
  );
  return next_generation;
end;
$$;

create or replace function public.cancel_publishing_occurrence(target_occurrence_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target_organization_id uuid;
begin
  select occurrence.organization_id into target_organization_id
  from public.publishing_occurrences occurrence where occurrence.id = target_occurrence_id for update;
  if actor is null or target_organization_id is null then return false; end if;
  if not private.has_org_role(target_organization_id, array['owner', 'admin', 'manager']::public.app_role[]) then
    raise exception 'Only organization leadership can cancel a publication';
  end if;
  update public.publishing_occurrences occurrence
  set status = 'cancelled', hold_reason = 'cancelled_by_user', updated_at = now()
  where occurrence.id = target_occurrence_id
    and occurrence.status not in ('publishing', 'published', 'unknown');
  return found;
end;
$$;

create or replace function public.create_publishing_admin_link(target_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  raw_code text := encode(extensions.gen_random_bytes(18), 'hex');
begin
  if actor is null then raise exception 'Authentication is required'; end if;
  if not private.has_org_role(target_organization_id, array['owner', 'admin', 'manager']::public.app_role[]) then
    raise exception 'Only organization leadership can connect publishing notifications';
  end if;
  insert into public.publishing_admin_connections (
    organization_id, user_id, link_code_hash, link_expires_at, updated_at
  ) values (
    target_organization_id, actor,
    encode(extensions.digest(convert_to(raw_code, 'UTF8'), 'sha256'), 'hex'),
    now() + interval '15 minutes', now()
  ) on conflict (organization_id, user_id) do update set
    link_code_hash = excluded.link_code_hash,
    link_expires_at = excluded.link_expires_at,
    updated_at = now();
  return raw_code;
end;
$$;

revoke all on function private.publication_payload(uuid) from public, anon, authenticated;
revoke all on function private.publication_payload_hash(jsonb) from public, anon, authenticated;
revoke all on function private.materialize_publishing_occurrences(timestamptz) from public, anon, authenticated;
revoke all on function public.upsert_verified_publishing_channel(uuid, uuid, bigint, text, text, text, bigint, boolean, text) from public, anon, authenticated;
grant execute on function public.upsert_verified_publishing_channel(uuid, uuid, bigint, text, text, text, bigint, boolean, text) to service_role;
revoke all on function public.create_telegram_publication(uuid, uuid, text, text, text, text, text, boolean, text, timestamptz, smallint[], time, date, date, integer, text, integer, integer, uuid[]) from public, anon, authenticated;
grant execute on function public.create_telegram_publication(uuid, uuid, text, text, text, text, text, boolean, text, timestamptz, smallint[], time, date, date, integer, text, integer, integer, uuid[]) to authenticated;
revoke all on function public.set_publishing_schedule_paused(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_publishing_schedule_paused(uuid, boolean) to authenticated;
revoke all on function public.set_publishing_kill_switch(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.set_publishing_kill_switch(uuid, boolean, text) to authenticated;
revoke all on function public.cancel_publishing_occurrence(uuid) from public, anon, authenticated;
grant execute on function public.cancel_publishing_occurrence(uuid) to authenticated;
revoke all on function public.create_publishing_admin_link(uuid) from public, anon, authenticated;
grant execute on function public.create_publishing_admin_link(uuid) to authenticated;
