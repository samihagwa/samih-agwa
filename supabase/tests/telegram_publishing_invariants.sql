begin;

do $$
declare
  test_org uuid;
  test_user uuid;
  test_channel uuid;
  test_post uuid;
  test_schedule uuid;
  test_occurrence uuid;
  first_claim record;
  claimed_again integer;
  gate_result boolean;
  terminal_status text;
  second_post uuid;
  second_schedule uuid;
  second_occurrence uuid;
  third_post uuid;
  third_schedule uuid;
  third_claim record;
  fourth_post uuid;
  fourth_schedule uuid;
  fourth_occurrence uuid;
  occurrence_count integer;
  media_guarded boolean := false;
  test_asset uuid;
  media_post uuid;
  linked_asset uuid;
  unregistered_media_guarded boolean := false;
begin
  select membership.organization_id, membership.user_id
  into test_org, test_user
  from public.memberships membership
  where membership.status = 'active' and membership.role = 'owner'
  order by membership.created_at
  limit 1;
  if test_org is null then raise exception 'Invariant test needs an active owner'; end if;

  insert into public.publishing_channels (
    organization_id, telegram_chat_id, telegram_username, title,
    bot_username, bot_user_id, allowlisted, bot_can_post,
    verification_status, verified_at, created_by
  ) values (
    test_org, -1009999999999, '@invariant_test_channel', 'Invariant test channel',
    'invariant_test_bot', 9999999999, true, true, 'ready', now(), test_user
  ) returning id into test_channel;

  insert into public.publishing_posts (
    organization_id, name, post_text, created_by
  ) values (test_org, 'Invariant test post', 'Never sent to Telegram', test_user)
  returning id into test_post;

  insert into public.publishing_schedules (
    organization_id, post_id, schedule_type, once_at,
    preview_policy, created_by
  ) values (
    test_org, test_post, 'once', now() - interval '1 minute',
    'automatic', test_user
  ) returning id into test_schedule;
  insert into public.publishing_schedule_channels (organization_id, schedule_id, channel_id)
  values (test_org, test_schedule, test_channel);
  insert into public.publishing_controls (organization_id, updated_by)
  values (test_org, test_user)
  on conflict (organization_id) do update set kill_switch = false,
    generation = public.publishing_controls.generation + 1,
    updated_by = excluded.updated_by;
  perform private.materialize_publishing_occurrences(now());

  select * into first_claim from public.claim_publication_batch(1);
  if first_claim.log_id is null then raise exception 'First durable claim was not created'; end if;
  select count(*) into claimed_again from public.claim_publication_batch(1);
  if claimed_again <> 0 then raise exception 'Duplicate publication claim was created'; end if;

  update public.publishing_controls
  set kill_switch = true, generation = generation + 1
  where organization_id = test_org;
  select public.mark_publication_network_started(
    first_claim.log_id, first_claim.claim_token, first_claim.claim_generation
  ) into gate_result;
  if gate_result then raise exception 'Kill switch did not fence an earlier claim'; end if;
  select publication_log.status into terminal_status
  from public.publishing_publication_logs publication_log
  where publication_log.id = first_claim.log_id;
  if terminal_status <> 'held' then raise exception 'Fenced claim was not held'; end if;

  -- Frozen content must stop if it changes before the network call.
  update public.publishing_controls
  set kill_switch = false, generation = generation + 1
  where organization_id = test_org;
  insert into public.publishing_posts (organization_id, name, post_text, created_by)
  values (test_org, 'Snapshot invariant', 'Frozen version', test_user)
  returning id into second_post;
  insert into public.publishing_schedules (
    organization_id, post_id, schedule_type, once_at, preview_policy, created_by
  ) values (
    test_org, second_post, 'once', now() - interval '1 minute', 'automatic', test_user
  ) returning id into second_schedule;
  insert into public.publishing_schedule_channels (organization_id, schedule_id, channel_id)
  values (test_org, second_schedule, test_channel);
  perform private.materialize_publishing_occurrences(now());
  select occurrence.id into second_occurrence
  from public.publishing_occurrences occurrence
  where occurrence.schedule_id = second_schedule;
  update public.publishing_occurrences occurrence
  set snapshot_payload = private.publication_payload(occurrence.id),
    snapshot_hash = private.publication_payload_hash(private.publication_payload(occurrence.id))
  where occurrence.id = second_occurrence;
  update public.publishing_posts set post_text = 'Changed after freeze' where id = second_post;
  perform public.claim_publication_batch(1);
  select occurrence.status into terminal_status
  from public.publishing_occurrences occurrence where occurrence.id = second_occurrence;
  if terminal_status <> 'held_changed' then raise exception 'Snapshot mismatch was not held'; end if;

  -- Once a Telegram request starts, expiry becomes unknown and never reclaimable.
  insert into public.publishing_posts (organization_id, name, post_text, created_by)
  values (test_org, 'Unknown result invariant', 'Potentially delivered once', test_user)
  returning id into third_post;
  insert into public.publishing_schedules (
    organization_id, post_id, schedule_type, once_at, preview_policy, created_by
  ) values (
    test_org, third_post, 'once', now() - interval '1 minute', 'automatic', test_user
  ) returning id into third_schedule;
  insert into public.publishing_schedule_channels (organization_id, schedule_id, channel_id)
  values (test_org, third_schedule, test_channel);
  perform private.materialize_publishing_occurrences(now());
  select * into third_claim from public.claim_publication_batch(1);
  if third_claim.log_id is null then raise exception 'Unknown-result test did not claim'; end if;
  if not public.mark_publication_network_started(
    third_claim.log_id, third_claim.claim_token, third_claim.claim_generation
  ) then raise exception 'Unknown-result test did not cross the network fence'; end if;
  update public.publishing_publication_logs
  set claim_expires_at = now() - interval '1 second'
  where id = third_claim.log_id;
  perform public.claim_publication_batch(1);
  select publication_log.status into terminal_status
  from public.publishing_publication_logs publication_log
  where publication_log.id = third_claim.log_id;
  if terminal_status <> 'unknown' then raise exception 'Expired network call was retried instead of becoming unknown'; end if;

  -- Invalid media captions fail before scheduling rather than at publication time.
  begin
    insert into public.publishing_posts (
      organization_id, name, post_text, media_kind, media_source, created_by
    ) values (
      test_org, 'Media caption guard', repeat('x', 1025), 'photo',
      'https://example.com/test.jpg', test_user
    );
  exception when check_violation then
    media_guarded := true;
  end;
  if not media_guarded then raise exception 'Oversized media caption was accepted'; end if;

  -- Telegram file IDs can only be scheduled after the connected bot has
  -- captured them in this organization's media library.
  insert into public.publishing_telegram_assets (
    organization_id, received_by_user_id, telegram_chat_id, telegram_user_id,
    telegram_message_id, telegram_file_id, telegram_file_unique_id,
    media_kind, display_name
  ) values (
    test_org, test_user, 999999, 999999, 1,
    'telegram-photo-file-id-12345678', 'telegram-photo-unique-1',
    'photo', 'Invariant media asset'
  ) returning id into test_asset;
  insert into public.publishing_posts (
    organization_id, name, post_text, media_kind, media_source, created_by
  ) values (
    test_org, 'Linked Telegram media', 'Saved through the bot', 'photo',
    'telegram-photo-file-id-12345678', test_user
  ) returning id into media_post;
  select post.media_asset_id into linked_asset
  from public.publishing_posts post where post.id = media_post;
  if linked_asset is distinct from test_asset then
    raise exception 'Telegram library file was not linked to the publication';
  end if;
  begin
    insert into public.publishing_posts (
      organization_id, name, post_text, media_kind, media_source, created_by
    ) values (
      test_org, 'Unregistered Telegram media', 'Must be rejected', 'photo',
      'unknown-telegram-file-id-12345678', test_user
    );
  exception when raise_exception then
    unregistered_media_guarded := true;
  end;
  if not unregistered_media_guarded then
    raise exception 'Unregistered Telegram file ID was accepted';
  end if;

  -- Moving the effective delivery time must not create a new copy of the
  -- original scheduled slot on the next materialization tick.
  insert into public.publishing_posts (organization_id, name, post_text, created_by)
  values (test_org, 'Immutable slot invariant', 'Publish-now must stay one occurrence', test_user)
  returning id into fourth_post;
  insert into public.publishing_schedules (
    organization_id, post_id, schedule_type, once_at, preview_policy, created_by
  ) values (
    test_org, fourth_post, 'once', now() + interval '1 hour', 'review_window', test_user
  ) returning id into fourth_schedule;
  perform private.materialize_publishing_occurrences(now());
  select occurrence.id into fourth_occurrence
  from public.publishing_occurrences occurrence
  where occurrence.schedule_id = fourth_schedule;
  update public.publishing_occurrences occurrence
  set scheduled_at = now(), status = 'ready'
  where occurrence.id = fourth_occurrence;
  perform private.materialize_publishing_occurrences(now());
  select count(*) into occurrence_count
  from public.publishing_occurrences occurrence
  where occurrence.schedule_id = fourth_schedule;
  if occurrence_count <> 1 then
    raise exception 'Publish-now rematerialized the original scheduled slot';
  end if;
end;
$$;

rollback;
