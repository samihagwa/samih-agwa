begin;

do $fixture$
declare
  target_organization_id uuid;
  requester_id uuid;
  assignee_id uuid;
  content_id uuid;
  review_task_id uuid;
  sibling_task_id uuid;
  revision_id uuid;
  replay_revision_id uuid;
  notification_marker bigint;
  generated_notification_count bigint;
  revision_notification_count bigint;
  returned_notification_count bigint;
  telegram_outbox_count bigint;
  telegram_is_linked boolean;
begin
  select owner_membership.organization_id,
    owner_membership.user_id,
    assignee_membership.user_id
  into target_organization_id, requester_id, assignee_id
  from public.memberships owner_membership
  join public.memberships assignee_membership
    on assignee_membership.organization_id = owner_membership.organization_id
   and assignee_membership.status = 'active'
   and assignee_membership.role not in ('owner', 'admin', 'viewer')
   and 'tasks' = any(assignee_membership.allowed_sections)
  left join public.publishing_admin_connections connection
    on connection.user_id = assignee_membership.user_id
   and connection.organization_id = assignee_membership.organization_id
  where owner_membership.status = 'active'
    and owner_membership.role = 'owner'
  order by (
      connection.telegram_chat_id is not null
      and connection.workflow_notifications_enabled
    ) desc nulls last,
    owner_membership.created_at,
    assignee_membership.created_at
  limit 1;

  if target_organization_id is null then
    perform set_config('app.skip_content_revision_functional_test', 'true', true);
    raise notice 'Skipping content revision functional test: no owner/member fixture';
    return;
  end if;

  perform set_config('request.jwt.claim.sub', requester_id::text, true);

  insert into public.content_items (
    organization_id, title, goal, hook, cta, publish_at, created_by
  ) values (
    target_organization_id,
    'Functional test: one content revision notification',
    'Temporary rollback-only database verification',
    'Temporary hook',
    'No publication',
    now() + interval '7 days',
    requester_id
  ) returning id into content_id;

  insert into public.tasks (
    organization_id, title, description, status, owner_id, created_by,
    due_at, content_item_id, content_step, is_work_item, requires_review
  ) values (
    target_organization_id,
    'Functional review-stage recording task',
    'Rollback-only fixture',
    'ready',
    assignee_id,
    requester_id,
    now() + interval '3 days',
    content_id,
    'recording',
    true,
    true
  ) returning id into review_task_id;

  insert into public.tasks (
    organization_id, title, description, status, owner_id, created_by,
    due_at, content_item_id, content_step, is_work_item, requires_review
  ) values (
    target_organization_id,
    'Functional sibling thumbnail task',
    'Rollback-only fixture',
    'ready',
    requester_id,
    requester_id,
    now() + interval '4 days',
    content_id,
    'thumbnail',
    true,
    false
  ) returning id into sibling_task_id;

  perform set_config('request.jwt.claim.sub', assignee_id::text, true);
  update public.tasks task
  set status = 'in_progress'
  where task.id = review_task_id;

  insert into public.content_step_deliveries (
    organization_id, content_item_id, task_id, step,
    result_note, result_url, submitted_by
  ) values (
    target_organization_id,
    content_id,
    review_task_id,
    'recording',
    'Rollback-only review delivery',
    'https://example.com/rollback-only-raw-material',
    assignee_id
  );

  update public.tasks task
  set status = 'review'
  where task.id = review_task_id;

  select coalesce(max(notification.id), 0)
  into notification_marker
  from public.notifications notification;

  revision_id := public.request_content_revision(
    requester_id,
    content_id,
    'recording'::public.content_step,
    'Apply the written changes and submit a fresh delivery'
  );
  replay_revision_id := public.request_content_revision(
    requester_id,
    content_id,
    'recording'::public.content_step,
    'Apply the written changes and submit a fresh delivery'
  );
  if replay_revision_id is distinct from revision_id then
    raise exception 'Revision retry created a second open request';
  end if;

  select count(*),
    count(*) filter (where notification.kind = 'revision_requested'),
    count(*) filter (where notification.kind = 'task_ready')
  into generated_notification_count,
    revision_notification_count,
    returned_notification_count
  from public.notifications notification
  where notification.id > notification_marker
    and notification.user_id = assignee_id
    and notification.entity_type = 'task'
    and notification.entity_id = review_task_id
    and notification.kind in ('revision_requested', 'task_ready');

  if generated_notification_count <> 1
    or revision_notification_count <> 1
    or returned_notification_count <> 0 then
    raise exception 'Content revision produced duplicate in-app notifications';
  end if;

  select count(*)
  into telegram_outbox_count
  from private.telegram_notification_outbox outbox
  join public.notifications notification
    on notification.id = outbox.notification_id
  where notification.id > notification_marker
    and notification.user_id = assignee_id
    and notification.entity_type = 'task'
    and notification.entity_id = review_task_id
    and notification.kind in ('revision_requested', 'task_ready');

  select exists (
    select 1
    from public.publishing_admin_connections connection
    where connection.organization_id = target_organization_id
      and connection.user_id = assignee_id
      and connection.telegram_chat_id is not null
      and connection.workflow_notifications_enabled
  ) into telegram_is_linked;

  if telegram_outbox_count > 1
    or (telegram_is_linked and telegram_outbox_count <> 1) then
    raise exception 'Content revision produced an invalid Telegram outbox count';
  end if;

  perform set_config('app.content_revision_request_id', '', true);
  perform set_config('app.test_content_id', content_id::text, true);
  perform set_config('app.test_sibling_task_id', sibling_task_id::text, true);
  perform set_config('app.test_assignee_id', assignee_id::text, true);
  perform set_config('app.test_requester_id', requester_id::text, true);
  perform set_config('app.test_organization_id', target_organization_id::text, true);
end;
$fixture$;

do $standalone$
declare
  target_organization_id uuid;
  requester_id uuid;
  assignee_id uuid;
  standalone_task_id uuid;
  started_task_version bigint;
  current_task_version bigint;
  notification_marker bigint;
  generated_notification_count bigint;
  revision_notification_count bigint;
  returned_notification_count bigint;
begin
  if current_setting('app.skip_content_revision_functional_test', true) = 'true' then
    return;
  end if;

  target_organization_id := current_setting('app.test_organization_id')::uuid;
  requester_id := current_setting('app.test_requester_id')::uuid;
  assignee_id := current_setting('app.test_assignee_id')::uuid;
  perform set_config('request.jwt.claim.sub', requester_id::text, true);

  insert into public.tasks (
    organization_id, title, description, status, owner_id, created_by,
    due_at, is_work_item, requires_review
  ) values (
    target_organization_id,
    'Functional standalone task revision',
    'Rollback-only fixture',
    'ready',
    assignee_id,
    requester_id,
    now() + interval '3 days',
    true,
    true
  ) returning id into standalone_task_id;

  perform set_config('request.jwt.claim.sub', assignee_id::text, true);
  update public.tasks task
  set status = 'in_progress'
  where task.id = standalone_task_id;
  select task.version into started_task_version
  from public.tasks task
  where task.id = standalone_task_id;
  perform public.submit_task_delivery(
    standalone_task_id,
    'Rollback-only standalone delivery',
    'https://example.com/rollback-only-standalone-delivery',
    started_task_version,
    null
  );

  select task.version into current_task_version
  from public.tasks task
  where task.id = standalone_task_id;
  select coalesce(max(notification.id), 0)
  into notification_marker
  from public.notifications notification;

  perform set_config('request.jwt.claim.sub', requester_id::text, true);
  insert into public.task_revision_requests (
    task_id, instructions, task_version
  ) values (
    standalone_task_id,
    'Standalone written revision must keep its one useful notification',
    current_task_version
  );

  select count(*),
    count(*) filter (where notification.kind = 'revision_requested'),
    count(*) filter (where notification.kind = 'task_ready')
  into generated_notification_count,
    revision_notification_count,
    returned_notification_count
  from public.notifications notification
  where notification.id > notification_marker
    and notification.user_id = assignee_id
    and notification.entity_type = 'task'
    and notification.entity_id = standalone_task_id
    and notification.kind in ('revision_requested', 'task_ready');

  if generated_notification_count <> 1
    or revision_notification_count <> 1
    or returned_notification_count <> 0 then
    raise exception 'Standalone task revision notification behavior changed';
  end if;
end;
$standalone$;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  nullif(current_setting('app.test_assignee_id', true), ''),
  true
)
where current_setting('app.skip_content_revision_functional_test', true)
  is distinct from 'true';

do $rls$
declare
  visible_task_count bigint;
  unauthorized_update_count bigint;
begin
  if current_setting('app.skip_content_revision_functional_test', true) = 'true' then
    return;
  end if;

  select count(*)
  into visible_task_count
  from public.tasks task
  where task.content_item_id = current_setting('app.test_content_id')::uuid;
  if visible_task_count <> 2 then
    raise exception 'Workflow participant cannot read the complete shared task card';
  end if;

  with changed as (
    update public.tasks task
    set status = 'in_progress'
    where task.id = current_setting('app.test_sibling_task_id')::uuid
    returning task.id
  )
  select count(*) into unauthorized_update_count from changed;
  if unauthorized_update_count <> 0 then
    raise exception 'Shared task visibility allowed execution of another owner task';
  end if;
end;
$rls$;

reset role;
rollback;
