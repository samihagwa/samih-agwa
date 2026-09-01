-- A revision is part of the task itself: one open revision per task, the task
-- reopens atomically, the assignee submits once, and that submission closes
-- the revision. This removes the old extra start/resolve workflow.

with ranked_open_revisions as (
  select
    revision.id,
    row_number() over (
      partition by revision.task_id
      order by revision.round desc, revision.requested_at desc, revision.id desc
    ) as open_rank
  from public.content_revision_requests revision
  where revision.status in ('requested', 'in_progress')
)
update public.content_revision_requests revision
set status = 'cancelled',
  resolved_by = coalesce(revision.resolved_by, revision.requested_by),
  resolved_at = coalesce(revision.resolved_at, now())
from ranked_open_revisions ranked
where revision.id = ranked.id
  and ranked.open_rank > 1;

create unique index if not exists content_revision_requests_one_open_per_task_idx
on public.content_revision_requests (task_id)
where status in ('requested', 'in_progress');

-- The existing task guard recognizes durable task-revision commands. Content
-- revisions use the same guarded status transition, so teach the guard to
-- accept either revision table while preserving every other task invariant.
create or replace function private.enforce_task_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  actor_can_plan boolean;
  actor_can_manage_all boolean;
  owner_is_active boolean;
  actor_owns_crm_contact boolean := false;
  publishing_completion boolean := false;
  launch_cancellation_id text := nullif(current_setting('app.cancel_launch_id', true), '');
  crm_command_contact_id text := nullif(current_setting('app.crm_contact_id', true), '');
  compact_workflow_content_id text := nullif(current_setting('app.compact_workflow_content_id', true), '');
  publishing_confirmation_task_id text := nullif(current_setting('app.confirm_content_publishing_task_id', true), '');
  task_revision_request_id text := nullif(current_setting('app.task_revision_request_id', true), '');
  content_revision_request_id text := nullif(current_setting('app.content_revision_request_id', true), '');
  valid_revision_command boolean := false;
  task_belongs_to_cancelled_launch boolean := false;
begin
  if actor is null then
    raise exception 'An authenticated actor is required';
  end if;

  if tg_op = 'UPDATE'
    and (task_revision_request_id is not null
      or content_revision_request_id is not null) then
    if task_revision_request_id is not null
      and content_revision_request_id is not null then
      raise exception 'Conflicting task revision commands';
    elsif task_revision_request_id is not null then
      select exists (
        select 1
        from public.task_revision_requests revision
        where revision.id::text = task_revision_request_id
          and revision.task_id = old.id
          and revision.organization_id = old.organization_id
          and revision.requested_by = actor
      ) into valid_revision_command;
    else
      select exists (
        select 1
        from public.content_revision_requests revision
        where revision.id::text = content_revision_request_id
          and revision.task_id = old.id
          and revision.organization_id = old.organization_id
          and revision.content_item_id = old.content_item_id
          and revision.stage = old.content_step
          and revision.requested_by = actor
          and revision.assigned_to = old.owner_id
          and revision.status = 'in_progress'
      ) into valid_revision_command;
    end if;

    if not valid_revision_command then
      raise exception 'Invalid task revision command';
    end if;
    if new.status is distinct from (case
      when old.status in ('review', 'done', 'blocked') then 'in_progress'::public.task_status
      else old.status
    end) then
      raise exception 'A revision request may only return the task to execution';
    end if;
    if (to_jsonb(new) - array['status', 'started_at', 'completed_at', 'version', 'updated_at']::text[])
      is distinct from
      (to_jsonb(old) - array['status', 'started_at', 'completed_at', 'version', 'updated_at']::text[]) then
      raise exception 'A revision request cannot edit task fields';
    end if;
    if old.status <> 'in_progress' and new.status = 'in_progress' and new.started_at is null then
      new.started_at := now();
    end if;
    if old.status = 'done' then
      new.completed_at := null;
    end if;
    new.version := old.version + 1;
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then
    if launch_cancellation_id is not null and new.status = 'cancelled' then
      new.version := old.version + 1;
      new.updated_at := now();
      new.completed_at := null;
      return new;
    end if;
    if (old.content_item_id is null and old.launch_id is null and old.crm_contact_id is null and old.launch_deliverable_id is null)
      or old.status <> 'backlog'
      or new.status <> 'ready'
      or (to_jsonb(new) - array['status', 'version', 'updated_at']::text[])
        is distinct from
        (to_jsonb(old) - array['status', 'version', 'updated_at']::text[]) then
      raise exception 'Invalid internal task transition';
    end if;
    new.version := old.version + 1;
    new.updated_at := now();
    return new;
  end if;

  select exists (
    select 1 from public.memberships membership
    where membership.organization_id = new.organization_id
      and membership.user_id = actor
      and membership.status = 'active'
      and membership.role in ('owner', 'admin', 'manager')
  ) into actor_can_plan;

  actor_can_manage_all := private.is_org_owner_or_admin_actor(actor, new.organization_id);

  select exists (
    select 1 from public.memberships membership
    where membership.organization_id = new.organization_id
      and membership.user_id = new.owner_id
      and membership.status = 'active'
  ) into owner_is_active;

  if not owner_is_active then
    raise exception 'Task owner must be an active member of the organization';
  end if;

  if new.crm_contact_id is not null then
    select exists (
      select 1 from public.crm_contacts contact
      where contact.id = new.crm_contact_id
        and contact.organization_id = new.organization_id
        and contact.owner_id = actor
    ) into actor_owns_crm_contact;
    if crm_command_contact_id is distinct from new.crm_contact_id::text then
      raise exception 'CRM follow-up tasks are managed through the CRM workflow only';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if not actor_can_plan and not actor_owns_crm_contact then
      raise exception 'Only organization leadership can create tasks, except a CRM owner creating their own follow-up';
    end if;
    if new.status not in ('backlog', 'ready') then
      raise exception 'New tasks must start in backlog or ready';
    end if;
    if new.due_at <= now() then
      raise exception 'New task deadline must be in the future';
    end if;
    if new.requires_review and new.owner_id = actor then
      raise exception 'A self-assigned task cannot require self-review';
    end if;
    new.created_by := actor;
    new.version := 1;
    new.started_at := null;
    new.completed_at := null;
    return new;
  end if;

  if new.organization_id <> old.organization_id
    or new.id <> old.id
    or new.created_by <> old.created_by
    or new.created_at <> old.created_at
    or new.requires_review is distinct from old.requires_review
    or new.content_item_id is distinct from old.content_item_id
    or new.content_step is distinct from old.content_step
    or new.launch_id is distinct from old.launch_id
    or new.launch_gate is distinct from old.launch_gate
    or new.crm_contact_id is distinct from old.crm_contact_id
    or new.launch_deliverable_id is distinct from old.launch_deliverable_id
    or (
      new.is_work_item is distinct from old.is_work_item
      and compact_workflow_content_id is distinct from new.content_item_id::text
    ) then
    raise exception 'Task identity, review rule, organization, and workflow link fields are immutable';
  end if;

  select exists (
    select 1
    from public.launches launch
    where launch.status = 'cancelled'
      and (
        launch.id = old.launch_id
        or exists (
          select 1 from public.launch_deliverables deliverable
          where deliverable.id = old.launch_deliverable_id
            and deliverable.launch_id = launch.id
        )
      )
  ) into task_belongs_to_cancelled_launch;

  if task_belongs_to_cancelled_launch
    and old.status = 'cancelled'
    and new.status <> 'cancelled' then
    raise exception 'A cancelled launch task cannot be reopened';
  end if;

  if old.requires_review and old.status = 'review' and old.owner_id = actor
    and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'The task assignee cannot modify their own task while it is under review';
  end if;

  if old.requires_review and old.status = 'review' and new.status is distinct from old.status then
    if old.owner_id = actor then
      raise exception 'The task assignee cannot approve or return their own reviewed task';
    end if;
    if old.created_by <> actor and not actor_can_manage_all then
      raise exception 'Only the task requester or platform leadership can review this task';
    end if;
    if new.status not in ('done', 'in_progress') then
      raise exception 'A reviewed task can only be approved or returned to work';
    end if;
    if new.title is distinct from old.title
      or new.description is distinct from old.description
      or new.priority is distinct from old.priority
      or new.owner_id is distinct from old.owner_id
      or new.acceptance_criteria is distinct from old.acceptance_criteria
      or new.due_at is distinct from old.due_at then
      raise exception 'Reviewers may only approve the task or return it to work';
    end if;
  elsif launch_cancellation_id is not null and new.status = 'cancelled' then
    if not actor_can_manage_all then
      raise exception 'Only a platform owner or admin can cancel launch tasks';
    end if;
  elsif old.owner_id = actor then
    if new.title is distinct from old.title
      or new.description is distinct from old.description
      or new.priority is distinct from old.priority
      or new.owner_id is distinct from old.owner_id
      or new.acceptance_criteria is distinct from old.acceptance_criteria
      or new.due_at is distinct from old.due_at then
      raise exception 'Task owners may change status only';
    end if;
  elsif actor_can_manage_all then
    if new.status is distinct from old.status then
      raise exception 'Platform leadership cannot execute a task assigned to another member';
    end if;
  else
    raise exception 'Only the assigned task owner can execute this task';
  end if;

  if old.requires_review
    and old.owner_id = actor
    and old.status <> 'review'
    and new.status = 'done' then
    raise exception 'Submit this task for review before completion';
  end if;

  publishing_completion := old.content_step = 'publishing'
    and old.is_work_item
    and old.status in ('ready', 'in_progress', 'review')
    and new.status = 'done'
    and publishing_confirmation_task_id = new.id::text
    and exists (
      select 1 from public.content_step_deliveries delivery
      where delivery.task_id = new.id
        and delivery.organization_id = new.organization_id
        and delivery.result_url is not null
    );

  if launch_cancellation_id is null
    and not private.is_valid_task_transition(old.status, new.status)
    and not publishing_completion then
    raise exception 'Invalid task status transition from % to %', old.status, new.status;
  end if;
  if old.status <> 'in_progress' and new.status = 'in_progress' and new.started_at is null then
    new.started_at := now();
  end if;
  if new.status = 'done' then
    new.started_at := coalesce(old.started_at, now());
    new.completed_at := coalesce(old.completed_at, now());
  elsif old.status = 'done' or new.status = 'cancelled' then
    new.completed_at := null;
  end if;
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.enforce_task_rules()
from public, anon, authenticated;

create or replace function public.request_content_revision(
  target_user_id uuid,
  target_content_item_id uuid,
  target_stage public.content_step,
  revision_instructions text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_record record;
  task_record public.tasks%rowtype;
  existing_revision public.content_revision_requests%rowtype;
  next_round bigint;
  revision_id uuid;
  clean_instructions text := trim(revision_instructions);
begin
  if target_user_id is null then
    raise exception 'A verified target user is required';
  end if;
  if target_stage not in ('recording', 'editing', 'thumbnail', 'caption', 'design') then
    raise exception 'This workflow stage cannot receive a revision request';
  end if;
  if clean_instructions is null
    or char_length(clean_instructions) not between 5 and 5000 then
    raise exception 'Revision instructions must be clear and within the allowed length';
  end if;

  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  select item.organization_id, item.created_by
  into item_record
  from public.content_items item
  where item.id = target_content_item_id
  for update;
  if item_record.organization_id is null then
    raise exception 'Content workflow was not found';
  end if;

  select task.* into task_record
  from public.tasks task
  where task.organization_id = item_record.organization_id
    and task.content_item_id = target_content_item_id
    and task.content_step = target_stage
    and task.is_work_item
  for update;
  if task_record.id is null then
    raise exception 'Content workflow stage was not found';
  end if;

  if not exists (
    select 1
    from public.memberships membership
    where membership.organization_id = item_record.organization_id
      and membership.user_id = target_user_id
      and membership.status = 'active'
      and membership.role <> 'viewer'
  ) then
    raise exception 'Only an active organization member can request revisions';
  end if;
  if item_record.created_by <> target_user_id
    and not private.is_org_owner_or_admin_actor(
      target_user_id,
      item_record.organization_id
    ) then
    raise exception 'Only the content requester or platform leadership can request revisions';
  end if;
  select revision.* into existing_revision
  from public.content_revision_requests revision
  where revision.task_id = task_record.id
    and revision.status in ('requested', 'in_progress')
  order by revision.round desc, revision.requested_at desc, revision.id desc
  limit 1
  for update;
  if existing_revision.id is not null then
    if existing_revision.requested_by = target_user_id
      and existing_revision.instructions = clean_instructions then
      return existing_revision.id;
    end if;
    raise exception 'An open revision already exists for this task';
  end if;
  if task_record.status not in ('review', 'done') then
    raise exception 'A revision can be requested only after the task has been submitted';
  end if;

  select coalesce(max(revision.round), 0) + 1
  into next_round
  from public.content_revision_requests revision
  where revision.content_item_id = target_content_item_id;

  insert into public.content_revision_requests (
    organization_id, content_item_id, task_id, stage, round, instructions,
    status, requested_by, assigned_to, started_at
  ) values (
    item_record.organization_id, target_content_item_id, task_record.id,
    target_stage, next_round, clean_instructions,
    'in_progress', target_user_id, task_record.owner_id, now()
  ) returning id into revision_id;

  -- The task rules recognize this durable revision id as the only valid
  -- command that may return submitted work to execution.
  perform set_config('app.content_revision_request_id', revision_id::text, true);
  update public.tasks task
  set status = 'in_progress'
  where task.id = task_record.id;

  update public.content_items item
  set version = item.version + 1,
    updated_at = now()
  where item.id = target_content_item_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    item_record.organization_id,
    target_user_id,
    'content.revision_requested',
    'content_revision',
    revision_id,
    jsonb_build_object(
      'content_item_id', target_content_item_id,
      'task_id', task_record.id,
      'stage', target_stage,
      'round', next_round,
      'assigned_to', task_record.owner_id,
      'task_reopened', true
    )
  );

  return revision_id;
end;
$$;

revoke all on function public.request_content_revision(
  uuid, uuid, public.content_step, text
) from public, anon, authenticated;
grant execute on function public.request_content_revision(
  uuid, uuid, public.content_step, text
) to service_role;

-- The revised delivery is the completion action. There is no separate
-- "resolve" click for the member and no second task completion transition.
create or replace function private.resolve_content_revision_on_task_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if old.status is distinct from 'done'
    and new.status = 'done'
    and new.content_item_id is not null then
    update public.content_revision_requests revision
    set status = 'resolved',
      started_at = coalesce(revision.started_at, revision.requested_at),
      resolved_by = coalesce(actor, new.owner_id),
      resolved_at = now()
    where revision.task_id = new.id
      and revision.status in ('requested', 'in_progress')
      and exists (
        select 1
        from public.content_step_deliveries delivery
        where delivery.task_id = new.id
          and delivery.organization_id = new.organization_id
          and delivery.submitted_at >= revision.requested_at
      );
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_resolve_content_revision_on_completion on public.tasks;
create trigger tasks_resolve_content_revision_on_completion
after update of status on public.tasks
for each row execute function private.resolve_content_revision_on_task_completion();

revoke all on function private.resolve_content_revision_on_task_completion()
from public, anon, authenticated;

-- Publishing must still wait for revisions on other workflow stages. Its own
-- open revision, however, is closed by the fresh delivery in the AFTER trigger
-- above and must not deadlock that same completion transition.
create or replace function private.guard_content_approval_revisions()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'done'
    and old.status <> 'done'
    and new.content_item_id is not null
    and new.content_step in ('approval', 'publishing')
    and exists (
      select 1
      from public.content_revision_requests revision
      where revision.content_item_id = new.content_item_id
        and revision.task_id <> new.id
        and revision.status in ('requested', 'in_progress')
    ) then
    raise exception 'Resolve every other open revision before approval or publishing';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_content_approval_revisions()
from public, anon, authenticated;

-- Legacy callers may still send start/resolve after the single delivery. Make
-- those calls harmless; never complete the task from the revision endpoint.
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
  task_record public.tasks%rowtype;
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

  if not exists (
    select 1
    from public.memberships membership
    where membership.organization_id = revision_record.organization_id
      and membership.user_id = target_user_id
      and membership.status = 'active'
      and membership.role <> 'viewer'
  ) then
    raise exception 'Only an active non-viewer organization member can change revisions';
  end if;

  actor_is_leadership := private.is_org_owner_or_admin_actor(
    target_user_id,
    revision_record.organization_id
  );
  if target_action in ('start', 'resolve')
    and revision_record.assigned_to <> target_user_id
    and not actor_is_leadership then
    raise exception 'Only the assigned owner or platform leadership can work this revision';
  end if;
  if target_action = 'cancel'
    and revision_record.requested_by <> target_user_id
    and not actor_is_leadership then
    raise exception 'Only the requester or platform leadership can cancel this revision';
  end if;

  if (target_action = 'start' and revision_record.status = 'in_progress')
    or (target_action = 'resolve' and revision_record.status = 'resolved')
    or (target_action = 'cancel' and revision_record.status = 'cancelled') then
    return true;
  end if;
  if revision_record.status in ('resolved', 'cancelled') then
    raise exception 'This revision request is already closed';
  end if;

  select task.* into task_record
  from public.tasks task
  where task.id = revision_record.task_id
  for update;
  if task_record.id is null then
    raise exception 'Revision task was not found';
  end if;

  if target_action = 'start' then
    update public.content_revision_requests revision
    set status = 'in_progress',
      started_at = coalesce(revision.started_at, now())
    where revision.id = revision_record.id;
  elsif target_action = 'resolve' then
    if task_record.status <> 'done'
      or not exists (
        select 1
        from public.content_step_deliveries delivery
        where delivery.task_id = task_record.id
          and delivery.submitted_at >= revision_record.requested_at
      ) then
      raise exception 'Submit the revised task result before resolving this revision';
    end if;
    update public.content_revision_requests revision
    set status = 'resolved',
      started_at = coalesce(revision.started_at, revision.requested_at),
      resolved_by = target_user_id,
      resolved_at = now()
    where revision.id = revision_record.id;
  else
    if task_record.status = 'in_progress' then
      raise exception 'An active revision cannot be cancelled after the task was reopened';
    end if;
    update public.content_revision_requests revision
    set status = 'cancelled',
      resolved_by = target_user_id,
      resolved_at = now()
    where revision.id = revision_record.id;
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

-- Revision notifications must open the exact task. Team members do not need
-- Content workspace access to understand or deliver their own revision.
create or replace function private.notify_content_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.add_notification(
    new.organization_id,
    new.assigned_to,
    'revision_requested',
    case
      when new.assigned_to = new.requested_by then 'تم تسجيل طلب تعديل لك'
      else 'مطلوب تعديل على مهمة'
    end,
    left(new.instructions, 1000),
    'task',
    new.task_id,
    '/tasks/' || new.task_id,
    'revision:' || new.id || ':requested:user:' || new.assigned_to
  );
  return new;
end;
$$;

revoke all on function private.notify_content_revision()
from public, anon, authenticated;

update public.notifications notification
set entity_type = 'task',
  entity_id = revision.task_id,
  url = '/tasks/' || revision.task_id
from public.content_revision_requests revision
where notification.entity_type = 'content_revision'
  and notification.entity_id = revision.id
  and notification.read_at is null;

-- Task-only participants may read the exact shared request and its revision
-- history, while the existing involved-member policies still prevent broad
-- Content access.
drop policy if exists "section_scope_content_items" on public.content_items;
create policy "section_scope_content_items" on public.content_items
as restrictive for select to authenticated
using (private.can_access_any_section(
  organization_id,
  array['dashboard','planning','content','scripts','publishing','campaigns','tasks']::text[]
));

drop policy if exists "section_scope_content_revisions" on public.content_revision_requests;
create policy "section_scope_content_revisions" on public.content_revision_requests
as restrictive for select to authenticated
using (private.can_access_any_section(
  organization_id,
  array['content','tasks']::text[]
));

-- A content request is one shared production card. An assignee may read the
-- other visible stage tasks for that same card so progress is understandable,
-- but this helper is used only by the tasks SELECT policy. Update RLS and task
-- execution guards remain assignee/requester scoped.
create or replace function private.can_read_shared_content_task_actor(
  target_user_id uuid,
  target_organization_id uuid,
  target_task_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user_id is not null
    and target_user_id = (select auth.uid())
    and exists (
      select 1
      from public.memberships membership
      join public.tasks target_task
        on target_task.id = target_task_id
       and target_task.organization_id = target_organization_id
       and target_task.content_item_id is not null
       and target_task.is_work_item
      where membership.organization_id = target_organization_id
        and membership.user_id = target_user_id
        and membership.status = 'active'
        and (
          membership.role = 'owner'
          or 'tasks' = any(membership.allowed_sections)
        )
        and exists (
          select 1
          from public.tasks participant_task
          where participant_task.organization_id = target_task.organization_id
            and participant_task.content_item_id = target_task.content_item_id
            and participant_task.owner_id = target_user_id
            and participant_task.is_work_item
            and participant_task.status <> 'cancelled'
        )
    );
$$;

revoke all on function private.can_read_shared_content_task_actor(
  uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function private.can_read_shared_content_task_actor(
  uuid, uuid, uuid
) to authenticated;

drop policy if exists "tasks_select_involved_members" on public.tasks;
create policy "tasks_select_involved_members"
on public.tasks for select to authenticated
using (
  private.can_read_task_actor(
    (select auth.uid()),
    organization_id,
    id
  )
  or private.can_read_shared_content_task_actor(
    (select auth.uid()),
    organization_id,
    id
  )
);
