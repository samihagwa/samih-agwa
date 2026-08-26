-- Count the real workflow minutes once per member, even when the same person
-- owns more than one production role in a single planned content item.

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
  if target_publish_at <= now() + interval '2 hours' then
    raise exception 'Publish time must be at least two hours in the future';
  end if;
  if requested_minutes not between 15 and 2880 then raise exception 'Estimated time is invalid'; end if;

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
    ) then
      raise exception 'Every execution owner must be an active working member';
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
    content_title, content_objective, nullif(trim(content_hook), ''), nullif(trim(content_cta), ''),
    content_platforms, accountable_owner_id, target_publish_at, 'planned', requested_minutes, actor, actor
  ) returning id into plan_item_id;

  if target_kind = 'reel' then
    content_id := public.create_reel_production_workflow_v3(
      actor, target_organization_id, content_title, content_objective,
      coalesce(nullif(trim(content_hook), ''), 'ابدأ من المشكلة الأساسية'),
      coalesce(nullif(trim(content_cta), ''), 'تفاعل مع المحتوى'),
      content_objective, 'نفّذ المونتاج وفق ملف المحتوى النهائي بعد اعتماد النص.',
      'اقترح غلافًا واضحًا من الفكرة والنص النهائي.', '', target_publish_at,
      accountable_owner_id, editing_owner_id, design_owner_id,
      publishing_owner_id, publishing_owner_id, '', '', '', '{}'::uuid[]
    );
    perform set_config('app.plan_execution_item_id', plan_item_id::text, true);
    update public.tasks task set
      source_plan_item_id = plan_item_id,
      estimated_minutes = case task.content_step
        when 'recording' then greatest(60, requested_minutes)
        when 'editing' then 180 when 'thumbnail' then 90 when 'publishing' then 30
        else task.estimated_minutes end
    where task.content_item_id = content_id;
  else
    content_id := private.create_generic_planned_content_workflow(
      actor, target_organization_id, plan_item_id, target_kind, content_title,
      content_objective, content_hook, content_cta, content_platforms,
      target_publish_at, accountable_owner_id, design_owner_id, publishing_owner_id
    );
  end if;

  update public.content_plan_items
  set content_item_id = content_id
  where id = plan_item_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id, actor, 'planning.execution_created', 'content_plan_item', plan_item_id,
    jsonb_build_object('content_item_id', content_id, 'capacity_override', allow_capacity_override)
  );
  return jsonb_build_object('plan_item_id', plan_item_id, 'content_item_id', content_id);
end;
$$;

