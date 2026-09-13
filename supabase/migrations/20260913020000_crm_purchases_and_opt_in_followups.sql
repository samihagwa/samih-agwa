-- Customer purchases are structured CRM facts, not inferred from the original interest.
create table public.crm_customer_purchases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null,
  product public.crm_interest not null,
  product_detail text,
  exness_account text,
  tradingview_username text,
  subscription_amount numeric(12, 2),
  subscription_currency text,
  subscription_starts_on date,
  subscription_ends_on date,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (contact_id, organization_id) references public.crm_contacts(id, organization_id) on delete cascade,
  constraint crm_purchase_account_valid check (exness_account is null or exness_account ~ '^[A-Z0-9-]{5,32}$'),
  constraint crm_purchase_tradingview_valid check (tradingview_username is null or char_length(trim(tradingview_username)) between 3 and 100),
  constraint crm_purchase_detail_valid check ((product = 'other' and coalesce(char_length(trim(product_detail)) between 2 and 160, false))
    or (product <> 'other' and product_detail is null)),
  constraint crm_purchase_product_details check (
    (product <> 'cashback' or exness_account is not null)
    and (product <> 'indicator' or tradingview_username is not null)
  ),
  constraint crm_purchase_subscription_complete check (
    (subscription_amount is null and subscription_currency is null and subscription_starts_on is null and subscription_ends_on is null)
    or (coalesce(subscription_amount > 0, false) and coalesce(subscription_currency in ('EGP', 'USD'), false)
      and subscription_starts_on is not null and subscription_ends_on is not null
      and subscription_ends_on >= subscription_starts_on)
  )
);

create index crm_customer_purchases_contact_idx on public.crm_customer_purchases(organization_id, contact_id, created_at desc);
create index crm_customer_purchases_product_idx on public.crm_customer_purchases(organization_id, product, contact_id);
alter table public.crm_customer_purchases enable row level security;
create policy "crm_customer_purchases_select_owner_or_leadership"
on public.crm_customer_purchases for select to authenticated
using (private.can_access_crm_contact(contact_id, organization_id));
create policy "section_scope_crm_customer_purchases"
on public.crm_customer_purchases as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['crm']::text[]));
revoke all on public.crm_customer_purchases from public, anon, authenticated;
grant select on public.crm_customer_purchases to authenticated;
grant all on public.crm_customer_purchases to service_role;

-- A won customer may have an explicitly scheduled after-sale follow-up.
-- Legacy won rows could retain a true flag with no date. Normalize that stale flag
-- before enforcing the new explicit yes/no contract; no customer or task is removed.
update public.crm_contacts
set follow_up_required = false
where stage = 'won' and next_follow_up_at is null and follow_up_required;

alter table public.crm_contacts drop constraint crm_contacts_follow_up_contract;
alter table public.crm_contacts add constraint crm_contacts_follow_up_contract check (
  (stage in ('new', 'contacted', 'qualified', 'follow_up', 'won')
    and ((follow_up_required and next_follow_up_at is not null)
      or (not follow_up_required and next_follow_up_at is null)))
  or (stage in ('lost', 'do_not_contact') and not follow_up_required and next_follow_up_at is null)
);

create or replace function private.insert_crm_purchase(
  target_user_id uuid, target_contact_id uuid, target_purchase jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  contact_record public.crm_contacts%rowtype;
  product_key public.crm_interest;
  account_number text := nullif(upper(regexp_replace(coalesce(target_purchase->>'exness_account', ''), '[[:space:]]+', '', 'g')), '');
  tradingview_name text := nullif(trim(target_purchase->>'tradingview_username'), '');
  custom_detail text := nullif(trim(target_purchase->>'product_detail'), '');
  amount numeric;
  currency_key text := nullif(trim(target_purchase->>'subscription_currency'), '');
  starts_on date;
  ends_on date;
  purchase_id uuid;
begin
  select * into contact_record from public.crm_contacts where id = target_contact_id for update;
  if contact_record.id is null or contact_record.stage <> 'won' then
    raise exception 'Customer purchase requires a converted CRM contact';
  end if;
  if not exists (select 1 from public.memberships m where m.organization_id = contact_record.organization_id
    and m.user_id = target_user_id and m.status = 'active'
    and (m.role in ('owner', 'admin', 'manager') or contact_record.owner_id = target_user_id)) then
    raise exception 'Only the CRM owner or leadership can record a purchase';
  end if;
  if target_purchase is null or jsonb_typeof(target_purchase) <> 'object'
    or coalesce(target_purchase->>'product', '') not in
      ('indicator', 'signals_gold', 'signals_fx', 'course', 'brokerage', 'book', 'service', 'cashback', 'other') then
    raise exception 'Choose the purchased product';
  end if;
  product_key := (target_purchase->>'product')::public.crm_interest;
  if product_key = 'cashback' and (account_number is null or account_number !~ '^[A-Z0-9-]{5,32}$') then
    raise exception 'Cashback needs a valid Exness account number';
  end if;
  if product_key = 'indicator' and (tradingview_name is null or char_length(tradingview_name) not between 3 and 100) then
    raise exception 'Indicator purchase needs a TradingView username';
  end if;
  if (product_key = 'other' and (custom_detail is null or char_length(custom_detail) not between 2 and 160))
    or (product_key <> 'other' and custom_detail is not null) then
    raise exception 'Custom product details are invalid';
  end if;
  if target_purchase ? 'subscription_amount' and nullif(target_purchase->>'subscription_amount', '') is not null then
    amount := (target_purchase->>'subscription_amount')::numeric;
    currency_key := nullif(trim(target_purchase->>'subscription_currency'), '');
    starts_on := (target_purchase->>'subscription_starts_on')::date;
    ends_on := (target_purchase->>'subscription_ends_on')::date;
    if amount <= 0 or currency_key not in ('EGP', 'USD') or starts_on is null or ends_on is null or ends_on < starts_on then
      raise exception 'Complete subscription amount, currency and dates';
    end if;
  elsif currency_key is not null or nullif(target_purchase->>'subscription_starts_on', '') is not null
    or nullif(target_purchase->>'subscription_ends_on', '') is not null then
    raise exception 'Subscription details are incomplete';
  end if;
  insert into public.crm_customer_purchases (
    organization_id, contact_id, product, product_detail, exness_account, tradingview_username,
    subscription_amount, subscription_currency, subscription_starts_on, subscription_ends_on, created_by
  ) values (
    contact_record.organization_id, target_contact_id, product_key, custom_detail, account_number, tradingview_name,
    amount, currency_key, starts_on, ends_on, target_user_id
  ) returning id into purchase_id;
  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, after_data)
  values (contact_record.organization_id, target_user_id, 'crm.purchase_recorded', 'crm_contact', target_contact_id,
    jsonb_build_object('purchase_id', purchase_id, 'product', product_key, 'has_subscription', amount is not null));
  return purchase_id;
end;
$$;
revoke all on function private.insert_crm_purchase(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function private.insert_crm_purchase(uuid, uuid, jsonb) to service_role;
create or replace function public.create_crm_lead_v6(
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
  contact_trading_experience public.crm_trading_experience,
  contact_initial_stage public.crm_lead_stage,
  initial_notes text,
  target_follow_up_at timestamptz,
  target_conversation_channel public.crm_conversation_channel,
  target_conversation_url text,
  target_conversation_label text,
  allow_no_conversation_link boolean,
  target_purchase jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.app_role;
  clean_source_detail text := nullif(trim(contact_source_detail), '');
  clean_interest_detail text := nullif(trim(contact_interest_detail), '');
  clean_conversation_url text := nullif(trim(target_conversation_url), '');
  clean_conversation_label text := nullif(trim(target_conversation_label), '');
  identity_record record;
  normalized_identity text;
  identity_count integer;
  contact_id uuid;
  current_customer boolean := contact_initial_stage = 'won';
begin
  if target_user_id is null then
    raise exception 'A verified target user is required';
  end if;

  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  select membership.role into actor_role
  from public.memberships membership
  where membership.organization_id = target_organization_id
    and membership.user_id = target_user_id
    and membership.status = 'active';

  if actor_role is null or actor_role = 'viewer' then
    raise exception 'Only an active working member can create CRM leads';
  end if;
  if actor_role not in ('owner', 'admin', 'manager') and contact_owner_id <> target_user_id then
    raise exception 'Team members can create CRM leads for themselves only';
  end if;
  if not exists (
    select 1 from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = contact_owner_id
      and membership.status = 'active'
  ) then
    raise exception 'CRM owner must be an active organization member';
  end if;
  if contact_initial_stage not in ('new', 'won') then
    raise exception 'Manual CRM intake stage must be new or won';
  end if;
  if contact_consent_status = 'denied' then
    raise exception 'A denied contact cannot be created from the active customer intake';
  end if;
  if contact_full_name is null or char_length(trim(contact_full_name)) not between 2 and 160 then
    raise exception 'CRM contact name must contain between 2 and 160 characters';
  end if;
  if target_follow_up_at is not null and target_follow_up_at <= now() then
    raise exception 'CRM follow-up time must be in the future';
  end if;
  if current_customer and target_purchase is null then
    raise exception 'Choose the purchased product for a current customer';
  end if;
  if not current_customer and target_purchase is not null then
    raise exception 'A prospect cannot have a recorded purchase';
  end if;

  if contact_source = 'other' then
    if clean_source_detail is null or char_length(clean_source_detail) not between 2 and 160 then
      raise exception 'Custom registration source must contain between 2 and 160 characters';
    end if;
  elsif clean_source_detail is not null then
    raise exception 'A custom registration source is allowed only with the Other source';
  end if;
  if contact_interest = 'other' then
    if clean_interest_detail is null or char_length(clean_interest_detail) not between 2 and 160 then
      raise exception 'Custom registration reason must contain between 2 and 160 characters';
    end if;
  elsif clean_interest_detail is not null then
    raise exception 'A custom registration reason is allowed only with the Other reason';
  end if;
  if jsonb_typeof(contact_identities) <> 'array' then
    raise exception 'CRM identities must be supplied as an array';
  end if;

  identity_count := jsonb_array_length(contact_identities);
  if identity_count > 7 then
    raise exception 'Provide no more than seven CRM contact identities';
  end if;
  if exists (
    select 1 from jsonb_array_elements(contact_identities) item
    where jsonb_typeof(item) <> 'object'
      or item->>'kind' not in ('phone', 'email', 'telegram', 'tradingview', 'instagram', 'facebook', 'exness_account')
      or char_length(trim(item->>'value')) not between 3 and 320
      or coalesce(item->>'is_primary', 'false') not in ('true', 'false')
  ) then
    raise exception 'One or more CRM identities are invalid';
  end if;
  if (
    select count(distinct item->>'kind') from jsonb_array_elements(contact_identities) item
  ) <> identity_count then
    raise exception 'Provide each CRM identity kind only once when creating a lead';
  end if;
  if identity_count > 0 and (
    select count(*) from jsonb_array_elements(contact_identities) item
    where coalesce((item->>'is_primary')::boolean, false)
  ) <> 1 then
    raise exception 'Choose exactly one primary CRM identity';
  end if;

  for identity_record in
    select (item->>'kind')::public.crm_identity_kind as kind,
      trim(item->>'value') as value,
      coalesce((item->>'is_primary')::boolean, false) as is_primary
    from jsonb_array_elements(contact_identities) item
  loop
    normalized_identity := private.validate_crm_identity(identity_record.kind, identity_record.value);
    if exists (
      select 1 from public.crm_identities identity
      where identity.organization_id = target_organization_id
        and identity.kind = identity_record.kind
        and identity.normalized_value = normalized_identity
    ) then
      raise exception 'This contact identity already belongs to another CRM record';
    end if;
  end loop;

  if clean_conversation_url is null and not coalesce(allow_no_conversation_link, false) then
    raise exception 'Conversation link is required unless explicitly skipped';
  end if;
  if clean_conversation_url is not null and target_conversation_channel is null then
    raise exception 'Conversation channel is required with a conversation link';
  end if;
  if clean_conversation_url is not null and (
    char_length(clean_conversation_url) not between 8 and 2000
    or clean_conversation_url !~* '^https?://[^[:space:]]+$'
  ) then
    raise exception 'Conversation link must be a valid HTTP or HTTPS URL';
  end if;
  if clean_conversation_label is not null and (
    clean_conversation_url is null or char_length(clean_conversation_label) not between 2 and 80
  ) then
    raise exception 'Conversation label requires a valid conversation link';
  end if;

  insert into public.crm_contacts (
    organization_id, full_name, stage, source, source_detail, interest, interest_detail,
    owner_id, consent_status, next_follow_up_at, follow_up_required, converted_at,
    notes, trading_experience, created_by
  ) values (
    target_organization_id, trim(contact_full_name), contact_initial_stage,
    contact_source, clean_source_detail, contact_interest, clean_interest_detail,
    contact_owner_id, contact_consent_status,
    target_follow_up_at,
    target_follow_up_at is not null,
    case when current_customer then now() else null end,
    nullif(trim(initial_notes), ''),
    coalesce(contact_trading_experience, 'unknown'::public.crm_trading_experience),
    target_user_id
  ) returning id into contact_id;

  for identity_record in
    select (item->>'kind')::public.crm_identity_kind as kind,
      trim(item->>'value') as value,
      coalesce((item->>'is_primary')::boolean, false) as is_primary
    from jsonb_array_elements(contact_identities) item
  loop
    insert into public.crm_identities (
      organization_id, contact_id, kind, value, normalized_value, is_primary, created_by
    ) values (
      target_organization_id, contact_id, identity_record.kind, identity_record.value,
      private.validate_crm_identity(identity_record.kind, identity_record.value),
      identity_record.is_primary, target_user_id
    );
  end loop;

  if clean_conversation_url is not null then
    insert into public.crm_conversation_links (
      organization_id, contact_id, channel, label, url, is_primary, created_by
    ) values (
      target_organization_id, contact_id, target_conversation_channel,
      clean_conversation_label, clean_conversation_url, true, target_user_id
    );
  end if;

  insert into public.crm_activities (
    organization_id, contact_id, actor_id, kind, from_stage, to_stage, summary,
    next_follow_up_at
  ) values (
    target_organization_id, contact_id, target_user_id, 'created', null,
    contact_initial_stage,
    case when current_customer then 'تم تسجيل العميل كعميل حالي.'
      when target_follow_up_at is not null then 'تم إنشاء ملف العميل وتحديد أول متابعة.'
      else 'تم إنشاء ملف العميل بدون متابعة مجدولة.' end,
    target_follow_up_at
  );

  if target_follow_up_at is not null then
    perform set_config('app.crm_contact_id', contact_id::text, true);
    insert into public.tasks (
      organization_id, title, description, status, priority, owner_id, created_by,
      acceptance_criteria, due_at, crm_contact_id, crm_work_kind
    ) values (
      target_organization_id, 'متابعة عميل',
      'افتح ملف العميل وسجّل نتيجة التواصل والموعد التالي.', 'ready',
      case when target_follow_up_at <= now() + interval '24 hours'
        then 'high'::public.task_priority else 'normal'::public.task_priority end,
      contact_owner_id, target_user_id,
      'نتيجة التواصل محفوظة في ملف العميل قبل إغلاق المهمة.',
      target_follow_up_at, contact_id, 'follow_up'
    );
  end if;

  if current_customer then
    perform private.insert_crm_purchase(target_user_id, contact_id, target_purchase);
  end if;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id, target_user_id, 'crm.customer_created', 'crm_contact', contact_id,
    jsonb_build_object(
      'source', contact_source,
      'interest', contact_interest,
      'owner_id', contact_owner_id,
      'initial_stage', contact_initial_stage,
      'identity_kinds', (
        select coalesce(jsonb_agg(item->>'kind' order by item->>'kind'), '[]'::jsonb)
        from jsonb_array_elements(contact_identities) item
      ),
      'conversation_channel', target_conversation_channel,
      'has_conversation_link', clean_conversation_url is not null,
      'follow_up_at', target_follow_up_at
    )
  );

  return contact_id;
end;
$$;
revoke all on function public.create_crm_lead_v6(uuid, uuid, text, public.crm_source, text, public.crm_interest, text, uuid, public.crm_consent_status, jsonb, public.crm_trading_experience, public.crm_lead_stage, text, timestamptz, public.crm_conversation_channel, text, text, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.create_crm_lead_v6(uuid, uuid, text, public.crm_source, text, public.crm_interest, text, uuid, public.crm_consent_status, jsonb, public.crm_trading_experience, public.crm_lead_stage, text, timestamptz, public.crm_conversation_channel, text, text, boolean, jsonb) to service_role;
create or replace function public.record_crm_activity_v3(
  target_user_id uuid,
  target_contact_id uuid,
  expected_contact_version bigint,
  activity_kind public.crm_activity_kind,
  next_stage public.crm_lead_stage,
  activity_summary text,
  target_next_follow_up_at timestamptz,
  target_purchase jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  contact_record public.crm_contacts%rowtype;
  actor_role public.app_role;
  activity_id bigint;
  follow_up_task_id uuid;
  active_follow_up boolean := target_next_follow_up_at is not null;
begin
  if target_user_id is null then
    raise exception 'A verified target user is required';
  end if;

  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  select contact.* into contact_record
  from public.crm_contacts contact
  where contact.id = target_contact_id
  for update;

  if contact_record.id is null then
    raise exception 'CRM contact was not found';
  end if;

  if expected_contact_version is not null
    and contact_record.version <> expected_contact_version then
    raise exception 'CRM contact changed. Refresh the customer file and try again';
  end if;

  select membership.role into actor_role
  from public.memberships membership
  where membership.organization_id = contact_record.organization_id
    and membership.user_id = target_user_id
    and membership.status = 'active';

  if actor_role is null
    or (contact_record.owner_id <> target_user_id and actor_role not in ('owner', 'admin', 'manager')) then
    raise exception 'Only the CRM owner or organization leadership can record follow-up';
  end if;

  if activity_kind = 'created' then
    raise exception 'Created is reserved for the initial CRM event';
  end if;

  if activity_summary is null
    or char_length(trim(activity_summary)) not between 3 and 4000 then
    raise exception 'CRM activity summary must contain between 3 and 4000 characters';
  end if;

  if not (contact_record.stage = 'won' and next_stage = 'won')
    and not private.is_valid_crm_transition(contact_record.stage, next_stage) then
    raise exception 'Invalid CRM stage transition from % to %', contact_record.stage, next_stage;
  end if;

  if active_follow_up and target_next_follow_up_at <= now() then
    raise exception 'CRM follow-up time must be in the future';
  end if;
  if next_stage in ('lost', 'do_not_contact') and active_follow_up then
    raise exception 'Closed CRM stages cannot keep an open follow-up time';
  end if;
  if next_stage = 'won' and contact_record.stage <> 'won' and target_purchase is null then
    raise exception 'Choose the purchased product before converting this customer';
  end if;
  if next_stage <> 'won' and target_purchase is not null then
    raise exception 'Purchases can only be recorded for current customers';
  end if;

  perform set_config('app.crm_contact_id', target_contact_id::text, true);

  -- Complete every open follow-up task through the canonical task transitions.
  update public.tasks task set status = 'ready'
  where task.crm_contact_id = target_contact_id and task.status = 'backlog';

  update public.tasks task set status = 'in_progress'
  where task.crm_contact_id = target_contact_id and task.status in ('ready', 'blocked');

  update public.tasks task set status = 'review'
  where task.crm_contact_id = target_contact_id and task.status = 'in_progress';

  update public.tasks task set status = 'done'
  where task.crm_contact_id = target_contact_id and task.status = 'review';

  update public.crm_contacts contact
  set stage = next_stage,
      follow_up_required = active_follow_up,
      next_follow_up_at = case when active_follow_up then target_next_follow_up_at else null end,
      last_contacted_at = case
        when activity_kind in ('call', 'message', 'email') then now()
        else contact.last_contacted_at
      end,
      converted_at = case
        when next_stage = 'won' then coalesce(contact.converted_at, now())
        else null
      end,
      closure_reason = case
        when next_stage in ('lost', 'do_not_contact') then trim(activity_summary)
        else null
      end,
      consent_status = case
        when next_stage = 'do_not_contact' then 'denied'::public.crm_consent_status
        when contact.consent_status = 'denied' then 'unknown'::public.crm_consent_status
        else contact.consent_status
      end,
      version = contact.version + 1,
      updated_at = now()
  where contact.id = target_contact_id;

  if target_purchase is not null then
    perform private.insert_crm_purchase(target_user_id, target_contact_id, target_purchase);
  end if;

  insert into public.crm_activities (
    organization_id, contact_id, actor_id, kind, from_stage, to_stage,
    summary, next_follow_up_at
  ) values (
    contact_record.organization_id, target_contact_id, target_user_id,
    activity_kind, contact_record.stage, next_stage, trim(activity_summary),
    case when active_follow_up then target_next_follow_up_at else null end
  ) returning id into activity_id;

  if active_follow_up then
    insert into public.tasks (
      organization_id, title, description, status, priority, owner_id,
      created_by, acceptance_criteria, due_at, crm_contact_id
    ) values (
      contact_record.organization_id,
      'متابعة: ' || contact_record.full_name,
      case when next_stage = 'won' then 'متابعة ما بعد البيع: افتح ملف العميل وسجّل ما حدث.'
        else 'افتح ملف العميل، تواصل معه، ثم سجّل النتيجة وحدد الخطوة التالية.' end,
      'ready',
      case when target_next_follow_up_at <= now() + interval '24 hours'
        then 'high'::public.task_priority
        else 'normal'::public.task_priority
      end,
      contact_record.owner_id,
      target_user_id,
      'تسجيل نتيجة التواصل في ملف العميل مع المرحلة التالية وموعد المتابعة أو سبب الإغلاق.',
      target_next_follow_up_at,
      target_contact_id
    ) returning id into follow_up_task_id;
  end if;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    contact_record.organization_id,
    target_user_id,
    'crm.follow_up_recorded',
    'crm_contact',
    target_contact_id,
    jsonb_build_object(
      'stage', contact_record.stage,
      'follow_up_required', contact_record.follow_up_required,
      'next_follow_up_at', contact_record.next_follow_up_at,
      'version', contact_record.version
    ),
    jsonb_build_object(
      'stage', next_stage,
      'follow_up_required', active_follow_up,
      'next_follow_up_at', case when active_follow_up then target_next_follow_up_at else null end,
      'version', contact_record.version + 1,
      'activity_kind', activity_kind,
      'activity_id', activity_id,
      'task_id', follow_up_task_id
    )
  );

  return jsonb_build_object(
    'changed', true,
    'contact_id', target_contact_id,
    'contact_version', contact_record.version + 1,
    'activity_id', activity_id,
    'task_id', follow_up_task_id,
    'follow_up_required', active_follow_up,
    'next_follow_up_at', case when active_follow_up then target_next_follow_up_at else null end
  );
end;
$$;
revoke all on function public.record_crm_activity_v3(uuid, uuid, bigint, public.crm_activity_kind, public.crm_lead_stage, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.record_crm_activity_v3(uuid, uuid, bigint, public.crm_activity_kind, public.crm_lead_stage, text, timestamptz, jsonb) to service_role;
create or replace function public.search_crm_contacts_v9(
  target_organization_id uuid,
  search_query text,
  target_owner_id uuid,
  target_stage public.crm_lead_stage,
  target_source public.crm_source,
  target_interest public.crm_interest,
  target_trading_experience public.crm_trading_experience,
  target_scope text,
  target_view text,
  target_queue text,
  target_priority text,
  target_segment text,
  result_limit integer,
  result_offset integer
)
returns table (
  contact_id uuid,
  total_count bigint,
  priority_score integer,
  priority_reason text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  clean_query text := nullif(lower(trim(search_query)), '');
  query_pattern text;
begin
  if target_scope is null or target_scope not in ('all', 'mine', 'overdue') then
    raise exception 'CRM search scope is invalid';
  end if;
  if target_view is null or target_view not in ('all', 'current', 'archive') then
    raise exception 'CRM directory view is invalid';
  end if;
  if target_queue is null or target_queue not in (
    'all', 'new', 'today', 'overdue', 'waiting', 'interested', 'converted', 'lost'
  ) then
    raise exception 'CRM follow-up queue is invalid';
  end if;
  if target_priority is null or target_priority not in ('all', 'high') then
    raise exception 'CRM priority filter is invalid';
  end if;
  if target_segment is null or target_segment not in ('all', 'manual', 'indicator', 'cashback', 'exness', 'other') then
    raise exception 'CRM customer segment is invalid';
  end if;
  if clean_query is not null and char_length(clean_query) < 2 then
    raise exception 'CRM search needs at least two characters';
  end if;
  if result_limit is null or result_offset is null
    or result_limit not between 1 and 100
    or result_offset not between 0 and 1000000 then
    raise exception 'CRM result page is invalid';
  end if;

  if clean_query is not null then
    query_pattern := '%' ||
      replace(replace(replace(clean_query, '\', '\\'), '%', '\%'), '_', '\_') ||
      '%';
  end if;

  return query
  with scored as (
    select
      contact.id,
      contact.next_follow_up_at,
      coalesce(contact.source_registered_at, contact.created_at) as registered_at,
      (
        case
          when contact.stage in ('new', 'contacted', 'qualified', 'follow_up')
            and contact.follow_up_required and contact.next_follow_up_at < now() then 45
          when contact.stage in ('new', 'contacted', 'qualified', 'follow_up')
            and contact.follow_up_required
            and (contact.next_follow_up_at at time zone 'Africa/Cairo')::date
              = (now() at time zone 'Africa/Cairo')::date then 30
          else 0
        end
        + case contact.stage
            when 'qualified' then 30 when 'follow_up' then 18
            when 'new' then 14 when 'contacted' then 10 else 0
          end
        + case coalesce(profile.lead_temperature, 'cold')
            when 'hot' then 25 when 'warm' then 12 else 0
          end
        + case when contact.last_contacted_at is null then 8 else 0 end
        + case when exists (
            select 1 from public.crm_conversation_links conversation
            where conversation.organization_id = contact.organization_id
              and conversation.contact_id = contact.id
          ) then 5 else 0 end
      )::integer as score,
      case
        when contact.stage in ('new', 'contacted', 'qualified', 'follow_up')
          and contact.follow_up_required and contact.next_follow_up_at < now() then 'متابعة متأخرة'
        when profile.lead_temperature = 'hot' then 'اهتمام مرتفع مسجل'
        when contact.stage = 'qualified' then 'مؤهل للشراء'
        when contact.stage = 'new' and contact.last_contacted_at is null then 'عميل جديد لم يبدأ التواصل معه'
        when contact.stage in ('new', 'contacted', 'qualified', 'follow_up')
          and contact.follow_up_required
          and (contact.next_follow_up_at at time zone 'Africa/Cairo')::date
            = (now() at time zone 'Africa/Cairo')::date then 'موعد متابعته اليوم'
        else 'أولوية مبنية على المرحلة وسجل المتابعة'
      end as reason
    from public.crm_contacts contact
    left join public.crm_sales_profiles profile
      on profile.organization_id = contact.organization_id
     and profile.contact_id = contact.id
    where contact.organization_id = target_organization_id
      and (
        target_segment = 'all'
        or (target_segment = 'manual' and contact.intake_origin = 'manual'
          and contact.stage in ('new', 'contacted', 'qualified', 'follow_up'))
        or (target_segment = 'indicator' and contact.intake_origin = 'external'
          and contact.interest = 'indicator' and contact.stage <> 'won')
        or (target_segment = 'cashback' and contact.intake_origin = 'external'
          and contact.interest::text = 'cashback' and contact.stage <> 'won')
        or (target_segment = 'exness' and (
          contact.source = 'exness' or contact.interest = 'brokerage'
          or exists (select 1 from public.crm_identities identity
            where identity.organization_id = contact.organization_id and identity.contact_id = contact.id
              and identity.kind = 'exness_account')
          or exists (select 1 from public.crm_customer_purchases purchase
            where purchase.organization_id = contact.organization_id and purchase.contact_id = contact.id
              and purchase.product in ('cashback', 'brokerage'))
        ))
        or (target_segment = 'other' and contact.intake_origin = 'external'
          and contact.interest::text not in ('indicator', 'cashback') and contact.stage <> 'won')
      )
      and (
        target_view = 'all'
        or (target_view = 'current' and contact.stage in ('new', 'contacted', 'qualified', 'follow_up'))
        or (target_view = 'archive' and contact.stage in ('won', 'lost', 'do_not_contact'))
      )
      and (target_owner_id is null or contact.owner_id = target_owner_id)
      and (target_stage is null or contact.stage = target_stage)
      and (target_source is null or contact.source = target_source)
      and (target_interest is null
        or (contact.stage <> 'won' and contact.interest = target_interest)
        or (contact.stage = 'won' and exists (
          select 1 from public.crm_customer_purchases purchased
          where purchased.organization_id = contact.organization_id
            and purchased.contact_id = contact.id and purchased.product = target_interest
        ))
        or (contact.stage = 'won' and contact.interest = target_interest and not exists (
          select 1 from public.crm_customer_purchases purchased
          where purchased.organization_id = contact.organization_id and purchased.contact_id = contact.id
        )))
      and (target_trading_experience is null or contact.trading_experience = target_trading_experience)
      and (
        target_scope = 'all'
        or (target_scope = 'mine' and contact.owner_id = (select auth.uid()))
        or (
          target_scope = 'overdue'
          and contact.stage in ('new', 'contacted', 'qualified', 'follow_up')
          and contact.follow_up_required and contact.next_follow_up_at < now()
        )
      )
      and (
        target_queue = 'all'
        or (target_queue = 'new' and contact.stage = 'new')
        or (
          target_queue = 'today'
          and contact.stage in ('new', 'contacted', 'qualified', 'follow_up')
          and contact.follow_up_required
          and (contact.next_follow_up_at at time zone 'Africa/Cairo')::date
            = (now() at time zone 'Africa/Cairo')::date
        )
        or (
          target_queue = 'overdue'
          and contact.stage in ('new', 'contacted', 'qualified', 'follow_up')
          and contact.follow_up_required and contact.next_follow_up_at < now()
        )
        or (target_queue = 'waiting' and contact.stage = 'follow_up' and contact.follow_up_required)
        or (target_queue = 'interested' and contact.stage in ('follow_up', 'qualified'))
        or (target_queue = 'converted' and contact.stage = 'won')
        or (target_queue = 'lost' and contact.stage in ('lost', 'do_not_contact'))
      )
      and (
        clean_query is null
        or lower(
          coalesce(contact.full_name, '') || ' ' || coalesce(contact.notes, '') || ' ' ||
          contact.source::text || ' ' || coalesce(contact.source_detail, '') || ' ' ||
          contact.interest::text || ' ' || coalesce(contact.interest_detail, '')
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
          select 1 from public.crm_customer_purchases purchase
          where purchase.contact_id = contact.id
            and purchase.organization_id = contact.organization_id
            and lower(coalesce(purchase.exness_account, '') || ' ' ||
              coalesce(purchase.tradingview_username, '') || ' ' ||
              coalesce(purchase.product_detail, '')) like query_pattern escape '\'
        )
        or exists (
          select 1 from public.crm_activities activity
          where activity.contact_id = contact.id
            and activity.organization_id = contact.organization_id
            and lower(activity.summary) like query_pattern escape '\'
        )
      )
  ), visible as (
    select * from scored where target_priority = 'all' or score >= 55
  )
  select visible.id, count(*) over (), visible.score, visible.reason
  from visible
  order by
    case when visible.next_follow_up_at < now() then 0 else 1 end,
    visible.score desc,
    visible.next_follow_up_at asc nulls last,
    visible.registered_at desc,
    visible.id
  limit result_limit offset result_offset;
end;
$$;
revoke all on function public.search_crm_contacts_v9(uuid, text, uuid, public.crm_lead_stage, public.crm_source, public.crm_interest, public.crm_trading_experience, text, text, text, text, text, integer, integer) from public, anon;
grant execute on function public.search_crm_contacts_v9(uuid, text, uuid, public.crm_lead_stage, public.crm_source, public.crm_interest, public.crm_trading_experience, text, text, text, text, text, integer, integer) to authenticated;
