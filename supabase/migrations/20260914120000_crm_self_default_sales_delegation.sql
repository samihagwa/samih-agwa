-- A creator starts as the file and follow-up owner; they may delegate to an
-- explicitly selected active Sales teammate. Never accept an arbitrary member.
create or replace function public.list_crm_assignable_owners(target_organization_id uuid)
returns table(user_id uuid)
language sql stable security definer set search_path = '' as $$
  select member.user_id
  from public.memberships member
  where member.organization_id = target_organization_id and member.status = 'active'
    and member.role <> 'viewer' and 'crm' = any(member.allowed_sections)
    and private.actor_can_access_any_section((select auth.uid()), target_organization_id, array['crm']::text[])
    and (member.user_id = (select auth.uid()) or exists (
      select 1 from public.crm_lead_routing_members route
      where route.organization_id = member.organization_id and route.user_id = member.user_id
    ));
$$;
revoke all on function public.list_crm_assignable_owners(uuid) from public, anon, authenticated;
grant execute on function public.list_crm_assignable_owners(uuid) to authenticated;

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
  if actor_role not in ('owner', 'admin', 'manager') and contact_owner_id <> target_user_id
    and not exists (
      select 1 from public.crm_lead_routing_members route
      join public.memberships member on member.organization_id = route.organization_id
        and member.user_id = route.user_id and member.status = 'active'
        and member.role <> 'viewer' and 'crm' = any(member.allowed_sections)
      where route.organization_id = target_organization_id and route.user_id = contact_owner_id
    ) then
    raise exception 'CRM file can be assigned only to an active Sales team member';
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

