-- Viewers may keep the existing assignee-only SELECT policies, but can never
-- become a script actor. Replacing the shared guard closes every mutation path
-- (drafts, research, voice profile, AI saves, status changes, and handoff) at
-- the database boundary, including calls made through service-role functions.

create or replace function private.is_active_script_actor(
  target_user_id uuid,
  target_organization_id uuid
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
        and membership.role <> 'viewer'
        and (
          membership.role = 'owner'
          or membership.allowed_sections && array['scripts']::text[]
        )
    );
$$;

revoke all on function private.is_active_script_actor(uuid, uuid)
from public, anon, authenticated;

comment on function private.is_active_script_actor(uuid, uuid) is
  'True only for an active non-viewer owner or member with Scripts access; used by every private script mutation.';
