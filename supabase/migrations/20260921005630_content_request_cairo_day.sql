-- Change only the date-only intake branch; retain authorization, idempotency,
-- grants, and the atomic creation of content, tasks, and notification outbox.
do $migration$
declare
  signature regprocedure := 'private.create_content_request_workflow(uuid,uuid,uuid,text,text,timestamptz,jsonb,uuid,uuid,uuid,uuid[],public.content_format,text[])'::regprocedure;
  definition text;
  old_guard text := $old$  if target_publish_at is null
    or target_publish_at <= now() + interval '1 hour' then
    raise exception 'Publish time must be at least one hour in the future';
  end if;$old$;
  new_guard text := $new$  if request_format in ('carousel', 'long_video') then
    if target_publish_at is null or not isfinite(target_publish_at)
      or (target_publish_at at time zone 'Africa/Cairo')::date < (now() at time zone 'Africa/Cairo')::date then
      raise exception using errcode = '22007', message = 'اختر يوم النشر الحالي أو يومًا قادمًا بتوقيت القاهرة.';
    end if;
    -- The selected day is authoritative. End-of-day keeps today's tasks from
    -- becoming overdue immediately and handles Cairo DST without a fixed offset.
    target_publish_at := (((target_publish_at at time zone 'Africa/Cairo')::date + 1)::timestamp
      at time zone 'Africa/Cairo') - interval '1 microsecond';
  elsif target_publish_at is null or target_publish_at <= now() + interval '1 hour' then
    raise exception 'Publish time must be at least one hour in the future';
  end if;$new$;
begin
  definition := pg_get_functiondef(signature);
  if strpos(definition, old_guard) = 0
    or (length(definition) - length(replace(definition, old_guard, ''))) <> length(old_guard) then
    raise exception 'Unexpected content intake definition; refusing to replace date guard';
  end if;
  execute replace(definition, old_guard, new_guard);
end;
$migration$;
