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

