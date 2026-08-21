-- Owner-controlled team access. Creating an invitation only creates a short-lived
-- claim link; it never sends email or adds an active member by itself. The invited
-- person must authenticate with the same email and explicitly claim the link.

create type public.team_invitation_status as enum (
  'pending',
  'accepted',
  'revoked'
);

alter table public.memberships
  add column onboarding_acknowledgements jsonb not null default '{}'::jsonb,
  add column onboarding_completed_at timestamptz,
  add constraint memberships_onboarding_acknowledgements_object
    check (jsonb_typeof(onboarding_acknowledgements) = 'object');

-- Existing active memberships predate the onboarding flow. Keep them operating
-- without forcing a historical owner through a fictional first-day checklist.
update public.memberships
set onboarding_acknowledgements = jsonb_build_object(
      'role', true,
      'workflow', true,
      'brand', true
    ),
    onboarding_completed_at = coalesce(onboarding_completed_at, joined_at, created_at)
where status = 'active';

create unique index memberships_one_active_organization_per_user_idx
  on public.memberships (user_id)
  where status = 'active';

create table public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null,
  full_name text not null,
  role public.app_role not null default 'member',
  token_hash text not null unique,
  status public.team_invitation_status not null default 'pending',
  invited_by uuid not null references public.profiles (id) on delete restrict,
  expires_at timestamptz not null,
  accepted_by uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz,
  revoked_by uuid references public.profiles (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_invitations_email_normalized check (
    email = lower(trim(email))
    and char_length(email) between 5 and 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'
  ),
  constraint team_invitations_full_name_length check (
    char_length(trim(full_name)) between 2 and 120
  ),
  constraint team_invitations_role_allowed check (role <> 'owner'),
  constraint team_invitations_token_hash_format check (token_hash ~ '^[a-f0-9]{64}$'),
  constraint team_invitations_expiry_after_creation check (expires_at > created_at),
  constraint team_invitations_resolution_consistent check (
    (status = 'pending' and accepted_by is null and accepted_at is null and revoked_by is null and revoked_at is null)
    or (status = 'accepted' and accepted_by is not null and accepted_at is not null and revoked_by is null and revoked_at is null)
    or (status = 'revoked' and accepted_by is null and accepted_at is null and revoked_by is not null and revoked_at is not null)
  )
);

create unique index team_invitations_org_pending_email_idx
  on public.team_invitations (organization_id, email)
  where status = 'pending';
create index team_invitations_org_status_time_idx
  on public.team_invitations (organization_id, status, created_at desc, id);
create index team_invitations_pending_expiry_idx
  on public.team_invitations (expires_at, id)
  where status = 'pending';
create index team_invitations_invited_by_idx
  on public.team_invitations (invited_by);
create index team_invitations_accepted_by_idx
  on public.team_invitations (accepted_by)
  where accepted_by is not null;
create index team_invitations_revoked_by_idx
  on public.team_invitations (revoked_by)
  where revoked_by is not null;

create trigger team_invitations_set_updated_at
before update on public.team_invitations
for each row execute function private.set_updated_at();

alter table public.team_invitations enable row level security;

create policy "team_invitations_select_owner"
on public.team_invitations
for select
to authenticated
using (
  private.has_org_role(
    organization_id,
    array['owner']::public.app_role[]
  )
);

revoke all on table public.team_invitations from anon, authenticated;
grant select on table public.team_invitations to authenticated;

drop policy "profiles_select_self_or_colleague" on public.profiles;
create policy "profiles_select_self_or_colleague"
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or exists (
    select 1
    from public.memberships colleague
    where colleague.user_id = profiles.id
      and private.is_org_member(colleague.organization_id)
      and (
        colleague.status = 'active'
        or private.has_org_role(
          colleague.organization_id,
          array['owner', 'admin', 'manager']::public.app_role[]
        )
      )
  )
);

drop policy "memberships_select_colleagues" on public.memberships;
create policy "memberships_select_colleagues"
on public.memberships
for select
to authenticated
using (
  private.is_org_member(organization_id)
  and (
    status = 'active'
    or user_id = (select auth.uid())
    or private.has_org_role(
      organization_id,
      array['owner', 'admin', 'manager']::public.app_role[]
    )
  )
);

alter table public.notifications
  drop constraint notifications_kind_allowed,
  add constraint notifications_kind_allowed check (
    kind in (
      'task_assigned', 'task_ready', 'task_review', 'task_blocked', 'task_done',
      'revision_requested', 'publication_published', 'publication_failed',
      'publication_held', 'script_assigned', 'script_ready', 'script_research_assigned',
      'content_brief_updated', 'team_joined', 'team_access_changed'
    )
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

  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'
    or char_length(normalized_email) not between 5 and 254 then
    raise exception 'Enter a valid work email';
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

  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text || ':' || normalized_email, 0));

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

create or replace function public.revoke_team_invitation(
  target_actor_id uuid,
  target_invitation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation_record public.team_invitations%rowtype;
begin
  select invitation.* into invitation_record
  from public.team_invitations invitation
  where invitation.id = target_invitation_id
  for update;

  if invitation_record.id is null then raise exception 'Invitation was not found'; end if;
  if not exists (
    select 1 from public.memberships membership
    where membership.organization_id = invitation_record.organization_id
      and membership.user_id = target_actor_id
      and membership.role = 'owner'
      and membership.status = 'active'
  ) then
    raise exception 'Only the active organization owner can revoke invitations';
  end if;
  if invitation_record.status <> 'pending' then return false; end if;

  update public.team_invitations
  set status = 'revoked', revoked_by = target_actor_id, revoked_at = now()
  where id = target_invitation_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id,
    before_data, after_data
  ) values (
    invitation_record.organization_id, target_actor_id,
    'team.invitation_revoked', 'team_invitation', invitation_record.id,
    jsonb_build_object('status', invitation_record.status, 'email', invitation_record.email),
    jsonb_build_object('status', 'revoked')
  );
  return true;
end;
$$;

create or replace function public.accept_team_invitation(
  target_user_id uuid,
  target_email text,
  plain_token text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation_record public.team_invitations%rowtype;
  normalized_email text := lower(trim(coalesce(target_email, '')));
begin
  if target_user_id is null or not exists (
    select 1 from public.profiles profile where profile.id = target_user_id
  ) then
    raise exception 'A verified user profile is required';
  end if;
  if plain_token is null or char_length(plain_token) not between 32 and 160 then
    raise exception 'Invitation link is invalid';
  end if;

  select invitation.* into invitation_record
  from public.team_invitations invitation
  where invitation.token_hash = encode(extensions.digest(plain_token, 'sha256'), 'hex')
  for update;

  if invitation_record.id is null
    or invitation_record.status <> 'pending'
    or invitation_record.expires_at <= now() then
    raise exception 'Invitation link is invalid, expired, or already used';
  end if;
  if invitation_record.email <> normalized_email then
    raise exception 'Sign in with the same email that the invitation was created for';
  end if;
  if exists (
    select 1 from public.memberships membership
    where membership.user_id = target_user_id
      and membership.status = 'active'
      and membership.organization_id <> invitation_record.organization_id
  ) then
    raise exception 'This account already belongs to another active workspace';
  end if;
  if exists (
    select 1 from public.memberships membership
    where membership.user_id = target_user_id
      and membership.organization_id = invitation_record.organization_id
      and membership.status = 'suspended'
  ) then
    raise exception 'This account is suspended. Ask the owner to restore access';
  end if;

  update public.profiles profile
  set full_name = invitation_record.full_name
  where profile.id = target_user_id;

  insert into public.memberships (
    organization_id, user_id, role, status, invited_by, joined_at,
    onboarding_acknowledgements, onboarding_completed_at
  ) values (
    invitation_record.organization_id, target_user_id, invitation_record.role,
    'active', invitation_record.invited_by, now(), '{}'::jsonb, null
  )
  on conflict (organization_id, user_id) do update
  set role = excluded.role,
      status = 'active',
      invited_by = excluded.invited_by,
      joined_at = coalesce(memberships.joined_at, excluded.joined_at),
      onboarding_acknowledgements = '{}'::jsonb,
      onboarding_completed_at = null;

  update public.team_invitations
  set status = 'accepted', accepted_by = target_user_id, accepted_at = now()
  where id = invitation_record.id;

  perform private.add_notification(
    invitation_record.organization_id, invitation_record.invited_by,
    'team_joined', 'عضو جديد انضم للفريق',
    invitation_record.full_name || ' فعّل حسابه ودخل مساحة العمل.',
    'membership', target_user_id, '/team',
    'team-invitation:' || invitation_record.id || ':accepted'
  );

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    invitation_record.organization_id, target_user_id,
    'team.invitation_accepted', 'membership', target_user_id,
    jsonb_build_object(
      'invitation_id', invitation_record.id,
      'role', invitation_record.role,
      'email', invitation_record.email
    )
  );

  return invitation_record.organization_id;
end;
$$;

create or replace function public.manage_team_membership(
  target_actor_id uuid,
  target_organization_id uuid,
  target_user_id uuid,
  target_role public.app_role,
  target_status public.membership_status
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  membership_record public.memberships%rowtype;
begin
  if not exists (
    select 1 from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = target_actor_id
      and membership.role = 'owner'
      and membership.status = 'active'
  ) then
    raise exception 'Only the active organization owner can manage team access';
  end if;

  select membership.* into membership_record
  from public.memberships membership
  where membership.organization_id = target_organization_id
    and membership.user_id = target_user_id
  for update;

  if membership_record.id is null then raise exception 'Team membership was not found'; end if;
  if membership_record.role = 'owner' or target_user_id = target_actor_id then
    raise exception 'The workspace owner access cannot be changed here';
  end if;
  if target_role is null or target_role = 'owner' then
    raise exception 'Owner access cannot be granted from team management';
  end if;
  if target_status not in ('active', 'suspended') then
    raise exception 'Membership status must be active or suspended';
  end if;

  if target_status = 'suspended' and membership_record.status <> 'suspended' then
    if exists (
      select 1 from public.tasks task
      where task.organization_id = target_organization_id
        and task.owner_id = target_user_id
        and task.status not in ('done', 'cancelled')
    ) then
      raise exception 'Reassign or close this member''s open tasks before suspending access';
    end if;
    if exists (
      select 1 from public.scripts script
      where script.organization_id = target_organization_id
        and script.assigned_to = target_user_id
        and script.status not in ('handed_off', 'archived')
    ) then
      raise exception 'Reassign or archive this member''s open scripts before suspending access';
    end if;
    if exists (
      select 1 from public.crm_contacts contact
      where contact.organization_id = target_organization_id
        and contact.owner_id = target_user_id
        and contact.stage not in ('won', 'lost', 'do_not_contact')
    ) then
      raise exception 'Reassign or close this member''s active leads before suspending access';
    end if;
  end if;

  update public.memberships membership
  set role = target_role,
      status = target_status,
      joined_at = case
        when target_status = 'active' then coalesce(membership.joined_at, now())
        else membership.joined_at
      end
  where membership.id = membership_record.id;

  if target_status = 'suspended' then
    delete from public.member_presence presence
    where presence.organization_id = target_organization_id
      and presence.user_id = target_user_id;
  else
    perform private.add_notification(
      target_organization_id, target_user_id, 'team_access_changed',
      'تم تحديث صلاحيتك',
      'دورك الحالي داخل مساحة Market Whales: ' || target_role::text || '.',
      'membership', membership_record.id, '/team',
      'membership:' || membership_record.id || ':access:' || gen_random_uuid()
    );
  end if;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id,
    before_data, after_data
  ) values (
    target_organization_id, target_actor_id, 'team.membership_updated',
    'membership', membership_record.id,
    jsonb_build_object('role', membership_record.role, 'status', membership_record.status),
    jsonb_build_object('role', target_role, 'status', target_status)
  );
  return true;
end;
$$;

create or replace function public.acknowledge_team_onboarding(
  target_user_id uuid,
  target_organization_id uuid,
  target_step text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  acknowledgements jsonb;
begin
  if target_step not in ('role', 'workflow', 'brand') then
    raise exception 'Unknown onboarding step';
  end if;
  if not exists (
    select 1 from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = target_user_id
      and membership.status = 'active'
  ) then
    raise exception 'Active organization membership is required';
  end if;

  update public.memberships membership
  set onboarding_acknowledgements = membership.onboarding_acknowledgements
        || jsonb_build_object(target_step, true)
  where membership.organization_id = target_organization_id
    and membership.user_id = target_user_id
  returning onboarding_acknowledgements into acknowledgements;

  if coalesce((acknowledgements ->> 'role')::boolean, false)
    and coalesce((acknowledgements ->> 'workflow')::boolean, false)
    and coalesce((acknowledgements ->> 'brand')::boolean, false) then
    update public.memberships membership
    set onboarding_completed_at = coalesce(membership.onboarding_completed_at, now())
    where membership.organization_id = target_organization_id
      and membership.user_id = target_user_id;

    insert into public.audit_events (
      organization_id, actor_id, action, entity_type, entity_id, after_data
    )
    select membership.organization_id, target_user_id,
      'team.onboarding_completed', 'membership', membership.id,
      jsonb_build_object('acknowledgements', acknowledgements)
    from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = target_user_id
      and not exists (
        select 1 from public.audit_events audit
        where audit.organization_id = target_organization_id
          and audit.actor_id = target_user_id
          and audit.action = 'team.onboarding_completed'
          and audit.entity_id = membership.id
      );
  end if;

  return true;
end;
$$;

revoke all on function public.create_team_invitation(uuid, uuid, text, text, public.app_role, text, timestamptz)
from public, anon, authenticated;
grant execute on function public.create_team_invitation(uuid, uuid, text, text, public.app_role, text, timestamptz)
to service_role;

revoke all on function public.revoke_team_invitation(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.revoke_team_invitation(uuid, uuid)
to service_role;

revoke all on function public.accept_team_invitation(uuid, text, text)
from public, anon, authenticated;
grant execute on function public.accept_team_invitation(uuid, text, text)
to service_role;

revoke all on function public.manage_team_membership(uuid, uuid, uuid, public.app_role, public.membership_status)
from public, anon, authenticated;
grant execute on function public.manage_team_membership(uuid, uuid, uuid, public.app_role, public.membership_status)
to service_role;

revoke all on function public.acknowledge_team_onboarding(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.acknowledge_team_onboarding(uuid, uuid, text)
to service_role;
