-- Compact reel operations: keep workflow gates auditable without counting them as
-- team work, make raw-material work conditional, and keep the caption inside the
-- reel card under the content creator's ownership.

alter table public.tasks
  add column is_work_item boolean not null default true;

create index tasks_org_work_status_due_idx
  on public.tasks (organization_id, status, due_at, id)
  where is_work_item;

comment on column public.tasks.is_work_item is
  'True for accountable team work shown on boards and reports; false for internal workflow gates kept for audit and dependency automation.';

-- Existing reel gates stop inflating the board and team report. Existing raw
-- material means the recording checkpoint is retained for history but not shown
-- as a second piece of work.
alter table public.tasks disable trigger user;

update public.tasks task
set
  is_work_item = false,
  version = task.version + 1,
  updated_at = now()
from public.content_items item
where item.id = task.content_item_id
  and item.format = 'reel'
  and task.content_step in ('brief', 'caption', 'approval');

update public.tasks caption
set
  owner_id = recording.owner_id,
  version = caption.version + 1,
  updated_at = now()
from public.tasks recording
join public.content_items item on item.id = recording.content_item_id and item.format = 'reel'
where caption.content_item_id = recording.content_item_id
  and caption.content_step = 'caption'
  and recording.content_step = 'recording'
  and caption.owner_id is distinct from recording.owner_id;

update public.tasks task
set
  is_work_item = false,
  status = case when task.status in ('backlog', 'ready', 'in_progress') then 'cancelled'::public.task_status else task.status end,
  completed_at = case when task.status = 'done' then task.completed_at else null end,
  version = task.version + 1,
  updated_at = now()
from public.content_items item
where item.id = task.content_item_id
  and item.format = 'reel'
  and task.content_step = 'recording'
  and exists (
    select 1
    from public.content_assets asset
    where asset.content_item_id = task.content_item_id
      and asset.kind = 'raw_video'
  );

delete from public.task_dependencies dependency
using public.tasks editing, public.tasks recording
where dependency.task_id = editing.id
  and dependency.depends_on_task_id = recording.id
  and editing.content_item_id = recording.content_item_id
  and editing.content_step = 'editing'
  and recording.content_step = 'recording'
  and not recording.is_work_item;

update public.tasks task
set
  status = 'done',
  started_at = coalesce(task.started_at, now()),
  completed_at = coalesce(task.completed_at, now()),
  version = task.version + 1,
  updated_at = now()
from public.content_items item
where item.id = task.content_item_id
  and item.format = 'reel'
  and task.content_step = 'brief'
  and task.status not in ('done', 'cancelled');

update public.tasks task
set
  status = 'ready',
  version = task.version + 1,
  updated_at = now()
from public.content_items item
where item.id = task.content_item_id
  and item.format = 'reel'
  and task.status = 'backlog'
  and task.content_step in ('recording', 'editing', 'caption')
  and not exists (
    select 1
    from public.task_dependencies dependency
    join public.tasks predecessor on predecessor.id = dependency.depends_on_task_id
    where dependency.task_id = task.id
      and predecessor.status <> 'done'
  );

alter table public.tasks enable trigger user;

-- Preserve the immutable workflow contract after adding is_work_item.
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
  crm_command_contact_id text := nullif(current_setting('app.crm_contact_id', true), '');
  compact_workflow_content_id text := nullif(current_setting('app.compact_workflow_content_id', true), '');
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

  if not private.is_valid_task_transition(old.status, new.status) then
    raise exception 'Invalid task status transition from % to %', old.status, new.status;
  end if;
  if old.status <> 'in_progress' and new.status = 'in_progress' and new.started_at is null then
    new.started_at := now();
  end if;
  if new.status = 'done' then
    new.completed_at := coalesce(old.completed_at, now());
  elsif old.status = 'done' then
    new.completed_at := null;
  end if;
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

-- Notify only when a real work item or an actionable internal gate is ready.
create or replace function private.notify_task_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  reviewer_id uuid;
  target_url text := case
    when new.crm_contact_id is not null then '/crm#lead-' || new.crm_contact_id
    when new.content_item_id is not null then '/content#content-' || new.content_item_id
    when new.launch_deliverable_id is not null then '/campaigns#deliverable-' || new.launch_deliverable_id
    else '/tasks'
  end;
begin
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

  if new.owner_id is distinct from old.owner_id
    and (new.is_work_item or new.status = 'ready') then
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

  if new.is_work_item and new.status is distinct from old.status and new.status = 'review' then
    if new.content_item_id is not null then
      select task.owner_id into reviewer_id
      from public.tasks task
      where task.content_item_id = new.content_item_id
        and task.content_step = 'approval';
    end if;
    reviewer_id := coalesce(reviewer_id, new.created_by);
    if reviewer_id is distinct from actor then
      perform private.add_notification(
        new.organization_id, reviewer_id, 'task_review',
        'تسليم جديد يحتاج مراجعتك', new.title,
        'task', new.id, target_url,
        'task:' || new.id || ':review:v' || new.version || ':user:' || reviewer_id
      );
    end if;
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
    and new.status = 'done' and new.created_by is distinct from actor then
    perform private.add_notification(
      new.organization_id, new.created_by, 'task_done',
      'اكتملت مهمة', new.title,
      'task', new.id, target_url,
      'task:' || new.id || ':done:v' || new.version || ':user:' || new.created_by
    );
  end if;
  return new;
end;
$$;

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

  if not private.has_org_role(
    target_organization_id,
    array['owner', 'admin', 'manager']::public.app_role[]
  ) then
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
    or thumbnail_task_id is null or caption_task_id is null
    or approval_task_id is null or publishing_task_id is null then
    raise exception 'The reel workflow is incomplete';
  end if;

  update public.tasks task
  set is_work_item = case
    when task.content_step in ('brief', 'caption', 'approval') then false
    when task.content_step = 'recording' and raw_material_ready then false
    else true
  end
  where task.content_item_id = target_content_item_id;

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
    (approval_task_id, editing_task_id),
    (approval_task_id, thumbnail_task_id),
    (approval_task_id, caption_task_id),
    (publishing_task_id, approval_task_id);

  update public.tasks set status = 'in_progress' where id = brief_task_id and status = 'ready';
  update public.tasks set status = 'review' where id = brief_task_id and status = 'in_progress';
  update public.tasks set status = 'done' where id = brief_task_id and status = 'review';

  if raw_material_ready then
    update public.tasks
    set status = 'cancelled'
    where id = recording_task_id and status in ('backlog', 'ready', 'in_progress');
    update public.tasks set status = 'ready' where id = editing_task_id and status = 'backlog';
  else
    update public.tasks set status = 'ready' where id = recording_task_id and status = 'backlog';
  end if;

  update public.tasks set status = 'ready' where id = caption_task_id and status = 'backlog';

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id, target_user_id, 'content.compact_workflow_created',
    'content_item', target_content_item_id,
    jsonb_build_object(
      'raw_material_ready', raw_material_ready,
      'work_task_count', case when raw_material_ready then 3 else 4 end,
      'workflow_gate_count', case when raw_material_ready then 4 else 3 end,
      'caption_owned_by_content_creator', true
    )
  );
end;
$$;

revoke all on function private.normalize_compact_reel_workflow(uuid, uuid, uuid, boolean)
from public, anon, authenticated;

create or replace function public.create_reel_production_workflow_v3(
  target_user_id uuid,
  target_organization_id uuid,
  content_title text,
  content_goal text,
  content_hook text,
  content_cta text,
  content_script_outline text,
  content_editing_brief text,
  content_thumbnail_brief text,
  content_brand_notes text,
  target_publish_at timestamptz,
  content_creator_id uuid,
  editing_owner_id uuid,
  thumbnail_owner_id uuid,
  approval_owner_id uuid,
  publishing_owner_id uuid,
  initial_raw_url text,
  initial_source_url text,
  initial_reference_url text,
  target_brand_article_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  content_id uuid;
  raw_material_ready boolean := nullif(trim(initial_raw_url), '') is not null;
begin
  content_id := public.create_reel_production_workflow_v2(
    target_user_id, target_organization_id, content_title, content_goal, content_hook,
    content_cta, content_script_outline, content_editing_brief,
    content_thumbnail_brief, content_brand_notes, target_publish_at,
    target_user_id, content_creator_id, editing_owner_id, thumbnail_owner_id,
    content_creator_id, approval_owner_id, publishing_owner_id,
    initial_raw_url, initial_source_url, initial_reference_url,
    target_brand_article_ids
  );

  perform private.normalize_compact_reel_workflow(
    target_user_id, target_organization_id, content_id, raw_material_ready
  );
  return content_id;
end;
$$;

create or replace function public.create_reel_from_intake_v3(
  target_user_id uuid,
  target_organization_id uuid,
  content_title text,
  content_goal text,
  content_hook text,
  content_cta text,
  content_script_outline text,
  content_editing_brief text,
  content_thumbnail_brief text,
  content_brand_notes text,
  intake_request_text text,
  telegram_source_url text,
  parsed_timeline jsonb,
  parsed_assets jsonb,
  target_publish_at timestamptz,
  content_creator_id uuid,
  editing_owner_id uuid,
  thumbnail_owner_id uuid,
  approval_owner_id uuid,
  publishing_owner_id uuid,
  target_brand_article_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  content_id uuid;
begin
  content_id := public.create_reel_from_intake_v2(
    target_user_id, target_organization_id, content_title, content_goal, content_hook,
    content_cta, content_script_outline, content_editing_brief,
    content_thumbnail_brief, content_brand_notes, intake_request_text,
    telegram_source_url, parsed_timeline, parsed_assets, target_publish_at,
    target_user_id, content_creator_id, editing_owner_id, thumbnail_owner_id,
    content_creator_id, approval_owner_id, publishing_owner_id,
    target_brand_article_ids
  );

  perform private.normalize_compact_reel_workflow(
    target_user_id, target_organization_id, content_id, true
  );
  return content_id;
end;
$$;

revoke all on function public.create_reel_production_workflow_v3(
  uuid, uuid, text, text, text, text, text, text, text, text, timestamptz,
  uuid, uuid, uuid, uuid, uuid, text, text, text, uuid[]
) from public, anon, authenticated;
grant execute on function public.create_reel_production_workflow_v3(
  uuid, uuid, text, text, text, text, text, text, text, text, timestamptz,
  uuid, uuid, uuid, uuid, uuid, text, text, text, uuid[]
) to service_role;

revoke all on function public.create_reel_from_intake_v3(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text,
  jsonb, jsonb, timestamptz, uuid, uuid, uuid, uuid, uuid, uuid[]
) from public, anon, authenticated;
grant execute on function public.create_reel_from_intake_v3(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text,
  jsonb, jsonb, timestamptz, uuid, uuid, uuid, uuid, uuid, uuid[]
) to service_role;

-- A reel caption is saved by the content creator inside the reel card and becomes
-- final input for the single final-approval gate. Social-post captions keep their
-- existing review behavior.
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
    and task.content_step in ('caption', 'design', 'scheduling', 'publishing')
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
  if task_record.content_step in ('design', 'publishing')
    and nullif(trim(delivery_result_url), '') is null then
    raise exception 'Design and publishing steps require a result URL';
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
  else
    if task_record.status = 'ready' then
      update public.tasks set status = 'in_progress' where id = task_record.id;
      update public.tasks set status = 'review' where id = task_record.id;
    elsif task_record.status = 'in_progress' then
      update public.tasks set status = 'review' where id = task_record.id;
    end if;
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
      'completed_inside_content_card', task_record.content_step = 'caption' and not task_record.is_work_item
    )
  );
  return delivery_id;
end;
$$;

create or replace function public.change_reel_approval_gate(
  target_user_id uuid,
  target_task_id uuid,
  target_action text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_record public.tasks%rowtype;
  actor_is_manager boolean;
begin
  if target_user_id is null then raise exception 'A verified target user is required'; end if;
  perform set_config('request.jwt.claim.sub', target_user_id::text, true);
  select task.* into task_record
  from public.tasks task
  join public.content_items item on item.id = task.content_item_id and item.format = 'reel'
  where task.id = target_task_id
    and task.content_step = 'approval'
    and not task.is_work_item
  for update of task;
  if task_record.id is null then raise exception 'The reel approval gate was not found'; end if;

  select private.has_org_role(
    task_record.organization_id,
    array['owner', 'admin', 'manager']::public.app_role[]
  ) into actor_is_manager;
  if not actor_is_manager and task_record.owner_id <> target_user_id then
    raise exception 'Only the assigned reviewer or organization leadership can manage approval';
  end if;

  if target_action = 'start' then
    if task_record.status <> 'ready' then raise exception 'Final approval is not ready to start'; end if;
    update public.tasks set status = 'in_progress' where id = task_record.id;
  elsif target_action = 'approve' then
    if task_record.status not in ('in_progress', 'review') then
      raise exception 'Start final approval before approving the reel';
    end if;
    update public.tasks set status = 'review' where id = task_record.id and status = 'in_progress';
    update public.tasks set status = 'done' where id = task_record.id and status = 'review';
  else
    raise exception 'Unknown approval action';
  end if;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    task_record.organization_id, target_user_id,
    case when target_action = 'start' then 'content.approval_started' else 'content.approved' end,
    'task', task_record.id,
    jsonb_build_object('content_item_id', task_record.content_item_id, 'gate_action', target_action)
  );
  return true;
end;
$$;

revoke all on function public.submit_content_step_delivery(uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.submit_content_step_delivery(uuid, uuid, text, text)
to service_role;
revoke all on function public.change_reel_approval_gate(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.change_reel_approval_gate(uuid, uuid, text)
to service_role;

-- Team performance counts accountable work only. Internal gates remain available
-- in task history and audit events but cannot inflate an employee's workload.
create or replace function public.get_team_task_performance(
  target_organization_id uuid,
  range_starts_at timestamptz,
  range_ends_at timestamptz
)
returns table (
  user_id uuid,
  tasks_requested bigint,
  tasks_assigned bigint,
  tasks_completed bigint,
  completed_on_time bigint,
  completed_late bigint,
  overdue_open bigint,
  review_submissions bigint,
  revisions_requested bigint,
  revisions_received bigint,
  last_activity_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if range_starts_at is null or range_ends_at is null
    or range_starts_at >= range_ends_at
    or range_ends_at - range_starts_at > interval '366 days' then
    raise exception 'Choose a valid reporting period of no more than 366 days';
  end if;
  if not private.has_org_role(
    target_organization_id,
    array['owner', 'admin', 'manager']::public.app_role[]
  ) then
    raise exception 'Only organization leadership can view team performance';
  end if;

  return query
  select
    membership.user_id,
    (select count(*) from public.tasks task
      where task.organization_id = target_organization_id and task.is_work_item
        and task.created_by = membership.user_id
        and task.created_at >= range_starts_at and task.created_at < range_ends_at),
    (select count(*) from public.tasks task
      where task.organization_id = target_organization_id and task.is_work_item
        and task.owner_id = membership.user_id
        and task.created_at >= range_starts_at and task.created_at < range_ends_at),
    (select count(*) from public.tasks task
      where task.organization_id = target_organization_id and task.is_work_item
        and task.owner_id = membership.user_id
        and task.completed_at >= range_starts_at and task.completed_at < range_ends_at),
    (select count(*) from public.tasks task
      where task.organization_id = target_organization_id and task.is_work_item
        and task.owner_id = membership.user_id
        and task.completed_at >= range_starts_at and task.completed_at < range_ends_at
        and task.completed_at <= task.due_at),
    (select count(*) from public.tasks task
      where task.organization_id = target_organization_id and task.is_work_item
        and task.owner_id = membership.user_id
        and task.completed_at >= range_starts_at and task.completed_at < range_ends_at
        and task.completed_at > task.due_at),
    (select count(*) from public.tasks task
      where task.organization_id = target_organization_id and task.is_work_item
        and task.owner_id = membership.user_id
        and task.status not in ('done', 'cancelled') and task.due_at < now()),
    (select count(*) from public.task_events event
      join public.tasks task on task.id = event.task_id and task.is_work_item
      where event.organization_id = target_organization_id
        and task.owner_id = membership.user_id
        and event.to_status = 'review'
        and event.occurred_at >= range_starts_at and event.occurred_at < range_ends_at),
    (select count(*) from public.content_revision_requests revision
      where revision.organization_id = target_organization_id
        and revision.requested_by = membership.user_id
        and revision.requested_at >= range_starts_at and revision.requested_at < range_ends_at),
    (select count(*) from public.content_revision_requests revision
      where revision.organization_id = target_organization_id
        and revision.assigned_to = membership.user_id
        and revision.requested_at >= range_starts_at and revision.requested_at < range_ends_at),
    (select max(event.occurred_at) from public.task_events event
      join public.tasks task on task.id = event.task_id and task.is_work_item
      where event.organization_id = target_organization_id
        and event.actor_id = membership.user_id)
  from public.memberships membership
  where membership.organization_id = target_organization_id
    and membership.status = 'active'
    and membership.role <> 'viewer'
  order by membership.joined_at nulls last, membership.user_id;
end;
$$;

revoke all on function public.get_team_task_performance(uuid, timestamptz, timestamptz)
from public, anon, authenticated;
grant execute on function public.get_team_task_performance(uuid, timestamptz, timestamptz)
to authenticated;
