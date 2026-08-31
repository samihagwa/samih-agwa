-- A direct reel starts only after its Telegram raw material is durable. The
-- database owns this invariant so stale browsers and old Edge deployments
-- cannot start editing, cover, or publishing work prematurely.

create or replace function private.content_has_real_raw_material(
  target_content_item_id uuid,
  target_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1
      from public.content_assets asset
      where asset.content_item_id = target_content_item_id
        and asset.organization_id = target_organization_id
        and asset.stage = 'recording'
        and asset.kind in ('raw_video', 'audio', 'source')
        and char_length(trim(asset.url)) <= 2000
        and trim(asset.url) ~* '^https?://[^[:space:]]+$'
    )
    or exists (
      -- Compatibility for a real recording handoff completed before this
      -- migration started materializing every delivery as an asset.
      select 1
      from public.tasks task
      join public.content_step_deliveries delivery
        on delivery.task_id = task.id
       and delivery.content_item_id = task.content_item_id
       and delivery.organization_id = task.organization_id
       and delivery.step = 'recording'
      where task.content_item_id = target_content_item_id
        and task.organization_id = target_organization_id
        and task.content_step = 'recording'
        and task.status = 'done'
        and char_length(trim(delivery.result_url)) <= 2000
        and trim(delivery.result_url) ~* '^https?://[^[:space:]]+$'
    );
$$;

revoke all on function private.content_has_real_raw_material(uuid, uuid)
from public, anon, authenticated, service_role;

-- Repair every active simplified-intake reel workflow that has no durable raw
-- handoff. Published and cancelled history is deliberately preserved. Missing
-- recording tasks are restored to the best active working member, preferring
-- the requester.
create temporary table direct_reel_raw_gate_repairs on commit drop as
select item.id as content_item_id, item.organization_id, item.created_by,
  item.title, item.intake_request, item.publish_at
from public.content_items item
where item.format = 'reel'
  and item.intake_request_key is not null
  and item.status not in ('published', 'cancelled')
  and not private.content_has_real_raw_material(item.id, item.organization_id)
  and exists (
    select 1
    from public.tasks task
    where task.content_item_id = item.id
      and task.content_step in ('recording', 'editing', 'thumbnail', 'publishing')
      and task.status <> 'cancelled'
  );

alter table public.tasks disable trigger user;

insert into public.tasks (
  organization_id, title, description, status, priority, owner_id,
  created_by, acceptance_criteria, requires_review, due_at,
  content_item_id, content_step, is_work_item, estimated_minutes
)
select
  repair.organization_id,
  left('إرسال المادة الخام: ' || trim(repair.title), 180),
  left('كل المطلوب والروابط:' || chr(10) || coalesce(repair.intake_request, repair.title), 5000),
  'ready'::public.task_status,
  'normal'::public.task_priority,
  recording_owner.user_id,
  repair.created_by,
  '',
  false,
  now() + interval '30 minutes',
  repair.content_item_id,
  'recording'::public.content_step,
  true,
  30
from direct_reel_raw_gate_repairs repair
join lateral (
  select membership.user_id
  from public.memberships membership
  where membership.organization_id = repair.organization_id
    and membership.status = 'active'
    and membership.role <> 'viewer'
    and (
      membership.role = 'owner'
      or 'tasks' = any(membership.allowed_sections)
    )
  order by
    case when membership.user_id = repair.created_by then 0 else 1 end,
    case membership.role
      when 'owner' then 0
      when 'admin' then 1
      when 'manager' then 2
      else 3
    end,
    membership.user_id
  limit 1
) recording_owner on true
where not exists (
  select 1 from public.tasks existing
  where existing.content_item_id = repair.content_item_id
    and existing.content_step = 'recording'
);

update public.tasks task
set status = case
      when task.content_step = 'recording' then 'ready'::public.task_status
      else 'backlog'::public.task_status
    end,
    owner_id = case
      when task.content_step = 'recording' and not exists (
        select 1 from public.memberships current_owner
        where current_owner.organization_id = task.organization_id
          and current_owner.user_id = task.owner_id
          and current_owner.status = 'active'
          and current_owner.role <> 'viewer'
          and (
            current_owner.role = 'owner'
            or 'tasks' = any(current_owner.allowed_sections)
          )
      ) then coalesce((
        select replacement.user_id
        from public.memberships replacement
        where replacement.organization_id = task.organization_id
          and replacement.status = 'active'
          and replacement.role <> 'viewer'
          and (
            replacement.role = 'owner'
            or 'tasks' = any(replacement.allowed_sections)
          )
        order by
          case when replacement.user_id = repair.created_by then 0 else 1 end,
          case replacement.role
            when 'owner' then 0
            when 'admin' then 1
            when 'manager' then 2
            else 3
          end,
          replacement.user_id
        limit 1
      ), task.owner_id)
      else task.owner_id
    end,
    started_at = null,
    completed_at = null,
    version = task.version + 1,
    updated_at = now()
from direct_reel_raw_gate_repairs repair
where task.content_item_id = repair.content_item_id
  and task.content_step in ('recording', 'editing', 'thumbnail', 'publishing')
  and (task.content_step = 'recording' or task.status <> 'cancelled');

alter table public.tasks enable trigger user;

-- A repaired cover must wait for the raw handoff just like editing. This does
-- not serialize cover behind editing; both unlock together when recording is
-- submitted with its real URL.
insert into public.task_dependencies (task_id, depends_on_task_id)
select downstream.id, recording.id
from direct_reel_raw_gate_repairs repair
join public.tasks recording
  on recording.content_item_id = repair.content_item_id
 and recording.content_step = 'recording'
join public.tasks downstream
  on downstream.content_item_id = repair.content_item_id
 and downstream.content_step in ('editing', 'thumbnail')
on conflict (task_id, depends_on_task_id) do nothing;

update public.content_items item
set status = 'production',
    published_at = null,
    version = item.version + 1,
    updated_at = now()
from direct_reel_raw_gate_repairs repair
where item.id = repair.content_item_id;

insert into public.audit_events (
  organization_id, actor_id, action, entity_type, entity_id, after_data
)
select
  repair.organization_id,
  null,
  'content.raw_material_gate_repaired',
  'content_item',
  repair.content_item_id,
  jsonb_build_object(
    'reason', 'missing_real_raw_material',
    'downstream_reset_to_backlog', true,
    'recording_task_available', exists (
      select 1 from public.tasks task
      where task.content_item_id = repair.content_item_id
        and task.content_step = 'recording'
        and task.status = 'ready'
    )
  )
from direct_reel_raw_gate_repairs repair;

create or replace function private.guard_reel_task_prerequisites()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is not distinct from old.status
    or new.content_item_id is null
    or new.content_step not in ('editing', 'thumbnail', 'publishing')
    or new.status not in ('ready', 'in_progress', 'review', 'done')
    or not exists (
      select 1 from public.content_items item
      where item.id = new.content_item_id
        and item.organization_id = new.organization_id
        and item.format = 'reel'
    ) then
    return new;
  end if;

  if not private.content_has_real_raw_material(
    new.content_item_id,
    new.organization_id
  ) then
    raise exception 'Reel raw material must be attached before this step can start';
  end if;

  if exists (
    select 1
    from public.task_dependencies dependency
    join public.tasks prerequisite
      on prerequisite.id = dependency.depends_on_task_id
    where dependency.task_id = new.id
      and (
        prerequisite.organization_id <> new.organization_id
        or prerequisite.content_item_id is distinct from new.content_item_id
        or prerequisite.status <> 'done'
      )
  ) then
    raise exception 'Complete every prerequisite before this content step can advance';
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_00_guard_reel_prerequisites on public.tasks;
create trigger tasks_00_guard_reel_prerequisites
before update of status on public.tasks
for each row execute function private.guard_reel_task_prerequisites();

revoke all on function private.guard_reel_task_prerequisites()
from public, anon, authenticated, service_role;

-- The generic unlock trigger can observe two parallel prerequisite completions
-- before either transaction commits, leaving their common dependent asleep.
-- Lock the reel dependent row explicitly, then re-check in a fresh statement;
-- the second concurrent completion will wait and see the first commit.
create or replace function private.unlock_reel_dependencies_serialized()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  dependent_task_id uuid;
begin
  if tg_op <> 'UPDATE'
    or old.status = 'done'
    or new.status <> 'done'
    or new.content_item_id is null
    or not exists (
      select 1 from public.content_items item
      where item.id = new.content_item_id
        and item.organization_id = new.organization_id
        and item.format = 'reel'
    ) then
    return new;
  end if;

  for dependent_task_id in
    select dependency.task_id
    from public.task_dependencies dependency
    join public.tasks candidate on candidate.id = dependency.task_id
    where dependency.depends_on_task_id = new.id
      and candidate.organization_id = new.organization_id
      and candidate.content_item_id = new.content_item_id
    order by dependency.task_id
  loop
    perform candidate.id
    from public.tasks candidate
    where candidate.id = dependent_task_id
    for update;

    update public.tasks candidate
    set status = 'ready'
    where candidate.id = dependent_task_id
      and candidate.organization_id = new.organization_id
      and candidate.content_item_id = new.content_item_id
      and candidate.status = 'backlog'
      and private.content_has_real_raw_material(
        candidate.content_item_id,
        candidate.organization_id
      )
      and not exists (
        select 1
        from public.task_dependencies dependency
        join public.tasks prerequisite
          on prerequisite.id = dependency.depends_on_task_id
        where dependency.task_id = candidate.id
          and (
            prerequisite.organization_id <> candidate.organization_id
            or prerequisite.content_item_id is distinct from candidate.content_item_id
            or prerequisite.status <> 'done'
          )
      );
  end loop;

  return new;
end;
$$;

drop trigger if exists tasks_11_unlock_reel_dependencies_serialized on public.tasks;
create trigger tasks_11_unlock_reel_dependencies_serialized
after update of status on public.tasks
for each row execute function private.unlock_reel_dependencies_serialized();

revoke all on function private.unlock_reel_dependencies_serialized()
from public, anon, authenticated, service_role;

create or replace function public.create_direct_reel_workflow_v2(
  target_user_id uuid,
  target_organization_id uuid,
  request_id uuid,
  content_title text,
  content_request_text text,
  target_publish_at timestamptz,
  raw_materials jsonb,
  editing_owner_id uuid,
  thumbnail_owner_id uuid,
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
  editing_task_id uuid;
  thumbnail_task_id uuid;
  publishing_task_id uuid;
  request_text text := trim(content_request_text);
  schedule_span interval;
  task_request text;
begin
  if target_user_id is null then
    raise exception 'A verified target user is required';
  end if;
  if target_organization_id is null then
    raise exception 'A target organization is required';
  end if;
  if request_id is null then
    raise exception 'A stable request id is required';
  end if;

  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  if not exists (
    select 1
    from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = target_user_id
      and membership.status = 'active'
      and membership.role in ('owner', 'admin', 'manager')
      and (
        membership.role = 'owner'
        or 'tasks' = any(membership.allowed_sections)
      )
      and (
        membership.role = 'owner'
        or 'content' = any(membership.allowed_sections)
      )
  ) then
    raise exception 'Only organization leadership with Content and Tasks access can create a direct reel workflow';
  end if;

  -- The idempotency key is authoritative for an already committed request.
  -- Check it before time-sensitive validation so a safe retry still returns
  -- the original content after the deadline has moved closer.
  perform pg_advisory_xact_lock(
    hashtextextended(target_organization_id::text || ':' || request_id::text, 0)
  );

  select item.id into content_id
  from public.content_items item
  where item.organization_id = target_organization_id
    and item.intake_request_key = request_id;
  if content_id is not null then
    return content_id;
  end if;

  if target_publish_at is null
    or target_publish_at <= now() + interval '1 hour' then
    raise exception 'Publish time must be at least one hour in the future';
  end if;
  if content_title is null
    or char_length(trim(content_title)) not between 3 and 180
    or content_request_text is null
    or char_length(request_text) not between 10 and 30000 then
    raise exception 'Content title or full request is incomplete';
  end if;

  if raw_materials is null
    or jsonb_typeof(raw_materials) is distinct from 'array' then
    raise exception 'Raw materials must be a JSON array';
  end if;
  if jsonb_array_length(raw_materials) not between 1 and 10 then
    raise exception 'Add between one and ten raw material links';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(raw_materials) material(value)
    where jsonb_typeof(material.value) is distinct from 'object'
  ) then
    raise exception 'Every raw material must be an object';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(raw_materials) material(value)
    where (material.value - array['kind', 'url', 'title']::text[]) <> '{}'::jsonb
      or not (material.value ? 'kind')
      or not (material.value ? 'url')
      or jsonb_typeof(material.value->'kind') is distinct from 'string'
      or jsonb_typeof(material.value->'url') is distinct from 'string'
      or lower(trim(material.value->>'kind')) not in ('raw_video', 'audio', 'source')
      or char_length(trim(material.value->>'url')) > 2000
      or trim(material.value->>'url') !~* '^https://(t\.me|telegram\.me)/[^[:space:]]+$'
      or (
        material.value ? 'title'
        and jsonb_typeof(material.value->'title') <> 'null'
        and (
          jsonb_typeof(material.value->'title') is distinct from 'string'
          or char_length(trim(material.value->>'title')) not between 2 and 160
        )
      )
  ) then
    raise exception 'Each raw material needs a valid type and Telegram URL';
  end if;
  if (
    select count(*) <> count(distinct lower(trim(material.value->>'url')))
    from jsonb_array_elements(raw_materials) material(value)
  ) then
    raise exception 'Raw material links must be distinct';
  end if;

  if exists (
    select 1
    from unnest(array[
      editing_owner_id,
      thumbnail_owner_id,
      publishing_owner_id
    ]) owner(user_id)
    where owner.user_id is null
      or not exists (
        select 1
        from public.memberships membership
        where membership.organization_id = target_organization_id
          and membership.user_id = owner.user_id
          and membership.status = 'active'
          and membership.role <> 'viewer'
          and (
            membership.role = 'owner'
            or 'tasks' = any(membership.allowed_sections)
          )
      )
  ) then
    raise exception 'Every workflow owner must be an active non-viewer member with Tasks access';
  end if;

  perform private.assert_approved_brand_references(
    target_organization_id,
    target_brand_article_ids
  );

  schedule_span := target_publish_at - now();
  task_request := left('كل المطلوب والروابط:' || chr(10) || request_text, 5000);

  insert into public.content_items (
    organization_id, title, format, goal, hook, cta, platforms, status,
    publish_at, script_outline, editing_brief, thumbnail_brief,
    intake_request, intake_source_url, intake_request_key, created_by
  ) values (
    target_organization_id,
    trim(content_title),
    'reel',
    'تنفيذ الطلب كما كتبه طالب المحتوى في خانة كل المطلوب.',
    'حسب نص الطلب الكامل.',
    'حسب نص الطلب الكامل.',
    array['instagram']::text[],
    'planned',
    target_publish_at,
    left(request_text, 8000),
    left(request_text, 8000),
    left(request_text, 4000),
    request_text,
    trim(raw_materials->0->>'url'),
    request_id,
    target_user_id
  )
  returning id into content_id;

  insert into public.content_assets (
    organization_id, content_item_id, stage, kind, title, url, notes, created_by
  )
  select
    target_organization_id,
    content_id,
    'recording'::public.content_step,
    lower(trim(material.value->>'kind'))::public.content_asset_kind,
    coalesce(
      nullif(trim(material.value->>'title'), ''),
      'المادة الخام ' || material.ordinality
    ),
    trim(material.value->>'url'),
    'مرفقة مع طلب الريلز المباشر قبل إنشاء مهام التنفيذ.',
    target_user_id
  from jsonb_array_elements(raw_materials) with ordinality material(value, ordinality);

  insert into public.tasks (
    organization_id, title, description, status, priority, owner_id,
    created_by, acceptance_criteria, requires_review, due_at,
    content_item_id, content_step, is_work_item, estimated_minutes
  ) values (
    target_organization_id,
    left('مونتاج الريلز: ' || trim(content_title), 180),
    task_request,
    'ready',
    'normal',
    editing_owner_id,
    target_user_id,
    '',
    false,
    now() + schedule_span * 0.60,
    content_id,
    'editing',
    true,
    180
  ) returning id into editing_task_id;

  insert into public.tasks (
    organization_id, title, description, status, priority, owner_id,
    created_by, acceptance_criteria, requires_review, due_at,
    content_item_id, content_step, is_work_item, estimated_minutes
  ) values (
    target_organization_id,
    left('غلاف الريلز: ' || trim(content_title), 180),
    task_request,
    'ready',
    'normal',
    thumbnail_owner_id,
    target_user_id,
    '',
    false,
    now() + schedule_span * 0.68,
    content_id,
    'thumbnail',
    true,
    90
  ) returning id into thumbnail_task_id;

  insert into public.tasks (
    organization_id, title, description, status, priority, owner_id,
    created_by, acceptance_criteria, requires_review, due_at,
    content_item_id, content_step, is_work_item, estimated_minutes
  ) values (
    target_organization_id,
    left('نشر الريلز: ' || trim(content_title), 180),
    task_request,
    'backlog',
    'normal',
    publishing_owner_id,
    target_user_id,
    '',
    false,
    target_publish_at,
    content_id,
    'publishing',
    true,
    30
  ) returning id into publishing_task_id;

  insert into public.task_dependencies (task_id, depends_on_task_id) values
    (publishing_task_id, editing_task_id),
    (publishing_task_id, thumbnail_task_id);

  perform private.link_brand_references(
    target_user_id,
    target_organization_id,
    content_id,
    target_brand_article_ids
  );

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, request_id, after_data
  ) values (
    target_organization_id,
    target_user_id,
    'content.direct_reel_workflow_created',
    'content_item',
    content_id,
    request_id,
    jsonb_build_object(
      'raw_material_count', jsonb_array_length(raw_materials),
      'raw_material_types', (
        select jsonb_agg(raw_type order by raw_type)
        from (
          select distinct lower(trim(material.value->>'kind')) as raw_type
          from jsonb_array_elements(raw_materials) material(value)
        ) types
      ),
      'visible_work_task_count', 3,
      'canonical_request_length', char_length(request_text),
      'recording_task_created', false
    )
  );

  return content_id;
end;
$$;

revoke all on function public.create_direct_reel_workflow_v2(
  uuid, uuid, uuid, text, text, timestamptz, jsonb,
  uuid, uuid, uuid, uuid[]
) from public, anon, authenticated;
grant execute on function public.create_direct_reel_workflow_v2(
  uuid, uuid, uuid, text, text, timestamptz, jsonb,
  uuid, uuid, uuid, uuid[]
) to service_role;

-- Fail closed if an old direct Edge deployment still tries to trust the
-- raw_material_sent checkbox. Internal planning/script functions execute as
-- the function owner and keep their explicit recording-task workflow.
revoke execute on function public.create_simplified_content_workflow_v1(
  uuid, uuid, uuid, text, text, timestamptz, boolean, text,
  uuid, uuid, uuid, uuid, uuid[]
) from service_role;

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
  delivery_id uuid;
  raw_asset_id uuid;
  clean_note text := nullif(trim(delivery_result_note), '');
  clean_url text := nullif(trim(delivery_result_url), '');
begin
  if target_user_id is null then
    raise exception 'A verified target user is required';
  end if;
  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  -- Read once for authorization, lock prerequisites in a deterministic order,
  -- then lock and re-read the task before making any change.
  select task.* into task_record
  from public.tasks task
  where task.id = target_task_id
    and task.content_item_id is not null
    and task.content_step in (
      'recording', 'editing', 'thumbnail', 'caption',
      'design', 'scheduling', 'publishing'
    );
  if task_record.id is null then
    raise exception 'A deliverable content step was not found';
  end if;

  if not exists (
    select 1 from public.memberships membership
    where membership.organization_id = task_record.organization_id
      and membership.user_id = target_user_id
      and membership.status = 'active'
      and membership.role <> 'viewer'
  ) then
    raise exception 'Only an active non-viewer organization member can submit a result';
  end if;
  if task_record.owner_id <> target_user_id then
    raise exception 'Only the assigned step owner can submit its result';
  end if;

  perform prerequisite.id
  from public.task_dependencies dependency
  join public.tasks prerequisite on prerequisite.id = dependency.depends_on_task_id
  where dependency.task_id = target_task_id
  order by prerequisite.id
  for update of prerequisite;

  select task.* into task_record
  from public.tasks task
  where task.id = target_task_id
    and task.content_item_id is not null
    and task.content_step in (
      'recording', 'editing', 'thumbnail', 'caption',
      'design', 'scheduling', 'publishing'
    )
  for update;
  if task_record.id is null then
    raise exception 'A deliverable content step was not found';
  end if;
  if task_record.owner_id <> target_user_id then
    raise exception 'Only the assigned step owner can submit its result';
  end if;
  if task_record.status in ('backlog', 'blocked', 'cancelled') then
    raise exception 'This step is not ready for result submission';
  end if;
  if exists (
    select 1
    from public.task_dependencies dependency
    join public.tasks prerequisite
      on prerequisite.id = dependency.depends_on_task_id
    where dependency.task_id = task_record.id
      and (
        prerequisite.organization_id <> task_record.organization_id
        or prerequisite.content_item_id is distinct from task_record.content_item_id
        or prerequisite.status <> 'done'
      )
  ) then
    raise exception 'Complete every prerequisite before submitting this content step';
  end if;

  if clean_note is null and clean_url is null then
    raise exception 'Add a result note or URL';
  end if;
  if clean_note is not null
    and char_length(clean_note) not between 3 and 10000 then
    raise exception 'Step result note is invalid';
  end if;
  if clean_url is not null
    and (
      char_length(clean_url) > 2000
      or clean_url !~* '^https?://[^[:space:]]+$'
    ) then
    raise exception 'Step result URL must be a valid http or https link';
  end if;
  if task_record.content_step in ('recording', 'editing', 'thumbnail', 'design', 'publishing')
    and clean_url is null then
    raise exception 'Recording, editing, thumbnail, design, and publishing steps require a result URL';
  end if;

  if task_record.content_step in ('editing', 'thumbnail', 'publishing')
    and exists (
      select 1 from public.content_items item
      where item.id = task_record.content_item_id
        and item.organization_id = task_record.organization_id
        and item.format = 'reel'
    )
    and not private.content_has_real_raw_material(
      task_record.content_item_id,
      task_record.organization_id
    ) then
    raise exception 'Attach the reel raw material before submitting this step';
  end if;

  if task_record.content_step = 'publishing'
    and clean_note is null
    and not exists (
      select 1 from public.content_items item
      where item.id = task_record.content_item_id
        and nullif(trim(item.caption_brief), '') is not null
    ) then
    raise exception 'Publishing requires the final caption in the same delivery form';
  end if;

  if task_record.content_step = 'recording' then
    select asset.id into raw_asset_id
    from public.content_assets asset
    where asset.organization_id = task_record.organization_id
      and asset.content_item_id = task_record.content_item_id
      and asset.stage = 'recording'
      and asset.kind in ('raw_video', 'audio', 'source')
      and trim(asset.url) = clean_url
    order by asset.created_at, asset.id
    limit 1;

    if raw_asset_id is null then
      insert into public.content_assets (
        organization_id, content_item_id, stage, kind,
        title, url, notes, created_by
      ) values (
        task_record.organization_id,
        task_record.content_item_id,
        'recording',
        'source',
        'المادة الخام — تسليم التسجيل',
        clean_url,
        'أضيفت تلقائيًا من تسليم مهمة المادة الخام.',
        target_user_id
      ) returning id into raw_asset_id;
    end if;
  end if;

  if task_record.content_step = 'recording'
    and clean_note is not null
    and clean_note <> 'تم إرسال المادة الخام على Telegram.' then
    update public.content_items item set
      caption_brief = clean_note,
      version = item.version + 1,
      updated_at = now()
    where item.id = task_record.content_item_id;
  elsif task_record.content_step = 'publishing' then
    update public.content_items item set
      caption_brief = coalesce(clean_note, item.caption_brief),
      version = case when clean_note is null then item.version else item.version + 1 end,
      updated_at = case when clean_note is null then item.updated_at else now() end
    where item.id = task_record.content_item_id;
  end if;

  insert into public.content_step_deliveries (
    organization_id, content_item_id, task_id, step,
    result_note, result_url, submitted_by
  ) values (
    task_record.organization_id,
    task_record.content_item_id,
    task_record.id,
    task_record.content_step,
    case
      when task_record.content_step = 'publishing' then coalesce(
        clean_note,
        (select nullif(trim(item.caption_brief), '')
         from public.content_items item
         where item.id = task_record.content_item_id)
      )
      else clean_note
    end,
    clean_url,
    target_user_id
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
    task_record.organization_id,
    target_user_id,
    'content.step_completed',
    'content_step_delivery',
    delivery_id,
    jsonb_build_object(
      'content_item_id', task_record.content_item_id,
      'task_id', task_record.id,
      'step', task_record.content_step,
      'has_note', clean_note is not null,
      'has_url', clean_url is not null,
      'raw_asset_id', raw_asset_id,
      'completed_by_single_submission', true
    )
  );

  return delivery_id;
end;
$$;

revoke all on function public.submit_content_step_delivery(uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.submit_content_step_delivery(uuid, uuid, text, text)
to service_role;

comment on function public.create_direct_reel_workflow_v2(
  uuid, uuid, uuid, text, text, timestamptz, jsonb,
  uuid, uuid, uuid, uuid[]
) is
  'Atomically creates a direct reel only after 1-10 distinct Telegram raw-material links are validated and persisted.';
