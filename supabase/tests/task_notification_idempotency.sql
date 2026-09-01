begin;

do $$
declare
  notification_function text;
  revision_function text;
  completion_cycle_function text;
  notification_dedupe_unique boolean;
  telegram_outbox_primary_key boolean;
begin
  select pg_get_functiondef('private.notify_task_change()'::regprocedure)
  into notification_function;
  select pg_get_functiondef(
    'public.change_content_revision(uuid,uuid,text)'::regprocedure
  ) into revision_function;
  select pg_get_functiondef(
    'private.task_completion_notification_cycle(uuid)'::regprocedure
  ) into completion_cycle_function;

  if notification_function not like '%new.status is distinct from old.status%'
    or notification_function not like '%new.status = ''done''%'
    or notification_function not like '%:done:cycle:%'
    or notification_function not like '%app.content_revision_request_id%'
    or notification_function not like '%not is_content_revision_reopen%'
  then
    raise exception 'Task completion notifications are not transition- and cycle-scoped';
  end if;
  if notification_function like '%:done:v%'
    or notification_function like '%:approved:v%' then
    raise exception 'Task completion notifications still depend on mutable task versions';
  end if;

  if completion_cycle_function not like '%content-revision:%'
    or completion_cycle_function not like '%task-revision:%'
    or completion_cycle_function not like '%union all%'
    or completion_cycle_function not like '%order by cycle.requested_at desc%'
    or completion_cycle_function not like '%initial%' then
    raise exception 'Completion-cycle identity does not cover initial and revision work';
  end if;

  if revision_function not like '%revision_record.status = ''resolved''%'
    or revision_function not like '%return true;%'
    or revision_function like '%update public.tasks%'
  then
    raise exception 'Content revision retries can still replay task completion';
  end if;

  select exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'public.notifications'::regclass
      and constraint_record.contype = 'u'
      and pg_get_constraintdef(constraint_record.oid)
        like 'UNIQUE (dedupe_key)%'
  ) into notification_dedupe_unique;
  if not notification_dedupe_unique then
    raise exception 'Notification dedupe key is not uniquely enforced';
  end if;

  select exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.conrelid =
      'private.telegram_notification_outbox'::regclass
      and constraint_record.contype = 'p'
      and pg_get_constraintdef(constraint_record.oid)
        like 'PRIMARY KEY (notification_id)%'
  ) into telegram_outbox_primary_key;
  if not telegram_outbox_primary_key then
    raise exception 'Telegram outbox is not idempotent by notification id';
  end if;
end;
$$;

rollback;
