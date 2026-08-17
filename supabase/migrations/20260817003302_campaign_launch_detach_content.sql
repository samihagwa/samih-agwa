-- Reversible content association command. Removing a link never deletes either
-- the launch or the content item, and every successful removal is audited.

create or replace function public.detach_content_from_launch(
  target_user_id uuid,
  target_launch_id uuid,
  target_content_item_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  target_organization_id uuid;
  deleted_count integer;
begin
  if target_user_id is null then
    raise exception 'A verified target user is required';
  end if;

  perform set_config('request.jwt.claim.sub', target_user_id::text, true);
  actor := (select auth.uid());

  select launch.organization_id
  into target_organization_id
  from public.launches launch
  where launch.id = target_launch_id;

  if target_organization_id is null then
    raise exception 'Launch was not found';
  end if;

  if not exists (
    select 1
    from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = actor
      and membership.status = 'active'
      and membership.role in ('owner', 'admin', 'manager')
  ) then
    raise exception 'Only organization leadership can detach launch content';
  end if;

  delete from public.launch_content_items link
  where link.organization_id = target_organization_id
    and link.launch_id = target_launch_id
    and link.content_item_id = target_content_item_id;

  get diagnostics deleted_count = row_count;

  if deleted_count = 1 then
    insert into public.audit_events (
      organization_id, actor_id, action, entity_type, entity_id, before_data
    ) values (
      target_organization_id,
      actor,
      'launch.content_detached',
      'launch',
      target_launch_id,
      jsonb_build_object('content_item_id', target_content_item_id)
    );
  end if;

  return deleted_count = 1;
end;
$$;

revoke all on function public.detach_content_from_launch(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.detach_content_from_launch(uuid, uuid, uuid)
  to service_role;
