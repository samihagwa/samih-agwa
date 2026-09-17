create or replace function public.create_content_request_workflow(
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
  target_brand_article_ids uuid[],
  request_format public.content_format,
  request_platforms text[]
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
  is_carousel boolean := request_format='carousel';
  schedule_span interval;
  task_request text;
begin
  if request_format is null or request_format not in ('reel','long_video','carousel') then raise exception 'Unsupported request format'; end if;
  request_platforms := array(select distinct lower(trim(p)) from unnest(request_platforms) p);
  if coalesce(cardinality(request_platforms),0) not between 1 and 7 or exists(select 1 from unnest(request_platforms) p where p is null or p not in ('instagram','facebook','tiktok','youtube','telegram','x','linkedin')) then raise exception 'Invalid request platforms'; end if;
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
  if jsonb_array_length(raw_materials) not between (case when is_carousel then 0 else 1 end) and 10 then
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
    request_format,
    'تنفيذ الطلب كما كتبه طالب المحتوى في خانة كل المطلوب.',
    'حسب نص الطلب الكامل.',
    'حسب نص الطلب الكامل.',
    request_platforms,
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
    case when is_carousel then 'design'::public.content_step else 'recording'::public.content_step end,
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
    left((case when is_carousel then 'تصميم الكاروسيل: ' else 'مونتاج الفيديو: ' end) || trim(content_title), 180),
    task_request,
    'ready',
    'normal',
    editing_owner_id,
    target_user_id,
    '',
    false,
    now() + schedule_span * 0.60,
    content_id,
    case when is_carousel then 'design'::public.content_step else 'editing'::public.content_step end,
    true,
    180
  ) returning id into editing_task_id;

  if not is_carousel then
  insert into public.tasks (
    organization_id, title, description, status, priority, owner_id,
    created_by, acceptance_criteria, requires_review, due_at,
    content_item_id, content_step, is_work_item, estimated_minutes
  ) values (
    target_organization_id,
    left('غلاف الفيديو: ' || trim(content_title), 180),
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
  end if;

  insert into public.tasks (
    organization_id, title, description, status, priority, owner_id,
    created_by, acceptance_criteria, requires_review, due_at,
    content_item_id, content_step, is_work_item, estimated_minutes
  ) values (
    target_organization_id,
    left('نشر المحتوى: ' || trim(content_title), 180),
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
    (publishing_task_id, editing_task_id);
  if not is_carousel then
    insert into public.task_dependencies(task_id,depends_on_task_id) values(publishing_task_id,thumbnail_task_id);
  end if;

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
    'content.request_workflow_created',
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
      'visible_work_task_count', case when is_carousel then 2 else 3 end,
      'canonical_request_length', char_length(request_text),
      'recording_task_created', false
    )
  );

  return content_id;
end;
$$;

revoke all on function public.create_content_request_workflow(
  uuid, uuid, uuid, text, text, timestamptz, jsonb,
  uuid, uuid, uuid, uuid[], public.content_format, text[]
) from public, anon, authenticated;
grant execute on function public.create_content_request_workflow(
  uuid, uuid, uuid, text, text, timestamptz, jsonb,
  uuid, uuid, uuid, uuid[], public.content_format, text[]
) to service_role;

alter table public.content_step_deliveries add column result_images jsonb not null default '[]'::jsonb;
create function private.guard_carousel_delivery() returns trigger
language plpgsql security definer set search_path='' as $$
declare images jsonb;
begin
  if new.step='design' and exists(select 1 from public.content_items where id=new.content_item_id and format='carousel') then
    images:=nullif(current_setting('app.carousel_delivery_images',true),'')::jsonb;
    if images is null or jsonb_typeof(images) is distinct from 'array' then raise exception 'Carousel requires ordered image links'; end if;
    if jsonb_array_length(images) not between 2 and 30 then raise exception 'Carousel needs 2 to 30 images'; end if;
    if exists(select 1 from jsonb_array_elements(images) x where jsonb_typeof(x)<>'string' or char_length(x#>>'{}')>2000 or (x#>>'{}') !~* '^https?://[^[:space:]@/?#]+([/?#][^[:space:]]*)?$')
      or (select count(distinct lower(trim(value))) from jsonb_array_elements_text(images))<>jsonb_array_length(images)
      then raise exception 'Carousel image links invalid or duplicate'; end if;
    new.result_images:=images;
    new.result_url:=images->>0;
  end if;
  return new;
end; $$;
revoke all on function private.guard_carousel_delivery() from public,anon,authenticated;
create trigger guard_carousel_delivery before insert or update on public.content_step_deliveries for each row execute function private.guard_carousel_delivery();

create function public.submit_carousel_delivery(target_user_id uuid,target_task_id uuid,delivery_result_note text,images jsonb,expected_task_version bigint,expected_delivery_version bigint)
returns uuid language plpgsql security definer set search_path='' as $$
declare task_record public.tasks; current_version bigint; delivery_id uuid;
begin
  if target_user_id is null then raise exception 'Verified actor required'; end if;
  perform set_config('request.jwt.claim.sub',target_user_id::text,true);
  select * into task_record from public.tasks where id=target_task_id;
  if task_record.owner_id is distinct from target_user_id or task_record.content_step is distinct from 'design'
    or not exists(select 1 from public.content_items where id=task_record.content_item_id and format='carousel')
    or not exists(select 1 from public.memberships where organization_id=task_record.organization_id and user_id=target_user_id and status='active' and role<>'viewer' and (role='owner' or 'tasks'=any(allowed_sections)))
    then raise exception 'Carousel delivery permission denied'; end if;
  perform t.id from public.task_dependencies d join public.tasks t on t.id=d.depends_on_task_id where d.task_id=target_task_id order by t.id for update of t;
  select * into task_record from public.tasks where id=target_task_id for update;
  select version into current_version from public.content_step_deliveries where task_id=target_task_id;
  if task_record.version is distinct from expected_task_version or current_version is distinct from expected_delivery_version then raise exception 'Task or delivery changed; refresh'; end if;
  if task_record.status not in ('in_progress','done') then raise exception 'Start or resume task before delivery'; end if;
  perform set_config('app.carousel_delivery_images',images::text,true);
  delivery_id:=public.submit_content_step_delivery(target_user_id,target_task_id,delivery_result_note,images->>0);
  perform set_config('app.carousel_delivery_images','',true);
  return delivery_id;
end; $$;
revoke all on function public.submit_carousel_delivery(uuid,uuid,text,jsonb,bigint,bigint) from public,anon,authenticated;
grant execute on function public.submit_carousel_delivery(uuid,uuid,text,jsonb,bigint,bigint) to service_role;
