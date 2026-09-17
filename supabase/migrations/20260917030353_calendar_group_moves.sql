-- A grouped card moves as one transaction. A stale sibling rolls back ALL
-- moves. Existing source authorization, locks and audit remain authoritative.
create function public.move_content_calendar_group(source_kind text, source_id uuid, changes jsonb)
returns setof public.content_calendar_slots
language plpgsql security invoker set search_path = '' as $$
declare change jsonb; result public.content_calendar_slots;
begin
  if jsonb_typeof(changes) is distinct from 'array' then raise exception 'Calendar changes invalid'; end if;
  if jsonb_array_length(changes) not between 1 and 20 then raise exception 'Calendar changes invalid'; end if;
  if (select count(distinct lower(trim(value->>'platform'))) from jsonb_array_elements(changes)) <> jsonb_array_length(changes)
    then raise exception 'Calendar duplicate platform'; end if;
  for change in select value from jsonb_array_elements(changes) order by value->>'platform' loop
    result := private.move_content_calendar_slot(source_kind, source_id, change->>'platform',
      (change->>'target_time')::timestamptz, (change->>'revision')::integer, (change->>'expected_time')::timestamptz);
    return next result;
  end loop;
end;
$$;
revoke all on function public.move_content_calendar_group(text,uuid,jsonb) from public, anon;
grant execute on function public.move_content_calendar_group(text,uuid,jsonb) to authenticated;
