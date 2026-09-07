-- Password-first authentication with owner-approved workspace access.
-- Creating an Auth account never grants application access: memberships remain
-- the only authorization source, and every approval is owner-only and audited.

create table public.account_access_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  email text not null unique,
  full_name text not null,
  status text not null default 'pending',
  approved_role public.app_role,
  approved_sections text[],
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint account_access_requests_email_normalized check (
    email = lower(trim(email))
    and char_length(email) between 5 and 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint account_access_requests_name_length check (char_length(trim(full_name)) between 2 and 120),
  constraint account_access_requests_status_allowed check (status in ('pending', 'approved', 'rejected')),
  constraint account_access_requests_owner_role_forbidden check (approved_role is null or approved_role <> 'owner'),
  constraint account_access_requests_review_consistent check (
    (status = 'pending' and reviewed_at is null and reviewed_by is null and approved_role is null and approved_sections is null)
    or (status = 'approved' and reviewed_at is not null and reviewed_by is not null and approved_role is not null and private.valid_workspace_sections(approved_sections))
    or (status = 'rejected' and reviewed_at is not null and reviewed_by is not null and approved_role is null and approved_sections is null)
  )
);

create index account_access_requests_org_status_time_idx
  on public.account_access_requests (organization_id, status, requested_at desc, id);
create index account_access_requests_reviewed_by_idx
  on public.account_access_requests (reviewed_by)
  where reviewed_by is not null;

create trigger account_access_requests_set_updated_at
before update on public.account_access_requests
for each row execute function private.set_updated_at();

alter table public.account_access_requests enable row level security;

create policy "account_access_requests_select_self_or_owner"
on public.account_access_requests
for select
to authenticated
using (
  user_id = (select auth.uid())
  or private.has_org_role(organization_id, array['owner']::public.app_role[])
);

revoke all on table public.account_access_requests from anon, authenticated;
grant select on table public.account_access_requests to authenticated;

create table public.password_recovery_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  link_generated_at timestamptz,
  resolved_at timestamptz,
  handled_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint password_recovery_requests_status_allowed check (status in ('pending', 'link_generated', 'resolved')),
  constraint password_recovery_requests_state_consistent check (
    (status = 'pending' and link_generated_at is null and resolved_at is null and handled_by is null)
    or (status = 'link_generated' and link_generated_at is not null and resolved_at is null and handled_by is not null)
    or (status = 'resolved' and resolved_at is not null)
  )
);

create unique index password_recovery_requests_one_pending_user_idx
  on public.password_recovery_requests (user_id)
  where status = 'pending';
create index password_recovery_requests_org_status_time_idx
  on public.password_recovery_requests (organization_id, status, requested_at desc, id);
create index password_recovery_requests_handled_by_idx
  on public.password_recovery_requests (handled_by)
  where handled_by is not null;

create trigger password_recovery_requests_set_updated_at
before update on public.password_recovery_requests
for each row execute function private.set_updated_at();

alter table public.password_recovery_requests enable row level security;

create policy "password_recovery_requests_select_self_or_owner"
on public.password_recovery_requests
for select
to authenticated
using (
  user_id = (select auth.uid())
  or private.has_org_role(organization_id, array['owner']::public.app_role[])
);

revoke all on table public.password_recovery_requests from anon, authenticated;
grant select on table public.password_recovery_requests to authenticated;

create table private.auth_access_attempts (
  id bigint generated always as identity primary key,
  scope text not null,
  fingerprint_hash text not null,
  email_hash text not null,
  attempted_at timestamptz not null default now(),
  constraint auth_access_attempts_scope_allowed check (scope in ('register', 'recover')),
  constraint auth_access_attempts_fingerprint_hash check (fingerprint_hash ~ '^[a-f0-9]{64}$'),
  constraint auth_access_attempts_email_hash check (email_hash ~ '^[a-f0-9]{64}$')
);

create index auth_access_attempts_fingerprint_time_idx
  on private.auth_access_attempts (scope, fingerprint_hash, attempted_at desc);
create index auth_access_attempts_email_time_idx
  on private.auth_access_attempts (scope, email_hash, attempted_at desc);

revoke all on table private.auth_access_attempts from public, anon, authenticated;

alter table public.notifications
  drop constraint notifications_kind_allowed;

alter table public.notifications
  add constraint notifications_kind_allowed check (kind = any (array[
    'task_assigned', 'task_ready', 'task_review', 'task_blocked', 'task_done',
    'revision_requested', 'publication_published', 'publication_failed',
    'publication_held', 'script_assigned', 'script_ready',
    'script_research_assigned', 'content_brief_updated', 'team_joined',
    'team_access_changed', 'task_due_soon', 'task_overdue',
    'task_overdue_escalated', 'chat_reply', 'task_question',
    'task_discussion', 'telegram_test', 'team_access_requested',
    'team_access_approved', 'password_recovery_requested'
  ]));

create or replace function public.consume_workspace_auth_rate_limit(
  target_scope text,
  target_fingerprint_hash text,
  target_email_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  fingerprint_attempts integer;
  email_attempts integer;
begin
  if target_scope not in ('register', 'recover')
    or target_fingerprint_hash !~ '^[a-f0-9]{64}$'
    or target_email_hash !~ '^[a-f0-9]{64}$' then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_scope || ':' || target_fingerprint_hash, 0));

  delete from private.auth_access_attempts
  where attempted_at < now() - interval '24 hours';

  select count(*) into fingerprint_attempts
  from private.auth_access_attempts
  where scope = target_scope
    and fingerprint_hash = target_fingerprint_hash
    and attempted_at >= now() - interval '10 minutes';

  select count(*) into email_attempts
  from private.auth_access_attempts
  where scope = target_scope
    and email_hash = target_email_hash
    and attempted_at >= now() - interval '1 hour';

  if fingerprint_attempts >= 5 or email_attempts >= 3 then
    return false;
  end if;

  insert into private.auth_access_attempts (scope, fingerprint_hash, email_hash)
  values (target_scope, target_fingerprint_hash, target_email_hash);
  return true;
end;
$$;

revoke all on function public.consume_workspace_auth_rate_limit(text, text, text)
from public, anon, authenticated;
grant execute on function public.consume_workspace_auth_rate_limit(text, text, text)
to service_role;

-- The browser cannot set app_metadata. Only the trusted account-access Edge
-- Function can add this marker, while old owner/invitation flows remain valid.
create or replace function public.hook_restrict_market_whales_signup(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  signup_email text := lower(trim(coalesce(event -> 'user' ->> 'email', '')));
  registration_flow text := coalesce(event -> 'user' -> 'app_metadata' ->> 'registration_flow', '');
begin
  if registration_flow = 'owner_approval_request'
    or signup_email = 'samihsmaih1234@gmail.com'
    or exists (
      select 1
      from public.team_invitations invitation
      where invitation.email = signup_email
        and invitation.status = 'pending'
        and invitation.expires_at > now()
    ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'استخدم نموذج إنشاء الحساب داخل منصة Market Whales.'
    )
  );
end;
$$;

revoke all on function public.hook_restrict_market_whales_signup(jsonb)
from public, anon, authenticated;
grant execute on function public.hook_restrict_market_whales_signup(jsonb)
to supabase_auth_admin;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  owner_id uuid;
  access_request_id uuid;
  normalized_name text := nullif(trim(new.raw_user_meta_data ->> 'full_name'), '');
  registration_flow text := coalesce(new.raw_app_meta_data ->> 'registration_flow', '');
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    normalized_name,
    nullif(trim(new.raw_user_meta_data ->> 'avatar_url'), '')
  )
  on conflict (id) do nothing;

  if registration_flow = 'owner_approval_request' then
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
      target_organization_id,
      new.id,
      lower(trim(new.email)),
      normalized_name
    )
    returning id into access_request_id;

    perform private.add_notification(
      target_organization_id,
      owner_id,
      'team_access_requested',
      'طلب انضمام جديد',
      normalized_name || ' طلب الانضمام للمنصة بحساب ' || lower(trim(new.email)),
      'account_access_request',
      access_request_id,
      '/team?request=' || access_request_id,
      'team-access-request:' || access_request_id || ':owner:' || owner_id
    );
  end if;

  return new;
end;
$$;

create or replace function public.approve_workspace_access_request(
  target_actor_id uuid,
  target_request_id uuid,
  target_role public.app_role,
  target_allowed_sections text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_record public.account_access_requests%rowtype;
begin
  select request.* into request_record
  from public.account_access_requests request
  where request.id = target_request_id
  for update;

  if request_record.id is null then raise exception 'Access request was not found'; end if;
  if not exists (
    select 1 from public.memberships membership
    where membership.organization_id = request_record.organization_id
      and membership.user_id = target_actor_id
      and membership.role = 'owner'
      and membership.status = 'active'
  ) then raise exception 'Only the active organization owner can approve access requests'; end if;
  if target_role is null or target_role = 'owner' then raise exception 'Owner access cannot be granted here'; end if;
  if not private.valid_workspace_sections(target_allowed_sections) then
    raise exception 'Choose at least one valid workspace section';
  end if;
  if request_record.status = 'approved' then return request_record.user_id; end if;
  if exists (
    select 1 from public.memberships membership
    where membership.user_id = request_record.user_id
      and membership.status = 'active'
      and membership.organization_id <> request_record.organization_id
  ) then raise exception 'This account already belongs to another active workspace'; end if;

  insert into public.memberships (
    organization_id, user_id, role, status, invited_by, joined_at,
    onboarding_acknowledgements, onboarding_completed_at, allowed_sections
  ) values (
    request_record.organization_id, request_record.user_id, target_role,
    'active', target_actor_id, now(), '{}'::jsonb, null, target_allowed_sections
  )
  on conflict (organization_id, user_id) do update
  set role = excluded.role,
      status = 'active',
      invited_by = excluded.invited_by,
      joined_at = coalesce(memberships.joined_at, excluded.joined_at),
      onboarding_acknowledgements = '{}'::jsonb,
      onboarding_completed_at = null,
      allowed_sections = excluded.allowed_sections;

  update public.account_access_requests
  set status = 'approved',
      approved_role = target_role,
      approved_sections = target_allowed_sections,
      reviewed_at = now(),
      reviewed_by = target_actor_id
  where id = request_record.id;

  perform private.add_notification(
    request_record.organization_id,
    request_record.user_id,
    'team_access_approved',
    'تمت الموافقة على انضمامك',
    'حسابك أصبح جاهزًا. افتح المنصة لتبدأ من الأقسام المسموحة لك.',
    'membership',
    request_record.user_id,
    '/tasks',
    'team-access-request:' || request_record.id || ':approved'
  );

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    request_record.organization_id, target_actor_id, 'team.access_request_approved',
    'account_access_request', request_record.id,
    jsonb_build_object('status', request_record.status, 'email', request_record.email),
    jsonb_build_object('status', 'approved', 'role', target_role, 'allowed_sections', target_allowed_sections)
  );
  return request_record.user_id;
end;
$$;

create or replace function public.reject_workspace_access_request(
  target_actor_id uuid,
  target_request_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_record public.account_access_requests%rowtype;
begin
  select request.* into request_record
  from public.account_access_requests request
  where request.id = target_request_id
  for update;

  if request_record.id is null then raise exception 'Access request was not found'; end if;
  if not exists (
    select 1 from public.memberships membership
    where membership.organization_id = request_record.organization_id
      and membership.user_id = target_actor_id
      and membership.role = 'owner'
      and membership.status = 'active'
  ) then raise exception 'Only the active organization owner can reject access requests'; end if;
  if request_record.status = 'approved' then raise exception 'Approved access must be suspended from team management'; end if;
  if request_record.status = 'rejected' then return false; end if;

  update public.account_access_requests
  set status = 'rejected',
      approved_role = null,
      approved_sections = null,
      reviewed_at = now(),
      reviewed_by = target_actor_id
  where id = request_record.id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    request_record.organization_id, target_actor_id, 'team.access_request_rejected',
    'account_access_request', request_record.id,
    jsonb_build_object('status', request_record.status, 'email', request_record.email),
    jsonb_build_object('status', 'rejected')
  );
  return true;
end;
$$;

revoke all on function public.approve_workspace_access_request(uuid, uuid, public.app_role, text[])
from public, anon, authenticated;
grant execute on function public.approve_workspace_access_request(uuid, uuid, public.app_role, text[])
to service_role;
revoke all on function public.reject_workspace_access_request(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.reject_workspace_access_request(uuid, uuid)
to service_role;

create or replace function public.request_workspace_password_recovery(target_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(trim(coalesce(target_email, '')));
  target_user_id uuid;
  target_organization_id uuid;
  owner_id uuid;
  recovery_request_id uuid;
begin
  select auth_user.id, membership.organization_id
    into target_user_id, target_organization_id
  from auth.users auth_user
  join public.memberships membership on membership.user_id = auth_user.id
  where lower(auth_user.email) = normalized_email
    and membership.status = 'active'
  limit 1;

  if target_user_id is null then return null; end if;

  select membership.user_id into owner_id
  from public.memberships membership
  where membership.organization_id = target_organization_id
    and membership.role = 'owner'
    and membership.status = 'active'
  limit 1;

  select request.id into recovery_request_id
  from public.password_recovery_requests request
  where request.user_id = target_user_id
    and request.status = 'pending'
  limit 1;

  if recovery_request_id is null then
    insert into public.password_recovery_requests (organization_id, user_id)
    values (target_organization_id, target_user_id)
    returning id into recovery_request_id;

    perform private.add_notification(
      target_organization_id,
      owner_id,
      'password_recovery_requested',
      'طلب استعادة كلمة مرور',
      'أحد أعضاء الفريق طلب رابطًا جديدًا لاستعادة كلمة المرور.',
      'password_recovery_request',
      recovery_request_id,
      '/team?recovery=' || recovery_request_id,
      'password-recovery:' || recovery_request_id || ':owner:' || owner_id
    );
  end if;

  return recovery_request_id;
end;
$$;

create or replace function public.prepare_workspace_password_recovery(
  target_actor_id uuid,
  target_request_id uuid
)
returns table (request_id uuid, user_id uuid, email text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select request.id, request.user_id, auth_user.email::text
  from public.password_recovery_requests request
  join auth.users auth_user on auth_user.id = request.user_id
  where request.id = target_request_id
    and request.status in ('pending', 'link_generated')
    and exists (
      select 1 from public.memberships membership
      where membership.organization_id = request.organization_id
        and membership.user_id = target_actor_id
        and membership.role = 'owner'
        and membership.status = 'active'
    );
end;
$$;

create or replace function public.mark_workspace_password_recovery_link_created(
  target_actor_id uuid,
  target_request_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_record public.password_recovery_requests%rowtype;
begin
  select request.* into request_record
  from public.password_recovery_requests request
  where request.id = target_request_id
  for update;

  if request_record.id is null or not exists (
    select 1 from public.memberships membership
    where membership.organization_id = request_record.organization_id
      and membership.user_id = target_actor_id
      and membership.role = 'owner'
      and membership.status = 'active'
  ) then raise exception 'Only the active organization owner can create recovery links'; end if;

  update public.password_recovery_requests
  set status = 'link_generated', link_generated_at = now(), handled_by = target_actor_id
  where id = request_record.id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    request_record.organization_id, target_actor_id, 'team.password_recovery_link_created',
    'password_recovery_request', request_record.id,
    jsonb_build_object('user_id', request_record.user_id)
  );
  return true;
end;
$$;

create or replace function public.complete_workspace_password_recovery(target_actor_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_actor_id is null then raise exception 'Authentication is required'; end if;
  update public.password_recovery_requests
  set status = 'resolved', resolved_at = now()
  where user_id = target_actor_id and status in ('pending', 'link_generated');
  return found;
end;
$$;

revoke all on function public.request_workspace_password_recovery(text)
from public, anon, authenticated;
grant execute on function public.request_workspace_password_recovery(text)
to service_role;
revoke all on function public.prepare_workspace_password_recovery(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.prepare_workspace_password_recovery(uuid, uuid)
to service_role;
revoke all on function public.mark_workspace_password_recovery_link_created(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.mark_workspace_password_recovery_link_created(uuid, uuid)
to service_role;
revoke all on function public.complete_workspace_password_recovery(uuid)
from public, anon, authenticated;
grant execute on function public.complete_workspace_password_recovery(uuid)
to service_role;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'account_access_requests'
  ) then alter publication supabase_realtime add table public.account_access_requests; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'password_recovery_requests'
  ) then alter publication supabase_realtime add table public.password_recovery_requests; end if;
end;
$$;
