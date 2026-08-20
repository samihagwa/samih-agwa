-- Scheduled publications are never hard-deleted. A revision archives the old
-- schedule and post, cancels every not-yet-terminal occurrence, then creates a
-- fresh schedule with a new idempotency namespace. Published/ambiguous history
-- remains immutable and queryable.

create or replace function public.revise_telegram_publication(
  target_schedule_id uuid,
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
  existing_schedule public.publishing_schedules%rowtype;
  new_schedule_id uuid;
begin
  if actor is null then raise exception 'Authentication is required'; end if;

  select schedule.* into existing_schedule
  from public.publishing_schedules schedule
  where schedule.id = target_schedule_id
  for update;

  if existing_schedule.id is null then raise exception 'Publishing schedule was not found'; end if;
  if not private.has_org_role(
    existing_schedule.organization_id,
    array['owner', 'admin', 'manager']::public.app_role[]
  ) then
    raise exception 'Only organization leadership can revise publishing schedules';
  end if;
  if existing_schedule.deleted_at is not null then
    raise exception 'Deleted publishing schedules cannot be revised';
  end if;

  -- Serialize against the worker's SKIP LOCKED claims. Once this transaction
  -- owns the occurrence rows, no new publication claim can start for them.
  perform occurrence.id
  from public.publishing_occurrences occurrence
  where occurrence.schedule_id = existing_schedule.id
    and occurrence.status in (
      'pending', 'previewing', 'previewed', 'awaiting_approval',
      'approved', 'ready', 'publishing', 'held', 'unknown'
    )
  for update;

  if exists (
    select 1
    from public.publishing_occurrences occurrence
    join public.publishing_publication_logs publication_log
      on publication_log.occurrence_id = occurrence.id
    where occurrence.schedule_id = existing_schedule.id
      and publication_log.status in ('claimed', 'publishing')
  ) or exists (
    select 1
    from public.publishing_occurrences occurrence
    where occurrence.schedule_id = existing_schedule.id
      and occurrence.status = 'publishing'
  ) then
    raise exception 'Publication has already started; wait for its result before editing';
  end if;

  -- An unknown result may already exist on Telegram. Cloning it could create a
  -- duplicate that no idempotency key can distinguish safely.
  if exists (
    select 1
    from public.publishing_occurrences occurrence
    where occurrence.schedule_id = existing_schedule.id
      and occurrence.status = 'unknown'
  ) then
    raise exception 'This schedule has an unknown Telegram result; inspect the channel before editing';
  end if;

  update public.publishing_occurrences occurrence
  set status = 'cancelled',
      hold_reason = 'schedule_revised',
      updated_at = now()
  where occurrence.schedule_id = existing_schedule.id
    and occurrence.status in (
      'pending', 'previewing', 'previewed', 'awaiting_approval',
      'approved', 'ready', 'held'
    );

  update public.publishing_schedules schedule
  set paused = true,
      deleted_at = now(),
      updated_at = now()
  where schedule.id = existing_schedule.id;

  update public.publishing_posts post
  set status = 'archived', updated_at = now()
  where post.id = existing_schedule.post_id;

  new_schedule_id := public.create_telegram_publication(
    existing_schedule.organization_id,
    target_content_item_id,
    post_name,
    post_text,
    post_link_url,
    post_media_kind,
    post_media_source,
    post_disable_link_preview,
    target_schedule_type,
    target_once_at,
    target_weekdays,
    target_time_local,
    target_starts_on,
    target_ends_on,
    target_occurrence_limit,
    target_preview_policy,
    target_preview_lead_minutes,
    target_missed_grace_minutes,
    target_channel_ids
  );

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id,
    before_data, after_data
  ) values (
    existing_schedule.organization_id, actor, 'publishing.schedule_revised',
    'publishing_schedule', existing_schedule.id,
    jsonb_build_object(
      'post_id', existing_schedule.post_id,
      'schedule_type', existing_schedule.schedule_type
    ),
    jsonb_build_object('replacement_schedule_id', new_schedule_id)
  );

  return new_schedule_id;
end;
$$;

create or replace function public.delete_publishing_schedule(target_schedule_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  existing_schedule public.publishing_schedules%rowtype;
  cancelled_count integer := 0;
begin
  if actor is null then raise exception 'Authentication is required'; end if;

  select schedule.* into existing_schedule
  from public.publishing_schedules schedule
  where schedule.id = target_schedule_id
  for update;

  if existing_schedule.id is null then return false; end if;
  if not private.has_org_role(
    existing_schedule.organization_id,
    array['owner', 'admin', 'manager']::public.app_role[]
  ) then
    raise exception 'Only organization leadership can delete publishing schedules';
  end if;
  if existing_schedule.deleted_at is not null then return true; end if;

  perform occurrence.id
  from public.publishing_occurrences occurrence
  where occurrence.schedule_id = existing_schedule.id
    and occurrence.status in (
      'pending', 'previewing', 'previewed', 'awaiting_approval',
      'approved', 'ready', 'publishing', 'held'
    )
  for update;

  if exists (
    select 1
    from public.publishing_occurrences occurrence
    join public.publishing_publication_logs publication_log
      on publication_log.occurrence_id = occurrence.id
    where occurrence.schedule_id = existing_schedule.id
      and publication_log.status in ('claimed', 'publishing')
  ) or exists (
    select 1
    from public.publishing_occurrences occurrence
    where occurrence.schedule_id = existing_schedule.id
      and occurrence.status = 'publishing'
  ) then
    raise exception 'Publication has already started; use the emergency stop and wait before deleting';
  end if;

  update public.publishing_occurrences occurrence
  set status = 'cancelled',
      hold_reason = 'schedule_deleted',
      updated_at = now()
  where occurrence.schedule_id = existing_schedule.id
    and occurrence.status in (
      'pending', 'previewing', 'previewed', 'awaiting_approval',
      'approved', 'ready', 'held'
    );
  get diagnostics cancelled_count = row_count;

  update public.publishing_schedules schedule
  set paused = true,
      deleted_at = now(),
      updated_at = now()
  where schedule.id = existing_schedule.id;

  update public.publishing_posts post
  set status = 'archived', updated_at = now()
  where post.id = existing_schedule.post_id
    and not exists (
      select 1
      from public.publishing_schedules other_schedule
      where other_schedule.post_id = post.id
        and other_schedule.id <> existing_schedule.id
        and other_schedule.deleted_at is null
    );

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id,
    before_data, after_data
  ) values (
    existing_schedule.organization_id, actor, 'publishing.schedule_deleted',
    'publishing_schedule', existing_schedule.id,
    jsonb_build_object(
      'post_id', existing_schedule.post_id,
      'schedule_type', existing_schedule.schedule_type
    ),
    jsonb_build_object(
      'soft_deleted', true,
      'cancelled_occurrences', cancelled_count
    )
  );

  return true;
end;
$$;

revoke all on function public.revise_telegram_publication(
  uuid, uuid, text, text, text, text, text, boolean, text,
  timestamptz, smallint[], time, date, date, integer, text,
  integer, integer, uuid[]
) from public, anon, authenticated;
grant execute on function public.revise_telegram_publication(
  uuid, uuid, text, text, text, text, text, boolean, text,
  timestamptz, smallint[], time, date, date, integer, text,
  integer, integer, uuid[]
) to authenticated;

revoke all on function public.delete_publishing_schedule(uuid)
  from public, anon, authenticated;
grant execute on function public.delete_publishing_schedule(uuid)
  to authenticated;

comment on function public.revise_telegram_publication(
  uuid, uuid, text, text, text, text, text, boolean, text,
  timestamptz, smallint[], time, date, date, integer, text,
  integer, integer, uuid[]
) is 'Atomically archives a scheduled publication revision and creates its replacement without mutating frozen occurrence history.';

comment on function public.delete_publishing_schedule(uuid)
  is 'Soft-deletes a publishing schedule and cancels every not-yet-terminal occurrence while preserving publication history.';
