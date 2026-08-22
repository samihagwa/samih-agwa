-- The original validation used two backslashes before the literal dot while
-- standard_conforming_strings is enabled. PostgreSQL therefore looked for a
-- backslash in the email address and rejected normal addresses such as Gmail.

alter table public.team_invitations
  drop constraint team_invitations_email_normalized;

alter table public.team_invitations
  add constraint team_invitations_email_normalized check (
    email = lower(trim(email))
    and char_length(email) between 5 and 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  );

create or replace function public.create_team_invitation(
  target_actor_id uuid,
  target_organization_id uuid,
  target_email text,
  target_full_name text,
  target_role public.app_role,
  plain_token text,
  target_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation_id uuid;
  normalized_email text := lower(trim(coalesce(target_email, '')));
  normalized_name text := trim(coalesce(target_full_name, ''));
begin
  if target_actor_id is null or not exists (
    select 1 from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = target_actor_id
      and membership.role = 'owner'
      and membership.status = 'active'
  ) then
    raise exception 'Only the active organization owner can create team invitations';
  end if;

  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or char_length(normalized_email) not between 5 and 254 then
    raise exception 'Enter a valid email address';
  end if;
  if char_length(normalized_name) not between 2 and 120 then
    raise exception 'Enter the team member name';
  end if;
  if target_role is null or target_role = 'owner' then
    raise exception 'Owner access cannot be granted through an invitation';
  end if;
  if plain_token is null or char_length(plain_token) not between 32 and 160 then
    raise exception 'Invitation token is invalid';
  end if;
  if target_expires_at <= now() + interval '5 minutes'
    or target_expires_at > now() + interval '14 days' then
    raise exception 'Invitation expiry must be between 5 minutes and 14 days';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(target_organization_id::text || ':' || normalized_email, 0)
  );

  if exists (
    select 1
    from public.memberships membership
    join auth.users auth_user on auth_user.id = membership.user_id
    where membership.organization_id = target_organization_id
      and lower(auth_user.email) = normalized_email
      and membership.status in ('active', 'suspended')
  ) then
    raise exception 'This email already belongs to a team member';
  end if;

  update public.team_invitations invitation
  set status = 'revoked',
      revoked_by = target_actor_id,
      revoked_at = now()
  where invitation.organization_id = target_organization_id
    and invitation.email = normalized_email
    and invitation.status = 'pending';

  insert into public.team_invitations (
    organization_id, email, full_name, role, token_hash,
    invited_by, expires_at
  ) values (
    target_organization_id, normalized_email, normalized_name, target_role,
    encode(extensions.digest(plain_token, 'sha256'), 'hex'),
    target_actor_id, target_expires_at
  ) returning id into invitation_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id, target_actor_id, 'team.invitation_created',
    'team_invitation', invitation_id,
    jsonb_build_object(
      'email', normalized_email,
      'full_name', normalized_name,
      'role', target_role,
      'expires_at', target_expires_at,
      'delivery', 'manual_link_only'
    )
  );

  return invitation_id;
end;
$$;

revoke all on function public.create_team_invitation(
  uuid, uuid, text, text, public.app_role, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.create_team_invitation(
  uuid, uuid, text, text, public.app_role, text, timestamptz
) to service_role;
