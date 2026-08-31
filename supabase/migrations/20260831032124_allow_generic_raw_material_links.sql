-- Raw material may live on any trusted web host. Keep the existing atomic
-- direct-reel workflow and legacy Telegram intake, while removing the accidental
-- t.me-only restriction from generic source and raw-material fields.

alter table public.content_items
  drop constraint if exists content_items_intake_source_url_http;

alter table public.content_items
  add constraint content_items_intake_source_url_http
  check (
    intake_source_url is null
    or (
      char_length(trim(intake_source_url)) <= 2000
      and trim(intake_source_url) ~* '^https?://[^[:space:]@/?#]+([/?#][^[:space:]]*)?$'
    )
  ) not valid;

alter table public.content_items
  validate constraint content_items_intake_source_url_http;

comment on constraint content_items_intake_source_url_http on public.content_items is
  'Optional canonical source may be any credential-free HTTP or HTTPS URL up to 2000 characters.';

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
      or trim(material.value->>'url') !~* '^https?://[^[:space:]@/?#]+([/?#][^[:space:]]*)?$'
      or (
        material.value ? 'title'
        and jsonb_typeof(material.value->'title') <> 'null'
        and (
          jsonb_typeof(material.value->'title') is distinct from 'string'
          or char_length(trim(material.value->>'title')) not between 2 and 160
        )
      )
  ) then
    raise exception 'Each raw material needs a valid type and HTTP or HTTPS URL';
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


comment on function public.create_direct_reel_workflow_v2(
  uuid, uuid, uuid, text, text, timestamptz, jsonb,
  uuid, uuid, uuid, uuid[]
) is
  'Atomically creates a direct reel only after 1-10 distinct HTTP or HTTPS raw-material links are validated and persisted.';

create or replace function public.update_content_request_v1(
  target_user_id uuid,
  target_content_item_id uuid,
  expected_content_version bigint,
  content_request_text text,
  request_source_url text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_record public.content_items%rowtype;
  request_text text := trim(content_request_text);
  source_url text := nullif(trim(coalesce(request_source_url, '')), '');
begin
  if target_user_id is null then
    raise exception 'A verified target user is required';
  end if;

  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  select * into item_record
  from public.content_items item
  where item.id = target_content_item_id
  for update;

  if item_record.id is null then
    raise exception 'Content item was not found';
  end if;

  if not exists (
    select 1
    from public.memberships membership
    where membership.organization_id = item_record.organization_id
      and membership.user_id = target_user_id
      and membership.status = 'active'
      and membership.role <> 'viewer'
  ) then
    raise exception 'Only an active non-viewer organization member can update the request';
  end if;

  if item_record.created_by <> target_user_id
    and not private.has_org_role(
      item_record.organization_id,
      array['owner','admin','manager']::public.app_role[]
    ) then
    raise exception 'Only the content requester or organization leadership can update the request';
  end if;

  if not private.actor_can_access_any_section(
    target_user_id,
    item_record.organization_id,
    array['content']::text[]
  ) then
    raise exception 'Content access is required to update the request';
  end if;

  if not private.can_read_content_actor(
    target_user_id,
    item_record.organization_id,
    target_content_item_id
  ) then
    raise exception 'The content request is outside this member''s scope';
  end if;

  if char_length(request_text) not between 10 and 30000 then
    raise exception 'The full content request must contain between 10 and 30000 characters';
  end if;

  if source_url is not null
    and (char_length(source_url) > 2000
      or source_url !~* '^https?://[^[:space:]@/?#]+([/?#][^[:space:]]*)?$' )
  then
    raise exception 'The optional source must be a valid HTTP or HTTPS URL of at most 2000 characters';
  end if;

  update public.content_items item
  set intake_request = request_text,
      intake_source_url = source_url,
      version = item.version + 1,
      updated_at = now()
  where item.id = target_content_item_id
    and item.version = expected_content_version;

  if not found then
    raise exception 'Content changed in another session. Refresh and try again';
  end if;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    item_record.organization_id,
    target_user_id,
    'content.canonical_request_updated',
    'content_item',
    target_content_item_id,
    jsonb_build_object(
      'previous_request', item_record.intake_request,
      'previous_source_url', item_record.intake_source_url
    ),
    jsonb_build_object(
      'canonical_request', request_text,
      'source_url', source_url,
      'version', expected_content_version + 1
    )
  );

  perform private.add_notification(
    item_record.organization_id,
    task.owner_id,
    'content_brief_updated',
    'تم تحديث المطلوب في مهمتك',
    item_record.title,
    'task',
    task.id,
    '/tasks/' || task.id,
    'content:' || target_content_item_id || ':request:v' || (expected_content_version + 1) || ':task:' || task.id
  )
  from public.tasks task
  where task.content_item_id = target_content_item_id
    and task.is_work_item
    and task.status not in ('done', 'cancelled')
    and task.owner_id is distinct from target_user_id;

  return true;
end;
$$;

revoke all on function public.update_content_request_v1(uuid, uuid, bigint, text, text)
from public, anon, authenticated;
grant execute on function public.update_content_request_v1(uuid, uuid, bigint, text, text)
to service_role;


comment on function public.update_content_request_v1(uuid, uuid, bigint, text, text) is
  'Updates the canonical request and optional credential-free HTTP or HTTPS source with optimistic concurrency.';
