-- Strict per-writer script privacy, including the organization owner.
--
-- A script becomes shared operational content only when its assigned writer
-- explicitly hands it to Content Factory. Before that handoff, no platform role
-- can read the script, its versions, its research, or its voice profile.

drop policy if exists "scripts_select_assignee_or_owner" on public.scripts;
create policy "scripts_select_assignee_only"
on public.scripts for select to authenticated
using (
  assigned_to = (select auth.uid())
  and private.actor_can_access_any_section(
    (select auth.uid()), organization_id, array['scripts']::text[]
  )
);

drop policy if exists "script_versions_select_through_script" on public.script_versions;
create policy "script_versions_select_assignee_only"
on public.script_versions for select to authenticated
using (
  exists (
    select 1
    from public.scripts script
    where script.id = script_versions.script_id
      and script.organization_id = script_versions.organization_id
      and script.assigned_to = (select auth.uid())
      and private.actor_can_access_any_section(
        (select auth.uid()), script.organization_id, array['scripts']::text[]
      )
  )
);

drop policy if exists "script_research_select_assignee_or_owner" on public.script_research_items;
create policy "script_research_select_assignee_only"
on public.script_research_items for select to authenticated
using (
  assigned_to = (select auth.uid())
  and private.actor_can_access_any_section(
    (select auth.uid()), organization_id, array['scripts']::text[]
  )
);

create or replace function private.can_access_script_actor(
  target_user_id uuid,
  target_organization_id uuid,
  target_assigned_to uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_assigned_to = target_user_id
    and private.is_active_script_actor(target_user_id, target_organization_id)
    and private.actor_can_access_any_section(
      target_user_id, target_organization_id, array['scripts']::text[]
    );
$$;

revoke all on function private.can_access_script_actor(uuid, uuid, uuid)
from public, anon, authenticated;

create or replace function public.change_script_status(
  target_user_id uuid,
  target_script_id uuid,
  next_status public.script_status,
  expected_edit_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  script_record public.scripts%rowtype;
  new_version bigint;
begin
  select * into script_record from public.scripts where id = target_script_id for update;
  if script_record.id is null then raise exception 'Script not found'; end if;
  if not private.can_access_script_actor(
    target_user_id, script_record.organization_id, script_record.assigned_to
  ) then
    raise exception 'Only the assigned writer can change this private script';
  end if;
  if script_record.edit_version <> expected_edit_version then
    raise exception 'Script changed in another session; refresh before changing status';
  end if;
  if next_status = 'handed_off' then raise exception 'Use the Content Factory handoff command'; end if;
  if script_record.status = 'handed_off' and next_status <> 'archived' then
    raise exception 'A handed-off script cannot return to drafting';
  end if;

  update public.scripts
  set status = next_status,
      archived_at = case when next_status = 'archived' then now() else null end,
      archived_by = case when next_status = 'archived' then target_user_id else null end,
      edit_version = edit_version + 1
  where id = target_script_id;

  select edit_version into new_version from public.scripts where id = target_script_id;
  perform private.add_script_version(
    target_script_id, 'manual_save', target_user_id, 'تغيير حالة الاسكريبت'
  );

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    script_record.organization_id, target_user_id, 'script.status_changed',
    'script', target_script_id,
    jsonb_build_object('status', script_record.status, 'edit_version', script_record.edit_version),
    jsonb_build_object('status', next_status, 'edit_version', new_version, 'private_script', true)
  );

  return new_version;
end;
$$;

create or replace function public.delete_archived_script(
  target_user_id uuid,
  target_script_id uuid,
  expected_edit_version bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  script_record public.scripts%rowtype;
begin
  select * into script_record
  from public.scripts
  where id = target_script_id
  for update;

  if script_record.id is null then raise exception 'Script not found'; end if;
  if not private.can_access_script_actor(
    target_user_id, script_record.organization_id, script_record.assigned_to
  ) then
    raise exception 'Only the assigned writer can permanently delete this private script';
  end if;
  if script_record.edit_version <> expected_edit_version then
    raise exception 'Script changed in another session; refresh before deleting';
  end if;
  if script_record.status <> 'archived' then
    raise exception 'Archive the script before permanently deleting it';
  end if;
  if script_record.content_item_id is not null then
    raise exception 'A script linked to the Content Factory cannot be permanently deleted';
  end if;
  if exists (
    select 1 from public.script_research_items research
    where research.linked_script_id = script_record.id
  ) then
    raise exception 'A script linked to research cannot be permanently deleted';
  end if;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, before_data
  ) values (
    script_record.organization_id, target_user_id, 'script.deleted', 'script', script_record.id,
    jsonb_build_object(
      'assigned_to', script_record.assigned_to,
      'status', script_record.status,
      'edit_version', script_record.edit_version,
      'private_script', true
    )
  );

  delete from public.scripts where id = script_record.id;
  return true;
end;
$$;

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
  workflow_actor_id uuid;
  content_id uuid;
  brand_ids uuid[];
  resolved_cta text;
begin
  select * into script_record
  from public.scripts
  where id = target_script_id
  for update;

  if script_record.id is null then raise exception 'Script not found'; end if;
  if not private.can_access_script_actor(
    target_user_id, script_record.organization_id, script_record.assigned_to
  ) then
    raise exception 'Only the assigned writer can hand off this private script';
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

  if exists (
    select 1
    from unnest(array[
      content_creator_id, editing_owner_id, thumbnail_owner_id, publishing_owner_id
    ]) selected_user_id
    where selected_user_id is null
      or not exists (
        select 1
        from public.memberships membership
        where membership.organization_id = script_record.organization_id
          and membership.user_id = selected_user_id
          and membership.status = 'active'
          and membership.role <> 'viewer'
      )
  ) then
    raise exception 'Every production owner must be an active working member';
  end if;

  select membership.user_id into workflow_actor_id
  from public.memberships membership
  where membership.organization_id = script_record.organization_id
    and membership.status = 'active'
    and membership.role in ('owner', 'admin')
  order by case membership.role when 'owner' then 0 else 1 end,
    membership.created_at, membership.user_id
  limit 1;

  if workflow_actor_id is null then
    raise exception 'A platform owner or admin is required to authorize production';
  end if;

  resolved_cta := coalesce(
    private.extract_script_cta(script_record.spoken_script),
    nullif(trim(script_record.cta), ''),
    'شاهد المحتوى كاملًا'
  );

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

  content_id := public.create_reel_production_workflow_v3(
    workflow_actor_id,
    script_record.organization_id,
    script_record.title,
    script_record.objective,
    coalesce(nullif(script_record.hook_variants[1], ''), script_record.title),
    resolved_cta,
    script_record.spoken_script,
    coalesce(nullif(script_record.editing_notes, ''), 'مونتاج نظيف وسريع يحافظ على وضوح الفكرة.'),
    coalesce(nullif(script_record.thumbnail_notes, ''), 'غلاف واضح يعكس الفكرة بدون مبالغة.'),
    concat_ws(E'\n\n',
      nullif(script_record.claims_notes, ''),
      nullif(script_record.recording_notes, ''),
      nullif(script_record.on_screen_text, '')
    ),
    target_publish_at,
    content_creator_id,
    editing_owner_id,
    thumbnail_owner_id,
    publishing_owner_id,
    publishing_owner_id,
    '',
    coalesce(script_record.source_url, ''),
    coalesce(script_record.source_url, ''),
    brand_ids
  );

  update public.content_items
  set caption_brief = left(concat_ws(E'\n\n',
    nullif(trim(script_record.caption), ''),
    nullif(array_to_string(script_record.hashtags, ' '), '')
  ), 10000)
  where id = content_id and organization_id = script_record.organization_id;

  update public.scripts
  set status = 'handed_off',
      content_item_id = content_id,
      handed_off_at = now(),
      handed_off_by = target_user_id,
      edit_version = edit_version + 1
  where id = target_script_id;

  perform private.add_script_version(
    target_script_id, 'handoff', target_user_id, 'تسليم لمصنع المحتوى'
  );

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    script_record.organization_id, target_user_id, 'script.handed_off',
    'script', target_script_id,
    jsonb_build_object('status', script_record.status, 'private_script', true),
    jsonb_build_object(
      'status', 'handed_off',
      'content_item_id', content_id,
      'workflow_authorized_by', workflow_actor_id,
      'caption_brief_carried', nullif(trim(script_record.caption), '') is not null
    )
  );

  return content_id;
end;
$$;

revoke all on function public.change_script_status(uuid, uuid, public.script_status, bigint)
from public, anon, authenticated;
grant execute on function public.change_script_status(uuid, uuid, public.script_status, bigint)
to service_role;

revoke all on function public.delete_archived_script(uuid, uuid, bigint)
from public, anon, authenticated;
grant execute on function public.delete_archived_script(uuid, uuid, bigint)
to service_role;

revoke all on function public.handoff_script_to_content(
  uuid, uuid, bigint, timestamptz, uuid, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.handoff_script_to_content(
  uuid, uuid, bigint, timestamptz, uuid, uuid, uuid, uuid
) to service_role;

comment on policy "scripts_select_assignee_only" on public.scripts is
  'Every member, including platform leadership, can select only scripts assigned to their own account.';
comment on function public.handoff_script_to_content(
  uuid, uuid, bigint, timestamptz, uuid, uuid, uuid, uuid
) is
  'The assigned writer atomically converts a private approved script into shared Content Factory work.';
