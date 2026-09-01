begin;

do $$
declare
  request_function text;
  task_guard_function text;
  completion_function text;
  approval_guard_function text;
  change_function text;
  notification_function text;
  shared_task_read_function text;
  one_open_revision_index boolean;
  completion_trigger_exists boolean;
  service_only_commands boolean;
  content_rls_is_preserved boolean;
  task_scoped_read_policies boolean;
  shared_task_select_only boolean;
begin
  select pg_get_functiondef(
    'public.request_content_revision(uuid,uuid,public.content_step,text)'::regprocedure
  ) into request_function;
  select pg_get_functiondef('private.enforce_task_rules()'::regprocedure)
  into task_guard_function;
  select pg_get_functiondef(
    'private.resolve_content_revision_on_task_completion()'::regprocedure
  ) into completion_function;
  select pg_get_functiondef('private.guard_content_approval_revisions()'::regprocedure)
  into approval_guard_function;
  select pg_get_functiondef(
    'public.change_content_revision(uuid,uuid,text)'::regprocedure
  ) into change_function;
  select pg_get_functiondef('private.notify_content_revision()'::regprocedure)
  into notification_function;
  select pg_get_functiondef(
    'private.can_read_shared_content_task_actor(uuid,uuid,uuid)'::regprocedure
  ) into shared_task_read_function;

  if request_function not like '%clean_instructions is null%'
    or request_function not like '%for update%'
    or request_function not like '%revision.status in (''requested'', ''in_progress'')%'
    or request_function not like '%task_record.status not in (''review'', ''done'')%'
    or request_function not like '%app.content_revision_request_id%'
  then
    raise exception 'Content revision creation is not validated, locked, or retry-safe';
  end if;

  if task_guard_function not like '%public.content_revision_requests%'
    or task_guard_function not like '%app.content_revision_request_id%'
    or task_guard_function not like '%revision.content_item_id = old.content_item_id%'
    or task_guard_function not like '%revision.stage = old.content_step%'
    or task_guard_function not like '%revision.assigned_to = old.owner_id%'
    or task_guard_function not like '%revision.status = ''in_progress''%'
  then
    raise exception 'The task guard does not authenticate content-revision reopen commands';
  end if;

  if completion_function not like '%delivery.submitted_at >= revision.requested_at%'
    or completion_function not like '%revision.status in (''requested'', ''in_progress'')%'
  then
    raise exception 'A stale task completion could resolve a newer content revision';
  end if;

  if approval_guard_function not like '%revision.task_id <> new.id%'
    or approval_guard_function not like '%revision.status in (''requested'', ''in_progress'')%'
  then
    raise exception 'A publishing revision can deadlock its own completion';
  end if;

  if change_function not like '%membership.status = ''active''%'
    or change_function not like '%membership.role <> ''viewer''%'
    or change_function not like '%delivery.submitted_at >= revision_record.requested_at%'
    or change_function like '%UPDATE public.tasks%'
  then
    raise exception 'Legacy revision actions are unsafe or can replay task completion';
  end if;

  if notification_function not like '%''task''%'
    or notification_function not like '%''/tasks/'' || new.task_id%'
    or notification_function not like '%''revision:'' || new.id || '':requested:user:''%'
  then
    raise exception 'Revision notifications are not exact-task and dedupe scoped';
  end if;

  if shared_task_read_function not like '%target_task.content_item_id is not null%'
    or shared_task_read_function not like '%target_user_id = (select auth.uid())%'
    or shared_task_read_function not like '%target_task.is_work_item%'
    or shared_task_read_function not like '%participant_task.owner_id = target_user_id%'
    or shared_task_read_function not like '%participant_task.is_work_item%'
    or shared_task_read_function not like '%participant_task.status <> ''cancelled''%'
  then
    raise exception 'Shared content-card task reading is not participant scoped';
  end if;

  select exists (
    select 1
    from pg_index index_record
    join pg_class index_class on index_class.oid = index_record.indexrelid
    where index_class.relname = 'content_revision_requests_one_open_per_task_idx'
      and index_record.indrelid = 'public.content_revision_requests'::regclass
      and index_record.indisunique
      and pg_get_expr(index_record.indpred, index_record.indrelid) like '%requested%'
      and pg_get_expr(index_record.indpred, index_record.indrelid) like '%in_progress%'
  ) into one_open_revision_index;
  if not one_open_revision_index then
    raise exception 'One-open-content-revision-per-task is not uniquely enforced';
  end if;

  select exists (
    select 1
    from pg_trigger trigger_record
    where trigger_record.tgrelid = 'public.tasks'::regclass
      and trigger_record.tgname = 'tasks_resolve_content_revision_on_completion'
      and not trigger_record.tgisinternal
  ) into completion_trigger_exists;
  if not completion_trigger_exists then
    raise exception 'Content revisions are not closed by the delivery completion transition';
  end if;

  select has_function_privilege(
      'service_role',
      'public.request_content_revision(uuid,uuid,public.content_step,text)',
      'EXECUTE'
    )
    and has_function_privilege(
      'service_role',
      'public.change_content_revision(uuid,uuid,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'public.request_content_revision(uuid,uuid,public.content_step,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'public.change_content_revision(uuid,uuid,text)',
      'EXECUTE'
    )
  into service_only_commands;
  if not service_only_commands then
    raise exception 'Revision commands must stay behind the authenticated Edge command';
  end if;

  select bool_and(table_record.relrowsecurity)
  from pg_class table_record
  where table_record.oid in (
    'public.content_items'::regclass,
    'public.content_revision_requests'::regclass
  ) into content_rls_is_preserved;
  if not content_rls_is_preserved then
    raise exception 'Content RLS was disabled';
  end if;

  select count(*) = 2
  from pg_policies policy
  where policy.schemaname = 'public'
    and (
      (policy.tablename = 'content_items'
        and policy.policyname = 'section_scope_content_items')
      or (policy.tablename = 'content_revision_requests'
        and policy.policyname = 'section_scope_content_revisions')
    )
    and policy.permissive = 'RESTRICTIVE'
    and policy.qual like '%tasks%'
  into task_scoped_read_policies;
  if not task_scoped_read_policies then
    raise exception 'Task-only participants cannot safely read their linked content revision';
  end if;

  select exists (
      select 1
      from pg_policies policy
      where policy.schemaname = 'public'
        and policy.tablename = 'tasks'
        and policy.policyname = 'tasks_select_involved_members'
        and policy.cmd = 'SELECT'
        and policy.qual like '%can_read_task_actor%'
        and policy.qual like '%can_read_shared_content_task_actor%'
    )
    and not exists (
      select 1
      from pg_policies policy
      where policy.schemaname = 'public'
        and policy.tablename = 'tasks'
        and policy.cmd = 'UPDATE'
        and (
          coalesce(policy.qual, '') like '%can_read_shared_content_task_actor%'
          or coalesce(policy.with_check, '') like '%can_read_shared_content_task_actor%'
        )
    )
  into shared_task_select_only;
  if not shared_task_select_only then
    raise exception 'Shared content-card visibility leaked into task execution policy';
  end if;
end;
$$;

rollback;
