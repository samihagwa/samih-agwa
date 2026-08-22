create or replace function public.cancel_launch(
  target_user_id uuid,
  target_launch_id uuid,
  expected_version bigint,
  cancellation_reason text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare launch_record public.launches%rowtype; new_version bigint;
begin
  select * into launch_record from public.launches where id = target_launch_id for update;
  if launch_record.id is null then raise exception 'Launch was not found'; end if;
  if not private.is_org_owner_or_admin_actor(target_user_id, launch_record.organization_id) then
    raise exception 'Only a platform owner or admin can cancel a launch';
  end if;
  if launch_record.version <> expected_version then
    raise exception 'Launch changed in another session; refresh before cancelling';
  end if;
  if launch_record.status = 'cancelled' then return launch_record.version; end if;
  if launch_record.status = 'completed' then raise exception 'A completed launch cannot be cancelled'; end if;
  if $4 is null or char_length(trim($4)) not between 3 and 1000 then
    raise exception 'Add a clear cancellation reason';
  end if;

  perform set_config('request.jwt.claim.sub', target_user_id::text, true);
  perform set_config('app.cancel_launch_id', target_launch_id::text, true);

  update public.tasks task set status = 'cancelled'
  where task.launch_id = target_launch_id and task.status <> 'cancelled';
  update public.tasks task set status = 'cancelled'
  where task.launch_deliverable_id in (
    select deliverable.id from public.launch_deliverables deliverable
    where deliverable.launch_id = target_launch_id
  ) and task.status <> 'cancelled';

  update public.launches launch set
    status = 'cancelled', cancelled_at = now(), cancelled_by = target_user_id,
    cancellation_reason = trim($4), version = launch.version + 1, updated_at = now()
  where launch.id = target_launch_id
  returning launch.version into new_version;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    launch_record.organization_id, target_user_id, 'launch.cancelled', 'launch', target_launch_id,
    jsonb_build_object('status', launch_record.status, 'version', launch_record.version),
    jsonb_build_object('status', 'cancelled', 'version', new_version,
      'reason', trim($4))
  );
  return new_version;
end;
$$;

revoke all on function public.cancel_launch(uuid, uuid, bigint, text)
from public, anon, authenticated;
grant execute on function public.cancel_launch(uuid, uuid, bigint, text)
to service_role;
