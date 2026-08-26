-- Rebuild the compact reel creator directly around accountable work. The older
-- seven-gate builder had become incompatible with the stricter task mutation
-- rules and could fail before returning a content item.

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
  recording_task_id uuid;
  editing_task_id uuid;
  thumbnail_task_id uuid;
  caption_task_id uuid;
  publishing_task_id uuid;
  raw_material_ready boolean := nullif(trim(coalesce(initial_raw_url, '')), '') is not null;
  schedule_span interval;
begin
  if target_user_id is null then raise exception 'A verified target user is required'; end if;
  perform set_config('request.jwt.claim.sub', target_user_id::text, true);
  if not private.has_org_role(target_organization_id, array['owner','admin','manager']::public.app_role[]) then
    raise exception 'Only organization leadership can create content workflows';
  end if;
  if target_publish_at <= now() + interval '1 hour' then
    raise exception 'Publish time must be at least one hour in the future';
  end if;
  if char_length(trim(content_title)) not between 3 and 180
    or char_length(trim(content_goal)) not between 5 and 1000
    or char_length(trim(content_hook)) not between 3 and 1000
    or char_length(trim(content_cta)) not between 2 and 500
    or char_length(trim(content_script_outline)) > 8000
    or char_length(trim(content_editing_brief)) > 8000
    or char_length(trim(content_thumbnail_brief)) > 4000
    or char_length(trim(content_brand_notes)) > 4000 then
    raise exception 'Content brief fields are incomplete or exceed their allowed length';
  end if;
  if exists (
    select 1 from unnest(array[content_creator_id, editing_owner_id, thumbnail_owner_id, publishing_owner_id]) owner(user_id)
    where owner.user_id is null or not exists (
      select 1 from public.memberships membership
      where membership.organization_id = target_organization_id
        and membership.user_id = owner.user_id and membership.status = 'active' and membership.role <> 'viewer'
    )
  ) then raise exception 'Every workflow owner must be an active organization member'; end if;
  if exists (
    select 1 from unnest(array[initial_raw_url, initial_source_url, initial_reference_url]) link(url)
    where nullif(trim(coalesce(link.url, '')), '') is not null
      and trim(link.url) !~* '^https?://[^[:space:]]+$'
  ) then raise exception 'Every asset link must be a valid HTTP or HTTPS URL'; end if;

  perform private.assert_approved_brand_references(target_organization_id, target_brand_article_ids);
  schedule_span := target_publish_at - now();

  insert into public.content_items (
    organization_id, title, format, goal, hook, cta, platforms, status, publish_at,
    script_outline, editing_brief, thumbnail_brief, brand_notes, created_by
  ) values (
    target_organization_id, trim(content_title), 'reel', trim(content_goal), trim(content_hook), trim(content_cta),
    array['instagram']::text[], 'planned', target_publish_at, trim(content_script_outline),
    trim(content_editing_brief), trim(content_thumbnail_brief), nullif(trim(content_brand_notes), ''), target_user_id
  ) returning id into content_id;

  if not raw_material_ready then
    insert into public.tasks (
      organization_id, title, description, status, priority, owner_id, created_by,
      acceptance_criteria, due_at, content_item_id, content_step, is_work_item, estimated_minutes
    ) values (
      target_organization_id, 'تجهيز المادة الخام: ' || trim(content_title),
      left('سجّل المادة الخام وارفع رابطها داخل ملف المحتوى.' || chr(10) || trim(content_script_outline), 5000),
      'ready', 'normal', content_creator_id, target_user_id, '', now() + schedule_span * 0.22,
      content_id, 'recording', true, 120
    ) returning id into recording_task_id;
  end if;

  insert into public.tasks (
    organization_id, title, description, status, priority, owner_id, created_by,
    acceptance_criteria, due_at, content_item_id, content_step, is_work_item, estimated_minutes
  ) values (
    target_organization_id, 'مونتاج الريلز: ' || trim(content_title),
    left('تعليمات المونتاج:' || chr(10) || trim(content_editing_brief), 5000),
    case when raw_material_ready then 'ready'::public.task_status else 'backlog'::public.task_status end,
    'normal', editing_owner_id, target_user_id, '', now() + schedule_span * 0.52,
    content_id, 'editing', true, 180
  ) returning id into editing_task_id;

  insert into public.tasks (
    organization_id, title, description, status, priority, owner_id, created_by,
    acceptance_criteria, due_at, content_item_id, content_step, is_work_item, estimated_minutes
  ) values (
    target_organization_id, 'غلاف الريلز: ' || trim(content_title),
    left('تعليمات الغلاف:' || chr(10) || trim(content_thumbnail_brief), 5000),
    'backlog', 'normal', thumbnail_owner_id, target_user_id, '', now() + schedule_span * 0.74,
    content_id, 'thumbnail', true, 90
  ) returning id into thumbnail_task_id;

  insert into public.tasks (
    organization_id, title, description, status, priority, owner_id, created_by,
    acceptance_criteria, due_at, content_item_id, content_step, is_work_item, estimated_minutes
  ) values (
    target_organization_id, 'كابشن الريلز: ' || trim(content_title),
    'اكتب الكابشن داخل ملف المحتوى أو اختر اقتراح AI، ثم اعتمده من نفس الملف.',
    'ready', 'normal', content_creator_id, target_user_id, '', now() + schedule_span * 0.62,
    content_id, 'caption', false, 45
  ) returning id into caption_task_id;

  insert into public.tasks (
    organization_id, title, description, status, priority, owner_id, created_by,
    acceptance_criteria, due_at, content_item_id, content_step, is_work_item, estimated_minutes
  ) values (
    target_organization_id, 'نشر الريلز: ' || trim(content_title),
    'انشر النسخة النهائية، ثم احفظ رابط المنشور الفعلي داخل ملف المحتوى.',
    'backlog', 'normal', publishing_owner_id, target_user_id, '', target_publish_at,
    content_id, 'publishing', true, 30
  ) returning id into publishing_task_id;

  if recording_task_id is not null then
    insert into public.task_dependencies (task_id, depends_on_task_id) values (editing_task_id, recording_task_id);
  end if;
  insert into public.task_dependencies (task_id, depends_on_task_id) values
    (thumbnail_task_id, editing_task_id),
    (publishing_task_id, editing_task_id),
    (publishing_task_id, thumbnail_task_id),
    (publishing_task_id, caption_task_id);

  insert into public.content_assets (
    organization_id, content_item_id, stage, kind, title, url, created_by
  )
  select target_organization_id, content_id, asset.stage, asset.kind, asset.title, trim(asset.url), target_user_id
  from (values
    ('recording'::public.content_step, 'raw_video'::public.content_asset_kind, 'المادة الخام', initial_raw_url),
    ('brief'::public.content_step, 'source'::public.content_asset_kind, 'المصدر الأساسي', initial_source_url),
    ('editing'::public.content_step, 'reference'::public.content_asset_kind, 'مرجع بصري أو أسلوبي', initial_reference_url)
  ) asset(stage, kind, title, url)
  where nullif(trim(coalesce(asset.url, '')), '') is not null;

  perform private.link_brand_references(target_user_id, target_organization_id, content_id, target_brand_article_ids);
  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, after_data)
  values (
    target_organization_id, target_user_id, 'content.compact_workflow_created', 'content_item', content_id,
    jsonb_build_object('raw_material_ready', raw_material_ready, 'work_task_count', case when raw_material_ready then 3 else 4 end, 'caption_inside_content', true)
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
  if char_length(trim(intake_request_text)) not between 20 and 30000
    or trim(telegram_source_url) !~* '^https://(t\.me|telegram\.me)/[^[:space:]]+$'
    or jsonb_typeof(parsed_timeline) <> 'array'
    or jsonb_typeof(parsed_assets) <> 'array' then
    raise exception 'Telegram intake data is invalid';
  end if;
  content_id := public.create_reel_production_workflow_v3(
    target_user_id, target_organization_id, content_title, content_goal, content_hook,
    content_cta, content_script_outline, content_editing_brief, content_thumbnail_brief,
    content_brand_notes, target_publish_at, content_creator_id, editing_owner_id,
    thumbnail_owner_id, approval_owner_id, publishing_owner_id,
    telegram_source_url, telegram_source_url, '', target_brand_article_ids
  );

  update public.content_items
  set intake_request = trim(intake_request_text), intake_source_url = trim(telegram_source_url),
      version = version + 1, updated_at = now()
  where id = content_id;

  insert into public.content_timeline_cues (
    organization_id, content_item_id, start_seconds, end_seconds, kind,
    action, source_url, sort_order, created_by
  )
  select target_organization_id, content_id,
    (cue.value->>'start_seconds')::integer,
    nullif(cue.value->>'end_seconds', '')::integer,
    (cue.value->>'kind')::public.content_cue_kind,
    trim(cue.value->>'action'), nullif(trim(cue.value->>'source_url'), ''),
    cue.ordinality::smallint, target_user_id
  from jsonb_array_elements(parsed_timeline) with ordinality cue(value, ordinality);

  insert into public.content_assets (
    organization_id, content_item_id, stage, kind, title, url, notes, created_by
  )
  select target_organization_id, content_id,
    (asset.value->>'stage')::public.content_step,
    (asset.value->>'kind')::public.content_asset_kind,
    trim(asset.value->>'title'), trim(asset.value->>'url'),
    nullif(trim(asset.value->>'notes'), ''), target_user_id
  from jsonb_array_elements(parsed_assets) asset(value)
  where nullif(trim(asset.value->>'url'), '') is not null
    and not exists (
      select 1 from public.content_assets existing
      where existing.content_item_id = content_id and existing.url = trim(asset.value->>'url')
    );

  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, after_data)
  values (
    target_organization_id, target_user_id, 'content.telegram_intake_created', 'content_item', content_id,
    jsonb_build_object('timeline_count', jsonb_array_length(parsed_timeline), 'asset_count', jsonb_array_length(parsed_assets))
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
