-- Database-side orchestration for Telegram publishing. Claims are intentionally
-- short transactions: Edge Functions perform network calls only after a claim.

alter table public.member_presence
  drop constraint member_presence_section_allowed,
  add constraint member_presence_section_allowed check (
    current_section in (
      'dashboard', 'tasks', 'content', 'publishing', 'brand',
      'campaigns', 'crm', 'analytics', 'team', 'settings'
    )
  );

create or replace function public.complete_publishing_admin_link(
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
    or target_telegram_user_id is null then
    raise exception 'A valid connection code and Telegram identity are required';
  end if;

  return query
  update public.publishing_admin_connections connection
  set telegram_chat_id = target_telegram_chat_id,
    telegram_user_id = target_telegram_user_id,
    telegram_username = nullif(left(trim(target_telegram_username), 64), ''),
    link_code_hash = null,
    link_expires_at = null,
    connected_at = now(),
    notifications_enabled = true,
    updated_at = now()
  where connection.link_code_hash = link_hash
    and connection.link_expires_at > now()
  returning connection.organization_id, connection.user_id;
end;
$$;

create or replace function public.claim_publishing_preview_batch(target_batch_size integer default 10)
returns table (
  occurrence_id uuid,
  claim_token uuid,
  organization_id uuid,
  scheduled_at timestamptz,
  preview_policy text,
  callback_token text,
  snapshot_payload jsonb,
  snapshot_hash text,
  admin_chat_id bigint
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

  perform private.materialize_publishing_occurrences(now());

  update public.publishing_occurrences occurrence
  set status = 'pending', preview_claim_token = null,
    preview_claimed_at = null, updated_at = now()
  where occurrence.status = 'previewing'
    and occurrence.preview_claimed_at < now() - interval '5 minutes';

  update public.publishing_occurrences occurrence
  set status = 'held', hold_reason = 'kill_switch',
    automation_generation = control.generation, updated_at = now()
  from public.publishing_controls control
  where control.organization_id = occurrence.organization_id
    and control.kill_switch
    and occurrence.status in ('pending', 'previewing', 'previewed', 'awaiting_approval', 'approved', 'ready');

  return query
  with candidates as (
    select occurrence.id
    from public.publishing_occurrences occurrence
    join public.publishing_schedules schedule on schedule.id = occurrence.schedule_id
    join public.publishing_controls control on control.organization_id = occurrence.organization_id
    where occurrence.status = 'pending'
      and schedule.preview_policy <> 'automatic'
      and not schedule.paused
      and schedule.deleted_at is null
      and not control.kill_switch
      and occurrence.scheduled_at - make_interval(mins => schedule.preview_lead_minutes) <= now()
      and occurrence.scheduled_at + make_interval(mins => schedule.missed_grace_minutes) > now()
    order by occurrence.scheduled_at, occurrence.id
    for update of occurrence skip locked
    limit target_batch_size
  ), claimed as (
    update public.publishing_occurrences occurrence
    set status = 'previewing',
      snapshot_payload = coalesce(occurrence.snapshot_payload, private.publication_payload(occurrence.id)),
      snapshot_hash = coalesce(
        occurrence.snapshot_hash,
        private.publication_payload_hash(private.publication_payload(occurrence.id))
      ),
      preview_claim_token = gen_random_uuid(),
      preview_claimed_at = now(),
      automation_generation = control.generation,
      error = null,
      updated_at = now()
    from candidates, public.publishing_controls control
    where occurrence.id = candidates.id
      and control.organization_id = occurrence.organization_id
    returning occurrence.*
  )
  select claimed.id, claimed.preview_claim_token, claimed.organization_id,
    claimed.scheduled_at, schedule.preview_policy, claimed.callback_token,
    claimed.snapshot_payload, claimed.snapshot_hash,
    connection.telegram_chat_id
  from claimed
  join public.publishing_schedules schedule on schedule.id = claimed.schedule_id
  left join lateral (
    select admin.telegram_chat_id
    from public.publishing_admin_connections admin
    join public.memberships membership
      on membership.organization_id = admin.organization_id
      and membership.user_id = admin.user_id
      and membership.status = 'active'
      and membership.role in ('owner', 'admin', 'manager')
    where admin.organization_id = claimed.organization_id
      and admin.notifications_enabled
      and admin.connected_at is not null
    order by case membership.role when 'owner' then 1 when 'admin' then 2 else 3 end,
      admin.connected_at
    limit 1
  ) connection on true;
end;
$$;

create or replace function public.complete_publishing_preview(
  target_occurrence_id uuid,
  target_claim_token uuid,
  target_preview_chat_id bigint,
  target_preview_message_id bigint,
  target_error text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  policy text;
  next_status text;
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'Service role required';
  end if;

  select schedule.preview_policy into policy
  from public.publishing_occurrences occurrence
  join public.publishing_schedules schedule on schedule.id = occurrence.schedule_id
  where occurrence.id = target_occurrence_id
    and occurrence.status = 'previewing'
    and occurrence.preview_claim_token = target_claim_token
  for update of occurrence;

  if policy is null then return null; end if;
  next_status := case
    when target_preview_message_id is not null and policy = 'approval_required' then 'awaiting_approval'
    when target_preview_message_id is not null then 'previewed'
    when policy = 'approval_required' then 'held'
    else 'previewed'
  end;

  update public.publishing_occurrences occurrence
  set status = next_status,
    preview_chat_id = target_preview_chat_id,
    preview_message_id = target_preview_message_id,
    preview_sent_at = case when target_preview_message_id is not null then now() else null end,
    hold_reason = case when next_status = 'held' then 'approval_admin_unavailable' else null end,
    error = nullif(left(trim(target_error), 2000), ''),
    updated_at = now()
  where occurrence.id = target_occurrence_id
    and occurrence.preview_claim_token = target_claim_token;

  return next_status;
end;
$$;

create or replace function public.handle_publishing_callback(
  target_callback_token text,
  target_action text,
  target_telegram_user_id bigint
)
returns table (
  occurrence_id uuid,
  organization_id uuid,
  occurrence_status text,
  occurrence_scheduled_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_occurrence public.publishing_occurrences%rowtype;
  policy text;
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'Service role required';
  end if;
  if target_action not in ('approve', 'publish_now', 'delay_60', 'cancel') then
    raise exception 'Unsupported publishing action';
  end if;

  select occurrence.* into target_occurrence
  from public.publishing_occurrences occurrence
  where occurrence.callback_token = target_callback_token
  for update;
  if target_occurrence.id is null
    or target_occurrence.callback_consumed_at is not null
    or target_occurrence.status not in ('previewed', 'awaiting_approval') then
    return;
  end if;
  if not exists (
    select 1
    from public.publishing_admin_connections connection
    join public.memberships membership
      on membership.organization_id = connection.organization_id
      and membership.user_id = connection.user_id
      and membership.status = 'active'
      and membership.role in ('owner', 'admin', 'manager')
    where connection.organization_id = target_occurrence.organization_id
      and connection.telegram_user_id = target_telegram_user_id
      and connection.connected_at is not null
  ) then
    raise exception 'This Telegram account cannot control this publication';
  end if;

  select schedule.preview_policy into policy
  from public.publishing_schedules schedule
  where schedule.id = target_occurrence.schedule_id;

  update public.publishing_occurrences occurrence
  set status = case target_action
      when 'cancel' then 'cancelled'
      when 'publish_now' then 'ready'
      else 'approved'
    end,
    scheduled_at = case
      when target_action = 'publish_now' then now()
      when target_action = 'delay_60' then greatest(now(), occurrence.scheduled_at) + interval '1 hour'
      else occurrence.scheduled_at
    end,
    approved_snapshot_hash = case
      when target_action in ('approve', 'publish_now', 'delay_60') then occurrence.snapshot_hash
      else occurrence.approved_snapshot_hash
    end,
    callback_consumed_at = now(),
    hold_reason = case when target_action = 'cancel' then 'cancelled_from_telegram' else null end,
    updated_at = now()
  where occurrence.id = target_occurrence.id
  returning occurrence.id, occurrence.organization_id,
    occurrence.status, occurrence.scheduled_at
  into occurrence_id, organization_id, occurrence_status, occurrence_scheduled_at;
  return next;
end;
$$;

create or replace function public.claim_publication_batch(target_batch_size integer default 10)
returns table (
  log_id uuid,
  claim_token uuid,
  claim_generation bigint,
  occurrence_id uuid,
  organization_id uuid,
  scheduled_at timestamptz,
  post_id uuid,
  post_created_by uuid,
  content_item_id uuid,
  post_name text,
  post_text text,
  link_url text,
  media_kind text,
  media_source text,
  disable_link_preview boolean,
  channel_id uuid,
  telegram_chat_id bigint,
  telegram_username text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  current_payload jsonb;
  current_hash text;
  next_claim uuid;
  claimed_log_id uuid;
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'Service role required';
  end if;
  if target_batch_size not between 1 and 50 then
    raise exception 'Batch size must be between 1 and 50';
  end if;

  perform private.materialize_publishing_occurrences(now());

  -- A request that may have reached Telegram is never retried automatically.
  with uncertain as (
    update public.publishing_publication_logs publication_log
    set status = 'unknown',
      error = coalesce(publication_log.error, 'Claim expired after the Telegram request started'),
      updated_at = now()
    where publication_log.status in ('claimed', 'publishing')
      and publication_log.network_started_at is not null
      and publication_log.claim_expires_at < now()
    returning publication_log.occurrence_id
  )
  update public.publishing_occurrences occurrence
  set status = 'unknown',
    error = 'Telegram result is uncertain; inspect the channel before any manual retry',
    updated_at = now()
  where occurrence.id in (select uncertain.occurrence_id from uncertain);

  update public.publishing_occurrences occurrence
  set status = 'held', hold_reason = 'kill_switch',
    automation_generation = control.generation, updated_at = now()
  from public.publishing_controls control
  where control.organization_id = occurrence.organization_id
    and control.kill_switch
    and occurrence.status in ('pending', 'previewing', 'previewed', 'awaiting_approval', 'approved', 'ready');

  update public.publishing_occurrences occurrence
  set status = 'skipped', hold_reason = 'approval_not_received', updated_at = now()
  from public.publishing_schedules schedule
  where schedule.id = occurrence.schedule_id
    and schedule.preview_policy = 'approval_required'
    and occurrence.status = 'awaiting_approval'
    and occurrence.scheduled_at <= now();

  update public.publishing_occurrences occurrence
  set status = 'skipped', hold_reason = 'missed_publication_window', updated_at = now()
  from public.publishing_schedules schedule
  where schedule.id = occurrence.schedule_id
    and occurrence.status in ('pending', 'previewed', 'approved', 'ready')
    and occurrence.scheduled_at + make_interval(mins => schedule.missed_grace_minutes) < now();

  for candidate in
    select occurrence.id as occurrence_id,
      occurrence.organization_id, occurrence.scheduled_at,
      occurrence.snapshot_payload, occurrence.snapshot_hash,
      occurrence.approved_snapshot_hash, occurrence.status as occurrence_status,
      schedule.preview_policy, schedule_channel.channel_id,
      control.generation,
      post.id as post_id, post.created_by as post_created_by,
      post.content_item_id, post.name as post_name, post.post_text,
      post.link_url, post.media_kind, post.media_source,
      post.disable_link_preview,
      channel.telegram_chat_id, channel.telegram_username
    from public.publishing_occurrences occurrence
    join public.publishing_schedules schedule on schedule.id = occurrence.schedule_id
    join public.publishing_schedule_channels schedule_channel
      on schedule_channel.schedule_id = occurrence.schedule_id
    join public.publishing_channels channel on channel.id = schedule_channel.channel_id
    join public.publishing_posts post on post.id = occurrence.post_id
    join public.publishing_controls control on control.organization_id = occurrence.organization_id
    left join public.publishing_publication_logs existing_log
      on existing_log.occurrence_id = occurrence.id
      and existing_log.channel_id = schedule_channel.channel_id
    where not control.kill_switch
      and not schedule.paused
      and schedule.deleted_at is null
      and channel.allowlisted and channel.bot_can_post
      and channel.verification_status = 'ready'
      and occurrence.scheduled_at <= now()
      and (
        occurrence.status in ('ready', 'approved', 'publishing')
        or (occurrence.status = 'pending' and schedule.preview_policy = 'automatic')
        or (occurrence.status in ('pending', 'previewed') and schedule.preview_policy = 'review_window')
      )
      and (
        existing_log.id is null
        or (
          existing_log.status = 'claimed'
          and existing_log.network_started_at is null
          and existing_log.claim_expires_at < now()
        )
      )
    order by occurrence.scheduled_at, occurrence.id, schedule_channel.channel_id
    for update of occurrence skip locked
    limit target_batch_size
  loop
    current_payload := private.publication_payload(candidate.occurrence_id);
    current_hash := private.publication_payload_hash(current_payload);

    if candidate.snapshot_hash is not null and candidate.snapshot_hash <> current_hash then
      update public.publishing_occurrences occurrence
      set status = 'held_changed', hold_reason = 'snapshot_hash_mismatch',
        error = 'Content or channels changed after the publishing snapshot was frozen',
        updated_at = now()
      where occurrence.id = candidate.occurrence_id;
      continue;
    end if;
    if candidate.occurrence_status = 'approved'
      and candidate.approved_snapshot_hash is distinct from coalesce(candidate.snapshot_hash, current_hash) then
      update public.publishing_occurrences occurrence
      set status = 'held_changed', hold_reason = 'approved_snapshot_hash_mismatch',
        error = 'Approved content no longer matches the frozen snapshot',
        updated_at = now()
      where occurrence.id = candidate.occurrence_id;
      continue;
    end if;

    update public.publishing_occurrences occurrence
    set status = 'publishing',
      snapshot_payload = coalesce(occurrence.snapshot_payload, current_payload),
      snapshot_hash = coalesce(occurrence.snapshot_hash, current_hash),
      automation_generation = candidate.generation,
      error = null,
      updated_at = now()
    where occurrence.id = candidate.occurrence_id;

    next_claim := gen_random_uuid();
    claimed_log_id := null;
    insert into public.publishing_publication_logs (
      organization_id, occurrence_id, post_id, channel_id,
      status, claim_token, claim_generation, claim_expires_at
    ) values (
      candidate.organization_id, candidate.occurrence_id,
      candidate.post_id, candidate.channel_id,
      'claimed', next_claim, candidate.generation, now() + interval '3 minutes'
    )
    on conflict on constraint publishing_logs_occurrence_channel_unique do update set
      status = 'claimed',
      claim_token = excluded.claim_token,
      claim_generation = excluded.claim_generation,
      claim_expires_at = excluded.claim_expires_at,
      attempt_count = public.publishing_publication_logs.attempt_count + 1,
      error = null,
      updated_at = now()
    where public.publishing_publication_logs.status = 'claimed'
      and public.publishing_publication_logs.network_started_at is null
      and public.publishing_publication_logs.claim_expires_at < now()
    returning id into claimed_log_id;

    if claimed_log_id is not null then
      log_id := claimed_log_id;
      claim_token := next_claim;
      claim_generation := candidate.generation;
      occurrence_id := candidate.occurrence_id;
      organization_id := candidate.organization_id;
      scheduled_at := candidate.scheduled_at;
      post_id := candidate.post_id;
      post_created_by := candidate.post_created_by;
      content_item_id := candidate.content_item_id;
      post_name := candidate.post_name;
      post_text := candidate.post_text;
      link_url := candidate.link_url;
      media_kind := candidate.media_kind;
      media_source := candidate.media_source;
      disable_link_preview := candidate.disable_link_preview;
      channel_id := candidate.channel_id;
      telegram_chat_id := candidate.telegram_chat_id;
      telegram_username := candidate.telegram_username;
      return next;
    end if;
  end loop;
end;
$$;

create or replace function public.mark_publication_network_started(
  target_log_id uuid,
  target_claim_token uuid,
  target_claim_generation bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_occurrence_id uuid;
  target_organization_id uuid;
  gate_open boolean;
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'Service role required';
  end if;

  select publication_log.occurrence_id, publication_log.organization_id,
    not control.kill_switch and control.generation = target_claim_generation
  into target_occurrence_id, target_organization_id, gate_open
  from public.publishing_publication_logs publication_log
  join public.publishing_controls control
    on control.organization_id = publication_log.organization_id
  join public.publishing_channels channel on channel.id = publication_log.channel_id
  where publication_log.id = target_log_id
    and publication_log.claim_token = target_claim_token
    and publication_log.claim_generation = target_claim_generation
    and publication_log.status = 'claimed'
    and publication_log.network_started_at is null
    and publication_log.claim_expires_at > now()
    and channel.allowlisted and channel.bot_can_post
    and channel.verification_status = 'ready'
  for update of publication_log;

  if target_occurrence_id is null then return false; end if;
  if not gate_open then
    update public.publishing_publication_logs publication_log
    set status = 'held', error = 'Publishing gate closed before Telegram call', updated_at = now()
    where publication_log.id = target_log_id;
    update public.publishing_occurrences occurrence
    set status = 'held', hold_reason = 'kill_switch_generation_changed', updated_at = now()
    where occurrence.id = target_occurrence_id;
    return false;
  end if;

  update public.publishing_publication_logs publication_log
  set status = 'publishing', network_started_at = now(),
    claim_expires_at = now() + interval '3 minutes', updated_at = now()
  where publication_log.id = target_log_id;
  return true;
end;
$$;

create or replace function public.complete_publication_success(
  target_log_id uuid,
  target_claim_token uuid,
  target_message_id bigint,
  target_message_url text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_occurrence_id uuid;
  target_organization_id uuid;
  linked_content_item_id uuid;
  linked_post_creator uuid;
  linked_task_id uuid;
  all_published boolean;
  owner_record record;
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'Service role required';
  end if;
  if target_message_id is null or target_message_url !~* '^https://t\.me/[^[:space:]]+$' then
    raise exception 'A valid Telegram publication result is required';
  end if;

  update public.publishing_publication_logs publication_log
  set status = 'published', message_id = target_message_id,
    message_url = target_message_url, published_at = now(), error = null,
    updated_at = now()
  where publication_log.id = target_log_id
    and publication_log.claim_token = target_claim_token
    and publication_log.status = 'publishing'
  returning publication_log.occurrence_id, publication_log.organization_id
  into target_occurrence_id, target_organization_id;
  if target_occurrence_id is null then return false; end if;

  select not exists (
    select 1
    from public.publishing_schedule_channels schedule_channel
    join public.publishing_occurrences occurrence
      on occurrence.schedule_id = schedule_channel.schedule_id
    left join public.publishing_publication_logs publication_log
      on publication_log.occurrence_id = occurrence.id
      and publication_log.channel_id = schedule_channel.channel_id
      and publication_log.status = 'published'
    where occurrence.id = target_occurrence_id
      and publication_log.id is null
  ) into all_published;

  if all_published then
    update public.publishing_occurrences occurrence
    set status = 'published', error = null, hold_reason = null, updated_at = now()
    where occurrence.id = target_occurrence_id;

    select post.content_item_id, post.created_by
    into linked_content_item_id, linked_post_creator
    from public.publishing_occurrences occurrence
    join public.publishing_posts post on post.id = occurrence.post_id
    where occurrence.id = target_occurrence_id;

    if linked_content_item_id is not null then
      select task.id into linked_task_id
      from public.tasks task
      where task.content_item_id = linked_content_item_id
        and task.content_step = 'publishing'
        and task.status in ('ready', 'in_progress', 'review')
      for update;
      if linked_task_id is not null then
        begin
          perform public.submit_content_step_delivery(
            linked_post_creator,
            linked_task_id,
            'تم النشر تلقائيًا عبر نظام النشر الآمن.',
            target_message_url
          );
        exception when others then
          insert into public.audit_events (
            organization_id, actor_id, action, entity_type, entity_id, after_data
          ) values (
            target_organization_id, linked_post_creator,
            'publishing.content_task_sync_failed', 'publishing_occurrence',
            target_occurrence_id, jsonb_build_object('error', sqlerrm)
          );
        end;
      end if;
    end if;

    for owner_record in
      select membership.user_id
      from public.memberships membership
      where membership.organization_id = target_organization_id
        and membership.status = 'active'
        and membership.role = 'owner'
    loop
      perform private.add_notification(
        target_organization_id, owner_record.user_id,
        'publication_published', 'تم النشر تلقائيًا',
        'اكتمل نشر المحتوى على كل قنوات Telegram المحددة.',
        'publishing_occurrence', target_occurrence_id,
        '/publishing#occurrence-' || target_occurrence_id,
        'publication-published-' || target_occurrence_id || '-' || owner_record.user_id
      );
    end loop;
  end if;
  return all_published;
end;
$$;

create or replace function public.complete_publication_failure(
  target_log_id uuid,
  target_claim_token uuid,
  target_terminal_status text,
  target_telegram_error_code integer,
  target_error text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_occurrence_id uuid;
  target_organization_id uuid;
  owner_record record;
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'Service role required';
  end if;
  if target_terminal_status not in ('failed', 'unknown') then
    raise exception 'Terminal status must be failed or unknown';
  end if;

  update public.publishing_publication_logs publication_log
  set status = target_terminal_status,
    telegram_error_code = target_telegram_error_code,
    error = left(coalesce(nullif(trim(target_error), ''), 'Telegram publishing failed'), 2000),
    updated_at = now()
  where publication_log.id = target_log_id
    and publication_log.claim_token = target_claim_token
    and publication_log.status = 'publishing'
  returning publication_log.occurrence_id, publication_log.organization_id
  into target_occurrence_id, target_organization_id;
  if target_occurrence_id is null then return false; end if;

  update public.publishing_occurrences occurrence
  set status = target_terminal_status,
    error = left(coalesce(nullif(trim(target_error), ''), 'Telegram publishing failed'), 2000),
    updated_at = now()
  where occurrence.id = target_occurrence_id;

  for owner_record in
    select membership.user_id
    from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.status = 'active'
      and membership.role = 'owner'
  loop
    perform private.add_notification(
      target_organization_id, owner_record.user_id,
      'publication_failed',
      case when target_terminal_status = 'unknown'
        then 'نتيجة النشر غير مؤكدة' else 'فشل النشر التلقائي' end,
      case when target_terminal_status = 'unknown'
        then 'افحص القناة يدويًا؛ النظام لن يعيد المحاولة منعًا للنشر المكرر.'
        else left(coalesce(nullif(trim(target_error), ''), 'تعذر النشر على Telegram.'), 1000) end,
      'publishing_occurrence', target_occurrence_id,
      '/publishing#occurrence-' || target_occurrence_id,
      'publication-' || target_terminal_status || '-' || target_occurrence_id || '-' || owner_record.user_id
    );
  end loop;
  return true;
end;
$$;

create or replace function private.invoke_telegram_publisher()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_url text;
  worker_secret text;
begin
  select secret.decrypted_secret into project_url
  from vault.decrypted_secrets secret
  where secret.name = 'market_whales_project_url'
  order by secret.created_at desc
  limit 1;

  select secret.decrypted_secret into worker_secret
  from vault.decrypted_secrets secret
  where secret.name = 'market_whales_publishing_worker_secret'
  order by secret.created_at desc
  limit 1;

  if nullif(trim(project_url), '') is null or nullif(worker_secret, '') is null then
    return;
  end if;

  perform net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/telegram-publisher',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-whales-worker-secret', worker_secret
    ),
    body := jsonb_build_object('source', 'supabase_cron', 'requested_at', now()),
    timeout_milliseconds := 10000
  );
end;
$$;

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'market-whales-telegram-publisher';
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
  perform cron.schedule(
    'market-whales-telegram-publisher',
    '* * * * *',
    'select private.invoke_telegram_publisher()'
  );
end;
$$;

alter publication supabase_realtime add table public.publishing_channels;
alter publication supabase_realtime add table public.publishing_schedules;
alter publication supabase_realtime add table public.publishing_occurrences;
alter publication supabase_realtime add table public.publishing_publication_logs;

revoke all on function public.complete_publishing_admin_link(text, bigint, bigint, text)
  from public, anon, authenticated;
grant execute on function public.complete_publishing_admin_link(text, bigint, bigint, text)
  to service_role;

revoke all on function public.claim_publishing_preview_batch(integer)
  from public, anon, authenticated;
grant execute on function public.claim_publishing_preview_batch(integer)
  to service_role;

revoke all on function public.complete_publishing_preview(uuid, uuid, bigint, bigint, text)
  from public, anon, authenticated;
grant execute on function public.complete_publishing_preview(uuid, uuid, bigint, bigint, text)
  to service_role;

revoke all on function public.handle_publishing_callback(text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.handle_publishing_callback(text, text, bigint)
  to service_role;

revoke all on function public.claim_publication_batch(integer)
  from public, anon, authenticated;
grant execute on function public.claim_publication_batch(integer)
  to service_role;

revoke all on function public.mark_publication_network_started(uuid, uuid, bigint)
  from public, anon, authenticated;
grant execute on function public.mark_publication_network_started(uuid, uuid, bigint)
  to service_role;

revoke all on function public.complete_publication_success(uuid, uuid, bigint, text)
  from public, anon, authenticated;
grant execute on function public.complete_publication_success(uuid, uuid, bigint, text)
  to service_role;

revoke all on function public.complete_publication_failure(uuid, uuid, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.complete_publication_failure(uuid, uuid, text, integer, text)
  to service_role;

revoke all on function private.invoke_telegram_publisher() from public, anon, authenticated;
