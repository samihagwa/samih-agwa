-- Simplify manual CRM intake without weakening ownership or deduplication.
-- A chat-only customer may be saved with no traditional identity, while any
-- supplied identity remains normalized and unique inside the organization.

alter type public.crm_interest add value if not exists 'cashback';
alter type public.crm_identity_kind add value if not exists 'exness_account';

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
  select case identity_kind::text
    when 'email' then lower(trim(identity_value))
    when 'phone' then regexp_replace(identity_value, '[^0-9+]', '', 'g')
    when 'telegram' then lower(regexp_replace(trim(identity_value), '^@', ''))
    when 'tradingview' then lower(regexp_replace(trim(identity_value), '[[:space:]]+', ' ', 'g'))
    when 'instagram' then lower(regexp_replace(trim(identity_value), '^@', ''))
    when 'facebook' then lower(regexp_replace(trim(identity_value), '^@', ''))
    when 'exness_account' then upper(regexp_replace(trim(identity_value), '[[:space:]]+', '', 'g'))
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

  if target_kind::text = 'tradingview' then
    if char_length(normalized_identity) not between 3 and 100
      or normalized_identity ~ '[[:cntrl:]]' then
      raise exception 'TradingView identity is invalid';
    end if;
  elsif target_kind::text in ('instagram', 'facebook') then
    if char_length(normalized_identity) not between 3 and 160
      or normalized_identity ~ '[[:space:][:cntrl:]/?#]' then
      raise exception 'Social username is invalid';
    end if;
  elsif target_kind::text = 'exness_account' then
    if normalized_identity !~ '^[A-Z0-9-]{5,32}$' then
      raise exception 'Exness account identity is invalid';
    end if;
  elsif char_length(normalized_identity) not between 3 and 320 then
    raise exception 'CRM identity is incomplete';
  elsif target_kind::text = 'email' and normalized_identity !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Email identity is invalid';
  elsif target_kind::text = 'phone' and normalized_identity !~ '^\+?[0-9]{7,16}$' then
    raise exception 'Phone identity is invalid';
  elsif target_kind::text = 'telegram' and normalized_identity !~ '^[a-z0-9_]{5,32}$' then
    raise exception 'Telegram username is invalid';
  end if;

  return normalized_identity;
end;
$$;

create or replace function public.create_crm_lead_v5(
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
  target_conversation_label text
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
  if not current_customer and (target_follow_up_at is null or target_follow_up_at <= now()) then
    raise exception 'CRM follow-up time must be in the future';
  end if;
  if current_customer and target_follow_up_at is not null then
    raise exception 'A current customer must not create a prospect follow-up task';
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
    case when current_customer then null else target_follow_up_at end,
    not current_customer,
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
    case when current_customer
      then 'تم تسجيل العميل كعميل حالي.'
      else 'تم إنشاء ملف العميل وتحديد أول متابعة.'
    end,
    case when current_customer then null else target_follow_up_at end
  );

  if not current_customer then
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
      'follow_up_at', case when current_customer then null else target_follow_up_at end
    )
  );

  return contact_id;
end;
$$;

revoke all on function public.create_crm_lead_v5(
  uuid, uuid, text, public.crm_source, text, public.crm_interest, text, uuid,
  public.crm_consent_status, jsonb, public.crm_trading_experience,
  public.crm_lead_stage, text, timestamptz,
  public.crm_conversation_channel, text, text
) from public, anon, authenticated;
grant execute on function public.create_crm_lead_v5(
  uuid, uuid, text, public.crm_source, text, public.crm_interest, text, uuid,
  public.crm_consent_status, jsonb, public.crm_trading_experience,
  public.crm_lead_stage, text, timestamptz,
  public.crm_conversation_channel, text, text
) to service_role;

comment on function public.create_crm_lead_v5(
  uuid, uuid, text, public.crm_source, text, public.crm_interest, text, uuid,
  public.crm_consent_status, jsonb, public.crm_trading_experience,
  public.crm_lead_stage, text, timestamptz,
  public.crm_conversation_channel, text, text
) is 'Creates a chat-only prospect or a current customer atomically; supplied identities remain normalized and deduplicated.';

create or replace function public.search_crm_contacts_v8(
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
  if target_segment is null or target_segment not in ('all', 'indicator', 'cashback', 'other') then
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
        or (target_segment = 'indicator' and contact.interest = 'indicator')
        or (target_segment = 'cashback' and contact.interest::text = 'cashback')
        or (target_segment = 'other' and contact.interest::text not in ('indicator', 'cashback'))
      )
      and (
        target_view = 'all'
        or (target_view = 'current' and contact.stage in ('new', 'contacted', 'qualified', 'follow_up'))
        or (target_view = 'archive' and contact.stage in ('won', 'lost', 'do_not_contact'))
      )
      and (target_owner_id is null or contact.owner_id = target_owner_id)
      and (target_stage is null or contact.stage = target_stage)
      and (target_source is null or contact.source = target_source)
      and (target_interest is null or contact.interest = target_interest)
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

revoke all on function public.search_crm_contacts_v8(
  uuid, text, uuid, public.crm_lead_stage, public.crm_source,
  public.crm_interest, public.crm_trading_experience,
  text, text, text, text, text, integer, integer
) from public, anon;
grant execute on function public.search_crm_contacts_v8(
  uuid, text, uuid, public.crm_lead_stage, public.crm_source,
  public.crm_interest, public.crm_trading_experience,
  text, text, text, text, text, integer, integer
) to authenticated;

comment on function public.search_crm_contacts_v8(
  uuid, text, uuid, public.crm_lead_stage, public.crm_source,
  public.crm_interest, public.crm_trading_experience,
  text, text, text, text, text, integer, integer
) is 'Searches CRM queues with explicit indicator, cashback, customer-state, ownership, and trading-experience filters.';
