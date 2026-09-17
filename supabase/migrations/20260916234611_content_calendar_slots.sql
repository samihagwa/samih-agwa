-- Each platform has an independent publishing appointment over the SAME
-- request. No task is created, completed, or rescheduled by moving a slot.
create table public.content_calendar_slots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  content_item_id uuid,
  plan_item_id uuid,
  platform text not null check (char_length(platform) between 1 and 80 and platform = lower(trim(platform))),
  scheduled_at timestamptz,
  revision integer not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  constraint calendar_one_parent check (num_nonnulls(content_item_id, plan_item_id) = 1),
  foreign key (content_item_id, organization_id) references public.content_items(id, organization_id) on delete cascade,
  foreign key (plan_item_id, organization_id) references public.content_plan_items(id, organization_id) on delete cascade
);
create unique index calendar_content_platform on public.content_calendar_slots(content_item_id, platform) where content_item_id is not null;
create unique index calendar_plan_platform on public.content_calendar_slots(plan_item_id, platform) where plan_item_id is not null;
create index calendar_org_time on public.content_calendar_slots(organization_id, scheduled_at);
alter table public.content_calendar_slots enable row level security;
revoke all on public.content_calendar_slots from public, anon, authenticated;
grant select on public.content_calendar_slots to authenticated;
create policy calendar_read_visible_source on public.content_calendar_slots for select to authenticated using (
  (content_item_id is not null and exists (select 1 from public.content_items c where c.id = content_item_id and c.organization_id = content_calendar_slots.organization_id))
  or (plan_item_id is not null and exists (select 1 from public.content_plan_items p where p.id = plan_item_id and p.organization_id = content_calendar_slots.organization_id))
);

create function private.move_content_calendar_slot(
  source_kind text, source_id uuid, target_platform text, target_time timestamptz,
  expected_revision integer, expected_time timestamptz
) returns public.content_calendar_slots
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  org uuid;
  parent_time timestamptz;
  parent_status text;
  platforms text[];
  slot public.content_calendar_slots%rowtype;
  prior jsonb;
  first_time timestamptz;
  linked_id uuid;
  plan_record public.content_plans%rowtype;
begin
  if actor is null then raise exception 'Calendar authentication required'; end if;
  if source_kind not in ('content','plan') or source_kind is null then raise exception 'Calendar source unavailable'; end if;
  if source_kind = 'content' then
    select c.organization_id, c.publish_at, c.status::text, c.platforms into org, parent_time, parent_status, platforms
    from public.content_items c where c.id = source_id for update;
  else
    select p.organization_id, p.publish_at, p.status::text, p.platforms, p.content_item_id
    into org, parent_time, parent_status, platforms, linked_id
    from public.content_plan_items p where p.id = source_id for update;
    if linked_id is not null then raise exception 'Calendar source changed; refresh'; end if;
    select p.* into plan_record from public.content_plans p join public.content_plan_items i on i.plan_id = p.id where i.id = source_id;
  end if;
  if org is null or not private.has_org_role(org, array['owner','admin','manager']::public.app_role[])
    or not private.can_access_any_section(org, array['planning']) then raise exception 'Calendar permission denied'; end if;
  if source_kind = 'content' and not private.can_read_content_actor(actor, org, source_id) then raise exception 'Calendar access denied'; end if;
  if parent_status in ('published','cancelled') or plan_record.status = 'archived'
    or (source_kind = 'content' and exists(select 1 from public.content_plan_items i join public.content_plans p on p.id=i.plan_id where i.content_item_id=source_id and p.status='archived'))
    then raise exception 'Calendar source closed or published'; end if;
  platforms := array(select distinct lower(trim(p)) from unnest(platforms) p where trim(p) <> '');
  target_platform := lower(trim(target_platform));
  if target_platform is null or not (target_platform = any(platforms)) then raise exception 'Calendar platform unavailable'; end if;
  if target_time is not null and (not isfinite(target_time) or target_time < timestamptz '2000-01-01' or target_time > timestamptz '2100-01-01') then raise exception 'Calendar time invalid'; end if;
  if source_kind = 'plan' and target_time is not null and
    ((target_time at time zone 'Africa/Cairo')::date < plan_record.starts_on or (target_time at time zone 'Africa/Cairo')::date > plan_record.ends_on)
    then raise exception 'Calendar time outside plan period'; end if;
  select * into slot from public.content_calendar_slots s
    where ((source_kind='content' and s.content_item_id=source_id) or (source_kind='plan' and s.plan_item_id=source_id)) and s.platform=target_platform;
  if expected_revision is null or expected_revision <> coalesce(slot.revision,0)
    or expected_time is distinct from (case when slot.id is null then parent_time else slot.scheduled_at end)
    then raise exception 'Calendar revision changed; refresh and retry'; end if;

  -- Snapshot EVERY platform before changing the compatibility timestamp;
  -- otherwise unsaved siblings would inherit the earliest moved appointment.
  insert into public.content_calendar_slots(organization_id, content_item_id, plan_item_id, platform, scheduled_at)
    select org, case when source_kind='content' then source_id end, case when source_kind='plan' then source_id end, p, parent_time from unnest(platforms) p
    on conflict do nothing;
  select * into slot from public.content_calendar_slots s where
    ((source_kind='content' and s.content_item_id=source_id) or (source_kind='plan' and s.plan_item_id=source_id)) and s.platform=target_platform;
  if slot.scheduled_at is not distinct from target_time then return slot; end if;
  prior := to_jsonb(slot);
  update public.content_calendar_slots set scheduled_at=target_time, revision=revision+1, updated_at=now() where id=slot.id returning * into slot;
  select min(s.scheduled_at) into first_time from public.content_calendar_slots s where
    ((source_kind='content' and s.content_item_id=source_id) or (source_kind='plan' and s.plan_item_id=source_id)) and s.platform=any(platforms);
  if first_time is not null and first_time is distinct from parent_time then
    if source_kind='content' then
      update public.content_items set publish_at=first_time, updated_at=now(), version=version+1 where id=source_id;
    else
      update public.content_plan_items set publish_at=first_time where id=source_id;
    end if;
  end if;
  insert into public.audit_events(organization_id,actor_id,action,entity_type,entity_id,before_data,after_data)
    values(org,actor,'content.calendar_rescheduled','calendar_slot',slot.id,prior,to_jsonb(slot));
  return slot;
end;
$$;
revoke all on function private.move_content_calendar_slot(text,uuid,text,timestamptz,integer,timestamptz) from public, anon, authenticated;
grant execute on function private.move_content_calendar_slot(text,uuid,text,timestamptz,integer,timestamptz) to authenticated;
create function public.move_content_calendar_slot(source_kind text, source_id uuid, target_platform text, target_time timestamptz, expected_revision integer, expected_time timestamptz)
returns public.content_calendar_slots language sql security invoker set search_path='' as $$
  select private.move_content_calendar_slot(source_kind, source_id, target_platform, target_time, expected_revision, expected_time);
$$;
revoke all on function public.move_content_calendar_slot(text,uuid,text,timestamptz,integer,timestamptz) from public, anon;
grant execute on function public.move_content_calendar_slot(text,uuid,text,timestamptz,integer,timestamptz) to authenticated;
alter publication supabase_realtime add table public.content_calendar_slots;
create or replace function private.guard_content_item_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  changed_fields text[] := array(
    select key from jsonb_each(to_jsonb(new)) entry(key, value)
    where value is distinct from (to_jsonb(old) -> key)
  );
  allowed_internal_fields constant text[] := array['status', 'published_at', 'version', 'updated_at'];
  allowed_version_fields constant text[] := array['version', 'updated_at'];
  allowed_caption_fields constant text[] := array['caption_brief', 'version', 'updated_at'];
  allowed_thumbnail_fields constant text[] := array['thumbnail_brief', 'version', 'updated_at'];
begin
  if actor is null then return new; end if;
  if private.is_org_owner_or_admin_actor(actor, new.organization_id)
    or new.created_by = actor then
    return new;
  end if;
  if changed_fields <@ array['publish_at','version','updated_at']::text[]
    and private.has_org_role(new.organization_id,array['owner','admin','manager']::public.app_role[])
    and private.can_access_any_section(new.organization_id,array['planning'])
    and private.can_read_content_actor(actor,new.organization_id,new.id) then return new; end if;
  if pg_trigger_depth() > 1 and changed_fields <@ allowed_internal_fields then
    return new;
  end if;
  if changed_fields <@ allowed_version_fields and exists (
    select 1 from public.tasks task
    where task.content_item_id = new.id and task.owner_id = actor
  ) then return new; end if;
  if changed_fields <@ allowed_caption_fields and exists (
    select 1 from public.tasks task
    where task.organization_id = new.organization_id
      and task.content_item_id = new.id
      and task.owner_id = actor
      and task.is_work_item
      and task.content_step in (
        'recording', 'editing', 'thumbnail', 'caption',
        'design', 'scheduling', 'publishing'
      )
      and task.status <> 'cancelled'
  ) then return new; end if;
  if changed_fields <@ allowed_thumbnail_fields and exists (
    select 1 from public.tasks task
    where task.content_item_id = new.id
      and task.owner_id = actor
      and task.content_step = 'thumbnail'
      and task.status <> 'cancelled'
  ) then return new; end if;
  raise exception 'You cannot modify this content file';
end;
$$;

-- Preserve independent appointments when a calendar idea becomes the canonical request.
create function private.transfer_calendar_plan_slots() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.content_item_id is not null and new.content_item_id is distinct from old.content_item_id then
    insert into public.content_calendar_slots(organization_id,content_item_id,platform,scheduled_at,revision)
      select new.organization_id,new.content_item_id,s.platform,s.scheduled_at,s.revision+1
      from public.content_calendar_slots s join public.content_items c on c.id=new.content_item_id and c.organization_id=new.organization_id
      where s.plan_item_id=new.id and s.platform=any(array(select lower(trim(p)) from unnest(c.platforms) p))
      on conflict do nothing;
  end if;
  return new;
end; $$;
revoke all on function private.transfer_calendar_plan_slots() from public, anon, authenticated;
create trigger transfer_calendar_plan_slots after update of content_item_id on public.content_plan_items for each row execute function private.transfer_calendar_plan_slots();

-- Quick calendar intake is atomic and idempotent. Drafts do not create tasks.
create function private.create_calendar_draft(
  target_org uuid, request_id uuid, item_title text, item_kind public.content_plan_item_kind,
  item_brief text, item_platforms text[], item_time timestamptz, target_plan uuid default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  actor uuid := (select auth.uid());
  quarter_start date;
  quarter_end date;
  chosen_plan uuid := target_plan;
  existing public.content_plan_items%rowtype;
begin
  if actor is null or not private.has_org_role(target_org,array['owner','admin','manager']::public.app_role[])
    or not private.can_access_any_section(target_org,array['planning']) then raise exception 'Calendar permission denied'; end if;
  if request_id is null or item_time is null or not isfinite(item_time) or item_time < timestamptz '2000-01-01' or item_time > timestamptz '2100-01-01'
    then raise exception 'Calendar time or request invalid'; end if;
  if char_length(trim(item_title)) not between 3 and 180 or char_length(trim(item_brief)) not between 5 and 2000
    or item_title is null or item_brief is null or item_kind is null then raise exception 'Calendar fields invalid'; end if;
  item_platforms:=array(select distinct lower(trim(p)) from unnest(item_platforms) p where trim(p)<>'');
  if cardinality(item_platforms) not between 1 and 12 or exists(select 1 from unnest(item_platforms) p where char_length(p)>80) then raise exception 'Calendar platforms invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_org::text || ':calendar-intake',0));
  select * into existing from public.content_plan_items where id=request_id;
  if found then
    if existing.organization_id<>target_org or existing.created_by<>actor then raise exception 'Calendar request conflict'; end if;
    return existing.id;
  end if;
  if chosen_plan is null then
    quarter_start:=date_trunc('quarter',item_time at time zone 'Africa/Cairo')::date;
    quarter_end:=(quarter_start+interval '3 months'-interval '1 day')::date;
    select id into chosen_plan from public.content_plans where organization_id=target_org and starts_on=quarter_start and ends_on=quarter_end
      and name='تقويم المحتوى ' || quarter_start::text and status='draft' order by created_at limit 1;
    if chosen_plan is null then
      insert into public.content_plans(organization_id,name,starts_on,ends_on,objective,audience,status,created_by,updated_by)
        values(target_org,'تقويم المحتوى ' || quarter_start::text,quarter_start,quarter_end,'تنظيم مواعيد المحتوى على المنصات','جمهور البراند','draft',actor,actor) returning id into chosen_plan;
    end if;
  end if;
  if not exists(select 1 from public.content_plans where id=chosen_plan and organization_id=target_org and status<>'archived'
      and (item_time at time zone 'Africa/Cairo')::date between starts_on and ends_on) then raise exception 'Calendar time outside plan period'; end if;
  insert into public.content_plan_items(id,organization_id,plan_id,kind,title,objective,platforms,owner_id,publish_at,status,created_by,updated_by)
    values(request_id,target_org,chosen_plan,item_kind,trim(item_title),trim(item_brief),item_platforms,actor,item_time,'planned',actor,actor);
  insert into public.audit_events(organization_id,actor_id,action,entity_type,entity_id,after_data)
    values(target_org,actor,'content.calendar_draft_created','content_plan_item',request_id,jsonb_build_object('plan_id',chosen_plan));
  return request_id;
end; $$;
revoke all on function private.create_calendar_draft(uuid,uuid,text,public.content_plan_item_kind,text,text[],timestamptz,uuid) from public,anon,authenticated;
grant execute on function private.create_calendar_draft(uuid,uuid,text,public.content_plan_item_kind,text,text[],timestamptz,uuid) to authenticated;
create function public.create_calendar_draft(target_org uuid,request_id uuid,item_title text,item_kind public.content_plan_item_kind,item_brief text,item_platforms text[],item_time timestamptz,target_plan uuid default null)
returns uuid language sql security invoker set search_path='' as $$
select private.create_calendar_draft(target_org,request_id,item_title,item_kind,item_brief,item_platforms,item_time,target_plan);
$$;
revoke all on function public.create_calendar_draft(uuid,uuid,text,public.content_plan_item_kind,text,text[],timestamptz,uuid) from public,anon;
grant execute on function public.create_calendar_draft(uuid,uuid,text,public.content_plan_item_kind,text,text[],timestamptz,uuid) to authenticated;
