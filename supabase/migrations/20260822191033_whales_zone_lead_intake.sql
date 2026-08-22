-- Whales Zone lead intake becomes the durable, idempotent entry point for the
-- public landing page and the historical Google Sheet backfill. The public
-- browser never receives table privileges or a privileged database key.

create table public.crm_lead_intake_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  source_system text not null,
  external_id text not null,
  contact_id uuid references public.crm_contacts (id) on delete set null,
  outcome text not null,
  registered_at timestamptz not null,
  payload_hash text not null,
  request_fingerprint text,
  sheet_mirror_status text not null default 'not_required',
  sheet_mirrored_at timestamptz,
  sheet_mirror_error text,
  created_at timestamptz not null default now(),
  constraint crm_lead_intake_events_source_check check (
    source_system in ('whales_zone_form', 'google_sheet_whales_zone')
  ),
  constraint crm_lead_intake_events_external_length check (
    char_length(trim(external_id)) between 3 and 160
  ),
  constraint crm_lead_intake_events_outcome_check check (
    outcome in ('created', 'deduplicated', 'conflict')
  ),
  constraint crm_lead_intake_events_payload_hash_check check (
    payload_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint crm_lead_intake_events_fingerprint_check check (
    request_fingerprint is null or request_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  constraint crm_lead_intake_events_mirror_status_check check (
    sheet_mirror_status in ('not_required', 'pending', 'succeeded', 'failed')
  ),
  constraint crm_lead_intake_events_mirror_consistent check (
    (sheet_mirror_status = 'succeeded' and sheet_mirrored_at is not null and sheet_mirror_error is null)
    or (sheet_mirror_status = 'failed' and sheet_mirrored_at is null and sheet_mirror_error is not null)
    or (sheet_mirror_status in ('not_required', 'pending') and sheet_mirrored_at is null)
  ),
  constraint crm_lead_intake_events_source_external_unique unique (
    organization_id, source_system, external_id
  )
);

create index crm_lead_intake_events_org_created_idx
  on public.crm_lead_intake_events (organization_id, created_at desc);

create index crm_lead_intake_events_contact_idx
  on public.crm_lead_intake_events (contact_id, created_at desc)
  where contact_id is not null;

create index crm_lead_intake_events_mirror_retry_idx
  on public.crm_lead_intake_events (created_at, id)
  where sheet_mirror_status = 'failed';

create table private.crm_lead_intake_rate_limits (
  id bigint generated always as identity primary key,
  request_fingerprint text not null,
  received_at timestamptz not null default now(),
  constraint crm_lead_intake_rate_limits_fingerprint_check check (
    request_fingerprint ~ '^[a-f0-9]{64}$'
  )
);

create index crm_lead_intake_rate_limits_lookup_idx
  on private.crm_lead_intake_rate_limits (request_fingerprint, received_at desc);

create or replace function public.ingest_whales_zone_lead(
  intake_source_system text,
  intake_external_id text,
  contact_full_name text,
  contact_email text,
  contact_tradingview text,
  contact_whatsapp text,
  intake_owner_id uuid,
  intake_registered_at timestamptz,
  intake_payload_hash text,
  intake_request_fingerprint text
)
returns table (
  event_id uuid,
  contact_id uuid,
  outcome text,
  should_mirror boolean,
  sheet_mirror_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  default_owner_id uuid;
  assigned_owner_id uuid;
  normalized_email text;
  normalized_tradingview text;
  normalized_whatsapp text;
  matching_contact_ids uuid[];
  resolved_contact_id uuid;
  resolved_event_id uuid;
  resolved_outcome text;
  resolved_mirror_status text;
  follow_up_at timestamptz;
  recent_ten_minutes integer;
  recent_day integer;
begin
  if intake_source_system not in ('whales_zone_form', 'google_sheet_whales_zone') then
    raise exception 'Whales Zone intake source is invalid';
  end if;
  if char_length(trim(intake_external_id)) not between 3 and 160 then
    raise exception 'Whales Zone intake id is invalid';
  end if;
  if char_length(trim(contact_full_name)) not between 2 and 160 then
    raise exception 'Whales Zone customer name is invalid';
  end if;
  if intake_registered_at is null
    or intake_registered_at < timestamptz '2020-01-01 00:00:00+00'
    or intake_registered_at > now() + interval '10 minutes' then
    raise exception 'Whales Zone registration time is invalid';
  end if;
  if intake_payload_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Whales Zone payload hash is invalid';
  end if;
  if intake_source_system = 'whales_zone_form'
    and (intake_request_fingerprint is null or intake_request_fingerprint !~ '^[a-f0-9]{64}$') then
    raise exception 'Whales Zone request fingerprint is invalid';
  end if;

  normalized_email := private.validate_crm_identity('email'::public.crm_identity_kind, contact_email);
  normalized_tradingview := private.validate_crm_identity('tradingview'::public.crm_identity_kind, contact_tradingview);
  normalized_whatsapp := private.validate_crm_identity('phone'::public.crm_identity_kind, contact_whatsapp);

  select organization.id into target_organization_id
  from public.organizations organization
  where organization.slug = 'market-whales'
  limit 1;

  if target_organization_id is null then
    raise exception 'Market Whales organization is not configured';
  end if;

  select membership.user_id into default_owner_id
  from public.memberships membership
  where membership.organization_id = target_organization_id
    and membership.status = 'active'
    and membership.role = 'owner'
  order by membership.joined_at nulls last, membership.created_at, membership.user_id
  limit 1;

  if default_owner_id is null then
    raise exception 'Market Whales CRM owner is not configured';
  end if;

  assigned_owner_id := default_owner_id;

  if intake_owner_id is not null then
    if not exists (
      select 1 from public.memberships membership
      where membership.organization_id = target_organization_id
        and membership.user_id = intake_owner_id
        and membership.status = 'active'
        and membership.role <> 'viewer'
    ) then
      raise exception 'Whales Zone CRM owner is not an active working member';
    end if;
    assigned_owner_id := intake_owner_id;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(target_organization_id::text || ':' || intake_source_system || ':' || trim(intake_external_id), 0)
  );

  select intake.id, intake.contact_id, intake.outcome, intake.sheet_mirror_status
  into resolved_event_id, resolved_contact_id, resolved_outcome, resolved_mirror_status
  from public.crm_lead_intake_events intake
  where intake.organization_id = target_organization_id
    and intake.source_system = intake_source_system
    and intake.external_id = trim(intake_external_id);

  if resolved_event_id is not null then
    if exists (
      select 1 from public.crm_lead_intake_events intake
      where intake.id = resolved_event_id
        and intake.payload_hash <> intake_payload_hash
    ) then
      raise exception 'Whales Zone intake id was reused with different data';
    end if;
    return query select
      resolved_event_id,
      resolved_contact_id,
      resolved_outcome,
      intake_source_system = 'whales_zone_form'
        and resolved_outcome <> 'conflict'
        and resolved_mirror_status in ('pending', 'failed'),
      resolved_mirror_status;
    return;
  end if;

  if intake_source_system = 'whales_zone_form' then
    delete from private.crm_lead_intake_rate_limits limit_row
    where limit_row.received_at < now() - interval '2 days';

    select count(*) filter (where limit_row.received_at >= now() - interval '10 minutes'),
           count(*)
    into recent_ten_minutes, recent_day
    from private.crm_lead_intake_rate_limits limit_row
    where limit_row.request_fingerprint = intake_request_fingerprint
      and limit_row.received_at >= now() - interval '1 day';

    if recent_ten_minutes >= 12 or recent_day >= 80 then
      raise exception 'Whales Zone intake rate limit exceeded';
    end if;

    insert into private.crm_lead_intake_rate_limits (request_fingerprint)
    values (intake_request_fingerprint);
  end if;

  select array_agg(distinct matched.contact_id)
  into matching_contact_ids
  from (
    select identity.contact_id
    from public.crm_identities identity
    where identity.organization_id = target_organization_id
      and (
        (identity.kind = 'email' and identity.normalized_value = normalized_email)
        or (identity.kind = 'tradingview' and identity.normalized_value = normalized_tradingview)
        or (identity.kind = 'phone' and identity.normalized_value = normalized_whatsapp)
      )
  ) matched;

  if coalesce(array_length(matching_contact_ids, 1), 0) > 1 then
    resolved_outcome := 'conflict';
    resolved_contact_id := null;
  elsif coalesce(array_length(matching_contact_ids, 1), 0) = 1 then
    resolved_outcome := 'deduplicated';
    resolved_contact_id := matching_contact_ids[1];

    insert into public.crm_identities (
      organization_id, contact_id, kind, value, normalized_value, is_primary, created_by
    )
    select target_organization_id, resolved_contact_id, incoming.kind, incoming.value,
           incoming.normalized_value, false, default_owner_id
    from (values
      ('email'::public.crm_identity_kind, trim(contact_email), normalized_email),
      ('tradingview'::public.crm_identity_kind, trim(contact_tradingview), normalized_tradingview),
      ('phone'::public.crm_identity_kind, trim(contact_whatsapp), normalized_whatsapp)
    ) incoming(kind, value, normalized_value)
    where not exists (
      select 1 from public.crm_identities identity
      where identity.organization_id = target_organization_id
        and identity.kind = incoming.kind
        and identity.normalized_value = incoming.normalized_value
    );

    update public.crm_contacts contact
    set source_registered_at = case
          when contact.source_registered_at is null then intake_registered_at
          else least(contact.source_registered_at, intake_registered_at)
        end,
        updated_at = greatest(contact.updated_at, intake_registered_at)
    where contact.id = resolved_contact_id;
  else
    resolved_outcome := 'created';
    follow_up_at := case
      when intake_source_system = 'whales_zone_form' then now() + interval '8 hours'
      else now()
        + interval '1 day'
        + ((abs(hashtext(trim(intake_external_id))::bigint) % 7)::text || ' days')::interval
        + ((abs(hashtext(trim(intake_external_id))::bigint) % 480)::text || ' minutes')::interval
    end;

    resolved_contact_id := public.create_crm_lead_v3(
      default_owner_id,
      target_organization_id,
      trim(contact_full_name),
      'whales_zone'::public.crm_source,
      null,
      'indicator'::public.crm_interest,
      null,
      assigned_owner_id,
      'unknown'::public.crm_consent_status,
      jsonb_build_array(
        jsonb_build_object('kind', 'phone', 'value', trim(contact_whatsapp), 'is_primary', true),
        jsonb_build_object('kind', 'email', 'value', trim(contact_email), 'is_primary', false),
        jsonb_build_object('kind', 'tradingview', 'value', trim(contact_tradingview), 'is_primary', false)
      ),
      case
        when intake_source_system = 'google_sheet_whales_zone'
          then 'تم استرداد التسجيل من سجل Whales Zone التاريخي في Google Sheet.'
        else 'تسجيل مباشر من صفحة Whales Zone.'
      end,
      follow_up_at,
      'whatsapp'::public.crm_conversation_channel,
      'https://wa.me/' || regexp_replace(normalized_whatsapp, '[^0-9]', '', 'g'),
      'WhatsApp من Whales Zone'
    );

    update public.crm_contacts contact
    set source_registered_at = intake_registered_at
    where contact.id = resolved_contact_id;
  end if;

  insert into public.crm_lead_intake_events as inserted_intake (
    organization_id, source_system, external_id, contact_id, outcome,
    registered_at, payload_hash, request_fingerprint, sheet_mirror_status
  ) values (
    target_organization_id,
    intake_source_system,
    trim(intake_external_id),
    resolved_contact_id,
    resolved_outcome,
    intake_registered_at,
    intake_payload_hash,
    intake_request_fingerprint,
    case when intake_source_system = 'whales_zone_form' then 'pending' else 'not_required' end
  ) returning inserted_intake.id, inserted_intake.sheet_mirror_status
    into resolved_event_id, resolved_mirror_status;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data, request_id
  ) values (
    target_organization_id,
    case when intake_source_system = 'google_sheet_whales_zone' then default_owner_id else null end,
    'crm.whales_zone_intake_recorded',
    'crm_lead_intake_event',
    resolved_event_id,
    jsonb_build_object(
      'source_system', intake_source_system,
      'outcome', resolved_outcome,
      'contact_id', resolved_contact_id,
      'registered_at', intake_registered_at
    ),
    case when intake_external_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then intake_external_id::uuid else null end
  );

  return query select
    resolved_event_id,
    resolved_contact_id,
    resolved_outcome,
    intake_source_system = 'whales_zone_form' and resolved_outcome <> 'conflict',
    resolved_mirror_status;
end;
$$;

create or replace function public.complete_whales_zone_sheet_mirror(
  target_event_id uuid,
  mirror_succeeded boolean,
  mirror_error text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.crm_lead_intake_events intake
  set sheet_mirror_status = case when mirror_succeeded then 'succeeded' else 'failed' end,
      sheet_mirrored_at = case when mirror_succeeded then now() else null end,
      sheet_mirror_error = case when mirror_succeeded then null else left(coalesce(nullif(trim(mirror_error), ''), 'Unknown mirror error'), 1000) end
  where intake.id = target_event_id
    and intake.source_system = 'whales_zone_form'
    and intake.sheet_mirror_status in ('pending', 'failed');

  return found;
end;
$$;

create or replace function public.import_whales_zone_sheet_batch(
  target_user_id uuid,
  target_organization_id uuid,
  default_owner_id uuid,
  import_rows jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_id uuid;
  input_row jsonb;
  row_external_id text;
  row_number integer := 0;
  registered_at timestamptz;
  payload_hash text;
  intake_result record;
  existing_intake boolean;
  final_version bigint;
  created_count integer := 0;
  duplicate_count integer := 0;
  error_count integer := 0;
begin
  if not private.is_org_owner_or_admin_actor(target_user_id, target_organization_id)
    or not private.actor_can_access_any_section(target_user_id, target_organization_id, array['crm']::text[]) then
    raise exception 'Only CRM platform leadership can import Whales Zone history';
  end if;
  if jsonb_typeof(import_rows) <> 'array'
    or jsonb_array_length(import_rows) not between 1 and 500 then
    raise exception 'Whales Zone import must contain between 1 and 500 rows';
  end if;
  if not exists (
    select 1 from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = default_owner_id
      and membership.status = 'active'
      and membership.role <> 'viewer'
  ) then
    raise exception 'Default CRM owner must be an active working member';
  end if;
  if not exists (
    select 1 from public.organizations organization
    where organization.id = target_organization_id and organization.slug = 'market-whales'
  ) then
    raise exception 'Whales Zone import organization is invalid';
  end if;

  insert into public.crm_import_batches (
    organization_id, source_system, total_rows, created_by
  ) values (
    target_organization_id, 'google_sheet_whales_zone', jsonb_array_length(import_rows), target_user_id
  ) returning id into batch_id;

  for input_row in select value from jsonb_array_elements(import_rows)
  loop
    row_number := row_number + 1;
    row_external_id := coalesce(nullif(trim(input_row->>'external_id'), ''), 'sheet-row-' || (row_number + 1)::text);
    registered_at := null;
    begin
      registered_at := nullif(trim(input_row->>'registered_at'), '')::timestamptz;
      payload_hash := encode(extensions.digest(
        lower(trim(input_row->>'full_name')) || '|' ||
        lower(trim(input_row->>'email')) || '|' ||
        lower(trim(input_row->>'tradingview')) || '|' ||
        regexp_replace(input_row->>'phone', '[^0-9+]', '', 'g') || '|' ||
        coalesce(registered_at::text, ''),
        'sha256'
      ), 'hex');

      select exists (
        select 1 from public.crm_lead_intake_events intake
        where intake.organization_id = target_organization_id
          and intake.source_system = 'google_sheet_whales_zone'
          and intake.external_id = row_external_id
      ) into existing_intake;

      select result.* into intake_result
      from public.ingest_whales_zone_lead(
        'google_sheet_whales_zone', row_external_id,
        trim(input_row->>'full_name'), trim(input_row->>'email'),
        trim(input_row->>'tradingview'), trim(input_row->>'phone'),
        default_owner_id, registered_at, payload_hash, null
      ) result;

      if intake_result.outcome = 'conflict' then
        raise exception 'Whales Zone row identities point to different CRM contacts';
      end if;

      if intake_result.outcome = 'created' and not existing_intake then
        select contact.version into final_version
        from public.crm_contacts contact where contact.id = intake_result.contact_id;
        created_count := created_count + 1;
      else
        final_version := null;
        duplicate_count := duplicate_count + 1;
      end if;

      insert into public.crm_import_rows (
        batch_id, organization_id, source_system, external_id, contact_id,
        result, signal, source_registered_at, contact_version_at_import
      ) values (
        batch_id, target_organization_id, 'google_sheet_whales_zone', row_external_id,
        intake_result.contact_id,
        case when intake_result.outcome = 'created' then 'created' else 'duplicate' end,
        'pending', registered_at, final_version
      );
    exception when others then
      insert into public.crm_import_rows (
        batch_id, organization_id, source_system, external_id, result, signal,
        source_registered_at, error_message
      ) values (
        batch_id, target_organization_id, 'google_sheet_whales_zone',
        coalesce(nullif(row_external_id, ''), 'sheet-row-' || (row_number + 1)::text),
        'error', 'pending', registered_at, left(sqlerrm, 1000)
      );
      error_count := error_count + 1;
    end;
  end loop;

  update public.crm_import_batches batch
  set status = 'completed',
      created_rows = created_count,
      duplicate_rows = duplicate_count,
      error_rows = error_count,
      completed_at = now()
  where batch.id = batch_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id, target_user_id, 'crm.whales_zone_sheet_imported',
    'crm_import_batch', batch_id,
    jsonb_build_object(
      'created', created_count,
      'duplicates', duplicate_count,
      'errors', error_count,
      'source_system', 'google_sheet_whales_zone'
    )
  );

  return batch_id;
end;
$$;

create or replace function public.get_whales_zone_intake_health(
  target_organization_id uuid
)
returns table (
  total_events bigint,
  live_events bigint,
  historical_events bigint,
  created_contacts bigint,
  deduplicated_events bigint,
  conflict_events bigint,
  failed_mirrors bigint,
  last_received_at timestamptz,
  last_successful_mirror_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*)::bigint,
    count(*) filter (where intake.source_system = 'whales_zone_form')::bigint,
    count(*) filter (where intake.source_system = 'google_sheet_whales_zone')::bigint,
    count(*) filter (where intake.outcome = 'created')::bigint,
    count(*) filter (where intake.outcome = 'deduplicated')::bigint,
    count(*) filter (where intake.outcome = 'conflict')::bigint,
    count(*) filter (where intake.sheet_mirror_status = 'failed')::bigint,
    max(intake.created_at),
    max(intake.sheet_mirrored_at)
  from public.crm_lead_intake_events intake
  where intake.organization_id = target_organization_id;
$$;

alter table public.crm_lead_intake_events enable row level security;

create policy "crm_lead_intake_events_leadership_select"
on public.crm_lead_intake_events for select to authenticated
using ((select private.can_manage_crm_imports(organization_id)));

revoke all on table public.crm_lead_intake_events from public, anon, authenticated;
grant select on table public.crm_lead_intake_events to authenticated;

revoke all on table private.crm_lead_intake_rate_limits from public, anon, authenticated;

revoke all on function public.ingest_whales_zone_lead(
  text, text, text, text, text, text, uuid, timestamptz, text, text
) from public, anon, authenticated;
grant execute on function public.ingest_whales_zone_lead(
  text, text, text, text, text, text, uuid, timestamptz, text, text
) to service_role;

revoke all on function public.complete_whales_zone_sheet_mirror(uuid, boolean, text)
from public, anon, authenticated;
grant execute on function public.complete_whales_zone_sheet_mirror(uuid, boolean, text)
to service_role;

revoke all on function public.import_whales_zone_sheet_batch(uuid, uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.import_whales_zone_sheet_batch(uuid, uuid, uuid, jsonb)
to service_role;

revoke all on function public.get_whales_zone_intake_health(uuid)
from public, anon;
grant execute on function public.get_whales_zone_intake_health(uuid)
to authenticated;

comment on table public.crm_lead_intake_events is
  'PII-free intake audit for Whales Zone landing submissions and historical Sheet rows.';
comment on function public.ingest_whales_zone_lead(text, text, text, text, text, text, uuid, timestamptz, text, text) is
  'Service-only idempotent Whales Zone intake with rate limiting, identity dedupe, CRM task creation, and audit.';
comment on function public.import_whales_zone_sheet_batch(uuid, uuid, uuid, jsonb) is
  'Owner/admin historical Google Sheet backfill with per-row audit and safe rollback compatibility.';
comment on function public.get_whales_zone_intake_health(uuid) is
  'RLS-scoped Whales Zone intake totals and last successful activity for CRM leadership.';
