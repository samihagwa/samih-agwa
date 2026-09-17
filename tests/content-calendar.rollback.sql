-- All fixtures, audit entries and tasks roll back; no real schedule is modified.
begin;
do $$
declare
 org uuid := (select organization_id from public.memberships where role='owner' and status='active' order by created_at limit 1);
 actor uuid := (select user_id from public.memberships where organization_id=org and role='owner' and status='active' limit 1);
 manager uuid := (select user_id from public.memberships where organization_id=org and role='manager' and status='active' and 'planning'=any(allowed_sections) order by user_id limit 1);
 cid uuid; tid uuid; pid uuid; draft_id uuid:=gen_random_uuid();
 original_time timestamptz := date_trunc('day',now())+interval '2 days 15 hours';
 changed_time timestamptz := date_trunc('day',now())+interval '3 days 17 hours';
 slot public.content_calendar_slots;
 before_task jsonb;
 before_count integer;
begin
 if org is null or actor is null then raise exception 'Owner fixture unavailable'; end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 insert into public.content_items(organization_id,title,format,goal,hook,cta,platforms,status,publish_at,created_by)
 values(org,'Calendar isolated rollback test','reel','فحص تقويم النشر بدون حفظ','اختبار معزول بالكامل','اختبار',array['instagram','facebook'],'production',original_time,actor) returning id into cid;
 insert into public.tasks(organization_id,title,status,owner_id,created_by,acceptance_criteria,due_at,content_item_id,is_work_item,content_step)
 values(org,'Calendar isolated task','ready',coalesce(manager,actor),actor,'لن تبقى المهمة بعد الاختبار',original_time-interval '1 day',cid,true,'editing') returning id into tid;
 select to_jsonb(t) into before_task from public.tasks t where id=tid;
 execute 'set local role authenticated';
 select * into slot from public.move_content_calendar_slot('content',cid,'instagram',changed_time,0,original_time);
 if slot.revision<>1 or slot.scheduled_at<>changed_time then raise exception 'Move failed'; end if;
 if (select scheduled_at from public.content_calendar_slots where content_item_id=cid and platform='facebook')<>original_time then raise exception 'Sibling schedule changed'; end if;
 if (select to_jsonb(t) from public.tasks t where id=tid) is distinct from before_task then raise exception 'Task changed'; end if;
 begin
   perform public.move_content_calendar_slot('content',cid,'instagram',original_time,0,original_time);
   raise exception 'Stale write allowed';
 exception when others then if sqlerrm<>'Calendar revision changed; refresh and retry' then raise; end if; end;
 select * into slot from public.move_content_calendar_slot('content',cid,'instagram',original_time,1,changed_time);
 if slot.revision<>2 then raise exception 'Undo failed'; end if;
 select * into slot from public.move_content_calendar_slot('content',cid,'instagram',null,2,original_time);
 if slot.scheduled_at is not null then raise exception 'Unscheduled failed'; end if;
 select * into slot from public.move_content_calendar_slot('content',cid,'instagram',changed_time,3,null);
 if slot.revision<>4 then raise exception 'Reschedule unscheduled failed'; end if;
 begin
   update public.content_calendar_slots set revision=90 where content_item_id=cid;
   raise exception 'Direct update allowed';
 exception when insufficient_privilege then null; end;
 begin
   delete from public.content_calendar_slots where content_item_id=cid;
   raise exception 'Direct delete allowed';
 exception when insufficient_privilege then null; end;
 begin
   insert into public.content_calendar_slots(organization_id,content_item_id,platform) values(org,cid,'x');
   raise exception 'Direct insert allowed';
 exception when insufficient_privilege then null; end;
 begin
   perform public.move_content_calendar_slot('content',cid,'unknown',changed_time,0,original_time);
   raise exception 'Unknown platform allowed';
 exception when others then if sqlerrm<>'Calendar platform unavailable' then raise; end if; end;
 if manager is not null then
   perform set_config('request.jwt.claim.sub',manager::text,true);
   select * into slot from public.move_content_calendar_slot('content',cid,'facebook',changed_time+interval '1 hour',0,original_time);
   if slot.revision<>1 then raise exception 'Manager schedule permission failed'; end if;
 end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 if exists(select 1 from public.content_calendar_slots where content_item_id=cid) then raise exception 'Outsider RLS leak'; end if;
 begin
   perform public.move_content_calendar_slot('content',cid,'instagram',original_time,4,changed_time);
   raise exception 'Outsider move allowed';
 exception when others then if sqlerrm not in ('Calendar permission denied','Calendar access denied') then raise; end if; end;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 select count(*) into before_count from public.tasks where organization_id=org;
 select public.create_calendar_draft(org,draft_id,'اختبار فكرة تقويم','social_post','فكرة للتقويم دون أي مهام',array['instagram','facebook'],original_time,null) into pid;
 if public.create_calendar_draft(org,draft_id,'اختبار فكرة تقويم','social_post','فكرة للتقويم دون أي مهام',array['instagram','facebook'],original_time,null)<>pid then raise exception 'Idempotency failed'; end if;
 if (select count(*) from public.tasks where organization_id=org)<>before_count then raise exception 'Draft created tasks'; end if;
 select * into slot from public.move_content_calendar_slot('plan',pid,'facebook',changed_time,0,original_time);
 if slot.scheduled_at<>changed_time then raise exception 'Plan move failed'; end if;
 begin
   perform public.move_content_calendar_slot('plan',pid,'facebook',original_time+interval '1 year',1,changed_time);
   raise exception 'Out of plan move allowed';
 exception when others then if sqlerrm<>'Calendar time outside plan period' then raise; end if; end;
 -- Linking retains appointment rows; explicit content appointments win.
 update public.content_plan_items set content_item_id=cid where id=pid;
 if (select scheduled_at from public.content_calendar_slots where content_item_id=cid and platform='instagram')<>changed_time then raise exception 'Link overwrote canonical appointment'; end if;
 begin
   perform public.move_content_calendar_slot('plan',pid,'facebook',original_time,1,changed_time);
   raise exception 'Linked source moved separately';
 exception when others then if sqlerrm<>'Calendar source changed; refresh' then raise; end if; end;
 execute 'reset role';
 if not exists(select 1 from public.audit_events where organization_id=org and action='content.calendar_rescheduled' and entity_id=slot.id) then raise exception 'Missing audit'; end if;
 -- The role really is read-only even if its section grant includes planning.
 if manager is not null then
   perform set_config('request.jwt.claim.sub',actor::text,true);
   update public.tasks set owner_id=actor where id=tid;
   update public.memberships set role='viewer' where organization_id=org and user_id=manager;
   perform set_config('request.jwt.claim.sub',manager::text,true);
   execute 'set local role authenticated';
   begin
     perform public.move_content_calendar_slot('content',cid,'instagram',original_time,4,changed_time);
     raise exception 'Viewer moved schedule';
   exception when others then if sqlerrm<>'Calendar permission denied' then raise; end if; end;
   execute 'reset role';
 end if;
end; $$;
select 'PASS: platform isolation, undo, unscheduled, CAS, task preservation, CRUD denied, outsider RLS, manager/viewer roles, draft idempotency, plan bounds, link preservation, audit. Rolled back.' as result;
rollback;
