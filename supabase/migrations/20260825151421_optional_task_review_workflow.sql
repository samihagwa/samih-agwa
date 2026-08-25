-- Make acceptance criteria optional and make review an explicit, requester-owned
-- choice for manual tasks. The database remains the authority for every status
-- transition so a hidden or forged client action cannot self-approve work.

alter table public.tasks
  add column requires_review boolean not null default false;

alter table public.tasks
  alter column acceptance_criteria set default '',
  drop constraint tasks_acceptance_criteria_length,
  add constraint tasks_acceptance_criteria_length check (
    char_length(trim(acceptance_criteria)) <= 4000
  );

comment on column public.tasks.requires_review is
  'When true, the assignee can submit for review but only the requester or platform leadership may approve completion.';

-- The requester needs UPDATE visibility only for the review decision. The
-- trigger below narrows that access to review -> done/in_progress transitions.
drop policy if exists "tasks_update_assignee_or_platform_admin" on public.tasks;
create policy "tasks_update_assignee_requester_or_platform_admin"
on public.tasks for update to authenticated
using (
  owner_id = (select auth.uid())
  or created_by = (select auth.uid())
  or private.is_org_owner_or_admin_actor((select auth.uid()), organization_id)
)
with check (
  private.is_org_member(organization_id)
  and (
    owner_id = (select auth.uid())
    or created_by = (select auth.uid())
    or private.is_org_owner_or_admin_actor((select auth.uid()), organization_id)
  )
);

grant insert (requires_review) on table public.tasks to authenticated;

create or replace function private.is_valid_task_transition(
  previous_status public.task_status,
  next_status public.task_status
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select
    previous_status = next_status
    or (previous_status = 'backlog' and next_status in ('ready', 'cancelled'))
    or (previous_status = 'ready' and next_status in ('in_progress', 'cancelled'))
    or (previous_status = 'in_progress' and next_status in ('review', 'blocked', 'done', 'cancelled'))
    or (previous_status = 'blocked' and next_status in ('in_progress', 'cancelled'))
    or (previous_status = 'review' and next_status in ('in_progress', 'done'))
    or (previous_status = 'done' and next_status = 'in_progress')
    or (previous_status = 'cancelled' and next_status = 'backlog');
$$;

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
  task_belongs_to_cancelled_launch boolean := false;
begin
  if actor is null then
    raise exception 'An authenticated actor is required';
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
  elsif not actor_can_manage_all then
    if old.owner_id <> actor then
      raise exception 'Only the assigned task owner can execute or update this task';
    end if;
    if new.title is distinct from old.title
      or new.description is distinct from old.description
      or new.priority is distinct from old.priority
      or new.owner_id is distinct from old.owner_id
      or new.acceptance_criteria is distinct from old.acceptance_criteria
      or new.due_at is distinct from old.due_at then
      raise exception 'Task owners may change status only';
    end if;
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
  target_url text := case
    when new.crm_contact_id is not null then '/crm/' || new.crm_contact_id
    when new.content_item_id is not null then '/content?content=' || new.content_item_id || '#content-' || new.content_item_id
    when new.launch_deliverable_id is not null then '/campaigns?deliverable=' || new.launch_deliverable_id || '#deliverable-' || new.launch_deliverable_id
    else '/tasks?task=' || new.id || '#task-' || new.id
  end;
begin
  select coalesce(nullif(trim(profile.full_name), ''), 'عضو الفريق')
  into actor_name from public.profiles profile where profile.id = actor;
  actor_name := coalesce(actor_name, 'عضو الفريق');

  if tg_op = 'INSERT' then
    if new.status = 'ready' and new.owner_id is distinct from actor then
      perform private.add_notification(
        new.organization_id, new.owner_id, 'task_assigned',
        'مهمة جديدة وصلت لك', new.title, 'task', new.id, target_url,
        'task:' || new.id || ':assigned:v' || new.version || ':user:' || new.owner_id
      );
    end if;
    return new;
  end if;

  if new.owner_id is distinct from old.owner_id and (new.is_work_item or new.status = 'ready') then
    perform private.add_notification(
      new.organization_id, new.owner_id, 'task_assigned',
      'تم إسناد مهمة لك', new.title, 'task', new.id, target_url,
      'task:' || new.id || ':reassigned:v' || new.version || ':user:' || new.owner_id
    );
  end if;

  if new.status is distinct from old.status and new.status = 'ready'
    and new.owner_id is distinct from actor then
    perform private.add_notification(
      new.organization_id, new.owner_id, 'task_ready',
      case when new.is_work_item then 'الخطوة السابقة اكتملت' else 'إجراء داخل ملف المحتوى' end,
      case when new.is_work_item then 'مهمتك جاهزة الآن: ' else 'جاهز الآن: ' end || new.title,
      'task', new.id, target_url,
      'task:' || new.id || ':ready:v' || new.version || ':user:' || new.owner_id
    );
  end if;

  if new.requires_review and new.status is distinct from old.status and new.status = 'review'
    and new.created_by is distinct from actor then
    perform private.add_notification(
      new.organization_id, new.created_by, 'task_review',
      'تسليم جديد يحتاج مراجعتك', new.title,
      'task', new.id, target_url,
      'task:' || new.id || ':review:v' || new.version || ':user:' || new.created_by
    );
  end if;

  if old.requires_review and old.status = 'review' and new.status = 'in_progress'
    and new.owner_id is distinct from actor then
    perform private.add_notification(
      new.organization_id, new.owner_id, 'task_ready',
      'المهمة رجعت لك للتنفيذ', new.title,
      'task', new.id, target_url,
      'task:' || new.id || ':returned:v' || new.version || ':user:' || new.owner_id
    );
  end if;

  if new.is_work_item and new.status is distinct from old.status and new.status = 'blocked'
    and new.created_by is distinct from actor then
    perform private.add_notification(
      new.organization_id, new.created_by, 'task_blocked',
      'مهمة متوقفة وتحتاج تدخلًا', new.title,
      'task', new.id, target_url,
      'task:' || new.id || ':blocked:v' || new.version || ':user:' || new.created_by
    );
  end if;

  if new.is_work_item and new.status is distinct from old.status and new.status = 'done' then
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
        case when old.requires_review and old.status = 'review' then 'تم اعتماد مهمة' else 'اكتملت مهمة بواسطة ' || actor_name end,
        new.title || case when new.completed_at > new.due_at then ' · اكتملت بعد الموعد' else ' · اكتملت في الموعد' end,
        'task', new.id, target_url,
        'task:' || new.id || ':done:v' || new.version || ':user:' || recipient_id
      );
    end loop;

    if old.requires_review and old.status = 'review' and new.owner_id is distinct from actor
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
        'task:' || new.id || ':approved:v' || new.version || ':user:' || new.owner_id
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
        'task:' || new.id || ':done:v' || new.version || ':user:' || new.created_by
      );
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.is_valid_task_transition(public.task_status, public.task_status)
from public, anon, authenticated;
revoke all on function private.enforce_task_rules()
from public, anon, authenticated;
revoke all on function private.notify_task_change()
from public, anon, authenticated;
