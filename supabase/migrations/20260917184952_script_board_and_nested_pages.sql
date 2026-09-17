-- Null preserves legacy text-derived classification until the writer explicitly moves a card.
alter table public.scripts add column draft_stage text check (draft_stage in ('idea', 'draft'));

create function private.move_script_card(target_script_id uuid, expected_version bigint, destination text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare s public.scripts%rowtype; result_version bigint;
begin
  select * into s from public.scripts where id = target_script_id for update;
  if s.id is null or auth.uid() is null or not private.can_access_script_actor(auth.uid(), s.organization_id, s.assigned_to) then
    raise exception 'هذا السكريبت ليس متاحًا للتعديل بحسابك';
  end if;
  if expected_version is null or s.edit_version <> expected_version then raise exception 'تغيّر السكريبت في جلسة أخرى؛ حدّث الصفحة أولًا'; end if;
  if destination is null or destination not in ('idea', 'draft', 'ready_to_record', 'archived') then
    raise exception 'مراحل التنفيذ والنشر تتحدث من المهام المرتبطة فقط';
  end if;
  if s.content_item_id is not null and destination <> 'archived' then raise exception 'هذا السكريبت مرتبط بالتنفيذ؛ افتح طلب التنفيذ'; end if;
  if destination = 'ready_to_record' and length(trim(s.spoken_script)) < 20 then raise exception 'اكتب نص السكريبت قبل تجهيزه للتصوير'; end if;
  update public.scripts set draft_stage = case when destination = 'idea' then 'idea' when destination in ('draft','ready_to_record') then 'draft' else draft_stage end where id = s.id;
  result_version := public.change_script_status(auth.uid(), s.id,
    (case when destination = 'idea' then 'draft' else destination end)::public.script_status, expected_version);
  return result_version;
end;
$$;
revoke all on function private.move_script_card(uuid,bigint,text) from public, anon, authenticated;
grant execute on function private.move_script_card(uuid,bigint,text) to authenticated;
create function public.move_script_card(target_script_id uuid, expected_version bigint, destination text)
returns bigint language sql security invoker set search_path = '' as $$
  select private.move_script_card(target_script_id, expected_version, destination);
$$;
revoke all on function public.move_script_card(uuid,bigint,text) from public, anon;
grant execute on function public.move_script_card(uuid,bigint,text) to authenticated;

create function private.create_board_script(organization uuid, title text, stage text, script_text text, kind text, source_text text, duration integer, input_mode public.script_input_mode)
returns uuid language plpgsql security definer set search_path = '' as $$
declare result_id uuid; version bigint;
begin
  if auth.uid() is null then raise exception 'سجّل الدخول أولًا'; end if;
  if stage is null or stage not in ('idea','draft','ready_to_record') or script_text is null then raise exception 'مرحلة البداية غير صحيحة'; end if;
  if stage = 'ready_to_record' and length(trim(script_text)) < 20 then raise exception 'أضف نص السكريبت قبل تجهيزه للتصوير'; end if;
  result_id := public.create_script_with_kind(auth.uid(), organization, auth.uid(), title, input_mode, null, source_text,
    coalesce(nullif(left(source_text,1000),''), title), 'متداولون عرب', 'instagram', duration, null, kind);
  select edit_version into version from public.scripts where id = result_id;
  if script_text <> '' then version := public.autosave_script_text(auth.uid(), result_id, version, script_text); end if;
  perform private.move_script_card(result_id, version, stage);
  return result_id;
end;
$$;
revoke all on function private.create_board_script(uuid,text,text,text,text,text,integer,public.script_input_mode) from public, anon, authenticated;
grant execute on function private.create_board_script(uuid,text,text,text,text,text,integer,public.script_input_mode) to authenticated;
create function public.create_board_script(organization uuid, title text, stage text, script_text text, kind text, source_text text, duration integer, input_mode public.script_input_mode)
returns uuid language sql security invoker set search_path = '' as $$
  select private.create_board_script(organization,title,stage,script_text,kind,source_text,duration,input_mode);
$$;
revoke all on function public.create_board_script(uuid,text,text,text,text,text,integer,public.script_input_mode) from public, anon;
grant execute on function public.create_board_script(uuid,text,text,text,text,text,integer,public.script_input_mode) to authenticated;

create table public.script_pages (
  id uuid primary key,
  script_id uuid not null references public.scripts(id) on delete cascade,
  parent_id uuid,
  title text not null check (length(trim(title)) between 1 and 180),
  body text not null default '' check (length(body) <= 30000),
  edit_version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id, script_id),
  foreign key(parent_id, script_id) references public.script_pages(id, script_id) on delete cascade,
  check (parent_id is distinct from id)
);
create index script_pages_script_idx on public.script_pages(script_id, created_at);
create index script_pages_parent_idx on public.script_pages(parent_id, script_id);
alter table public.script_pages enable row level security;
revoke all on public.script_pages from public, anon, authenticated;
grant select on public.script_pages to authenticated;
create policy script_pages_read on public.script_pages for select to authenticated
using (exists(select 1 from public.scripts s where s.id = script_pages.script_id));

-- Writes inherit writer/section permissions. Parent cannot change, preventing cycles.
-- The script row lock serializes page creation with handoff/archive/deletion.
create function private.save_script_page(target_script_id uuid, page_id uuid, parent_page_id uuid, page_title text, page_body text, expected_version bigint)
returns public.script_pages language plpgsql security definer set search_path = '' as $$
declare s public.scripts%rowtype; p public.script_pages%rowtype; ancestor uuid; depth integer := 0;
begin
  select * into s from public.scripts where id = target_script_id for update;
  if s.id is null or auth.uid() is null or not private.can_access_script_actor(auth.uid(), s.organization_id, s.assigned_to) then
    raise exception 'ليس لديك صلاحية تعديل صفحات هذا السكريبت';
  end if;
  if s.status in ('handed_off', 'archived') then raise exception 'السكريبت المؤرشف أو المرسل للتنفيذ للقراءة فقط'; end if;
  if page_id is null or expected_version is null or expected_version < 0 or page_title is null or length(trim(page_title)) not between 1 and 180 or page_body is null or length(page_body) > 30000 then
    raise exception 'راجع عنوان الصفحة والنص';
  end if;
  select * into p from public.script_pages where id = page_id for update;
  if p.id is not null then
    if p.script_id <> s.id or p.parent_id is distinct from parent_page_id then raise exception 'مرجع الصفحة غير صحيح'; end if;
    if expected_version = 0 and p.title = trim(page_title) and p.body = page_body then return p; end if;
    if p.edit_version <> expected_version then raise exception 'تغيّرت الصفحة؛ انسخ تعديلك وحدّثها قبل الحفظ'; end if;
    update public.script_pages set title = trim(page_title), body = page_body, edit_version = edit_version + 1, updated_at = now()
      where id = p.id returning * into p;
  else
    if expected_version <> 0 then raise exception 'الصفحة غير موجودة'; end if;
    ancestor := parent_page_id;
    while ancestor is not null loop
      depth := depth + 1;
      if depth > 10 then raise exception 'الحد الأقصى 10 مستويات للصفحات الداخلية'; end if;
      select parent_id into ancestor from public.script_pages where id = ancestor and script_id = s.id;
      if not found then raise exception 'الصفحة الأم غير موجودة في هذا السكريبت'; end if;
    end loop;
    insert into public.script_pages(id, script_id, parent_id, title, body) values(page_id, s.id, parent_page_id, trim(page_title), page_body) returning * into p;
  end if;
  insert into public.audit_events(organization_id, actor_id, action, entity_type, entity_id, after_data)
    values(s.organization_id, auth.uid(), 'script.page_saved', 'script', s.id, jsonb_build_object('page_id', p.id, 'page_version', p.edit_version));
  return p;
end;
$$;
revoke all on function private.save_script_page(uuid,uuid,uuid,text,text,bigint) from public, anon, authenticated;
grant execute on function private.save_script_page(uuid,uuid,uuid,text,text,bigint) to authenticated;
create function public.save_script_page(target_script_id uuid, page_id uuid, parent_page_id uuid, page_title text, page_body text, expected_version bigint)
returns public.script_pages language sql security invoker set search_path = '' as $$
  select private.save_script_page(target_script_id, page_id, parent_page_id, page_title, page_body, expected_version);
$$;
revoke all on function public.save_script_page(uuid,uuid,uuid,text,text,bigint) from public, anon;
grant execute on function public.save_script_page(uuid,uuid,uuid,text,text,bigint) to authenticated;
