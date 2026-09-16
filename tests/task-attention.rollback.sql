-- Integration-only, explicit transaction; never commit test tasks or notifications.
begin;
create temp table attention_test_results (result text);
do $$
declare
 org uuid := (select organization_id from public.memberships where role='owner' and status='active' order by created_at limit 1);
 requester uuid := (select user_id from public.memberships where organization_id=org and role='owner' and status='active' limit 1);
 assignee uuid := (select user_id from public.memberships where organization_id=org and role='manager' and status='active' order by user_id limit 1);
 other_member uuid := (select user_id from public.memberships where organization_id=org and role='manager' and status='active' and user_id<>assignee order by user_id limit 1);
 tid uuid;
 a public.task_attention;
 initial_task jsonb;
begin
 if org is null or requester is null or assignee is null or other_member is null then raise exception 'Fixture requires owner and two managers'; end if;
 perform set_config('request.jwt.claim.sub',requester::text,true);
 insert into public.tasks(organization_id,title,status,owner_id,created_by,acceptance_criteria,due_at)
 values(org,'اختبار معزول — سيتم التراجع', 'ready',assignee,requester,'اختبار دون حفظ أي بيانات',now()+interval '2 days') returning id into tid;
 select to_jsonb(t) into initial_task from public.tasks t where id=tid;
 -- Check permissions really apply to the role used by PostgREST.
 execute 'set local role authenticated';
 select * into a from public.change_task_attention(tid,'urgent',0,'مطلوب للتسليم اليوم');
 if a.revision <> 1 or a.urgency->>'sent_by' <> requester::text then raise exception 'urgent assertion'; end if;
 begin
   perform public.change_task_attention(tid,'urgent',0);
   raise exception 'stale request was allowed';
 exception when others then if sqlerrm <> 'Attention changed; refresh and retry' then raise; end if; end;
 begin
   perform public.change_task_attention(tid,'urgent',1);
   raise exception 'cooldown was bypassed';
 exception when others then if sqlerrm <> 'Attention cooldown; wait 15 minutes' then raise; end if; end;
 begin
   update public.task_attention set revision=100 where task_id=tid;
   raise exception 'direct write was allowed';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub',other_member::text,true);
 begin
   perform public.change_task_attention(tid,'urgent',1);
   raise exception 'wrong requester allowed';
 exception when others then if sqlerrm not in ('Only the task requester can send urgency','Attention access denied') then raise; end if; end;
 begin
   perform public.change_task_attention(tid,'acknowledge',1);
   raise exception 'wrong assignee allowed';
 exception when others then if sqlerrm not in ('Only the assignee can respond to attention','Attention access denied') then raise; end if; end;
 perform set_config('request.jwt.claim.sub',assignee::text,true);
 begin
   perform public.change_task_attention(tid,'acknowledge',1,null,null,now()-interval '1 minute');
   raise exception 'past eta allowed';
 exception when others then if sqlerrm <> 'Attention expected time must be in the future' then raise; end if; end;
 select * into a from public.change_task_attention(tid,'acknowledge',1,null,null,now()+interval '1 hour');
 if a.revision <> 2 or a.urgency->>'acknowledged_by' <> assignee::text then raise exception 'ack assertion'; end if;
 select * into a from public.change_task_attention(tid,'acknowledge',2);
 if a.revision <> 2 then raise exception 'duplicate ack mutated'; end if;
 begin
   perform public.change_task_attention(tid,'help',2,'','materials');
   raise exception 'empty blocker allowed';
 exception when others then if sqlerrm <> 'Attention help requires reason and details' then raise; end if; end;
 select * into a from public.change_task_attention(tid,'help',2,'محتاج لينك المادة الخام','materials');
 if a.revision <> 3 or a.blocker->>'reason' <> 'materials' then raise exception 'help assertion'; end if;
 begin
   perform public.change_task_attention(tid,'help',3,'تكرار غير مسموح','other');
   raise exception 'duplicate blocker allowed';
 exception when others then if sqlerrm <> 'Attention help already open' then raise; end if; end;
 select * into a from public.change_task_attention(tid,'resolve_help',3);
 if a.revision <> 4 or a.blocker->>'resolved_by' <> assignee::text then raise exception 'resolve assertion'; end if;
 select * into a from public.change_task_attention(tid,'resolve_help',4);
 if a.revision <> 4 then raise exception 'duplicate resolution mutated'; end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 if exists(select 1 from public.task_attention where task_id=tid) then raise exception 'RLS outsider leaked'; end if;
 begin
   perform public.change_task_attention(tid,'urgent',4);
   raise exception 'outsider allowed';
 exception when others then if sqlerrm <> 'Attention access denied' then raise; end if; end;
 execute 'reset role';
 if (select to_jsonb(t) from public.tasks t where id=tid) <> initial_task then raise exception 'task state or deadline changed'; end if;
 if (select count(*) from public.notifications where entity_id=tid and kind in ('task_urgent','task_urgent_acknowledged','task_help_requested','task_help_resolved')) <> 4 then raise exception 'notification duplication'; end if;
 if (select count(*) from public.audit_events where entity_id=tid and action like 'task.attention.%') <> 4 then raise exception 'audit mismatch'; end if;
 if has_function_privilege('anon','public.change_task_attention(uuid,text,integer,text,text,timestamp with time zone)','execute') then raise exception 'anon execution allowed'; end if;
 insert into attention_test_results values('PASS: authenticated requester/assignee flow; incorrect actors; outsider RLS; anonymous denial; direct write denied; stale revisions; cooldown; ETA validation; blocker validation; idempotent acknowledgements/resolution; exactly 4 notifications/audits; task and deadline unchanged');
end $$;
select * from attention_test_results;
rollback;
