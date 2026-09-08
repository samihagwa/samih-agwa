-- Repair password-first team onboarding.
--
-- Supabase Admin createUser can persist app_metadata after the auth.users INSERT.
-- The original INSERT trigger therefore created the profile but sometimes did
-- not see registration_flow yet, leaving a valid account without either an
-- access request or membership. Keep the trigger as a safety net, but make the
-- durable request an explicit, idempotent server-side operation as well.

create or replace function public.ensure_workspace_access_request(
  target_user_id uuid,
  target_email text,
  target_full_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  auth_email text;
  registration_flow text;
  normalized_name text;
  target_organization_id uuid;
  owner_id uuid;
  access_request_id uuid;
begin
  if target_user_id is null then
    raise exception 'A registered account is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('workspace-access:' || target_user_id::text, 0));

  select lower(trim(auth_user.email)),
         coalesce(auth_user.raw_app_meta_data ->> 'registration_flow', ''),
         coalesce(
           nullif(trim(target_full_name), ''),
           nullif(trim(auth_user.raw_user_meta_data ->> 'full_name'), ''),
           'عضو جديد'
         )
    into auth_email, registration_flow, normalized_name
  from auth.users auth_user
  where auth_user.id = target_user_id;

  if auth_email is null
    or auth_email <> lower(trim(coalesce(target_email, ''))) then
    raise exception 'Registered account email does not match the access request';
  end if;
  if registration_flow <> 'owner_approval_request' then
    raise exception 'Account is not eligible for the owner approval flow';
  end if;
  if char_length(normalized_name) not between 2 and 120 then
    raise exception 'Enter the team member name';
  end if;

  insert into public.profiles (id, full_name)
  values (target_user_id, normalized_name)
  on conflict (id) do update
  set full_name = coalesce(nullif(trim(profiles.full_name), ''), excluded.full_name);

  select request.id into access_request_id
  from public.account_access_requests request
  where request.user_id = target_user_id
  limit 1;

  if access_request_id is not null then
    return access_request_id;
  end if;

  if exists (
    select 1 from public.memberships membership
    where membership.user_id = target_user_id
      and membership.status = 'active'
  ) then
    return null;
  end if;

  select membership.organization_id, membership.user_id
    into target_organization_id, owner_id
  from public.memberships membership
  join auth.users owner_user on owner_user.id = membership.user_id
  where membership.role = 'owner'
    and membership.status = 'active'
    and lower(owner_user.email) = 'samihsmaih1234@gmail.com'
  order by membership.created_at
  limit 1;

  if target_organization_id is null or owner_id is null then
    raise exception 'Workspace owner is unavailable';
  end if;

  insert into public.account_access_requests (
    organization_id, user_id, email, full_name
  ) values (
    target_organization_id, target_user_id, auth_email, normalized_name
  )
  returning id into access_request_id;

  perform private.add_notification(
    target_organization_id,
    owner_id,
    'team_access_requested',
    'طلب انضمام جديد',
    normalized_name || ' طلب الانضمام للمنصة بحساب ' || auth_email,
    'account_access_request',
    access_request_id,
    '/team?request=' || access_request_id,
    'team-access-request:' || access_request_id || ':owner:' || owner_id
  );

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id, target_user_id, 'team.access_request_created',
    'account_access_request', access_request_id,
    jsonb_build_object('status', 'pending', 'email', auth_email)
  );

  return access_request_id;
end;
$$;

revoke all on function public.ensure_workspace_access_request(uuid, text, text)
from public, anon, authenticated;
grant execute on function public.ensure_workspace_access_request(uuid, text, text)
to service_role;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := nullif(trim(new.raw_user_meta_data ->> 'full_name'), '');
  registration_flow text := coalesce(new.raw_app_meta_data ->> 'registration_flow', '');
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    normalized_name,
    nullif(trim(new.raw_user_meta_data ->> 'avatar_url'), '')
  )
  on conflict (id) do update
  set full_name = coalesce(nullif(trim(profiles.full_name), ''), excluded.full_name),
      avatar_url = coalesce(profiles.avatar_url, excluded.avatar_url);

  if registration_flow = 'owner_approval_request' then
    perform public.ensure_workspace_access_request(new.id, new.email, normalized_name);
  end if;

  return new;
end;
$$;

-- The INSERT trigger remains the first line of defense. This UPDATE trigger is
-- required because Admin createUser may attach trusted app metadata immediately
-- after inserting the auth row.
drop trigger if exists on_auth_user_registration_metadata_changed on auth.users;
create trigger on_auth_user_registration_metadata_changed
after update of raw_app_meta_data, raw_user_meta_data, email on auth.users
for each row execute function private.handle_new_user();

-- Whichever owner-approved path wins (approval screen or legacy invitation),
-- reconcile the other path so the owner never sees a stale pending request or
-- invitation for an already-active member.
create or replace function private.reconcile_team_access_after_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_email text;
begin
  if new.status <> 'active' or new.role = 'owner' or new.invited_by is null then
    return new;
  end if;

  update public.account_access_requests request
  set status = 'approved',
      approved_role = new.role,
      approved_sections = new.allowed_sections,
      reviewed_at = coalesce(request.reviewed_at, now()),
      reviewed_by = coalesce(request.reviewed_by, new.invited_by)
  where request.organization_id = new.organization_id
    and request.user_id = new.user_id
    and request.status <> 'approved';

  select lower(trim(auth_user.email)) into member_email
  from auth.users auth_user
  where auth_user.id = new.user_id;

  update public.team_invitations invitation
  set status = 'accepted',
      accepted_by = new.user_id,
      accepted_at = now()
  where invitation.organization_id = new.organization_id
    and invitation.email = member_email
    and invitation.status = 'pending';

  return new;
end;
$$;

drop trigger if exists memberships_reconcile_team_access_after_insert on public.memberships;
create trigger memberships_reconcile_team_access_after_insert
after insert on public.memberships
for each row execute function private.reconcile_team_access_after_membership();

drop trigger if exists memberships_reconcile_team_access_after_update on public.memberships;
create trigger memberships_reconcile_team_access_after_update
after update of status, role, allowed_sections, invited_by on public.memberships
for each row execute function private.reconcile_team_access_after_membership();

revoke all on function private.reconcile_team_access_after_membership()
from public, anon, authenticated;

-- Repair every account affected before this migration. The operation is
-- idempotent and creates only a pending owner decision; it grants no access.
select public.ensure_workspace_access_request(
  auth_user.id,
  auth_user.email,
  coalesce(profile.full_name, auth_user.raw_user_meta_data ->> 'full_name')
)
from auth.users auth_user
left join public.profiles profile on profile.id = auth_user.id
where auth_user.raw_app_meta_data ->> 'registration_flow' = 'owner_approval_request'
  and not exists (
    select 1 from public.account_access_requests request
    where request.user_id = auth_user.id
  )
  and not exists (
    select 1 from public.memberships membership
    where membership.user_id = auth_user.id
      and membership.status = 'active'
  );
