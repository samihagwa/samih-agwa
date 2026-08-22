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

