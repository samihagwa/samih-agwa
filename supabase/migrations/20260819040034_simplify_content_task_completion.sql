-- Team members submit one result. Workflow statuses remain internal, managers
-- approve reviewable work, and a verified live URL completes publishing at once.

alter table public.content_step_deliveries
  drop constraint content_step_deliveries_step_allowed,
  add constraint content_step_deliveries_step_allowed
    check (step in (
      'recording', 'editing', 'thumbnail', 'caption',
      'design', 'scheduling', 'publishing'
    ));

create or replace function private.require_content_step_delivery()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.content_item_id is not null
    and new.content_step in (
      'recording', 'editing', 'thumbnail', 'caption',
      'design', 'scheduling', 'publishing'
    )
    and new.status in ('review', 'done')
    and old.status is distinct from new.status
    and not exists (
      select 1
      from public.content_step_deliveries delivery
      where delivery.task_id = new.id
        and delivery.organization_id = new.organization_id
    ) then
    raise exception 'Submit the step result from the content card before review or completion';
  end if;

  return new;
end;
$$;

create or replace function private.enforce_task_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  actor_is_manager boolean;
  owner_is_active boolean;
  actor_owns_crm_contact boolean := false;
  publishing_completion boolean := false;
  crm_command_contact_id text := nullif(current_setting('app.crm_contact_id', true), '');
  compact_workflow_content_id text := nullif(current_setting('app.compact_workflow_content_id', true), '');
  publishing_confirmation_task_id text := nullif(current_setting('app.confirm_content_publishing_task_id', true), '');
begin
  if actor is null then
    raise exception 'An authenticated actor is required';
  end if;

  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then
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
  ) into actor_is_manager;

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
    if not actor_is_manager and not actor_owns_crm_contact then
      raise exception 'Only organization leadership can create tasks, except a CRM owner creating their own follow-up';
    end if;
    if new.status not in ('backlog', 'ready') then
      raise exception 'New tasks must start in backlog or ready';
    end if;
    if new.due_at <= now() then
      raise exception 'New task deadline must be in the future';
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
    raise exception 'Task identity, organization, and workflow link fields are immutable';
  end if;

  if not actor_is_manager then
    if old.owner_id <> actor then
      raise exception 'Only task owners or organization leadership can update tasks';
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

  publishing_completion := old.content_step = 'publishing'
    and old.is_work_item
    and old.status in ('ready', 'in_progress', 'review')
    and new.status = 'done'
    and publishing_confirmation_task_id = new.id::text
    and exists (
      select 1
      from public.content_step_deliveries delivery
      where delivery.task_id = new.id
        and delivery.organization_id = new.organization_id
        and delivery.result_url is not null
    );

  if old.content_item_id is not null
    and old.is_work_item
    and old.status = 'review'
    and new.status = 'done'
    and not actor_is_manager
    and not publishing_completion then
    raise exception 'Only organization leadership can approve a submitted content task';
  end if;

  if not private.is_valid_task_transition(old.status, new.status)
    and not publishing_completion then
    raise exception 'Invalid task status transition from % to %', old.status, new.status;
  end if;
  if old.status <> 'in_progress' and new.status = 'in_progress' and new.started_at is null then
    new.started_at := now();
  end if;
  if new.status = 'done' then
    new.started_at := coalesce(old.started_at, now());
    new.completed_at := coalesce(old.completed_at, now());
  elsif old.status = 'done' then
    new.completed_at := null;
  end if;
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.submit_content_step_delivery(
  target_user_id uuid,
  target_task_id uuid,
  delivery_result_note text,
  delivery_result_url text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_record public.tasks%rowtype;
  actor_is_manager boolean;
  delivery_id uuid;
begin
  if target_user_id is null then raise exception 'A verified target user is required'; end if;
  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  select task.* into task_record
  from public.tasks task
  where task.id = target_task_id
    and task.content_item_id is not null
    and task.content_step in (
      'recording', 'editing', 'thumbnail', 'caption',
      'design', 'scheduling', 'publishing'
    )
  for update;
  if task_record.id is null then raise exception 'A deliverable content step was not found'; end if;

  select private.has_org_role(
    task_record.organization_id,
    array['owner', 'admin', 'manager']::public.app_role[]
  ) into actor_is_manager;
  if not actor_is_manager and task_record.owner_id <> target_user_id then
    raise exception 'Only the step owner or organization leadership can submit its result';
  end if;
  if task_record.status in ('backlog', 'blocked', 'cancelled') then
    raise exception 'This step is not ready for result submission';
  end if;
  if nullif(trim(delivery_result_note), '') is null
    and nullif(trim(delivery_result_url), '') is null then
    raise exception 'Add a result note or URL';
  end if;
  if nullif(trim(delivery_result_note), '') is not null
    and char_length(trim(delivery_result_note)) not between 3 and 10000 then
    raise exception 'Step result note is invalid';
  end if;
  if nullif(trim(delivery_result_url), '') is not null
    and (char_length(trim(delivery_result_url)) > 2000
      or trim(delivery_result_url) !~* '^https?://[^[:space:]]+$') then
    raise exception 'Step result URL must be a valid http or https link';
  end if;
  if task_record.content_step in ('recording', 'editing', 'thumbnail', 'design', 'publishing')
    and nullif(trim(delivery_result_url), '') is null then
    raise exception 'Recording, editing, thumbnail, design, and publishing steps require a result URL';
  end if;

  insert into public.content_step_deliveries (
    organization_id, content_item_id, task_id, step,
    result_note, result_url, submitted_by
  ) values (
    task_record.organization_id, task_record.content_item_id, task_record.id,
    task_record.content_step, nullif(trim(delivery_result_note), ''),
    nullif(trim(delivery_result_url), ''), target_user_id
  )
  on conflict (task_id) do update set
    result_note = excluded.result_note,
    result_url = excluded.result_url,
    version = public.content_step_deliveries.version + 1,
    submitted_by = excluded.submitted_by,
    submitted_at = now(),
    updated_at = now()
  returning id into delivery_id;

  if task_record.content_step = 'caption' and not task_record.is_work_item then
    update public.tasks set status = 'in_progress' where id = task_record.id and status = 'ready';
    update public.tasks set status = 'review' where id = task_record.id and status = 'in_progress';
    update public.tasks set status = 'done' where id = task_record.id and status = 'review';
  elsif task_record.content_step = 'publishing' then
    perform set_config('app.confirm_content_publishing_task_id', task_record.id::text, true);
    update public.tasks set status = 'done'
    where id = task_record.id and status in ('ready', 'in_progress', 'review');
  else
    update public.tasks set status = 'in_progress'
    where id = task_record.id and status = 'ready';
    update public.tasks set status = 'review'
    where id = task_record.id and status = 'in_progress';
  end if;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    task_record.organization_id, target_user_id, 'content.step_result_submitted',
    'content_step_delivery', delivery_id,
    jsonb_build_object(
      'content_item_id', task_record.content_item_id,
      'task_id', task_record.id,
      'step', task_record.content_step,
      'has_note', nullif(trim(delivery_result_note), '') is not null,
      'has_url', nullif(trim(delivery_result_url), '') is not null,
      'completed_inside_content_card',
        (task_record.content_step = 'caption' and not task_record.is_work_item)
        or task_record.content_step = 'publishing'
    )
  );
  return delivery_id;
end;
$$;

revoke all on function private.enforce_task_rules() from public, anon, authenticated;
revoke all on function private.require_content_step_delivery() from public, anon, authenticated;
revoke all on function public.submit_content_step_delivery(uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.submit_content_step_delivery(uuid, uuid, text, text)
to service_role;
