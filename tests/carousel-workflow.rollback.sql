begin;
set local role service_role;
do $$
declare org uuid; actor uuid; cid uuid; yt uuid; design uuid; publish uuid; delivery uuid; task_version bigint; stored_version bigint; retry_key uuid:=gen_random_uuid(); due timestamptz:=now()+interval '7 days'; source_request text:='الصفحة الأولى: المقدمة. الصفحة الثانية: الشرح. الصفحة الثالثة: الخاتمة.';
begin
 select organization_id,user_id into org,actor from public.memberships where role='owner' and status='active' limit 1;
 if actor is null then raise exception 'Missing fixture owner'; end if;
 cid:=public.create_content_request_workflow(actor,org,retry_key,'اختبار كاروسيل معزول',source_request,due,'[]',actor,actor,actor,'{}','carousel',array['instagram','facebook']);
 if public.create_content_request_workflow(actor,org,retry_key,'اختبار كاروسيل معزول',source_request,due,'[]',actor,actor,actor,'{}','carousel',array['instagram','facebook'])<>cid then raise exception 'Intake retry duplicate'; end if;
 if (select count(*) from public.tasks where content_item_id=cid)<>2 then raise exception 'Carousel task count'; end if;
 if exists(select 1 from public.tasks where content_item_id=cid and content_step not in ('design','publishing')) then raise exception 'Unwanted carousel tasks'; end if;
 if (select intake_request from public.content_items where id=cid)<>source_request then raise exception 'Request text lost'; end if;
 select id into design from public.tasks where content_item_id=cid and content_step='design' and status='ready';
 select id into publish from public.tasks where content_item_id=cid and content_step='publishing' and status='backlog';
 if design is null or publish is null then raise exception 'Initial task state'; end if;
 update public.tasks set status='in_progress' where id=design;
 select version into task_version from public.tasks where id=design;
 begin
  perform public.submit_content_step_delivery(actor,design,'تجربة','https://example.com/one.png');
  raise exception 'Legacy bypass accepted';
 exception when others then if sqlerrm<>'Carousel requires ordered image links' then raise; end if; end;
 begin
  perform public.submit_carousel_delivery(actor,design,'تجربة','["https://example.com/one.png"]',task_version,null);
  raise exception 'Single image accepted';
 exception when others then if sqlerrm<>'Carousel needs 2 to 30 images' then raise; end if; end;
 delivery:=public.submit_carousel_delivery(actor,design,'تسليم معزول','["https://example.com/one.png","https://example.com/two.png"]',task_version,null);
 if (select status from public.tasks where id=design)<>'done' then raise exception 'Design not done'; end if;
 if (select status from public.tasks where id=publish)<>'ready' then raise exception 'Publishing not unlocked'; end if;
 if (select result_images->>1 from public.content_step_deliveries where id=delivery)<>'https://example.com/two.png' then raise exception 'Image order lost'; end if;
 select version into stored_version from public.content_step_deliveries where id=delivery;
 begin
  perform public.submit_carousel_delivery(actor,design,'تجربة','["https://example.com/two.png","https://example.com/one.png"]',task_version,null);
  raise exception 'Stale delivery accepted';
 exception when others then if sqlerrm<>'Task or delivery changed; refresh' then raise; end if; end;
 select version into task_version from public.tasks where id=design;
 perform public.submit_carousel_delivery(actor,design,'إعادة ترتيب','["https://example.com/two.png","https://example.com/one.png"]',task_version,stored_version);
 if (select result_images->>0 from public.content_step_deliveries where id=delivery)<>'https://example.com/two.png' then raise exception 'Reorder lost'; end if;
 begin
  perform public.submit_carousel_delivery(gen_random_uuid(),design,'تجربة','["https://example.com/one.png","https://example.com/two.png"]',task_version,stored_version);
  raise exception 'Wrong owner accepted';
 exception when others then if sqlerrm<>'Carousel delivery permission denied' then raise; end if; end;
 yt:=public.create_content_request_workflow(actor,org,gen_random_uuid(),'اختبار يوتيوب معزول',source_request,due,'[{"kind":"raw_video","url":"https://example.com/raw.mp4"}]',actor,actor,actor,'{}','long_video',array['youtube']);
 if (select format from public.content_items where id=yt)<>'long_video' or (select platforms from public.content_items where id=yt)<>array['youtube'] then raise exception 'YouTube type lost'; end if;
 if (select count(*) from public.tasks where content_item_id=yt)<>3 then raise exception 'YouTube task count'; end if;
 if has_function_privilege('authenticated','public.create_content_request_workflow(uuid,uuid,uuid,text,text,timestamptz,jsonb,uuid,uuid,uuid,uuid[],public.content_format,text[])','execute') then raise exception 'Unsafe direct intake grant'; end if;
 if has_function_privilege('anon','public.submit_carousel_delivery(uuid,uuid,text,jsonb,bigint,bigint)','execute') then raise exception 'Unsafe anonymous grant'; end if;
end; $$;
select 'PASS carousel intake, no video tasks, retry, ordered images, legacy bypass denial, CAS, owner checks, completion and publishing unlock, YouTube; rolled back' result;
rollback;
