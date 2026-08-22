-- Secure brokerage-integration foundation. No provider credential is accepted
-- until the private Exness Partner API contract has been reviewed. Financial
-- detail remains owner-only while CRM-authorized staff get a boolean lookup.

create table public.broker_integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null,
  display_name text not null,
  status text not null default 'not_configured',
  base_url text,
  account_lookup_enabled boolean not null default false,
  last_sync_at timestamptz,
  last_error text,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint broker_integrations_org_provider_unique unique (organization_id, provider),
  constraint broker_integrations_provider_check check (provider in ('exness')),
  constraint broker_integrations_name_length check (char_length(trim(display_name)) between 2 and 80),
  constraint broker_integrations_status_check check (status in ('not_configured', 'ready', 'syncing', 'paused', 'error')),
  constraint broker_integrations_base_url_check check (base_url is null or (base_url ~ '^https://' and char_length(base_url) <= 1000)),
  constraint broker_integrations_error_length check (last_error is null or char_length(last_error) <= 2000)
);

create table public.broker_client_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  integration_id uuid not null references public.broker_integrations (id) on delete cascade,
  crm_contact_id uuid references public.crm_contacts (id) on delete set null,
  external_client_id text not null,
  account_number text not null,
  client_profile jsonb not null default '{}'::jsonb,
  is_active boolean not null default false,
  lots numeric(20, 4) not null default 0,
  commission numeric(20, 2) not null default 0,
  commission_currency text not null default 'USD',
  registered_at timestamptz,
  last_activity_at timestamptz,
  last_synced_at timestamptz not null,
  source_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint broker_client_accounts_integration_account_unique unique (integration_id, account_number),
  constraint broker_client_accounts_external_length check (char_length(trim(external_client_id)) between 1 and 160),
  constraint broker_client_accounts_number_length check (char_length(trim(account_number)) between 3 and 80),
  constraint broker_client_accounts_profile_object check (jsonb_typeof(client_profile) = 'object'),
  constraint broker_client_accounts_lots_nonnegative check (lots >= 0),
  constraint broker_client_accounts_commission_currency check (commission_currency ~ '^[A-Z]{3,8}$'),
  constraint broker_client_accounts_hash_length check (char_length(source_hash) between 16 and 128)
);

create table public.broker_sync_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  integration_id uuid not null references public.broker_integrations (id) on delete cascade,
  request_key text not null,
  status text not null default 'running',
  fetched_rows integer not null default 0,
  upserted_rows integer not null default 0,
  error_rows integer not null default 0,
  error_message text,
  triggered_by uuid references public.profiles (id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint broker_sync_runs_request_unique unique (integration_id, request_key),
  constraint broker_sync_runs_request_length check (char_length(trim(request_key)) between 8 and 160),
  constraint broker_sync_runs_status_check check (status in ('running', 'completed', 'failed', 'ambiguous')),
  constraint broker_sync_runs_counts_nonnegative check (fetched_rows >= 0 and upserted_rows >= 0 and error_rows >= 0),
  constraint broker_sync_runs_error_contract check (
    (status in ('failed', 'ambiguous') and error_message is not null)
    or status in ('running', 'completed')
  )
);

create index broker_integrations_org_status_idx
  on public.broker_integrations (organization_id, status);
create index broker_integrations_created_by_idx
  on public.broker_integrations (created_by);
create index broker_client_accounts_org_account_idx
  on public.broker_client_accounts (organization_id, account_number);
create index broker_client_accounts_org_external_idx
  on public.broker_client_accounts (organization_id, external_client_id);
create index broker_client_accounts_crm_contact_idx
  on public.broker_client_accounts (crm_contact_id)
  where crm_contact_id is not null;
create index broker_sync_runs_org_started_idx
  on public.broker_sync_runs (organization_id, started_at desc);
create index broker_sync_runs_triggered_by_idx
  on public.broker_sync_runs (triggered_by)
  where triggered_by is not null;

create or replace function public.lookup_exness_account(
  target_user_id uuid,
  target_organization_id uuid,
  lookup_value text
)
returns table (
  integration_ready boolean,
  under_agency boolean,
  is_active boolean,
  last_synced_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_lookup text := trim(lookup_value);
  integration_record public.broker_integrations%rowtype;
  account_record public.broker_client_accounts%rowtype;
begin
  if target_user_id is null or not exists (
    select 1 from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = target_user_id
      and membership.status = 'active'
      and membership.role <> 'viewer'
      and (membership.role = 'owner' or membership.allowed_sections && array['crm']::text[])
  ) then
    raise exception 'CRM access is required for brokerage account lookup';
  end if;

  if char_length(normalized_lookup) not between 3 and 160 then
    raise exception 'Enter a valid brokerage account or client identifier';
  end if;

  select integration.* into integration_record
  from public.broker_integrations integration
  where integration.organization_id = target_organization_id
    and integration.provider = 'exness'
  limit 1;

  if integration_record.id is null
    or integration_record.status <> 'ready'
    or not integration_record.account_lookup_enabled then
    return query select false, false, false, integration_record.last_sync_at;
    return;
  end if;

  select account.* into account_record
  from public.broker_client_accounts account
  where account.organization_id = target_organization_id
    and account.integration_id = integration_record.id
    and (account.account_number = normalized_lookup or account.external_client_id = normalized_lookup)
  order by account.last_synced_at desc
  limit 1;

  return query select true, account_record.id is not null,
    coalesce(account_record.is_active, false), integration_record.last_sync_at;
end;
$$;

alter table public.broker_integrations enable row level security;
alter table public.broker_client_accounts enable row level security;
alter table public.broker_sync_runs enable row level security;

create policy "broker_integrations_owner_select"
on public.broker_integrations for select to authenticated
using (private.has_org_role(organization_id, array['owner']::public.app_role[]));

create policy "broker_client_accounts_owner_select"
on public.broker_client_accounts for select to authenticated
using (private.has_org_role(organization_id, array['owner']::public.app_role[]));

create policy "broker_sync_runs_owner_select"
on public.broker_sync_runs for select to authenticated
using (private.has_org_role(organization_id, array['owner']::public.app_role[]));

revoke all on table public.broker_integrations from public, anon, authenticated;
revoke all on table public.broker_client_accounts from public, anon, authenticated;
revoke all on table public.broker_sync_runs from public, anon, authenticated;
grant select on table public.broker_integrations to authenticated;
grant select on table public.broker_client_accounts to authenticated;
grant select on table public.broker_sync_runs to authenticated;

revoke all on function public.lookup_exness_account(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.lookup_exness_account(uuid, uuid, text) to service_role;

comment on table public.broker_client_accounts is
  'Owner-only Exness agency snapshot. Ordinary CRM staff must use lookup_exness_account and never receive financial fields.';
comment on function public.lookup_exness_account(uuid, uuid, text) is
  'Least-privilege brokerage lookup: authorized CRM staff receive only integration readiness, agency membership and active status.';
