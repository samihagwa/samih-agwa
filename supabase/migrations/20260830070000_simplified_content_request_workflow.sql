-- Make the requester's original message the canonical content brief. The
-- structured fields stay available for legacy items and downstream AI, but a
-- new reel no longer requires the requester to split one Telegram-style brief
-- into goal, hook, CTA, script, editing, and cover fields.

-- The original Telegram intake required the request and a Telegram URL as an
-- inseparable pair. The simplified intake keeps the request canonical while
-- making the source message genuinely optional.
alter table public.content_items
  drop constraint if exists content_items_intake_request_length,
  drop constraint if exists content_items_intake_fields_together;

alter table public.content_items
  add constraint content_items_intake_request_length
    check (intake_request is null or char_length(trim(intake_request)) between 10 and 30000);

alter table public.content_items
  add column if not exists intake_request_key uuid;

alter table public.content_items
  drop constraint if exists content_items_organization_request_key_unique;

alter table public.content_items
  add constraint content_items_organization_request_key_unique
    unique (organization_id, intake_request_key);

create or replace function public.create_simplified_content_workflow_v1(
  target_user_id uuid,
  target_organization_id uuid,
  request_id uuid,
  content_title text,
  content_request_text text,
  target_publish_at timestamptz,
  raw_material_sent boolean,
  request_source_url text,
  content_creator_id uuid,
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
  recording_task_id uuid;
  editing_task_id uuid;
  thumbnail_task_id uuid;
  publishing_task_id uuid;
  request_text text := trim(content_request_text);
  source_url text := nullif(trim(coalesce(request_source_url, '')), '');
  material_is_ready boolean := coalesce(raw_material_sent, false);
  schedule_span interval;
  task_request text;
  direct_creator_authorized boolean := false;
  plan_execution_authorized boolean := false;
  script_handoff_authorized boolean := false;
begin
  if target_user_id is null then
    raise exception 'A verified target user is required';
  end if;

  if request_id is null then
    raise exception 'A stable request id is required';
  end if;

  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  select exists (
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
    )
  into direct_creator_authorized;

  select exists (
      select 1
      from public.memberships membership
      join public.content_plan_items plan_item
        on plan_item.organization_id = membership.organization_id
       and plan_item.created_by = membership.user_id
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
          or 'planning' = any(membership.allowed_sections)
        )
        and plan_item.id::text = coalesce(
          nullif(current_setting('app.plan_execution_item_id', true), ''),
          '__missing__'
        )
        and plan_item.status = 'planned'
        and plan_item.content_item_id is null
    )
  into plan_execution_authorized;

  select
    coalesce(nullif(current_setting('app.script_handoff_request_id', true), ''), '__missing__') = request_id::text
    and exists (
      select 1
      from public.memberships membership
      join public.scripts script
        on script.organization_id = membership.organization_id
       and script.assigned_to = membership.user_id
      where membership.organization_id = target_organization_id
        and membership.user_id = target_user_id
        and membership.status = 'active'
        and membership.role <> 'viewer'
        and (
          membership.role = 'owner'
          or 'tasks' = any(membership.allowed_sections)
        )
        and (
          membership.role = 'owner'
          or 'scripts' = any(membership.allowed_sections)
        )
        and script.id::text = coalesce(
          nullif(current_setting('app.script_handoff_script_id', true), ''),
          '__missing__'
        )
        and script.status = 'ready_to_record'
        and script.content_item_id is null
    )
  into script_handoff_authorized;

  if not (
    direct_creator_authorized
    or plan_execution_authorized
    or script_handoff_authorized
  ) then
    raise exception 'Only organization leadership with Content and Tasks access can create a direct content workflow';
  end if;

  if target_publish_at <= now() + interval '1 hour' then
    raise exception 'Publish time must be at least one hour in the future';
  end if;

  if char_length(trim(content_title)) not between 3 and 180
    or char_length(request_text) not between 10 and 30000 then
    raise exception 'Content title or full request is incomplete';
  end if;

  if source_url is not null
    and source_url !~* '^https://(t\.me|telegram\.me)/[^[:space:]]+$' then
    raise exception 'The optional source must be a valid Telegram message URL';
  end if;

  if exists (
    select 1
    from unnest(array[
      content_creator_id,
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
    organization_id,
    title,
    format,
    goal,
    hook,
    cta,
    platforms,
    status,
    publish_at,
    script_outline,
    editing_brief,
    thumbnail_brief,
    intake_request,
    intake_source_url,
    intake_request_key,
    created_by
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
    source_url,
    request_id,
    target_user_id
  )
  on conflict (organization_id, intake_request_key) do nothing
  returning id into content_id;

  if content_id is null then
    select item.id into content_id
    from public.content_items item
    where item.organization_id = target_organization_id
      and item.intake_request_key = request_id;
    return content_id;
  end if;

  if not material_is_ready then
    insert into public.tasks (
      organization_id, title, description, status, priority, owner_id,
      created_by, acceptance_criteria, due_at, content_item_id,
      content_step, is_work_item, estimated_minutes
    ) values (
      target_organization_id,
      'إرسال المادة الخام: ' || trim(content_title),
      task_request,
      'ready',
      'normal',
      content_creator_id,
      target_user_id,
      '',
      now() + schedule_span * 0.22,
      content_id,
      'recording',
      true,
      30
    ) returning id into recording_task_id;
  end if;

  insert into public.tasks (
    organization_id, title, description, status, priority, owner_id,
    created_by, acceptance_criteria, due_at, content_item_id,
    content_step, is_work_item, estimated_minutes
  ) values (
    target_organization_id,
    'مونتاج الريلز: ' || trim(content_title),
    task_request,
    case when material_is_ready then 'ready'::public.task_status else 'backlog'::public.task_status end,
    'normal',
    editing_owner_id,
    target_user_id,
    '',
    now() + schedule_span * 0.52,
    content_id,
    'editing',
    true,
    180
  ) returning id into editing_task_id;

  insert into public.tasks (
    organization_id, title, description, status, priority, owner_id,
    created_by, acceptance_criteria, due_at, content_item_id,
    content_step, is_work_item, estimated_minutes
  ) values (
    target_organization_id,
    'غلاف الريلز: ' || trim(content_title),
    task_request,
    'ready',
    'normal',
    thumbnail_owner_id,
    target_user_id,
    '',
    now() + schedule_span * 0.74,
    content_id,
    'thumbnail',
    true,
    90
  ) returning id into thumbnail_task_id;

  insert into public.tasks (
    organization_id, title, description, status, priority, owner_id,
    created_by, acceptance_criteria, due_at, content_item_id,
    content_step, is_work_item, estimated_minutes
  ) values (
    target_organization_id,
    'نشر الريلز: ' || trim(content_title),
    task_request,
    'backlog',
    'normal',
    publishing_owner_id,
    target_user_id,
    '',
    target_publish_at,
    content_id,
    'publishing',
    true,
    30
  ) returning id into publishing_task_id;

  if recording_task_id is not null then
    insert into public.task_dependencies (task_id, depends_on_task_id)
    values (editing_task_id, recording_task_id);
  end if;

  insert into public.task_dependencies (task_id, depends_on_task_id) values
    (publishing_task_id, editing_task_id),
    (publishing_task_id, thumbnail_task_id);

  if source_url is not null then
    insert into public.content_assets (
      organization_id, content_item_id, stage, kind, title, url, created_by
    ) values (
      target_organization_id,
      content_id,
      'recording',
      'raw_video',
      'رسالة المادة الخام على Telegram',
      source_url,
      target_user_id
    );
  end if;

  perform private.link_brand_references(
    target_user_id,
    target_organization_id,
    content_id,
    target_brand_article_ids
  );

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id,
    target_user_id,
    'content.simplified_request_created',
    'content_item',
    content_id,
    jsonb_build_object(
      'raw_material_sent', material_is_ready,
      'visible_work_task_count', case when material_is_ready then 3 else 4 end,
      'canonical_request_length', char_length(request_text),
      'request_id', request_id
    )
  );

  return content_id;
end;
$$;

revoke all on function public.create_simplified_content_workflow_v1(
  uuid, uuid, uuid, text, text, timestamptz, boolean, text,
  uuid, uuid, uuid, uuid, uuid[]
) from public, anon, authenticated;
grant execute on function public.create_simplified_content_workflow_v1(
  uuid, uuid, uuid, text, text, timestamptz, boolean, text,
  uuid, uuid, uuid, uuid, uuid[]
) to service_role;

-- Planning is a view over the same execution engine, not a second production
-- system. A reel sent from the calendar now creates the exact same compact
-- request and task graph as a reel created from Requests.
alter table public.content_plan_items
  drop constraint if exists content_plan_items_objective_length;
alter table public.content_plan_items
  add constraint content_plan_items_objective_length
    check (char_length(trim(objective)) between 5 and 30000);

create or replace function public.create_plan_item_execution(
  target_organization_id uuid,
  target_plan_id uuid,
  target_pillar_id uuid,
  target_kind public.content_plan_item_kind,
  content_title text,
  content_objective text,
  content_hook text,
  content_cta text,
  content_platforms text[],
  target_publish_at timestamptz,
  accountable_owner_id uuid,
  editing_owner_id uuid,
  design_owner_id uuid,
  publishing_owner_id uuid,
  requested_minutes integer default 120,
  allow_capacity_override boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  plan_item_id uuid;
  content_id uuid;
  capacity jsonb;
  overloaded_members text[] := '{}'::text[];
  capacity_request record;
begin
  perform private.assert_capacity_leadership(target_organization_id);
  if not private.actor_can_access_any_section(actor, target_organization_id, array['tasks']::text[]) then
    raise exception 'Sending a plan item to execution requires Tasks access';
  end if;
  if target_publish_at <= now() + interval '2 hours' then
    raise exception 'Publish time must be at least two hours in the future';
  end if;
  if requested_minutes not between 15 and 2880 then raise exception 'Estimated time is invalid'; end if;
  if char_length(trim(content_objective)) not between 5 and 30000 then
    raise exception 'The full request is incomplete or too long';
  end if;

  for capacity_request in
    select assignment.member_id, sum(assignment.minutes)::integer as minutes
    from (values
      (accountable_owner_id, case
        when target_kind = 'reel' then requested_minutes
        when target_kind in ('social_post', 'ad', 'telegram_post', 'email', 'other') then 90
        when target_kind in ('live', 'webinar') then 180
        else 0 end),
      (editing_owner_id, case when target_kind = 'reel' then 180 else 0 end),
      (design_owner_id, case
        when target_kind in ('social_post', 'ad') then 120
        when target_kind in ('reel', 'story') then 90
        else 0 end),
      (publishing_owner_id, 30)
    ) as assignment(member_id, minutes)
    where assignment.minutes > 0
    group by assignment.member_id
  loop
    if capacity_request.member_id is null or not exists (
      select 1 from public.memberships membership
      where membership.organization_id = target_organization_id
        and membership.user_id = capacity_request.member_id
        and membership.status = 'active'
        and membership.role <> 'viewer'
        and (membership.role = 'owner' or 'tasks' = any(membership.allowed_sections))
    ) then
      raise exception 'Every execution owner must be an active member with Tasks access';
    end if;
    capacity := private.member_capacity_snapshot(
      target_organization_id,
      capacity_request.member_id,
      target_publish_at,
      capacity_request.minutes,
      null
    );
    if coalesce((capacity->>'overloaded')::boolean, false) then
      overloaded_members := array_append(overloaded_members, capacity_request.member_id::text);
    end if;
  end loop;
  if cardinality(overloaded_members) > 0 and not allow_capacity_override then
    raise exception 'TEAM_CAPACITY_EXCEEDED:%', array_to_string(overloaded_members, ',');
  end if;

  insert into public.content_plan_items (
    organization_id, plan_id, pillar_id, kind, title, objective, hook_direction,
    cta, platforms, owner_id, publish_at, status, estimated_minutes, created_by, updated_by
  ) values (
    target_organization_id, target_plan_id, target_pillar_id, target_kind,
    trim(content_title), trim(content_objective), nullif(trim(content_hook), ''), nullif(trim(content_cta), ''),
    content_platforms, accountable_owner_id, target_publish_at, 'planned', requested_minutes, actor, actor
  ) returning id into plan_item_id;

  if target_kind = 'reel' then
    perform set_config('app.plan_execution_item_id', plan_item_id::text, true);
    content_id := public.create_simplified_content_workflow_v1(
      actor,
      target_organization_id,
      gen_random_uuid(),
      trim(content_title),
      trim(content_objective),
      target_publish_at,
      false,
      null,
      accountable_owner_id,
      editing_owner_id,
      design_owner_id,
      publishing_owner_id,
      '{}'::uuid[]
    );
    perform set_config('app.plan_execution_item_id', '', true);
    update public.tasks task set
      source_plan_item_id = plan_item_id,
      estimated_minutes = case task.content_step
        when 'recording' then greatest(30, requested_minutes)
        when 'editing' then 180
        when 'thumbnail' then 90
        when 'publishing' then 30
        else task.estimated_minutes
      end
    where task.content_item_id = content_id;
  else
    content_id := private.create_generic_planned_content_workflow(
      actor, target_organization_id, plan_item_id, target_kind, trim(content_title),
      trim(content_objective), content_hook, content_cta, content_platforms,
      target_publish_at, accountable_owner_id, design_owner_id, publishing_owner_id
    );
  end if;

  update public.content_plan_items set content_item_id = content_id
  where id = plan_item_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id, actor, 'planning.execution_created', 'content_plan_item', plan_item_id,
    jsonb_build_object(
      'content_item_id', content_id,
      'capacity_override', allow_capacity_override,
      'uses_canonical_request', true,
      'compact_reel_workflow', target_kind = 'reel'
    )
  );
  return jsonb_build_object('plan_item_id', plan_item_id, 'content_item_id', content_id);
end;
$$;

revoke all on function public.create_plan_item_execution(
  uuid, uuid, uuid, public.content_plan_item_kind, text, text, text, text, text[],
  timestamptz, uuid, uuid, uuid, uuid, integer, boolean
) from public, anon;
grant execute on function public.create_plan_item_execution(
  uuid, uuid, uuid, public.content_plan_item_kind, text, text, text, text, text[],
  timestamptz, uuid, uuid, uuid, uuid, integer, boolean
) to authenticated, service_role;

-- A script handoff must enter the same compact request workflow as manual and
-- calendar intake. Keeping the historical handoff here would silently recreate
-- the retired brief/caption/approval task graph even though the UI is lean.
create or replace function public.handoff_script_to_content(
  target_user_id uuid,
  target_script_id uuid,
  expected_edit_version bigint,
  target_publish_at timestamptz,
  content_creator_id uuid,
  editing_owner_id uuid,
  thumbnail_owner_id uuid,
  publishing_owner_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  script_record public.scripts%rowtype;
  content_id uuid;
  brand_ids uuid[];
  request_text text;
  telegram_source_url text;
  workflow_request_id uuid := gen_random_uuid();
begin
  select * into script_record
  from public.scripts
  where id = target_script_id
  for update;

  if script_record.id is null then raise exception 'Script not found'; end if;
  if not private.can_access_script_actor(
    target_user_id,
    script_record.organization_id,
    script_record.assigned_to
  ) then
    raise exception 'Only the script owner can send it to execution';
  end if;
  if script_record.edit_version <> expected_edit_version then
    raise exception 'Script changed in another session; refresh before handoff';
  end if;
  if script_record.status <> 'ready_to_record' then
    raise exception 'Mark the script ready to record before handoff';
  end if;
  if char_length(trim(script_record.spoken_script)) < 20 then
    raise exception 'Complete the spoken script before handoff';
  end if;
  if target_publish_at <= now() + interval '1 hour' then
    raise exception 'Publish time must be at least one hour in the future';
  end if;

  select coalesce(array_agg(article.id order by article.updated_at desc), '{}'::uuid[])
  into brand_ids
  from (
    select id, updated_at
    from public.brand_articles
    where organization_id = script_record.organization_id
      and status = 'approved'
    order by updated_at desc
    limit 8
  ) article;

  request_text := left(concat_ws(E'\n\n',
    'السكريبت النهائي:' || E'\n' || trim(script_record.spoken_script),
    case when nullif(trim(coalesce(script_record.source_text, '')), '') is not null
      then 'الطلب أو المادة المرجعية الأصلية:' || E'\n' || trim(script_record.source_text) end,
    case when nullif(trim(coalesce(script_record.source_url, '')), '') is not null
      then 'رابط المصدر:' || E'\n' || trim(script_record.source_url) end,
    case when nullif(trim(coalesce(script_record.recording_notes, '')), '') is not null
      then 'تعليمات التسجيل:' || E'\n' || trim(script_record.recording_notes) end,
    case when nullif(trim(coalesce(script_record.editing_notes, '')), '') is not null
      then 'تعليمات المونتاج:' || E'\n' || trim(script_record.editing_notes) end,
    case when nullif(trim(coalesce(script_record.thumbnail_notes, '')), '') is not null
      then 'تعليمات الغلاف:' || E'\n' || trim(script_record.thumbnail_notes) end,
    case when nullif(trim(coalesce(script_record.on_screen_text, '')), '') is not null
      then 'النص على الشاشة:' || E'\n' || trim(script_record.on_screen_text) end,
    case when nullif(trim(coalesce(script_record.b_roll_notes, '')), '') is not null
      then 'لقطات B-roll:' || E'\n' || trim(script_record.b_roll_notes) end,
    case when nullif(trim(coalesce(script_record.claims_notes, '')), '') is not null
      then 'ملاحظات الدقة والمراجعة:' || E'\n' || trim(script_record.claims_notes) end
  ), 30000);

  telegram_source_url := case
    when trim(coalesce(script_record.source_url, '')) ~* '^https://(t\.me|telegram\.me)/[^[:space:]]+$'
      then trim(script_record.source_url)
    else null
  end;

  -- The core workflow command is also used by manual intake and planning.
  -- A transaction-local, script-bound capability lets only this already
  -- authorized self-handoff use the non-leadership path.
  perform set_config('app.script_handoff_script_id', target_script_id::text, true);
  perform set_config('app.script_handoff_request_id', workflow_request_id::text, true);

  content_id := public.create_simplified_content_workflow_v1(
    target_user_id,
    script_record.organization_id,
    workflow_request_id,
    script_record.title,
    request_text,
    target_publish_at,
    false,
    telegram_source_url,
    content_creator_id,
    editing_owner_id,
    thumbnail_owner_id,
    publishing_owner_id,
    brand_ids
  );

  perform set_config('app.script_handoff_script_id', '', true);
  perform set_config('app.script_handoff_request_id', '', true);

  update public.content_items
  set caption_brief = left(concat_ws(E'\n\n',
    nullif(trim(script_record.caption), ''),
    nullif(array_to_string(script_record.hashtags, ' '), '')
  ), 10000)
  where id = content_id
    and organization_id = script_record.organization_id;

  update public.scripts
  set status = 'handed_off',
      content_item_id = content_id,
      handed_off_at = now(),
      handed_off_by = target_user_id,
      edit_version = edit_version + 1
  where id = target_script_id;

  perform private.add_script_version(
    target_script_id,
    'handoff',
    target_user_id,
    'إنشاء طلب تنفيذ موحّد'
  );

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    script_record.organization_id,
    target_user_id,
    'script.handed_off',
    'script',
    target_script_id,
    jsonb_build_object('status', script_record.status),
    jsonb_build_object(
      'status', 'handed_off',
      'content_item_id', content_id,
      'workflow', 'simplified_request_v1',
      'caption_brief_carried', nullif(trim(script_record.caption), '') is not null
    )
  );

  return content_id;
end;
$$;

revoke all on function public.handoff_script_to_content(
  uuid, uuid, bigint, timestamptz, uuid, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.handoff_script_to_content(
  uuid, uuid, bigint, timestamptz, uuid, uuid, uuid, uuid
) to service_role;

-- AI caption suggestions belong to the reel file, not to a hidden task. Route
-- the selected caption to the publishing owner (and the thumbnail choice to
-- the thumbnail owner) so every notification still opens real assigned work.
create or replace function public.apply_content_ai_choice(
  target_user_id uuid,
  target_content_item_id uuid,
  target_scope text,
  expected_content_version bigint,
  selected_text text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_record public.content_items%rowtype;
  new_version bigint;
  step_owner_id uuid;
  step_task_id uuid;
begin
  select * into item_record
  from public.content_items item
  where item.id = target_content_item_id
  for update;
  if item_record.id is null then raise exception 'Content item not found'; end if;
  if not private.can_use_content_ai_actor(target_user_id, target_content_item_id, target_scope) then
    raise exception 'You cannot choose AI output for this content step';
  end if;
  if item_record.version <> expected_content_version then
    raise exception 'Content changed while AI choices were open';
  end if;
  if target_scope = 'caption' and char_length(trim(selected_text)) not between 3 and 10000 then
    raise exception 'Caption choice is invalid';
  elsif target_scope = 'thumbnail' and char_length(trim(selected_text)) not between 10 and 4000 then
    raise exception 'Thumbnail choice is invalid';
  elsif target_scope not in ('caption', 'thumbnail') then
    raise exception 'AI choice scope is invalid';
  end if;

  update public.content_items item set
    caption_brief = case when target_scope = 'caption' then trim(selected_text) else item.caption_brief end,
    thumbnail_brief = case when target_scope = 'thumbnail' then trim(selected_text) else item.thumbnail_brief end,
    version = item.version + 1,
    updated_at = now()
  where item.id = target_content_item_id
  returning version into new_version;

  select task.id, task.owner_id into step_task_id, step_owner_id
  from public.tasks task
  where task.content_item_id = target_content_item_id
    and task.status <> 'cancelled'
    and task.content_step = case
      when target_scope = 'caption' then 'publishing'::public.content_step
      else 'thumbnail'::public.content_step
    end
  limit 1;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    item_record.organization_id, target_user_id, 'content.ai_choice_selected',
    'content_item', target_content_item_id,
    jsonb_build_object('scope', target_scope, 'version', new_version)
  );

  if step_owner_id is not null and step_owner_id is distinct from target_user_id then
    perform private.add_notification(
      item_record.organization_id, step_owner_id, 'content_brief_updated',
      case when target_scope = 'caption' then 'تم تجهيز الكابشن لمهمة النشر' else 'تم تحديث تعليمات الغلاف' end,
      item_record.title, 'task', step_task_id,
      '/tasks/' || step_task_id,
      'content:' || target_content_item_id || ':ai-choice:' || target_scope || ':v' || new_version || ':user:' || step_owner_id
    );
  end if;
  return new_version;
end;
$$;

revoke all on function public.apply_content_ai_choice(uuid, uuid, text, bigint, text)
from public, anon, authenticated;
grant execute on function public.apply_content_ai_choice(uuid, uuid, text, bigint, text)
to service_role;

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
    and source_url !~* '^https://(t\.me|telegram\.me)/[^[:space:]]+$' then
    raise exception 'The optional source must be a valid Telegram message URL';
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

-- A member assigned to a content task must be able to read the canonical
-- request from that task, even if their visible workspace is only "My work".
create or replace function private.can_read_content_actor(
  target_user_id uuid,
  target_organization_id uuid,
  target_content_item_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user_id is not null
    and private.actor_can_access_any_section(
      target_user_id,
      target_organization_id,
      array['content', 'campaigns', 'scripts', 'tasks']::text[]
    )
    and (
      private.is_org_owner_or_admin_actor(target_user_id, target_organization_id)
      or exists (
        select 1
        from public.content_items item
        where item.id = target_content_item_id
          and item.organization_id = target_organization_id
          and item.created_by = target_user_id
      )
      or exists (
        select 1
        from public.tasks task
        where task.content_item_id = target_content_item_id
          and task.organization_id = target_organization_id
          and task.owner_id = target_user_id
      )
    );
$$;

revoke all on function private.can_read_content_actor(uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function private.can_read_content_actor(uuid, uuid, uuid)
to authenticated;

-- A task is private operational work, not an organization-wide bulletin. The
-- assignee and requester can read it, while owners/admins/managers retain the
-- team oversight view. This helper is also reused by every child table so a
-- guessed task UUID cannot expose its brief, delivery links, or activity log.
create or replace function private.can_read_task_actor(
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
    and exists (
      select 1
      from public.memberships membership
      where membership.organization_id = target_organization_id
        and membership.user_id = target_user_id
        and membership.status = 'active'
        and (
          membership.role = 'owner'
          or 'tasks' = any(membership.allowed_sections)
        )
        and (
          membership.role in ('owner', 'admin', 'manager')
          or exists (
            select 1
            from public.tasks task
            where task.id = target_task_id
              and task.organization_id = target_organization_id
              and (
                task.owner_id = target_user_id
                or task.created_by = target_user_id
              )
          )
        )
    );
$$;

revoke all on function private.can_read_task_actor(uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function private.can_read_task_actor(uuid, uuid, uuid)
to authenticated;

drop policy if exists "tasks_select_organization_members" on public.tasks;
create policy "tasks_select_involved_members"
on public.tasks for select to authenticated
using (
  private.can_read_task_actor(
    (select auth.uid()),
    organization_id,
    id
  )
);

drop policy if exists "task_events_select_organization_members" on public.task_events;
create policy "task_events_select_involved_members"
on public.task_events for select to authenticated
using (
  private.can_read_task_actor(
    (select auth.uid()),
    organization_id,
    task_id
  )
);

drop policy if exists "task_revision_requests_select_task_members" on public.task_revision_requests;
create policy "task_revision_requests_select_involved_members"
on public.task_revision_requests for select to authenticated
using (
  private.can_read_task_actor(
    (select auth.uid()),
    organization_id,
    task_id
  )
);

drop policy if exists "task_deliveries_select_organization_members" on public.task_deliveries;
create policy "task_deliveries_select_involved_members"
on public.task_deliveries for select to authenticated
using (
  private.can_read_task_actor(
    (select auth.uid()),
    organization_id,
    task_id
  )
);

drop policy if exists "task_dependencies_select_organization_members" on public.task_dependencies;
create policy "task_dependencies_select_involved_members"
on public.task_dependencies for select to authenticated
using (
  private.can_read_task_actor(
    (select auth.uid()),
    (select task.organization_id from public.tasks task where task.id = task_dependencies.task_id),
    task_id
  )
  or private.can_read_task_actor(
    (select auth.uid()),
    (select task.organization_id from public.tasks task where task.id = task_dependencies.depends_on_task_id),
    depends_on_task_id
  )
);

-- The old section gates required the Content section even when the person was
-- executing an exact task. Keep the task-aware row policy above, and let a
-- Tasks-only assignee read the inputs and prior deliveries for that content.
drop policy if exists "section_scope_content_assets" on public.content_assets;
create policy "section_scope_content_assets" on public.content_assets
as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['content','tasks']::text[]));

drop policy if exists "section_scope_content_deliveries" on public.content_step_deliveries;
create policy "section_scope_content_deliveries" on public.content_step_deliveries
as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['content','tasks']::text[]));

-- Viewer means read-only at the database boundary. This trigger protects both
-- direct client writes and service-role RPCs that preserve the user's JWT id.
create or replace function private.reject_viewer_operational_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target_organization_id uuid;
begin
  target_organization_id := nullif(
    case when tg_op = 'DELETE' then to_jsonb(old)->>'organization_id'
      else to_jsonb(new)->>'organization_id'
    end,
    ''
  )::uuid;

  if actor is not null and not exists (
    select 1
    from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = actor
      and membership.status = 'active'
      and membership.role <> 'viewer'
  ) then
    raise exception 'Only active non-viewer members can change operational work';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger tasks_reject_viewer_write
before insert or update on public.tasks
for each row execute function private.reject_viewer_operational_write();

create trigger task_revision_requests_reject_viewer_write
before insert or update on public.task_revision_requests
for each row execute function private.reject_viewer_operational_write();

create trigger task_deliveries_reject_viewer_write
before insert or update on public.task_deliveries
for each row execute function private.reject_viewer_operational_write();

create trigger task_discussion_messages_reject_viewer_write
before insert or update on public.task_discussion_messages
for each row execute function private.reject_viewer_operational_write();

create trigger content_step_deliveries_reject_viewer_write
before insert or update on public.content_step_deliveries
for each row execute function private.reject_viewer_operational_write();

create trigger content_items_reject_viewer_write
before insert or update or delete on public.content_items
for each row execute function private.reject_viewer_operational_write();

create trigger content_assets_reject_viewer_write
before insert or update or delete on public.content_assets
for each row execute function private.reject_viewer_operational_write();

create trigger content_revision_requests_reject_viewer_write
before insert or update or delete on public.content_revision_requests
for each row execute function private.reject_viewer_operational_write();

create trigger content_timeline_cues_reject_viewer_write
before insert or update or delete on public.content_timeline_cues
for each row execute function private.reject_viewer_operational_write();

create trigger content_brand_references_reject_viewer_write
before insert or update or delete on public.content_brand_references
for each row execute function private.reject_viewer_operational_write();

-- Never create work that its owner cannot open. Owners always have all
-- sections; every other assignee needs explicit Tasks access and cannot be a
-- viewer. Existing historical rows are left untouched.
create or replace function private.enforce_task_assignee_reachability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Serialize assignment against concurrent role/section changes. Membership
  -- updates already lock this same row before their reachability trigger runs.
  perform 1
  from public.memberships membership
  where membership.organization_id = new.organization_id
    and membership.user_id = new.owner_id
    and membership.status = 'active'
    and membership.role <> 'viewer'
    and (
      membership.role = 'owner'
      or 'tasks' = any(membership.allowed_sections)
    )
  for share;

  if not found then
    raise exception 'Task owner must be an active non-viewer member with Tasks access';
  end if;
  return new;
end;
$$;

create trigger tasks_enforce_assignee_reachability
before insert or update of owner_id on public.tasks
for each row execute function private.enforce_task_assignee_reachability();

drop policy if exists "tasks_update_assignee_requester_or_platform_admin" on public.tasks;
create policy "tasks_update_assignee_requester_or_platform_admin"
on public.tasks for update to authenticated
using (
  exists (
    select 1 from public.memberships membership
    where membership.organization_id = tasks.organization_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and membership.role <> 'viewer'
      and (
        membership.role = 'owner'
        or 'tasks' = any(membership.allowed_sections)
      )
  )
  and (
    owner_id = (select auth.uid())
    or created_by = (select auth.uid())
    or private.is_org_owner_or_admin_actor((select auth.uid()), organization_id)
  )
)
with check (
  exists (
    select 1 from public.memberships membership
    where membership.organization_id = tasks.organization_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and membership.role <> 'viewer'
      and (
        membership.role = 'owner'
        or 'tasks' = any(membership.allowed_sections)
      )
  )
  and (
    owner_id = (select auth.uid())
    or created_by = (select auth.uid())
    or private.is_org_owner_or_admin_actor((select auth.uid()), organization_id)
  )
);

-- Removing Tasks access from a current assignee would strand live work behind
-- an inaccessible deep link. Keep access changes reversible by requiring the
-- owner to reassign or close that work first.
create or replace function private.enforce_open_task_member_reachability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
      new.status <> 'active'
      or new.role = 'viewer'
      or (
        new.role <> 'owner'
        and not ('tasks' = any(new.allowed_sections))
      )
    ) and exists (
      select 1
      from public.tasks task
      where task.organization_id = new.organization_id
        and task.owner_id = new.user_id
        and task.status not in ('done', 'cancelled')
    ) then
    raise exception 'Reassign or close this member''s open tasks before removing Tasks access or making the account read-only';
  end if;
  return new;
end;
$$;

create trigger memberships_protect_open_task_reachability
before update of role, status, allowed_sections on public.memberships
for each row execute function private.enforce_open_task_member_reachability();

revoke all on function private.enforce_open_task_member_reachability()
from public, anon, authenticated;

drop policy if exists "section_scope_content_items" on public.content_items;
create policy "section_scope_content_items" on public.content_items
as restrictive for select to authenticated
using (
  private.can_access_any_section(
    organization_id,
    array['dashboard','planning','content','scripts','publishing','campaigns','tasks']::text[]
  )
);

-- A recording handoff may live entirely in the team Telegram group. Requiring
-- a copied URL for that one step recreates the paperwork this workflow removes;
-- every other file-producing step still requires its real delivery URL.
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
  if task_record.content_step in ('editing', 'thumbnail', 'design', 'publishing')
    and nullif(trim(delivery_result_url), '') is null then
    raise exception 'Editing, thumbnail, design, and publishing steps require a result URL';
  end if;

  -- The caption is data on the reel, not a fifth task. The content creator may
  -- write it while handing off the raw material; otherwise the publisher must
  -- complete it in the same form used to confirm the final post.
  if task_record.content_step = 'publishing'
    and nullif(trim(delivery_result_note), '') is null
    and not exists (
      select 1 from public.content_items item
      where item.id = task_record.content_item_id
        and nullif(trim(item.caption_brief), '') is not null
    ) then
    raise exception 'Publishing requires the final caption in the same delivery form';
  end if;

  if task_record.content_step = 'recording'
    and nullif(trim(delivery_result_note), '') is not null
    and trim(delivery_result_note) <> 'تم إرسال المادة الخام على Telegram.' then
    update public.content_items item set
      caption_brief = trim(delivery_result_note),
      version = item.version + 1,
      updated_at = now()
    where item.id = task_record.content_item_id;
  elsif task_record.content_step = 'publishing' then
    update public.content_items item set
      caption_brief = coalesce(nullif(trim(delivery_result_note), ''), item.caption_brief),
      version = case when nullif(trim(delivery_result_note), '') is null then item.version else item.version + 1 end,
      updated_at = case when nullif(trim(delivery_result_note), '') is null then item.updated_at else now() end
    where item.id = task_record.content_item_id;
  end if;

  insert into public.content_step_deliveries (
    organization_id, content_item_id, task_id, step,
    result_note, result_url, submitted_by
  ) values (
    task_record.organization_id, task_record.content_item_id, task_record.id,
    task_record.content_step,
    case
      when task_record.content_step = 'publishing' then coalesce(
        nullif(trim(delivery_result_note), ''),
        (select nullif(trim(item.caption_brief), '') from public.content_items item where item.id = task_record.content_item_id)
      )
      else nullif(trim(delivery_result_note), '')
    end,
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
      'completed_by_single_submission', true,
      'telegram_raw_handoff', task_record.content_step = 'recording'
        and nullif(trim(delivery_result_url), '') is null
    )
  );
  return delivery_id;
end;
$$;

revoke all on function public.submit_content_step_delivery(uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.submit_content_step_delivery(uuid, uuid, text, text)
to service_role;

-- Every task notification must open the exact task, regardless of whether the
-- task originated from CRM, a campaign, or a content workflow. Internal
-- bookkeeping rows such as the caption helper never notify or enter My Work.
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
  target_url text := '/tasks/' || new.id;
begin
  select coalesce(nullif(trim(profile.full_name), ''), 'عضو الفريق')
  into actor_name from public.profiles profile where profile.id = actor;
  actor_name := coalesce(actor_name, 'عضو الفريق');

  if tg_op = 'INSERT' then
    if new.is_work_item and new.status = 'ready'
      and new.owner_id is distinct from actor then
      perform private.add_notification(
        new.organization_id, new.owner_id, 'task_assigned',
        'مهمة جديدة وصلت لك', new.title, 'task', new.id, target_url,
        'task:' || new.id || ':assigned:v' || new.version || ':user:' || new.owner_id
      );
    end if;
    return new;
  end if;

  if new.is_work_item and new.owner_id is distinct from old.owner_id then
    perform private.add_notification(
      new.organization_id, new.owner_id, 'task_assigned',
      'تم إسناد مهمة لك', new.title, 'task', new.id, target_url,
      'task:' || new.id || ':reassigned:v' || new.version || ':user:' || new.owner_id
    );
  end if;

  if new.is_work_item and new.status is distinct from old.status
    and new.status = 'ready' and new.owner_id is distinct from actor then
    perform private.add_notification(
      new.organization_id, new.owner_id, 'task_ready',
      'الخطوة السابقة اكتملت', 'مهمتك جاهزة الآن: ' || new.title,
      'task', new.id, target_url,
      'task:' || new.id || ':ready:v' || new.version || ':user:' || new.owner_id
    );
  end if;

  if new.is_work_item and new.requires_review
    and new.status is distinct from old.status and new.status = 'review'
    and new.created_by is distinct from actor then
    perform private.add_notification(
      new.organization_id, new.created_by, 'task_review',
      'تسليم جديد يحتاج مراجعتك', new.title,
      'task', new.id, target_url,
      'task:' || new.id || ':review:v' || new.version || ':user:' || new.created_by
    );
  end if;

  if new.is_work_item and old.requires_review and old.status = 'review'
    and new.status = 'in_progress' and new.owner_id is distinct from actor then
    perform private.add_notification(
      new.organization_id, new.owner_id, 'task_ready',
      'المهمة رجعت لك للتنفيذ', new.title,
      'task', new.id, target_url,
      'task:' || new.id || ':returned:v' || new.version || ':user:' || new.owner_id
    );
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
        case when old.requires_review and old.status = 'review'
          then 'تم اعتماد مهمة' else 'اكتملت مهمة بواسطة ' || actor_name end,
        new.title || case when new.completed_at > new.due_at
          then ' · اكتملت بعد الموعد' else ' · اكتملت في الموعد' end,
        'task', new.id, target_url,
        'task:' || new.id || ':done:v' || new.version || ':user:' || recipient_id
      );
    end loop;

    if old.requires_review and old.status = 'review'
      and new.owner_id is distinct from actor
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

revoke all on function private.notify_task_change()
from public, anon, authenticated;
