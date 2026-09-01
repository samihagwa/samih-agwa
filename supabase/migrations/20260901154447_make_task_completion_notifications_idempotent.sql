-- One logical completion cycle must produce one in-app notification and,
-- consequently, one Telegram outbox row per recipient. Task.version cannot be
-- used as the identity of that cycle: resolving a content revision used to
-- advance the same task through done -> in_progress -> review -> done and each
-- internal update produced a new version-backed notification.

create or replace function private.task_completion_notification_cycle(
  target_task_id uuid
)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (
      select cycle.cycle_key
      from (
        select
          'content-revision:' || revision.id::text as cycle_key,
          revision.requested_at,
          revision.id
        from public.content_revision_requests revision
        where revision.task_id = target_task_id
        union all
        select
          'task-revision:' || revision.id::text as cycle_key,
          revision.requested_at,
          revision.id
        from public.task_revision_requests revision
        where revision.task_id = target_task_id
      ) cycle
      order by cycle.requested_at desc, cycle.id desc
      limit 1
    ),
    'initial'
  );
$$;

revoke all on function private.task_completion_notification_cycle(uuid)
from public, anon, authenticated;

-- Retrying an already-applied revision action is a successful no-op. Most
-- importantly, resolving a revision after its assignee has already submitted
-- the corrected delivery closes the revision only; it must not complete the
-- already-done task a second time.
create or replace function public.change_content_revision(
  target_user_id uuid,
  target_revision_id uuid,
  target_action text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  revision_record public.content_revision_requests%rowtype;
  task_status public.task_status;
  actor_is_leadership boolean;
begin
  if target_user_id is null then
    raise exception 'A verified target user is required';
  end if;
  if target_action not in ('start', 'resolve', 'cancel') then
    raise exception 'Unknown revision action';
  end if;
  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  select revision.* into revision_record
  from public.content_revision_requests revision
  where revision.id = target_revision_id
  for update;
  if revision_record.id is null then
    raise exception 'Revision request was not found';
  end if;

  actor_is_leadership := private.has_org_role(
    revision_record.organization_id,
    array['owner', 'admin', 'manager']::public.app_role[]
  );
  if target_action in ('start', 'resolve')
    and revision_record.assigned_to <> target_user_id
    and not actor_is_leadership then
    raise exception 'Only the assigned owner or organization leadership can work this revision';
  end if;
  if target_action = 'cancel'
    and revision_record.requested_by <> target_user_id
    and not actor_is_leadership then
    raise exception 'Only the requester or organization leadership can cancel this revision';
  end if;

  if (target_action = 'start' and revision_record.status = 'in_progress')
    or (target_action = 'resolve' and revision_record.status = 'resolved')
    or (target_action = 'cancel' and revision_record.status = 'cancelled') then
    return true;
  end if;
  if revision_record.status in ('resolved', 'cancelled') then
    raise exception 'This revision request is already closed';
  end if;

  if target_action = 'cancel' then
    update public.content_revision_requests revision
    set status = 'cancelled',
      resolved_by = target_user_id,
      resolved_at = now()
    where revision.id = target_revision_id;
  else
    select task.status into task_status
    from public.tasks task
    where task.id = revision_record.task_id
    for update;
    if task_status is null then
      raise exception 'Revision task was not found';
    end if;
    if task_status = 'cancelled' then
      raise exception 'A cancelled workflow task cannot receive revisions';
    end if;

    if target_action = 'start' then
      if task_status = 'backlog' then
        update public.tasks
        set status = 'ready'
        where id = revision_record.task_id;
        task_status := 'ready';
      end if;
      if task_status in ('ready', 'review', 'blocked', 'done') then
        update public.tasks
        set status = 'in_progress'
        where id = revision_record.task_id;
      end if;

      update public.content_revision_requests revision
      set status = 'in_progress',
        started_at = coalesce(revision.started_at, now())
      where revision.id = target_revision_id;
    else
      -- A corrected delivery can complete the task before the member closes
      -- the revision card. Preserve that completion instead of replaying it.
      if task_status <> 'done' then
        if task_status = 'backlog' then
          update public.tasks
          set status = 'ready'
          where id = revision_record.task_id;
          task_status := 'ready';
        end if;
        if task_status in ('ready', 'review', 'blocked') then
          update public.tasks
          set status = 'in_progress'
          where id = revision_record.task_id;
          task_status := 'in_progress';
        end if;
        if task_status = 'in_progress' then
          update public.tasks
          set status = 'review'
          where id = revision_record.task_id;
          update public.tasks
          set status = 'done'
          where id = revision_record.task_id;
        end if;
      end if;

      update public.content_revision_requests revision
      set status = 'resolved',
        started_at = coalesce(revision.started_at, now()),
        resolved_by = target_user_id,
        resolved_at = now()
      where revision.id = target_revision_id;
    end if;
  end if;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id,
    before_data, after_data
  ) values (
    revision_record.organization_id,
    target_user_id,
    'content.revision_' || target_action,
    'content_revision',
    target_revision_id,
    jsonb_build_object('status', revision_record.status),
    jsonb_build_object(
      'status', case target_action
        when 'start' then 'in_progress'
        when 'resolve' then 'resolved'
        else 'cancelled'
      end
    )
  );
  return true;
end;
$$;

revoke all on function public.change_content_revision(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.change_content_revision(uuid, uuid, text)
to service_role;

-- Every task transition remains responsible for at most one durable
-- notification per recipient. Completion keys are scoped to the initial work
-- or the latest revision request rather than to mutable task versions.
create or replace function private.notify_task_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  recipient_id uuid;
  actor_name text;
  completion_cycle text;
  target_url text := '/tasks/' || new.id;
  content_revision_request_id text := nullif(
    current_setting('app.content_revision_request_id', true),
    ''
  );
  is_content_revision_reopen boolean := false;
begin
  select coalesce(nullif(trim(profile.full_name), ''), 'عضو الفريق')
  into actor_name
  from public.profiles profile
  where profile.id = actor;
  actor_name := coalesce(actor_name, 'عضو الفريق');

  if tg_op = 'INSERT' then
    if new.is_work_item and new.status = 'ready'
      and new.owner_id is distinct from actor then
      perform private.add_notification(
        new.organization_id, new.owner_id, 'task_assigned',
        'مهمة جديدة وصلت لك', new.title, 'task', new.id, target_url,
        'task:' || new.id || ':assigned:v' || new.version || ':user:' || new.owner_id
      );
    end if;
    return new;
  end if;

  if new.owner_id is not distinct from old.owner_id
    and new.status is not distinct from old.status then
    return new;
  end if;

  if content_revision_request_id is not null then
    select exists (
      select 1
      from public.content_revision_requests revision
      where revision.id::text = content_revision_request_id
        and revision.task_id = new.id
        and revision.organization_id = new.organization_id
        and revision.content_item_id = new.content_item_id
        and revision.stage = new.content_step
        and revision.requested_by = actor
        and revision.assigned_to = new.owner_id
        and revision.status = 'in_progress'
    ) into is_content_revision_reopen;
  end if;

  if new.is_work_item and new.owner_id is distinct from old.owner_id then
    perform private.add_notification(
      new.organization_id, new.owner_id, 'task_assigned',
      'تم إسناد مهمة لك', new.title, 'task', new.id, target_url,
      'task:' || new.id || ':reassigned:v' || new.version || ':user:' || new.owner_id
    );
  end if;

  if new.is_work_item and new.status is distinct from old.status
    and new.status = 'ready' and new.owner_id is distinct from actor then
    perform private.add_notification(
      new.organization_id, new.owner_id, 'task_ready',
      'الخطوة السابقة اكتملت', 'مهمتك جاهزة الآن: ' || new.title,
      'task', new.id, target_url,
      'task:' || new.id || ':ready:v' || new.version || ':user:' || new.owner_id
    );
  end if;

  if new.is_work_item and new.requires_review
    and new.status is distinct from old.status and new.status = 'review'
    and new.created_by is distinct from actor then
    perform private.add_notification(
      new.organization_id, new.created_by, 'task_review',
      'تسليم جديد يحتاج مراجعتك', new.title,
      'task', new.id, target_url,
      'task:' || new.id || ':review:v' || new.version || ':user:' || new.created_by
    );
  end if;

  if new.is_work_item and old.requires_review and old.status = 'review'
    and new.status = 'in_progress' and new.owner_id is distinct from actor
    and not is_content_revision_reopen then
    perform private.add_notification(
      new.organization_id, new.owner_id, 'task_ready',
      'المهمة رجعت لك للتنفيذ', new.title,
      'task', new.id, target_url,
      'task:' || new.id || ':returned:v' || new.version || ':user:' || new.owner_id
    );
  end if;

  if new.is_work_item and new.status is distinct from old.status
    and new.status = 'blocked' and new.created_by is distinct from actor then
    perform private.add_notification(
      new.organization_id, new.created_by, 'task_blocked',
      'مهمة متوقفة وتحتاج تدخلًا', new.title,
      'task', new.id, target_url,
      'task:' || new.id || ':blocked:v' || new.version || ':user:' || new.created_by
    );
  end if;

  if new.is_work_item and new.status is distinct from old.status
    and new.status = 'done' then
    completion_cycle := private.task_completion_notification_cycle(new.id);

    for recipient_id in
      select membership.user_id
      from public.memberships membership
      where membership.organization_id = new.organization_id
        and membership.status = 'active'
        and membership.role = 'owner'
        and membership.user_id is distinct from actor
    loop
      perform private.add_notification(
        new.organization_id, recipient_id, 'task_done',
        case when old.requires_review and old.status = 'review'
          then 'تم اعتماد مهمة' else 'اكتملت مهمة بواسطة ' || actor_name end,
        new.title || case when new.completed_at > new.due_at
          then ' · اكتملت بعد الموعد' else ' · اكتملت في الموعد' end,
        'task', new.id, target_url,
        'task:' || new.id || ':done:cycle:' || completion_cycle || ':user:' || recipient_id
      );
    end loop;

    if old.requires_review and old.status = 'review'
      and new.owner_id is distinct from actor
      and not exists (
        select 1 from public.memberships membership
        where membership.organization_id = new.organization_id
          and membership.user_id = new.owner_id
          and membership.status = 'active'
          and membership.role = 'owner'
      ) then
      perform private.add_notification(
        new.organization_id, new.owner_id, 'task_done',
        'تم اعتماد مهمتك', new.title,
        'task', new.id, target_url,
        'task:' || new.id || ':approved:cycle:' || completion_cycle || ':user:' || new.owner_id
      );
    end if;

    if new.created_by is distinct from actor and not exists (
      select 1 from public.memberships membership
      where membership.organization_id = new.organization_id
        and membership.user_id = new.created_by
        and membership.status = 'active'
        and membership.role = 'owner'
    ) then
      perform private.add_notification(
        new.organization_id, new.created_by, 'task_done',
        'اكتملت مهمة بواسطة ' || actor_name, new.title,
        'task', new.id, target_url,
        'task:' || new.id || ':done:cycle:' || completion_cycle || ':user:' || new.created_by
      );
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.notify_task_change()
from public, anon, authenticated;
