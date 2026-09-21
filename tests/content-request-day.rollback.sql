-- Explicit rollback: no test content, tasks, audit events, or outbox is committed.
begin;
set local role service_role;
do $$
declare
  org uuid; actor uuid; cid uuid; key uuid; kind public.content_format;
  today date := (now() at time zone 'Africa/Cairo')::date;
  morning timestamptz := today::timestamp at time zone 'Africa/Cairo';
  end_of_day timestamptz := ((today+1)::timestamp at time zone 'Africa/Cairo') - interval '1 microsecond';
  expected_count integer;
begin
  select organization_id,user_id into org,actor from public.memberships where role='owner' and status='active' limit 1;
  if actor is null then raise exception 'Missing fixture owner'; end if;
  foreach kind in array array['carousel','long_video']::public.content_format[] loop
    key:=gen_random_uuid();
    cid:=public.create_content_request_workflow(actor,org,key,'اختبار يوم النشر المعزول','تفاصيل اختبار معزول بالكامل ولا يتم حفظه.',morning,
      '[{"kind":"raw_video","url":"https://example.com/raw.mp4"}]',actor,actor,actor,'{}',kind,array['instagram']);
    if (select publish_at from public.content_items where id=cid) is distinct from end_of_day then raise exception 'Selected Cairo day not preserved'; end if;
    if exists(select 1 from public.tasks where content_item_id=cid and (due_at < now() or due_at > end_of_day)) then raise exception 'Tasks outside selected day'; end if;
    expected_count:=case when kind='carousel' then 2 else 3 end;
    if (select count(*) from public.tasks where content_item_id=cid) <> expected_count then raise exception 'Wrong task count'; end if;
    -- Retry with expired input still returns the already-created request.
    if public.create_content_request_workflow(actor,org,key,'اختبار يوم النشر المعزول','تفاصيل اختبار معزول بالكامل ولا يتم حفظه.',morning-interval '2 days',
      '[{"kind":"raw_video","url":"https://example.com/raw.mp4"}]',actor,actor,actor,'{}',kind,array['instagram']) <> cid then raise exception 'Retry duplicated content'; end if;
    begin
      perform public.create_content_request_workflow(actor,org,gen_random_uuid(),'اختبار يوم النشر المعزول','تفاصيل اختبار معزول بالكامل ولا يتم حفظه.',morning-interval '1 day',
        '[{"kind":"raw_video","url":"https://example.com/raw.mp4"}]',actor,actor,actor,'{}',kind,array['instagram']);
      raise exception 'Past day accepted';
    exception when sqlstate '22007' then
      if sqlerrm <> 'اختر يوم النشر الحالي أو يومًا قادمًا بتوقيت القاهرة.' then raise; end if;
    end;
  end loop;
  if has_function_privilege('authenticated','public.create_content_request_workflow(uuid,uuid,uuid,text,text,timestamptz,jsonb,uuid,uuid,uuid,uuid[],public.content_format,text[])','execute') then raise exception 'Direct intake permission broadened'; end if;
end;
$$;
select 'PASS: today, past-day rejection, Arabic error, selected-day task deadlines, retry idempotency, grants. All rolled back.' result;
rollback;
