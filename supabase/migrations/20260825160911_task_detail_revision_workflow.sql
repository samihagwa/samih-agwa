-- Give every task a durable revision history and keep execution controls with
-- the assignee. Requesters can ask for changes with written instructions; the
-- database records the request, reopens the task when needed, and notifies the
-- assignee atomically.

create table public.task_revision_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete restrict,
  requested_by uuid not null references public.profiles (id) on delete restrict,
  instructions text not null,
  task_version bigint not null,
  requested_at timestamptz not null default now(),
  constraint task_revision_requests_instructions_length check (
    char_length(trim(instructions)) between 3 and 5000
  ),
  constraint task_revision_requests_task_version_positive check (task_version > 0)
);

create index task_revision_requests_task_time_idx
  on public.task_revision_requests (task_id, requested_at desc, id);
create index task_revision_requests_org_requester_time_idx
  on public.task_revision_requests (organization_id, requested_by, requested_at desc, id);

alter table public.task_revision_requests enable row level security;

create policy "task_revision_requests_select_task_members"
on public.task_revision_requests for select to authenticated
using (private.is_org_member(organization_id));

create policy "task_revision_requests_insert_requester_or_platform_admin"
on public.task_revision_requests for insert to authenticated
with check (
  requested_by = (select auth.uid())
  and private.is_org_member(organization_id)
  and exists (
    select 1
    from public.tasks task
    where task.id = task_revision_requests.task_id
      and task.organization_id = task_revision_requests.organization_id
      and task.owner_id <> (select auth.uid())
      and task.status <> 'cancelled'
      and (
        task.created_by = (select auth.uid())
        or private.is_org_owner_or_admin_actor(
          (select auth.uid()),
          task_revision_requests.organization_id
        )
      )
  )
);

create policy "section_scope_task_revision_requests"
on public.task_revision_requests
as restrictive for all to authenticated
using (
  private.can_access_any_section(
    organization_id,
    array['tasks','content','scripts','campaigns','crm']::text[]
  )
)
with check (
  private.can_access_any_section(
    organization_id,
    array['tasks','content','scripts','campaigns','crm']::text[]
  )
);

revoke all on table public.task_revision_requests from anon, authenticated;
grant select on table public.task_revision_requests to authenticated;
grant insert (task_id, instructions, task_version)
on table public.task_revision_requests to authenticated;

create or replace function private.prepare_task_revision_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  task_record public.tasks%rowtype;
begin
  if actor is null then
    raise exception 'An authenticated actor is required';
  end if;

  select task.* into task_record
  from public.tasks task
  where task.id = new.task_id
  for update;

  if task_record.id is null then
    raise exception 'Task was not found';
  end if;
  if task_record.version <> new.task_version then
    raise exception 'Task changed. Refresh the task page and try again';
  end if;
  if task_record.status = 'cancelled' then
    raise exception 'A cancelled task cannot receive a revision request';
  end if;
  if task_record.owner_id = actor then
    raise exception 'The assignee cannot request changes from themselves';
  end if;
  if task_record.content_item_id is not null
    or task_record.launch_id is not null
    or task_record.launch_deliverable_id is not null
    or task_record.crm_contact_id is not null then
    raise exception 'Linked workflow revisions must be requested from their source workspace';
  end if;
  if task_record.created_by <> actor
    and not private.is_org_owner_or_admin_actor(actor, task_record.organization_id) then
    raise exception 'Only the task requester or platform leadership can request changes';
  end if;
  if new.instructions is null
    or char_length(trim(new.instructions)) not between 3 and 5000 then
    raise exception 'Revision instructions must contain between 3 and 5000 characters';
  end if;

  new.organization_id := task_record.organization_id;
  new.requested_by := actor;
  new.instructions := trim(new.instructions);
  new.requested_at := now();
  return new;
end;
$$;

create trigger task_revision_requests_prepare
before insert on public.task_revision_requests
for each row execute function private.prepare_task_revision_request();

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
  valid_revision_command boolean := false;
  task_belongs_to_cancelled_launch boolean := false;
begin
  if actor is null then
    raise exception 'An authenticated actor is required';
  end if;

  if tg_op = 'UPDATE' and task_revision_request_id is not null then
    select exists (
      select 1
      from public.task_revision_requests revision
      where revision.id::text = task_revision_request_id
        and revision.task_id = old.id
        and revision.organization_id = old.organization_id
        and revision.requested_by = actor
    ) into valid_revision_command;

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

create or replace function private.apply_task_revision_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_record public.tasks%rowtype;
begin
  perform set_config('app.task_revision_request_id', new.id::text, true);

  update public.tasks task
  set status = case
        when task.status in ('review', 'done', 'blocked') then 'in_progress'::public.task_status
        else task.status
      end,
      updated_at = now()
  where task.id = new.task_id
  returning task.* into task_record;

  if task_record.id is null then
    raise exception 'Task was not found while applying the revision request';
  end if;

  -- review -> in_progress previously emitted a generic "ready" notice. Replace
  -- that uncommitted derived row with the useful notice containing the actual
  -- revision instructions, so the assignee receives one notification only.
  delete from public.notifications notification
  where notification.dedupe_key =
    'task:' || task_record.id || ':returned:v' || task_record.version || ':user:' || task_record.owner_id;

  perform private.add_notification(
    new.organization_id,
    task_record.owner_id,
    'revision_requested',
    'مطلوب تعديل على مهمة',
    left(new.instructions, 1000),
    'task',
    task_record.id,
    '/tasks/' || task_record.id,
    'task:' || task_record.id || ':revision:' || new.id || ':user:' || task_record.owner_id
  );

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    new.organization_id,
    new.requested_by,
    'task.revision_requested',
    'task',
    new.task_id,
    jsonb_build_object(
      'revision_request_id', new.id,
      'task_version', new.task_version,
      'instructions', new.instructions,
      'resulting_status', task_record.status,
      'resulting_version', task_record.version
    )
  );

  return new;
end;
$$;

create trigger task_revision_requests_apply
after insert on public.task_revision_requests
for each row execute function private.apply_task_revision_request();

-- New task notifications and every generated deep link open the exact task
-- detail page instead of dropping the member onto the entire board.
create or replace function private.canonicalize_notification_url()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  related_id uuid;
begin
  if new.entity_id is null then return new; end if;

  case new.entity_type
    when 'task' then
      new.url := '/tasks/' || new.entity_id;
    when 'crm_contact' then
      new.url := '/crm/' || new.entity_id;
    when 'content_item' then
      new.url := '/content?content=' || new.entity_id || '#content-' || new.entity_id;
    when 'content_revision' then
      select revision.content_item_id into related_id
      from public.content_revision_requests revision
      where revision.id = new.entity_id;
      if related_id is not null then
        new.url := '/content?content=' || related_id || '&revision=' || new.entity_id || '#revision-' || new.entity_id;
      end if;
    when 'script' then
      new.url := '/scripts/' || new.entity_id;
    when 'script_research' then
      new.url := '/scripts?tab=radar&research=' || new.entity_id || '#research-' || new.entity_id;
    when 'publishing_occurrence' then
      new.url := '/publishing?occurrence=' || new.entity_id || '#occurrence-' || new.entity_id;
    when 'launch' then
      new.url := '/campaigns?launch=' || new.entity_id || '#launch-' || new.entity_id;
    when 'launch_deliverable' then
      new.url := '/campaigns?deliverable=' || new.entity_id || '#deliverable-' || new.entity_id;
    when 'membership' then
      select membership.user_id into related_id
      from public.memberships membership
      where membership.id = new.entity_id;
      related_id := coalesce(related_id, new.entity_id);
      new.url := '/team?member=' || related_id || '#member-' || related_id;
    else
      null;
  end case;

  return new;
end;
$$;

update public.notifications notification
set url = '/tasks/' || notification.entity_id
where notification.entity_type = 'task'
  and notification.entity_id is not null
  and notification.url is distinct from '/tasks/' || notification.entity_id;

revoke all on function private.prepare_task_revision_request()
from public, anon, authenticated;
revoke all on function private.apply_task_revision_request()
from public, anon, authenticated;
revoke all on function private.enforce_task_rules()
from public, anon, authenticated;
revoke all on function private.canonicalize_notification_url()
from public, anon, authenticated;
