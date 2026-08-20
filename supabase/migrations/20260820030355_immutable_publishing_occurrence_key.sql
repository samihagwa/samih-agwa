-- Keep the identity of a scheduled slot immutable. `scheduled_at` is the
-- effective delivery time and may move after "publish now" or "delay".
create or replace function private.publishing_occurrence_key(
  target_schedule_id uuid,
  target_slot_at timestamptz
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select 'ps' || replace(target_schedule_id::text, '-', '') || '-'
    || floor(extract(epoch from target_slot_at))::bigint::text;
$$;

alter table public.publishing_occurrences
  add column occurrence_key text;

-- Preserve every historical row. The first row for a slot receives the
-- canonical key; any already-existing duplicate keeps an explicit legacy key
-- so the unique constraint can be installed without erasing audit evidence.
with prepared as (
  select occurrence.id, occurrence.created_at,
    private.publishing_occurrence_key(
      occurrence.schedule_id,
      case
        when schedule.schedule_type = 'once'
          then coalesce(schedule.once_at, occurrence.scheduled_at)
        else occurrence.scheduled_at
      end
    ) as base_key
  from public.publishing_occurrences occurrence
  join public.publishing_schedules schedule on schedule.id = occurrence.schedule_id
), ranked as (
  select prepared.*,
    row_number() over (
      partition by prepared.base_key
      order by prepared.created_at, prepared.id
    ) as duplicate_ordinal
  from prepared
)
update public.publishing_occurrences occurrence
set occurrence_key = case
  when ranked.duplicate_ordinal = 1 then ranked.base_key
  else ranked.base_key || '-legacy-' || replace(occurrence.id::text, '-', '')
end
from ranked
where occurrence.id = ranked.id;

alter table public.publishing_occurrences
  alter column occurrence_key set not null,
  add constraint publishing_occurrences_key_length
    check (char_length(occurrence_key) between 40 and 120),
  add constraint publishing_occurrences_key_unique unique (occurrence_key),
  drop constraint publishing_occurrences_schedule_time_unique;

create or replace function private.materialize_publishing_occurrences(
  target_now timestamptz default now()
)
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
    organization_id, schedule_id, post_id, occurrence_key, scheduled_at, status
  )
  select schedule.organization_id, schedule.id, schedule.post_id,
    private.publishing_occurrence_key(schedule.id, schedule.once_at),
    schedule.once_at, 'pending'
  from public.publishing_schedules schedule
  where schedule.schedule_type = 'once'
    and not schedule.paused
    and schedule.deleted_at is null
    and schedule.once_at is not null
  on conflict (occurrence_key) do nothing;
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

      scheduled_moment := (local_day + schedule_record.time_local)
        at time zone schedule_record.timezone_name;
      insert into public.publishing_occurrences (
        organization_id, schedule_id, post_id, occurrence_key, scheduled_at, status
      ) values (
        schedule_record.organization_id, schedule_record.id,
        schedule_record.post_id,
        private.publishing_occurrence_key(schedule_record.id, scheduled_moment),
        scheduled_moment, 'pending'
      ) on conflict (occurrence_key) do nothing;
      if found then
        inserted_count := inserted_count + 1;
        existing_count := existing_count + 1;
      end if;
    end loop;
  end loop;
  return inserted_count;
end;
$$;

revoke all on function private.publishing_occurrence_key(uuid, timestamptz)
  from public, anon, authenticated;
