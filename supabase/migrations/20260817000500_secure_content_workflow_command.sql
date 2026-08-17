-- Route content workflow creation through a JWT-protected Edge Function.
-- The browser can no longer execute a SECURITY DEFINER database command directly.

revoke all on function public.create_reel_workflow(
  uuid, text, text, text, text, timestamptz,
  uuid, uuid, uuid, uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;

alter function public.create_reel_workflow(
  uuid, text, text, text, text, timestamptz,
  uuid, uuid, uuid, uuid, uuid, uuid, uuid
) rename to create_reel_workflow_internal;

revoke all on function public.create_reel_workflow_internal(
  uuid, text, text, text, text, timestamptz,
  uuid, uuid, uuid, uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;

create or replace function public.create_reel_workflow(
  target_user_id uuid,
  target_organization_id uuid,
  content_title text,
  content_goal text,
  content_hook text,
  content_cta text,
  target_publish_at timestamptz,
  brief_owner_id uuid,
  recording_owner_id uuid,
  editing_owner_id uuid,
  thumbnail_owner_id uuid,
  caption_owner_id uuid,
  approval_owner_id uuid,
  publishing_owner_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_user_id is null then
    raise exception 'A verified target user is required';
  end if;

  -- auth.uid() and all task audit triggers resolve to the verified caller supplied
  -- by the trusted Edge Function for this transaction only.
  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  return public.create_reel_workflow_internal(
    target_organization_id,
    content_title,
    content_goal,
    content_hook,
    content_cta,
    target_publish_at,
    brief_owner_id,
    recording_owner_id,
    editing_owner_id,
    thumbnail_owner_id,
    caption_owner_id,
    approval_owner_id,
    publishing_owner_id
  );
end;
$$;

revoke all on function public.create_reel_workflow(
  uuid, uuid, text, text, text, text, timestamptz,
  uuid, uuid, uuid, uuid, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.create_reel_workflow(
  uuid, uuid, text, text, text, text, timestamptz,
  uuid, uuid, uuid, uuid, uuid, uuid, uuid
) to service_role;

