-- Regular content work must not wait for the owner. A single evidence-backed
-- submission completes the assigned task and unlocks its dependants. The old
-- approval rows remain only as cancelled audit history for backwards
-- compatibility with the existing workflow creation RPC signatures.

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

create or replace function private.advance_content_workflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_content_status public.content_status;
  previous_content_status public.content_status;
begin
  if new.content_item_id is null then return new; end if;

  select item.status into previous_content_status
  from public.content_items item
  where item.id = new.content_item_id
  for update;

  select case
    when bool_or(task.content_step = 'publishing' and task.status = 'done')
      then 'published'::public.content_status
    when bool_or(task.content_step = 'publishing' and task.status in ('ready', 'in_progress', 'review'))
      or bool_or(task.content_step = 'scheduling' and task.status in ('review', 'done'))
      then 'scheduled'::public.content_status
    when bool_or(task.content_step in ('recording', 'editing', 'thumbnail', 'caption', 'design', 'scheduling')
      and task.status in ('ready', 'in_progress', 'review', 'done'))
      then 'production'::public.content_status
    else 'planned'::public.content_status
  end into next_content_status
  from public.tasks task
  where task.content_item_id = new.content_item_id;

  if next_content_status is distinct from previous_content_status then
    update public.content_items item
    set status = next_content_status,
      published_at = case when next_content_status = 'published' then coalesce(item.published_at, now()) else null end,
      version = item.version + 1,
      updated_at = now()
    where item.id = new.content_item_id;

    insert into public.audit_events (
      organization_id, actor_id, action, entity_type, entity_id, before_data, after_data
    ) values (
      new.organization_id, (select auth.uid()), 'content.status_changed',
      'content_item', new.content_item_id,
      jsonb_build_object('status', previous_content_status),
      jsonb_build_object('status', next_content_status)
    );
  end if;
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

  if task_record.content_step = 'publishing' then
    perform set_config('app.confirm_content_publishing_task_id', task_record.id::text, true);
    update public.tasks set status = 'done'
    where id = task_record.id and status in ('ready', 'in_progress', 'review');
  else
    update public.tasks set status = 'in_progress'
    where id = task_record.id and status = 'ready';
    update public.tasks set status = 'review'
    where id = task_record.id and status = 'in_progress';
    update public.tasks set status = 'done'
    where id = task_record.id and status = 'review';
  end if;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    task_record.organization_id, target_user_id, 'content.step_completed',
    'content_step_delivery', delivery_id,
    jsonb_build_object(
      'content_item_id', task_record.content_item_id,
      'task_id', task_record.id,
      'step', task_record.content_step,
      'has_note', nullif(trim(delivery_result_note), '') is not null,
      'has_url', nullif(trim(delivery_result_url), '') is not null,
      'completed_by_single_submission', true
    )
  );
  return delivery_id;
end;
$$;

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
  if target_user_id is null then raise exception 'A verified target user is required'; end if;
  if target_action not in ('start', 'resolve', 'cancel') then raise exception 'Unknown revision action'; end if;
  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  select revision.* into revision_record
  from public.content_revision_requests revision
  where revision.id = target_revision_id
  for update;
  if revision_record.id is null then raise exception 'Revision request was not found'; end if;

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
  if revision_record.status in ('resolved', 'cancelled') then
    raise exception 'This revision request is already closed';
  end if;

  if target_action = 'cancel' then
    update public.content_revision_requests revision
    set status = 'cancelled', resolved_by = target_user_id, resolved_at = now()
    where revision.id = target_revision_id;
  else
    select task.status into task_status
    from public.tasks task where task.id = revision_record.task_id for update;
    if task_status = 'cancelled' then raise exception 'A cancelled workflow task cannot receive revisions'; end if;
    if task_status = 'backlog' then
      update public.tasks set status = 'ready' where id = revision_record.task_id;
      task_status := 'ready';
    end if;
    if task_status in ('ready', 'review', 'blocked', 'done') then
      update public.tasks set status = 'in_progress' where id = revision_record.task_id;
      task_status := 'in_progress';
    end if;

    if target_action = 'start' then
      update public.content_revision_requests revision
      set status = 'in_progress', started_at = coalesce(revision.started_at, now())
      where revision.id = target_revision_id;
    else
      if task_status = 'in_progress' then
        update public.tasks set status = 'review' where id = revision_record.task_id;
        update public.tasks set status = 'done' where id = revision_record.task_id;
      end if;
      update public.content_revision_requests revision
      set status = 'resolved', started_at = coalesce(revision.started_at, now()),
        resolved_by = target_user_id, resolved_at = now()
      where revision.id = target_revision_id;
    end if;
  end if;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    revision_record.organization_id, target_user_id,
    'content.revision_' || target_action, 'content_revision', target_revision_id,
    jsonb_build_object('status', revision_record.status),
    jsonb_build_object('status', case target_action when 'start' then 'in_progress' when 'resolve' then 'resolved' else 'cancelled' end)
  );
  return true;
end;
$$;

-- Reroute old workflow builders that still emit an approval dependency. This
-- keeps their stable public signatures while removing the blocking gate.
create or replace function private.reroute_content_approval_dependency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  dependent_task public.tasks%rowtype;
  predecessor_task public.tasks%rowtype;
begin
  select * into dependent_task from public.tasks where id = new.task_id;
  select * into predecessor_task from public.tasks where id = new.depends_on_task_id;
  if dependent_task.content_item_id is null
    or predecessor_task.content_item_id is distinct from dependent_task.content_item_id
    or predecessor_task.content_step <> 'approval' then
    return new;
  end if;

  delete from public.task_dependencies dependency
  where dependency.task_id = new.task_id
    and dependency.depends_on_task_id = new.depends_on_task_id;

  perform set_config('app.compact_workflow_content_id', dependent_task.content_item_id::text, true);
  update public.tasks task
  set status = 'cancelled', is_work_item = false
  where task.id = predecessor_task.id
    and task.status <> 'cancelled';

  delete from public.task_dependencies dependency
  where dependency.task_id = predecessor_task.id;

  if dependent_task.content_step = 'scheduling' then
    insert into public.task_dependencies (task_id, depends_on_task_id)
    select dependent_task.id, prerequisite.id
    from public.tasks prerequisite
    where prerequisite.content_item_id = dependent_task.content_item_id
      and prerequisite.content_step in ('caption', 'design')
    on conflict do nothing;
  elsif dependent_task.content_step = 'publishing' then
    insert into public.task_dependencies (task_id, depends_on_task_id)
    select dependent_task.id, prerequisite.id
    from public.tasks prerequisite
    join public.content_items item on item.id = prerequisite.content_item_id
    where prerequisite.content_item_id = dependent_task.content_item_id
      and prerequisite.content_step in (
        case when item.format = 'post' then 'scheduling'::public.content_step else 'editing'::public.content_step end,
        case when item.format = 'post' then 'scheduling'::public.content_step else 'thumbnail'::public.content_step end,
        case when item.format = 'post' then 'scheduling'::public.content_step else 'caption'::public.content_step end
      )
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists task_dependencies_reroute_content_approval on public.task_dependencies;
create trigger task_dependencies_reroute_content_approval
after insert on public.task_dependencies
for each row execute function private.reroute_content_approval_dependency();

create or replace function private.normalize_compact_reel_workflow(
  target_user_id uuid,
  target_organization_id uuid,
  target_content_item_id uuid,
  raw_material_ready boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  brief_task_id uuid;
  recording_task_id uuid;
  editing_task_id uuid;
  thumbnail_task_id uuid;
  caption_task_id uuid;
  approval_task_id uuid;
  publishing_task_id uuid;
begin
  perform set_config('request.jwt.claim.sub', target_user_id::text, true);
  perform set_config('app.compact_workflow_content_id', target_content_item_id::text, true);
  if not private.has_org_role(target_organization_id, array['owner', 'admin', 'manager']::public.app_role[]) then
    raise exception 'Only organization leadership can create content workflows';
  end if;

  select
    (max(task.id::text) filter (where task.content_step = 'brief'))::uuid,
    (max(task.id::text) filter (where task.content_step = 'recording'))::uuid,
    (max(task.id::text) filter (where task.content_step = 'editing'))::uuid,
    (max(task.id::text) filter (where task.content_step = 'thumbnail'))::uuid,
    (max(task.id::text) filter (where task.content_step = 'caption'))::uuid,
    (max(task.id::text) filter (where task.content_step = 'approval'))::uuid,
    (max(task.id::text) filter (where task.content_step = 'publishing'))::uuid
  into brief_task_id, recording_task_id, editing_task_id, thumbnail_task_id,
    caption_task_id, approval_task_id, publishing_task_id
  from public.tasks task
  where task.organization_id = target_organization_id
    and task.content_item_id = target_content_item_id;

  if brief_task_id is null or recording_task_id is null or editing_task_id is null
    or thumbnail_task_id is null or caption_task_id is null or publishing_task_id is null then
    raise exception 'The reel workflow is incomplete';
  end if;

  update public.tasks task
  set is_work_item = case
    when task.content_step in ('brief', 'caption', 'approval') then false
    when task.content_step = 'recording' and raw_material_ready then false
    else true
  end
  where task.content_item_id = target_content_item_id;

  if approval_task_id is not null then
    update public.tasks set status = 'cancelled'
    where id = approval_task_id and status <> 'cancelled';
  end if;

  delete from public.notifications notification
  using public.tasks task
  where task.content_item_id = target_content_item_id
    and not task.is_work_item
    and notification.entity_type = 'task'
    and notification.entity_id = task.id;

  delete from public.task_dependencies dependency
  using public.tasks task
  where dependency.task_id = task.id
    and task.content_item_id = target_content_item_id;

  if not raw_material_ready then
    insert into public.task_dependencies (task_id, depends_on_task_id)
    values (editing_task_id, recording_task_id);
  end if;

  insert into public.task_dependencies (task_id, depends_on_task_id) values
    (thumbnail_task_id, editing_task_id),
    (publishing_task_id, editing_task_id),
    (publishing_task_id, thumbnail_task_id),
    (publishing_task_id, caption_task_id)
  on conflict do nothing;

  update public.tasks set status = 'in_progress' where id = brief_task_id and status = 'ready';
  update public.tasks set status = 'review' where id = brief_task_id and status = 'in_progress';
  update public.tasks set status = 'done' where id = brief_task_id and status = 'review';
  if raw_material_ready then
    update public.tasks set status = 'cancelled'
    where id = recording_task_id and status in ('backlog', 'ready', 'in_progress', 'review');
    update public.tasks set status = 'ready' where id = editing_task_id and status = 'backlog';
  else
    update public.tasks set status = 'ready' where id = recording_task_id and status = 'backlog';
  end if;
  update public.tasks set status = 'ready' where id = caption_task_id and status = 'backlog';

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id, target_user_id, 'content.unblocked_workflow_created',
    'content_item', target_content_item_id,
    jsonb_build_object(
      'raw_material_ready', raw_material_ready,
      'approval_required', false,
      'single_submission_completes_work', true
    )
  );
end;
$$;

-- Notify every active owner when a real task is completed by somebody else.
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
    when new.crm_contact_id is not null then '/crm#lead-' || new.crm_contact_id
    when new.content_item_id is not null then '/content#content-' || new.content_item_id
    when new.launch_deliverable_id is not null then '/campaigns#deliverable-' || new.launch_deliverable_id
    else '/tasks'
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
        'اكتملت مهمة بواسطة ' || actor_name,
        new.title || case when new.completed_at > new.due_at then ' · اكتملت بعد الموعد' else ' · اكتملت في الموعد' end,
        'task', new.id, target_url,
        'task:' || new.id || ':done:v' || new.version || ':user:' || recipient_id
      );
    end loop;

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

-- Convert existing workflows without creating owner notifications for the
-- migration itself, then recompute the visible workflow state.
alter table public.tasks disable trigger user;

delete from public.task_dependencies dependency
using public.tasks predecessor
where predecessor.id = dependency.depends_on_task_id
  and predecessor.content_item_id is not null
  and predecessor.content_step = 'approval';

delete from public.task_dependencies dependency
using public.tasks dependent
where dependent.id = dependency.task_id
  and dependent.content_item_id is not null
  and dependent.content_step = 'approval';

update public.tasks task
set status = 'cancelled', is_work_item = false, completed_at = null,
  version = task.version + 1, updated_at = now()
where task.content_item_id is not null
  and task.content_step = 'approval'
  and task.status <> 'cancelled';

insert into public.task_dependencies (task_id, depends_on_task_id)
select publishing.id, prerequisite.id
from public.tasks publishing
join public.content_items item on item.id = publishing.content_item_id and item.format = 'reel'
join public.tasks prerequisite on prerequisite.content_item_id = publishing.content_item_id
  and prerequisite.content_step in ('editing', 'thumbnail', 'caption')
where publishing.content_step = 'publishing'
on conflict do nothing;

insert into public.task_dependencies (task_id, depends_on_task_id)
select scheduling.id, prerequisite.id
from public.tasks scheduling
join public.content_items item on item.id = scheduling.content_item_id and item.format = 'post'
join public.tasks prerequisite on prerequisite.content_item_id = scheduling.content_item_id
  and prerequisite.content_step in ('caption', 'design')
where scheduling.content_step = 'scheduling'
on conflict do nothing;

update public.tasks task
set status = case
    when exists (select 1 from public.content_step_deliveries delivery where delivery.task_id = task.id) then 'done'::public.task_status
    else 'ready'::public.task_status
  end,
  started_at = case when exists (select 1 from public.content_step_deliveries delivery where delivery.task_id = task.id) then coalesce(task.started_at, now()) else task.started_at end,
  completed_at = case when exists (select 1 from public.content_step_deliveries delivery where delivery.task_id = task.id) then coalesce(task.completed_at, now()) else null end,
  version = task.version + 1,
  updated_at = now()
where task.content_item_id is not null
  and task.content_step <> 'approval'
  and task.status = 'review';

update public.tasks candidate
set status = 'ready', version = candidate.version + 1, updated_at = now()
where candidate.status = 'backlog'
  and candidate.content_item_id is not null
  and not exists (
    select 1 from public.task_dependencies dependency
    join public.tasks predecessor on predecessor.id = dependency.depends_on_task_id
    where dependency.task_id = candidate.id and predecessor.status <> 'done'
  );

with derived as (
  select item.id,
    case
      when bool_or(task.content_step = 'publishing' and task.status = 'done') then 'published'::public.content_status
      when bool_or(task.content_step = 'publishing' and task.status in ('ready', 'in_progress', 'review'))
        or bool_or(task.content_step = 'scheduling' and task.status in ('review', 'done')) then 'scheduled'::public.content_status
      when bool_or(task.content_step in ('recording', 'editing', 'thumbnail', 'caption', 'design', 'scheduling')
        and task.status in ('ready', 'in_progress', 'review', 'done')) then 'production'::public.content_status
      else 'planned'::public.content_status
    end as next_status
  from public.content_items item
  left join public.tasks task on task.content_item_id = item.id
  group by item.id
)
update public.content_items item
set status = derived.next_status,
  published_at = case when derived.next_status = 'published' then coalesce(item.published_at, now()) else null end,
  version = item.version + 1,
  updated_at = now()
from derived
where item.id = derived.id and item.status is distinct from derived.next_status;

alter table public.tasks enable trigger user;

revoke all on function private.enforce_task_rules() from public, anon, authenticated;
revoke all on function private.advance_content_workflow() from public, anon, authenticated;
revoke all on function private.reroute_content_approval_dependency() from public, anon, authenticated;
revoke all on function private.notify_task_change() from public, anon, authenticated;
revoke all on function private.normalize_compact_reel_workflow(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.submit_content_step_delivery(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.submit_content_step_delivery(uuid, uuid, text, text) to service_role;
revoke all on function public.change_content_revision(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.change_content_revision(uuid, uuid, text) to service_role;
