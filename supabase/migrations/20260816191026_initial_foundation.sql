-- Market Whales OS foundation: identity, organizations, membership, and audit.
-- All exposed tables use RLS. Direct membership mutation is intentionally withheld
-- until invitation and last-owner invariants are implemented as trusted commands.

create schema private;
revoke all on schema private from public;

create type public.app_role as enum (
  'owner',
  'admin',
  'manager',
  'member',
  'viewer'
);

create type public.membership_status as enum (
  'invited',
  'active',
  'suspended'
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_full_name_length check (full_name is null or char_length(full_name) between 2 and 120)
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_name_length check (char_length(name) between 2 and 120),
  constraint organizations_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null default 'member',
  status public.membership_status not null default 'invited',
  invited_by uuid references auth.users (id),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id),
  constraint memberships_active_joined_at check (status <> 'active' or joined_at is not null)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations (id) on delete set null,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  request_id uuid,
  occurred_at timestamptz not null default now(),
  constraint audit_events_action_length check (char_length(action) between 2 and 120),
  constraint audit_events_entity_type_length check (char_length(entity_type) between 2 and 80)
);

create index memberships_user_active_idx
  on public.memberships (user_id, organization_id)
  where status = 'active';

create index memberships_org_role_idx
  on public.memberships (organization_id, role, status);

create index audit_events_org_time_idx
  on public.audit_events (organization_id, occurred_at desc);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger organizations_set_updated_at
before update on public.organizations
for each row execute function private.set_updated_at();

create trigger memberships_set_updated_at
before update on public.memberships
for each row execute function private.set_updated_at();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'avatar_url'), '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

create or replace function private.is_org_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
  );
$$;

create or replace function private.has_org_role(
  target_organization_id uuid,
  allowed_roles public.app_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and membership.role = any (allowed_roles)
  );
$$;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.audit_events enable row level security;

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
      and colleague.status = 'active'
      and private.is_org_member(colleague.organization_id)
  )
);

create policy "profiles_update_self"
on public.profiles
for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy "organizations_select_members"
on public.organizations
for select
to authenticated
using (private.is_org_member(id));

create policy "memberships_select_colleagues"
on public.memberships
for select
to authenticated
using (private.is_org_member(organization_id));

create policy "audit_events_select_leadership"
on public.audit_events
for select
to authenticated
using (
  private.has_org_role(
    organization_id,
    array['owner', 'admin', 'manager']::public.app_role[]
  )
);

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.organizations from anon, authenticated;
revoke all on table public.memberships from anon, authenticated;
revoke all on table public.audit_events from anon, authenticated;

grant select, update (full_name, avatar_url) on table public.profiles to authenticated;
grant select on table public.organizations to authenticated;
grant select on table public.memberships to authenticated;
grant select on table public.audit_events to authenticated;

revoke all on function private.set_updated_at() from public, anon, authenticated;
revoke all on function private.handle_new_user() from public, anon, authenticated;
revoke all on function private.is_org_member(uuid) from public, anon;
revoke all on function private.has_org_role(uuid, public.app_role[]) from public, anon;

grant usage on schema private to authenticated;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.has_org_role(uuid, public.app_role[]) to authenticated;
