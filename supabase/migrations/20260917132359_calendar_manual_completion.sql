-- Manual calendar check-off is separate from publishing and execution tasks.
alter table public.content_calendar_slots
  add column completed_at timestamptz,
  add column completed_by uuid references public.profiles(id) on delete set null;

create function private.set_content_calendar_completion(source_kind text, source_id uuid, changes jsonb, completed boolean)
returns setof public.content_calendar_slots
language plpgsql security definer set search_path = '' as $$
declare change jsonb; slot public.content_calendar_slots; before_slot public.content_calendar_slots;
  actor uuid := (select auth.uid());
begin
  if actor is null then raise exception 'Calendar authentication required'; end if;
  if completed is null or jsonb_typeof(changes) is distinct from 'array' then raise exception 'Calendar changes invalid'; end if;
  if jsonb_array_length(changes) not between 1 and 20 then raise exception 'Calendar changes invalid'; end if;
  if (select count(distinct lower(trim(value->>'platform'))) from jsonb_array_elements(changes)) <> jsonb_array_length(changes)
    then raise exception 'Calendar duplicate platform'; end if;
  for change in select value from jsonb_array_elements(changes) order by value->>'platform' loop
    -- Same-time moves only authorize, lock, validate revisions and materialize
    -- slots. They never reschedule the parent or touch execution tasks.
    slot := private.move_content_calendar_slot(source_kind, source_id, change->>'platform',
      (change->>'expected_time')::timestamptz, (change->>'revision')::integer, (change->>'expected_time')::timestamptz);
    if (slot.completed_at is not null) <> completed then
      before_slot := slot;
      update public.content_calendar_slots set completed_at=case when completed then now() end,
        completed_by=case when completed then actor end, revision=revision+1, updated_at=now()
        where id=slot.id returning * into slot;
      insert into public.audit_events(organization_id,actor_id,action,entity_type,entity_id,before_data,after_data)
        values(slot.organization_id,actor,'content.calendar_completion_changed','content_calendar_slot',slot.id,
          to_jsonb(before_slot),to_jsonb(slot));
    end if;
    return next slot;
  end loop;
end; $$;
revoke all on function private.set_content_calendar_completion(text,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function private.set_content_calendar_completion(text,uuid,jsonb,boolean) to authenticated;
create function public.set_content_calendar_completion(source_kind text, source_id uuid, changes jsonb, completed boolean)
returns setof public.content_calendar_slots language sql security invoker set search_path='' as $$
  select * from private.set_content_calendar_completion(source_kind,source_id,changes,completed);
$$;
revoke all on function public.set_content_calendar_completion(text,uuid,jsonb,boolean) from public,anon;
grant execute on function public.set_content_calendar_completion(text,uuid,jsonb,boolean) to authenticated;

create or replace function private.transfer_calendar_plan_slots() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.content_item_id is not null and new.content_item_id is distinct from old.content_item_id then
    insert into public.content_calendar_slots(organization_id,content_item_id,platform,scheduled_at,revision,completed_at,completed_by)
      select new.organization_id,new.content_item_id,s.platform,s.scheduled_at,s.revision+1,s.completed_at,s.completed_by
      from public.content_calendar_slots s join public.content_items c on c.id=new.content_item_id and c.organization_id=new.organization_id
      where s.plan_item_id=new.id and s.platform=any(array(select lower(trim(p)) from unnest(c.platforms) p))
      on conflict do nothing;
  end if;
  return new;
end; $$;
