-- CRM scale foundation: searchable TradingView identities, a server-side
-- current/archive view, and auditable Telegram import batches with safe rollback.

alter table public.crm_contacts
  add column source_registered_at timestamptz;

create table public.crm_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  source_system text not null,
  status text not null default 'processing',
  total_rows integer not null default 0,
  created_rows integer not null default 0,
  duplicate_rows integer not null default 0,
  error_rows integer not null default 0,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  rolled_back_at timestamptz,
  rolled_back_by uuid references public.profiles (id) on delete restrict,
  constraint crm_import_batches_source_length check (char_length(trim(source_system)) between 3 and 80),
  constraint crm_import_batches_status_check check (status in ('processing', 'completed', 'rolled_back', 'partially_rolled_back')),
  constraint crm_import_batches_counts_nonnegative check (
    total_rows >= 0 and created_rows >= 0 and duplicate_rows >= 0 and error_rows >= 0
  )
);

create table public.crm_import_rows (
  id bigint generated always as identity primary key,
  batch_id uuid not null references public.crm_import_batches (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  source_system text not null,
  external_id text not null,
  contact_id uuid references public.crm_contacts (id) on delete set null,
  result text not null,
  signal text not null,
  source_registered_at timestamptz,
  contact_version_at_import bigint,
  error_message text,
  created_at timestamptz not null default now(),
  constraint crm_import_rows_batch_unique unique (batch_id, external_id),
  constraint crm_import_rows_external_length check (char_length(trim(external_id)) between 1 and 160),
  constraint crm_import_rows_result_check check (result in ('created', 'duplicate', 'error', 'rolled_back', 'rollback_blocked')),
  constraint crm_import_rows_signal_check check (signal in ('pending', 'contacted', 'activated', 'needs_account_correction')),
  constraint crm_import_rows_error_contract check (
    (result = 'error' and error_message is not null)
    or (result <> 'error')
  )
);

create index crm_import_batches_org_created_idx
  on public.crm_import_batches (organization_id, created_at desc);

create index crm_import_rows_source_external_idx
  on public.crm_import_rows (organization_id, source_system, external_id);

create index crm_import_rows_contact_idx
  on public.crm_import_rows (contact_id)
  where contact_id is not null;

create or replace function private.normalize_crm_identity(
  identity_kind public.crm_identity_kind,
  identity_value text
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case identity_kind
    when 'email' then lower(trim(identity_value))
    when 'phone' then regexp_replace(identity_value, '[^0-9+]', '', 'g')
    when 'telegram' then lower(regexp_replace(trim(identity_value), '^@', ''))
    when 'tradingview' then lower(regexp_replace(trim(identity_value), '[[:space:]]+', ' ', 'g'))
  end;
$$;

create or replace function private.validate_crm_identity(
  target_kind public.crm_identity_kind,
  target_value text
)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  normalized_identity text;
begin
  if target_kind is null or target_value is null then
    raise exception 'CRM identity is incomplete';
  end if;

  normalized_identity := private.normalize_crm_identity(target_kind, target_value);

  if target_kind = 'tradingview' then
    if char_length(normalized_identity) not between 3 and 100
      or normalized_identity ~ '[[:cntrl:]]' then
      raise exception 'TradingView identity is invalid';
    end if;
  elsif char_length(normalized_identity) not between 3 and 320 then
    raise exception 'CRM identity is incomplete';
  elsif target_kind = 'email' and normalized_identity !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Email identity is invalid';
  elsif target_kind = 'phone' and normalized_identity !~ '^\+?[0-9]{7,16}$' then
    raise exception 'Phone identity is invalid';
  elsif target_kind = 'telegram' and normalized_identity !~ '^[a-z0-9_]{5,32}$' then
    raise exception 'Telegram username is invalid';
  end if;

  return normalized_identity;
end;
$$;

create or replace function public.create_crm_lead_v3(
  target_user_id uuid,
  target_organization_id uuid,
  contact_full_name text,
  contact_source public.crm_source,
  contact_source_detail text,
  contact_interest public.crm_interest,
  contact_interest_detail text,
  contact_owner_id uuid,
  contact_consent_status public.crm_consent_status,
  contact_identities jsonb,
  initial_notes text,
  target_follow_up_at timestamptz,
  target_conversation_channel public.crm_conversation_channel,
  target_conversation_url text,
  target_conversation_label text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  identity_record record;
  primary_kind public.crm_identity_kind;
  primary_value text;
  normalized_identity text;
  contact_id uuid;
begin
  if jsonb_typeof(contact_identities) <> 'array'
    or jsonb_array_length(contact_identities) not between 1 and 4 then
    raise exception 'Provide between one and four CRM contact identities';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(contact_identities) item
    where jsonb_typeof(item) <> 'object'
      or item->>'kind' not in ('phone', 'email', 'telegram', 'tradingview')
      or char_length(trim(item->>'value')) not between 2 and 320
      or coalesce(item->>'is_primary', 'false') not in ('true', 'false')
  ) then
    raise exception 'One or more CRM identities are invalid';
  end if;

  if (
    select count(distinct item->>'kind')
    from jsonb_array_elements(contact_identities) item
  ) <> jsonb_array_length(contact_identities) then
    raise exception 'Provide each CRM identity kind only once when creating a lead';
  end if;

  if (
    select count(*)
    from jsonb_array_elements(contact_identities) item
    where coalesce((item->>'is_primary')::boolean, false)
  ) <> 1 then
    raise exception 'Choose exactly one primary CRM identity';
  end if;

  for identity_record in
    select
      (item->>'kind')::public.crm_identity_kind as kind,
      trim(item->>'value') as value,
      coalesce((item->>'is_primary')::boolean, false) as is_primary
    from jsonb_array_elements(contact_identities) item
  loop
    normalized_identity := private.validate_crm_identity(identity_record.kind, identity_record.value);

    if exists (
      select 1
      from public.crm_identities identity
      where identity.organization_id = target_organization_id
        and identity.kind = identity_record.kind
        and identity.normalized_value = normalized_identity
    ) then
      raise exception 'This contact identity already belongs to another CRM record';
    end if;

    if identity_record.is_primary then
      primary_kind := identity_record.kind;
      primary_value := identity_record.value;
    end if;
  end loop;

  contact_id := public.create_crm_lead_v2(
    target_user_id,
    target_organization_id,
    contact_full_name,
    contact_source,
    contact_source_detail,
    contact_interest,
    contact_interest_detail,
    contact_owner_id,
    contact_consent_status,
    primary_kind,
    primary_value,
    initial_notes,
    target_follow_up_at,
    target_conversation_channel,
    target_conversation_url,
    target_conversation_label
  );

  for identity_record in
    select
      (item->>'kind')::public.crm_identity_kind as kind,
      trim(item->>'value') as value,
      coalesce((item->>'is_primary')::boolean, false) as is_primary
    from jsonb_array_elements(contact_identities) item
    where not coalesce((item->>'is_primary')::boolean, false)
  loop
    insert into public.crm_identities (
      organization_id, contact_id, kind, value, normalized_value, is_primary, created_by
    ) values (
      target_organization_id,
      contact_id,
      identity_record.kind,
      identity_record.value,
      private.validate_crm_identity(identity_record.kind, identity_record.value),
      false,
      target_user_id
    );
  end loop;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id,
    target_user_id,
    'crm.identities_created',
    'crm_contact',
    contact_id,
    jsonb_build_object(
      'identity_kinds', (
        select jsonb_agg(item->>'kind' order by item->>'kind')
        from jsonb_array_elements(contact_identities) item
      )
    )
  );

  return contact_id;
end;
$$;

create or replace function public.search_crm_contacts_v2(
  target_organization_id uuid,
  search_query text,
  target_owner_id uuid,
  target_stage public.crm_lead_stage,
  target_scope text,
  target_view text,
  result_limit integer,
  result_offset integer
)
returns table (contact_id uuid, total_count bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  clean_query text := nullif(lower(trim(search_query)), '');
  query_pattern text;
begin
  if target_scope not in ('all', 'mine', 'overdue') then
    raise exception 'CRM search scope is invalid';
  end if;
  if target_view not in ('current', 'archive') then
    raise exception 'CRM board view is invalid';
  end if;
  if clean_query is not null and char_length(clean_query) < 2 then
    raise exception 'CRM search needs at least two characters';
  end if;
  if result_limit not between 1 and 100 or result_offset not between 0 and 1000000 then
    raise exception 'CRM result page is invalid';
  end if;

  if clean_query is not null then
    query_pattern := '%' ||
      replace(replace(replace(clean_query, '\', '\\'), '%', '\%'), '_', '\_') ||
      '%';
  end if;

  return query
  select contact.id, count(*) over () as total_count
  from public.crm_contacts contact
  where contact.organization_id = target_organization_id
    and (
      (target_view = 'current' and contact.stage in ('new', 'contacted', 'qualified', 'follow_up'))
      or (target_view = 'archive' and contact.stage in ('won', 'lost', 'do_not_contact'))
    )
    and (target_owner_id is null or contact.owner_id = target_owner_id)
    and (target_stage is null or contact.stage = target_stage)
    and (
      target_scope = 'all'
      or (target_scope = 'mine' and contact.owner_id = (select auth.uid()))
      or (
        target_scope = 'overdue'
        and contact.stage in ('new', 'contacted', 'qualified', 'follow_up')
        and contact.next_follow_up_at < now()
      )
    )
    and (
      clean_query is null
      or lower(
        coalesce(contact.full_name, '') || ' ' ||
        coalesce(contact.notes, '') || ' ' ||
        coalesce(contact.source_detail, '') || ' ' ||
        coalesce(contact.interest_detail, '')
      ) like query_pattern escape '\'
      or exists (
        select 1 from public.crm_identities identity
        where identity.contact_id = contact.id
          and identity.organization_id = contact.organization_id
          and lower(coalesce(identity.value, '') || ' ' || coalesce(identity.normalized_value, ''))
            like query_pattern escape '\'
      )
      or exists (
        select 1 from public.crm_conversation_links conversation
        where conversation.contact_id = contact.id
          and conversation.organization_id = contact.organization_id
          and lower(coalesce(conversation.label, '') || ' ' || coalesce(conversation.url, ''))
            like query_pattern escape '\'
      )
      or exists (
        select 1 from public.crm_activities activity
        where activity.contact_id = contact.id
          and activity.organization_id = contact.organization_id
          and lower(activity.summary) like query_pattern escape '\'
      )
    )
  order by contact.next_follow_up_at asc nulls last, contact.created_at desc, contact.id
  limit result_limit
  offset result_offset;
end;
$$;

create or replace function public.import_telegram_indicator_batch(
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
  external_id text;
  full_name text;
  phone text;
  email text;
  tradingview text;
  signal text;
  registered_at timestamptz;
  contact_id uuid;
  matching_contact_ids uuid[];
  final_version bigint;
  created_count integer := 0;
  duplicate_count integer := 0;
  error_count integer := 0;
  follow_up_at timestamptz;
begin
  if not private.is_org_owner_or_admin_actor(target_user_id, target_organization_id)
    or not private.actor_can_access_any_section(target_user_id, target_organization_id, array['crm']::text[]) then
    raise exception 'Only CRM platform leadership can import customer data';
  end if;

  if jsonb_typeof(import_rows) <> 'array'
    or jsonb_array_length(import_rows) not between 1 and 500 then
    raise exception 'Telegram import must contain between 1 and 500 rows';
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

  insert into public.crm_import_batches (
    organization_id, source_system, total_rows, created_by
  ) values (
    target_organization_id, 'telegram_admin_whales', jsonb_array_length(import_rows), target_user_id
  ) returning id into batch_id;

  for input_row in select value from jsonb_array_elements(import_rows)
  loop
    external_id := trim(input_row->>'message_id');
    full_name := trim(input_row->>'full_name');
    phone := trim(input_row->>'phone');
    email := trim(input_row->>'email');
    tradingview := trim(input_row->>'tradingview');
    signal := coalesce(nullif(trim(input_row->>'signal'), ''), 'pending');
    registered_at := null;
    contact_id := null;
    matching_contact_ids := null;

    begin
      if external_id is null or external_id = ''
        or char_length(full_name) not between 2 and 160
        or signal not in ('pending', 'contacted', 'activated', 'needs_account_correction') then
        raise exception 'Telegram row is incomplete';
      end if;

      phone := private.validate_crm_identity('phone'::public.crm_identity_kind, phone);
      email := private.validate_crm_identity('email'::public.crm_identity_kind, email);
      tradingview := private.validate_crm_identity('tradingview'::public.crm_identity_kind, tradingview);
      registered_at := nullif(trim(input_row->>'registered_at'), '')::timestamptz;

      select array_agg(distinct imported.contact_id)
      into matching_contact_ids
      from (
        select identity.contact_id
        from public.crm_identities identity
        where identity.organization_id = target_organization_id
          and (
            (identity.kind = 'phone' and identity.normalized_value = phone)
            or (identity.kind = 'email' and identity.normalized_value = email)
            or (identity.kind = 'tradingview' and identity.normalized_value = tradingview)
          )
        union
        select previous.contact_id
        from public.crm_import_rows previous
        where previous.organization_id = target_organization_id
          and previous.source_system = 'telegram_admin_whales'
          and previous.external_id = external_id
          and previous.contact_id is not null
      ) imported;

      if coalesce(array_length(matching_contact_ids, 1), 0) > 1 then
        raise exception 'Telegram row identities point to different CRM contacts';
      end if;

      if coalesce(array_length(matching_contact_ids, 1), 0) = 1 then
        insert into public.crm_import_rows (
          batch_id, organization_id, source_system, external_id, contact_id,
          result, signal, source_registered_at
        ) values (
          batch_id, target_organization_id, 'telegram_admin_whales', external_id,
          matching_contact_ids[1], 'duplicate', signal, registered_at
        );
        duplicate_count := duplicate_count + 1;
        continue;
      end if;

      follow_up_at := now() + case
        when signal = 'needs_account_correction' then interval '4 hours'
        when signal = 'contacted' then interval '1 day'
        else interval '8 hours'
      end;

      contact_id := public.create_crm_lead_v3(
        target_user_id,
        target_organization_id,
        full_name,
        'whales_zone'::public.crm_source,
        null,
        'indicator'::public.crm_interest,
        null,
        default_owner_id,
        'unknown'::public.crm_consent_status,
        jsonb_build_array(
          jsonb_build_object('kind', 'phone', 'value', phone, 'is_primary', true),
          jsonb_build_object('kind', 'email', 'value', email, 'is_primary', false),
          jsonb_build_object('kind', 'tradingview', 'value', tradingview, 'is_primary', false)
        ),
        case
          when signal = 'needs_account_correction' then 'إشارة Telegram: توجد مشكلة في حساب TradingView وتحتاج متابعة.'
          else ''
        end,
        follow_up_at,
        'whatsapp'::public.crm_conversation_channel,
        'https://wa.me/' || regexp_replace(phone, '[^0-9]', '', 'g'),
        'WhatsApp من Whales Zone'
      );

      update public.crm_contacts contact
      set source_registered_at = registered_at
      where contact.id = contact_id;

      if signal = 'activated' then
        perform public.record_crm_activity(
          target_user_id, contact_id, 'note'::public.crm_activity_kind,
          'won'::public.crm_lead_stage, 'أكد أيمن على Telegram أن المؤشر تم تفعيله.', null
        );
      elsif signal = 'contacted' then
        perform public.record_crm_activity(
          target_user_id, contact_id, 'message'::public.crm_activity_kind,
          'contacted'::public.crm_lead_stage, 'أكدت أسماء على Telegram أنها تواصلت مع العميل.', follow_up_at
        );
      elsif signal = 'needs_account_correction' then
        perform public.record_crm_activity(
          target_user_id, contact_id, 'note'::public.crm_activity_kind,
          'follow_up'::public.crm_lead_stage, 'حساب TradingView غير مضبوط؛ مطلوب التواصل عبر الهاتف أو البريد للتأكد من التفعيل.', follow_up_at
        );
      end if;

      select contact.version into final_version
      from public.crm_contacts contact where contact.id = contact_id;

      insert into public.crm_import_rows (
        batch_id, organization_id, source_system, external_id, contact_id,
        result, signal, source_registered_at, contact_version_at_import
      ) values (
        batch_id, target_organization_id, 'telegram_admin_whales', external_id,
        contact_id, 'created', signal, registered_at, final_version
      );
      created_count := created_count + 1;
    exception when others then
      insert into public.crm_import_rows (
        batch_id, organization_id, source_system, external_id, result, signal,
        source_registered_at, error_message
      ) values (
        batch_id, target_organization_id, 'telegram_admin_whales',
        coalesce(nullif(external_id, ''), 'row-' || (created_count + duplicate_count + error_count + 1)::text),
        'error', case when signal in ('pending', 'contacted', 'activated', 'needs_account_correction') then signal else 'pending' end,
        registered_at, left(sqlerrm, 1000)
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
    target_organization_id, target_user_id, 'crm.telegram_batch_imported',
    'crm_import_batch', batch_id,
    jsonb_build_object('created', created_count, 'duplicates', duplicate_count, 'errors', error_count)
  );

  return batch_id;
end;
$$;

create or replace function public.rollback_crm_import_batch(
  target_user_id uuid,
  target_batch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_record public.crm_import_batches%rowtype;
  imported_row public.crm_import_rows%rowtype;
  removed_count integer := 0;
  blocked_count integer := 0;
begin
  select batch.* into batch_record
  from public.crm_import_batches batch
  where batch.id = target_batch_id
  for update;

  if batch_record.id is null then raise exception 'CRM import batch was not found'; end if;
  if batch_record.status <> 'completed' then raise exception 'Only a completed CRM import can be rolled back'; end if;
  if not private.is_org_owner_or_admin_actor(target_user_id, batch_record.organization_id)
    or not private.actor_can_access_any_section(target_user_id, batch_record.organization_id, array['crm']::text[]) then
    raise exception 'Only CRM platform leadership can roll back customer imports';
  end if;

  for imported_row in
    select row.* from public.crm_import_rows row
    where row.batch_id = target_batch_id and row.result = 'created'
    order by row.id
  loop
    if exists (
      select 1 from public.crm_contacts contact
      where contact.id = imported_row.contact_id
        and contact.version = imported_row.contact_version_at_import
    ) then
      delete from public.tasks task where task.crm_contact_id = imported_row.contact_id;
      delete from public.crm_contacts contact where contact.id = imported_row.contact_id;
      update public.crm_import_rows row set result = 'rolled_back' where row.id = imported_row.id;
      removed_count := removed_count + 1;
    else
      update public.crm_import_rows row set result = 'rollback_blocked' where row.id = imported_row.id;
      blocked_count := blocked_count + 1;
    end if;
  end loop;

  update public.crm_import_batches batch
  set status = case when blocked_count = 0 then 'rolled_back' else 'partially_rolled_back' end,
      rolled_back_at = now(),
      rolled_back_by = target_user_id
  where batch.id = target_batch_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    batch_record.organization_id, target_user_id, 'crm.telegram_batch_rolled_back',
    'crm_import_batch', target_batch_id,
    jsonb_build_object('removed', removed_count, 'blocked_after_manual_change', blocked_count)
  );

  return jsonb_build_object('removed', removed_count, 'blocked', blocked_count);
end;
$$;

alter table public.crm_import_batches enable row level security;
alter table public.crm_import_rows enable row level security;

create policy "crm_import_batches_leadership_select"
on public.crm_import_batches for select to authenticated
using (
  private.is_org_owner_or_admin_actor((select auth.uid()), organization_id)
  and private.actor_can_access_any_section((select auth.uid()), organization_id, array['crm']::text[])
);

create policy "crm_import_rows_leadership_select"
on public.crm_import_rows for select to authenticated
using (
  private.is_org_owner_or_admin_actor((select auth.uid()), organization_id)
  and private.actor_can_access_any_section((select auth.uid()), organization_id, array['crm']::text[])
);

revoke all on table public.crm_import_batches from public, anon, authenticated;
revoke all on table public.crm_import_rows from public, anon, authenticated;
grant select on table public.crm_import_batches to authenticated;
grant select on table public.crm_import_rows to authenticated;

revoke all on function public.search_crm_contacts_v2(
  uuid, text, uuid, public.crm_lead_stage, text, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.search_crm_contacts_v2(
  uuid, text, uuid, public.crm_lead_stage, text, text, integer, integer
) to authenticated;

revoke all on function public.import_telegram_indicator_batch(uuid, uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.import_telegram_indicator_batch(uuid, uuid, uuid, jsonb)
to service_role;

revoke all on function public.rollback_crm_import_batch(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.rollback_crm_import_batch(uuid, uuid)
to service_role;

comment on table public.crm_import_batches is
  'Owner/admin-only audit envelope for customer imports; no customer row is imported without an explicit batch.';
comment on function public.rollback_crm_import_batch(uuid, uuid) is
  'Deletes only contacts that are still at their exact imported version; later manual changes block deletion.';
