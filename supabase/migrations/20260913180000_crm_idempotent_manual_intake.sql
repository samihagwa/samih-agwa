-- A retry of one manual intake must not create a second customer or follow-up task.
create table public.crm_creation_requests (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null,
  actor_id uuid not null references auth.users(id),
  payload_hash text not null,
  contact_id uuid not null references public.crm_contacts(id),
  created_at timestamptz not null default now(),
  primary key (organization_id, request_id)
);

create index crm_creation_requests_contact_idx on public.crm_creation_requests (contact_id);
create index crm_conversation_link_normalized_lookup_idx on public.crm_conversation_links
  (organization_id, lower(regexp_replace(trim(url), '/+$', '')));
alter table public.crm_creation_requests enable row level security;
revoke all on public.crm_creation_requests from public, anon, authenticated;
grant select, insert on public.crm_creation_requests to service_role;

create or replace function public.create_crm_lead_v7(
  target_user_id uuid,
  target_organization_id uuid,
  target_request_id uuid,
  payload jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.crm_creation_requests%rowtype;
  result_id uuid;
  clean_url text := nullif(lower(regexp_replace(trim(payload->>'conversation_url'), '/+$', '')), '');
  fingerprint text := md5(payload::text);
begin
  if target_user_id is null or target_organization_id is null or target_request_id is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'A verified actor, organization and intake request are required';
  end if;

  -- Serialize both retries and competing requests for the same conversation.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_organization_id::text || ':' || target_request_id::text, 0));
  select * into existing from public.crm_creation_requests
  where organization_id = target_organization_id and request_id = target_request_id;
  if found then
    if existing.actor_id <> target_user_id or existing.payload_hash <> fingerprint then
      raise exception 'This intake request was already used for different customer details';
    end if;
    return existing.contact_id;
  end if;

  if clean_url is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_organization_id::text || ':chat:' || clean_url, 0));
    if exists (
      select 1 from public.crm_conversation_links link
      where link.organization_id = target_organization_id
        and lower(regexp_replace(trim(link.url), '/+$', '')) = clean_url
    ) then
      raise exception 'This conversation already belongs to a CRM customer. Open the existing customer file instead.';
    end if;
  end if;

  result_id := public.create_crm_lead_v6(
    target_user_id, target_organization_id,
    payload->>'full_name', (payload->>'source')::public.crm_source,
    payload->>'source_detail', (payload->>'interest')::public.crm_interest,
    payload->>'interest_detail', (payload->>'owner_id')::uuid,
    (payload->>'consent_status')::public.crm_consent_status,
    payload->'identities', (payload->>'trading_experience')::public.crm_trading_experience,
    (payload->>'initial_stage')::public.crm_lead_stage, payload->>'notes',
    (payload->>'follow_up_at')::timestamptz,
    (payload->>'conversation_channel')::public.crm_conversation_channel,
    payload->>'conversation_url', payload->>'conversation_label',
    coalesce((payload->>'without_conversation_link')::boolean, false),
    case when jsonb_typeof(payload->'purchase') = 'object' then payload->'purchase' else null end
  );

  insert into public.crm_creation_requests (organization_id, request_id, actor_id, payload_hash, contact_id)
  values (target_organization_id, target_request_id, target_user_id, fingerprint, result_id);
  return result_id;
end;
$$;

revoke all on function public.create_crm_lead_v7(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.create_crm_lead_v7(uuid, uuid, uuid, jsonb) to service_role;
