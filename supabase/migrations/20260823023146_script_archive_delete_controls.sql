-- Permanent script deletion is deliberately narrower than archive/restore:
-- only the active organization owner, only after archiving, and only while the
-- script is still an unlinked draft asset. Production and research history stay
-- durable and can only be hidden through the archive.

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
  select *
  into script_record
  from public.scripts
  where id = target_script_id
  for update;

  if script_record.id is null then
    raise exception 'Script not found';
  end if;
  if not private.is_script_owner_actor(target_user_id, script_record.organization_id) then
    raise exception 'Only the organization owner can permanently delete scripts';
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
    select 1
    from public.script_research_items research
    where research.linked_script_id = script_record.id
  ) then
    raise exception 'A script linked to research cannot be permanently deleted';
  end if;

  insert into public.audit_events (
    organization_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    before_data
  ) values (
    script_record.organization_id,
    target_user_id,
    'script.deleted',
    'script',
    script_record.id,
    jsonb_build_object(
      'title', script_record.title,
      'assigned_to', script_record.assigned_to,
      'status', script_record.status,
      'edit_version', script_record.edit_version,
      'created_at', script_record.created_at,
      'archived_at', script_record.archived_at
    )
  );

  delete from public.scripts where id = script_record.id;
  return true;
end;
$$;

revoke all on function public.delete_archived_script(uuid, uuid, bigint)
from public, anon, authenticated;
grant execute on function public.delete_archived_script(uuid, uuid, bigint)
to service_role;
