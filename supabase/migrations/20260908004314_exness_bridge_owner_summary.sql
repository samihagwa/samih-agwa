-- Complete the Exness agency bridge without widening browser access to the
-- owner-only account snapshot. The Edge Function is the only caller of the
-- summary function; CRM staff continue to use the boolean lookup contract.

create index if not exists broker_client_accounts_org_activity_idx
  on public.broker_client_accounts (organization_id, is_active, last_synced_at desc);

drop trigger if exists broker_integrations_set_updated_at on public.broker_integrations;
create trigger broker_integrations_set_updated_at
before update on public.broker_integrations
for each row execute function private.set_updated_at();

drop trigger if exists broker_client_accounts_set_updated_at on public.broker_client_accounts;
create trigger broker_client_accounts_set_updated_at
before update on public.broker_client_accounts
for each row execute function private.set_updated_at();

create or replace function public.get_exness_agency_summary(
  target_user_id uuid,
  target_organization_id uuid
)
returns table (
  integration_ready boolean,
  integration_status text,
  last_sync_at timestamptz,
  total_accounts bigint,
  active_accounts bigint,
  total_lots numeric,
  total_commission numeric,
  commission_currency text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  integration_record public.broker_integrations%rowtype;
begin
  if target_user_id is null or not exists (
    select 1
    from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = target_user_id
      and membership.status = 'active'
      and membership.role = 'owner'
  ) then
    raise exception 'Owner access is required for brokerage agency summary';
  end if;

  select integration.* into integration_record
  from public.broker_integrations integration
  where integration.organization_id = target_organization_id
    and integration.provider = 'exness'
  limit 1;

  if integration_record.id is null then
    return query select false, 'not_configured'::text, null::timestamptz,
      0::bigint, 0::bigint, 0::numeric, 0::numeric, 'USD'::text;
    return;
  end if;

  return query
  select
    integration_record.status = 'ready' and integration_record.account_lookup_enabled,
    integration_record.status,
    integration_record.last_sync_at,
    count(account.id),
    count(account.id) filter (where account.is_active),
    coalesce(sum(account.lots), 0),
    coalesce(sum(account.commission), 0),
    case
      when count(distinct account.commission_currency) <= 1
        then coalesce(max(account.commission_currency), 'USD')
      else 'MIXED'
    end
  from public.broker_client_accounts account
  where account.organization_id = target_organization_id
    and account.integration_id = integration_record.id;
end;
$$;

revoke all on function public.get_exness_agency_summary(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_exness_agency_summary(uuid, uuid)
  to service_role;

comment on function public.get_exness_agency_summary(uuid, uuid) is
  'Owner-only Exness agency totals. The function is callable only by the service role after Edge authentication and membership checks.';
