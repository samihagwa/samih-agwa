-- The final caption is shared workflow data on the content item. It can be
-- edited from an involved task without granting broad write access to the
-- whole Content workspace. Optimistic locking prevents one member from
-- silently overwriting another member's newer edit.

-- Keep the table-level write guard aligned with the command authorization.
-- This changes only the caption field set; it does not grant direct table
-- UPDATE or broaden the existing RLS policies.
create or replace function private.guard_content_item_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  changed_fields text[] := array(
    select key from jsonb_each(to_jsonb(new)) entry(key, value)
    where value is distinct from (to_jsonb(old) -> key)
  );
  allowed_internal_fields constant text[] := array['status', 'published_at', 'version', 'updated_at'];
  allowed_version_fields constant text[] := array['version', 'updated_at'];
  allowed_caption_fields constant text[] := array['caption_brief', 'version', 'updated_at'];
  allowed_thumbnail_fields constant text[] := array['thumbnail_brief', 'version', 'updated_at'];
begin
  if actor is null then return new; end if;
  if private.is_org_owner_or_admin_actor(actor, new.organization_id)
    or new.created_by = actor then
    return new;
  end if;
  if pg_trigger_depth() > 1 and changed_fields <@ allowed_internal_fields then
    return new;
  end if;
  if changed_fields <@ allowed_version_fields and exists (
    select 1 from public.tasks task
    where task.content_item_id = new.id and task.owner_id = actor
  ) then return new; end if;
  if changed_fields <@ allowed_caption_fields and exists (
    select 1 from public.tasks task
    where task.organization_id = new.organization_id
      and task.content_item_id = new.id
      and task.owner_id = actor
      and task.is_work_item
      and task.content_step in (
        'recording', 'editing', 'thumbnail', 'caption',
        'design', 'scheduling', 'publishing'
      )
      and task.status <> 'cancelled'
  ) then return new; end if;
  if changed_fields <@ allowed_thumbnail_fields and exists (
    select 1 from public.tasks task
    where task.content_item_id = new.id
      and task.owner_id = actor
      and task.content_step = 'thumbnail'
      and task.status <> 'cancelled'
  ) then return new; end if;
  raise exception 'You cannot modify this content file';
end;
$$;

revoke all on function private.guard_content_item_write()
from public, anon, authenticated;

create or replace function public.update_content_caption_v1(
  target_user_id uuid,
  target_content_item_id uuid,
  expected_content_version bigint,
  content_caption text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_record public.content_items%rowtype;
  clean_caption text := nullif(trim(content_caption), '');
  actor_is_active_editor boolean;
  actor_is_requester boolean;
  actor_is_step_owner boolean;
  actor_is_content_leadership boolean;
  publishing_task record;
  new_version bigint;
begin
  if target_user_id is null then
    raise exception 'A verified target user is required';
  end if;
  if target_content_item_id is null then
    raise exception 'Content item is required';
  end if;
  if expected_content_version is null or expected_content_version < 1 then
    raise exception 'A valid content version is required';
  end if;
  if clean_caption is null or char_length(clean_caption) not between 3 and 10000 then
    raise exception 'Final caption must contain between 3 and 10000 characters';
  end if;

  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  select item.* into item_record
  from public.content_items item
  where item.id = target_content_item_id
  for update;
  if item_record.id is null then
    raise exception 'Content item was not found';
  end if;

  select exists (
    select 1
    from public.memberships membership
    where membership.organization_id = item_record.organization_id
      and membership.user_id = target_user_id
      and membership.status = 'active'
      and membership.role <> 'viewer'
  ) into actor_is_active_editor;
  if not actor_is_active_editor then
    raise exception 'Only an active non-viewer organization member can update the caption';
  end if;

  actor_is_requester := item_record.created_by = target_user_id;
  select exists (
    select 1
    from public.tasks task
    where task.organization_id = item_record.organization_id
      and task.content_item_id = item_record.id
      and task.owner_id = target_user_id
      and task.is_work_item
      and task.content_step in (
        'recording', 'editing', 'thumbnail', 'caption',
        'design', 'scheduling', 'publishing'
      )
      and task.status <> 'cancelled'
  ) into actor_is_step_owner;
  actor_is_content_leadership := private.has_org_role(
      item_record.organization_id,
      array['owner', 'admin', 'manager']::public.app_role[]
    ) and private.actor_can_access_any_section(
      target_user_id,
      item_record.organization_id,
      array['content']::text[]
    );

  if not (
    actor_is_requester
    or actor_is_step_owner
    or actor_is_content_leadership
  ) then
    raise exception 'Only the requester, an assigned content-step owner, or Content leadership can update the caption';
  end if;

  -- A lost successful HTTP response can be retried safely: returning the
  -- current version for the same caption creates no second audit or notice.
  if item_record.version <> expected_content_version then
    if item_record.caption_brief = clean_caption then
      return item_record.version;
    end if;
    raise exception 'Content changed in another session. Refresh and try again';
  end if;
  if item_record.caption_brief = clean_caption then
    return item_record.version;
  end if;

  update public.content_items item
  set caption_brief = clean_caption,
    version = item.version + 1,
    updated_at = now()
  where item.id = target_content_item_id
    and item.version = expected_content_version
  returning item.version into new_version;
  if new_version is null then
    raise exception 'Content changed in another session. Refresh and try again';
  end if;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id,
    before_data, after_data
  ) values (
    item_record.organization_id,
    target_user_id,
    'content.caption_updated',
    'content_item',
    item_record.id,
    jsonb_build_object(
      'version', item_record.version,
      'caption_length', char_length(item_record.caption_brief)
    ),
    jsonb_build_object(
      'version', new_version,
      'caption_length', char_length(clean_caption)
    )
  );

  for publishing_task in
    select task.id, task.owner_id
    from public.tasks task
    where task.organization_id = item_record.organization_id
      and task.content_item_id = item_record.id
      and task.content_step = 'publishing'
      and task.is_work_item
      and task.status <> 'cancelled'
      and task.owner_id is distinct from target_user_id
    order by task.created_at, task.id
  loop
    perform private.add_notification(
      item_record.organization_id,
      publishing_task.owner_id,
      'content_brief_updated',
      'تم تحديث الكابشن النهائي',
      item_record.title,
      'task',
      publishing_task.id,
      '/tasks/' || publishing_task.id,
      'content:' || item_record.id || ':caption:v' || new_version
        || ':task:' || publishing_task.id || ':user:' || publishing_task.owner_id
    );
  end loop;

  return new_version;
end;
$$;

revoke all on function public.update_content_caption_v1(
  uuid, uuid, bigint, text
) from public, anon, authenticated;
grant execute on function public.update_content_caption_v1(
  uuid, uuid, bigint, text
) to service_role;

comment on function public.update_content_caption_v1(
  uuid, uuid, bigint, text
) is
  'Optimistically updates the final caption for the content requester, an assigned content-step owner, or Content-authorized leadership; retries of an already-applied value are no-ops.';
