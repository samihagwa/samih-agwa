do $$
begin
  create type public.crm_trading_experience as enum ('unknown', 'new', 'experienced');
exception
  when duplicate_object then null;
end
$$;

alter table public.crm_contacts
  add column if not exists trading_experience public.crm_trading_experience not null default 'unknown';

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
    when 'instagram' then lower(regexp_replace(trim(identity_value), '^@', ''))
    when 'facebook' then lower(regexp_replace(trim(identity_value), '^@', ''))
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
  elsif target_kind in ('instagram', 'facebook') then
    if char_length(normalized_identity) not between 3 and 160
      or normalized_identity ~ '[[:space:][:cntrl:]/?#]' then
      raise exception 'Social username is invalid';
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
    or jsonb_array_length(contact_identities) not between 1 and 6 then
    raise exception 'Provide between one and six CRM contact identities';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(contact_identities) item
    where jsonb_typeof(item) <> 'object'
      or item->>'kind' not in ('phone', 'email', 'telegram', 'tradingview', 'instagram', 'facebook')
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

create or replace function public.create_crm_lead_v4(
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
  contact_id uuid;
begin
  contact_id := public.create_crm_lead_v3(
    target_user_id, target_organization_id, contact_full_name,
    contact_source, contact_source_detail, contact_interest, contact_interest_detail,
    contact_owner_id, contact_consent_status, contact_identities, initial_notes,
    target_follow_up_at, target_conversation_channel, target_conversation_url,
    target_conversation_label
  );

  update public.crm_contacts
  set trading_experience = coalesce(contact_trading_experience, 'unknown'::public.crm_trading_experience),
      updated_at = now()
  where id = contact_id and organization_id = target_organization_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id, target_user_id, 'crm.trading_experience_set',
    'crm_contact', contact_id,
    jsonb_build_object('trading_experience', coalesce(contact_trading_experience, 'unknown'::public.crm_trading_experience))
  );

  return contact_id;
end;
$$;

revoke all on function public.create_crm_lead_v4(
  uuid, uuid, text, public.crm_source, text, public.crm_interest, text, uuid,
  public.crm_consent_status, jsonb, public.crm_trading_experience, text, timestamptz,
  public.crm_conversation_channel, text, text
) from public, anon, authenticated;
grant execute on function public.create_crm_lead_v4(
  uuid, uuid, text, public.crm_source, text, public.crm_interest, text, uuid,
  public.crm_consent_status, jsonb, public.crm_trading_experience, text, timestamptz,
  public.crm_conversation_channel, text, text
) to service_role;

create or replace function public.search_crm_contacts_v7(
  target_organization_id uuid,
  search_query text,
  target_owner_id uuid,
  target_stage public.crm_lead_stage,
  target_source public.crm_source,
  target_interest public.crm_interest,
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
  if target_segment is null or target_segment not in ('all', 'indicator', 'other') then
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
        or (target_segment = 'other' and contact.interest <> 'indicator')
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

revoke all on function public.search_crm_contacts_v7(
  uuid, text, uuid, public.crm_lead_stage, public.crm_source,
  public.crm_interest, text, text, text, text, text, integer, integer
) from public, anon;
grant execute on function public.search_crm_contacts_v7(
  uuid, text, uuid, public.crm_lead_stage, public.crm_source,
  public.crm_interest, text, text, text, text, text, integer, integer
) to authenticated;

create or replace function public.search_exness_agency_clients(
  target_organization_id uuid,
  search_query text,
  target_status text,
  result_limit integer,
  result_offset integer
)
returns table (
  account_id uuid,
  crm_contact_id uuid,
  account_number text,
  external_client_id text,
  country text,
  account_type text,
  is_active boolean,
  registered_at timestamptz,
  last_activity_at timestamptz,
  last_synced_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  clean_query text := nullif(trim(search_query), '');
  query_pattern text;
begin
  if actor is null or not exists (
    select 1 from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = actor
      and membership.status = 'active'
      and membership.role <> 'viewer'
      and (membership.role = 'owner' or 'crm' = any(membership.allowed_sections))
  ) then
    raise exception 'CRM access is required to view agency clients';
  end if;
  if target_status not in ('all', 'active', 'inactive') then
    raise exception 'Agency client status is invalid';
  end if;
  if result_limit not between 1 and 100 or result_offset not between 0 and 1000000 then
    raise exception 'Agency client page is invalid';
  end if;
  if clean_query is not null then
    query_pattern := '%' ||
      replace(replace(replace(lower(clean_query), '\', '\\'), '%', '\%'), '_', '\_') ||
      '%';
  end if;

  return query
  select
    account.id,
    account.crm_contact_id,
    account.account_number,
    account.external_client_id,
    nullif(trim(account.client_profile->>'country'), ''),
    nullif(trim(account.client_profile->>'account_type'), ''),
    account.is_active,
    account.registered_at,
    account.last_activity_at,
    account.last_synced_at,
    count(*) over ()
  from public.broker_client_accounts account
  where account.organization_id = target_organization_id
    and (
      target_status = 'all'
      or (target_status = 'active' and account.is_active)
      or (target_status = 'inactive' and not account.is_active)
    )
    and (
      clean_query is null
      or lower(account.account_number) like query_pattern escape '\'
      or lower(account.external_client_id) like query_pattern escape '\'
    )
  order by account.last_activity_at desc nulls last, account.registered_at desc nulls last, account.id
  limit result_limit offset result_offset;
end;
$$;

revoke all on function public.search_exness_agency_clients(uuid, text, text, integer, integer)
  from public, anon;
grant execute on function public.search_exness_agency_clients(uuid, text, text, integer, integer)
  to authenticated;

create or replace function private.ensure_whales_zone_indicator_workflow(
  target_event_id uuid,
  target_organization_id uuid,
  target_contact_id uuid,
  contact_full_name text,
  target_activation_owner_id uuid,
  target_sales_owner_id uuid,
  target_sales_delay_hours smallint,
  workflow_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched_sales_task_id uuid;
  matched_activation_task_id uuid;
  claimed_event_id uuid;
begin
  if exists (
    select 1 from public.crm_indicator_workflows workflow
    where workflow.intake_event_id = target_event_id
  ) then
    return;
  end if;

  if exists (
    select 1 from public.crm_contacts contact
    where contact.id = target_contact_id
      and (contact.stage = 'do_not_contact' or contact.consent_status = 'denied')
  ) then
    insert into public.audit_events (
      organization_id, actor_id, action, entity_type, entity_id, after_data
    ) values (
      target_organization_id, workflow_actor_id, 'crm.indicator_intake_skipped_do_not_contact',
      'crm_contact', target_contact_id, jsonb_build_object('intake_event_id', target_event_id)
    );
    return;
  end if;

  select task.id into matched_sales_task_id
  from public.tasks task
  where task.crm_contact_id = target_contact_id
    and task.crm_work_kind = 'follow_up'
    and task.status not in ('done', 'cancelled')
  order by task.created_at desc, task.id
  limit 1;

  select task.id into matched_activation_task_id
  from public.tasks task
  where task.crm_contact_id = target_contact_id
    and task.crm_work_kind = 'indicator_activation'
    and task.status not in ('done', 'cancelled')
  order by task.created_at desc, task.id
  limit 1;

  if (matched_sales_task_id is not null and exists (
      select 1 from public.crm_indicator_workflows workflow where workflow.sales_task_id = matched_sales_task_id
    )) or (matched_activation_task_id is not null and exists (
      select 1 from public.crm_indicator_workflows workflow where workflow.activation_task_id = matched_activation_task_id
    )) then
    update public.crm_contacts contact
    set owner_id = target_sales_owner_id,
        stage = case
          when contact.stage in ('won', 'lost') then 'follow_up'::public.crm_lead_stage
          else contact.stage
        end,
        next_follow_up_at = least(
          coalesce(contact.next_follow_up_at, now() + make_interval(hours => target_sales_delay_hours)),
          now() + make_interval(hours => target_sales_delay_hours)
        ),
        follow_up_required = true,
        closure_reason = null,
        converted_at = null,
        updated_at = now(),
        version = version + 1
    where contact.id = target_contact_id;

    insert into public.audit_events (
      organization_id, actor_id, action, entity_type, entity_id, after_data
    ) values (
      target_organization_id, workflow_actor_id, 'crm.indicator_intake_merged_into_open_work',
      'crm_contact', target_contact_id, jsonb_build_object('intake_event_id', target_event_id)
    );
    return;
  end if;

  perform set_config('request.jwt.claim.sub', workflow_actor_id::text, true);
  perform set_config('app.crm_contact_id', target_contact_id::text, true);

  if matched_sales_task_id is null then
    insert into public.tasks (
      organization_id, title, description, status, priority,
      owner_id, created_by, acceptance_criteria, due_at,
      crm_contact_id, crm_work_kind
    ) values (
      target_organization_id,
      'متابعة سيلز — ' || trim(contact_full_name),
      'تواصل مع العميل بعد تفعيل المؤشر، وسجّل نتيجة التواصل والموعد التالي داخل ملفه.',
      'ready', 'high', target_sales_owner_id, workflow_actor_id,
      'نتيجة التواصل مسجلة في ملف العميل مع المرحلة والموعد التالي أو سبب الإغلاق.',
      now() + make_interval(hours => target_sales_delay_hours),
      target_contact_id, 'follow_up'
    ) returning id into matched_sales_task_id;
  else
    update public.tasks task
    set title = 'متابعة سيلز — ' || trim(contact_full_name),
        description = 'تواصل مع العميل بعد تفعيل المؤشر، وسجّل نتيجة التواصل والموعد التالي داخل ملفه.',
        owner_id = target_sales_owner_id,
        priority = 'high',
        acceptance_criteria = 'نتيجة التواصل مسجلة في ملف العميل مع المرحلة والموعد التالي أو سبب الإغلاق.',
        due_at = now() + make_interval(hours => target_sales_delay_hours)
    where task.id = matched_sales_task_id;
  end if;

  if matched_activation_task_id is null then
    insert into public.tasks (
      organization_id, title, description, status, priority,
      owner_id, created_by, acceptance_criteria, due_at,
      crm_contact_id, crm_work_kind
    ) values (
      target_organization_id,
      'عملية تفعيل المؤشر — ' || trim(contact_full_name),
      'افتح ملف العميل، راجع حساب TradingView، ونفّذ تفعيل Whales Zone فورًا ثم سجّل النتيجة.',
      'ready', 'urgent', target_activation_owner_id, workflow_actor_id,
      'تم التحقق من حساب TradingView وتسجيل نجاح التفعيل أو سبب التعذر داخل ملف العميل.',
      now() + interval '1 hour',
      target_contact_id, 'indicator_activation'
    ) returning id into matched_activation_task_id;
  end if;

  insert into public.crm_indicator_workflows (
    intake_event_id, organization_id, contact_id,
    activation_owner_id, sales_owner_id, activation_task_id, sales_task_id
  ) values (
    target_event_id, target_organization_id, target_contact_id,
    target_activation_owner_id, target_sales_owner_id, matched_activation_task_id, matched_sales_task_id
  )
  on conflict (intake_event_id) do nothing
  returning intake_event_id into claimed_event_id;

  if claimed_event_id is null then return; end if;

  update public.crm_contacts contact
  set owner_id = target_sales_owner_id,
      stage = case when contact.stage = 'do_not_contact' then contact.stage else 'follow_up'::public.crm_lead_stage end,
      next_follow_up_at = now() + make_interval(hours => target_sales_delay_hours),
      follow_up_required = true,
      closure_reason = null,
      converted_at = null,
      updated_at = now(),
      version = version + 1
  where contact.id = target_contact_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id, workflow_actor_id,
    'crm.indicator_workflow_created', 'crm_contact', target_contact_id,
    jsonb_build_object(
      'intake_event_id', target_event_id,
      'activation_task_id', matched_activation_task_id,
      'activation_owner_id', target_activation_owner_id,
      'sales_task_id', matched_sales_task_id,
      'sales_owner_id', target_sales_owner_id,
      'sales_follow_up_delay_hours', target_sales_delay_hours
    )
  );
end;
$$;

revoke all on function private.ensure_whales_zone_indicator_workflow(
  uuid, uuid, uuid, text, uuid, uuid, smallint, uuid
) from public, anon, authenticated;

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
  workflow_actor_id uuid;
  routed_sales_owner_id uuid := intake_owner_id;
  fallback_sales_owner_id uuid;
  activation_owner_id uuid;
  sales_delay_hours smallint := 24;
  intake_result record;
begin
  select organization.id into target_organization_id
  from public.organizations organization
  where organization.slug = 'market-whales'
  limit 1;

  if target_organization_id is null then
    raise exception 'Market Whales organization is not configured';
  end if;

  select membership.user_id into workflow_actor_id
  from public.memberships membership
  where membership.organization_id = target_organization_id
    and membership.status = 'active'
    and membership.role = 'owner'
  order by membership.created_at, membership.user_id
  limit 1;

  if intake_owner_id is null then
    select settings.activation_owner_id, settings.sales_owner_id, settings.sales_follow_up_delay_hours
    into activation_owner_id, fallback_sales_owner_id, sales_delay_hours
    from public.crm_indicator_workflow_settings settings
    where settings.organization_id = target_organization_id;
  end if;

  if intake_source_system = 'whales_zone_form' and intake_owner_id is null then
    routed_sales_owner_id := private.pick_crm_lead_route(target_organization_id);
  end if;
  routed_sales_owner_id := coalesce(routed_sales_owner_id, fallback_sales_owner_id, workflow_actor_id);
  activation_owner_id := coalesce(activation_owner_id, workflow_actor_id);

  select intake.*
  into intake_result
  from public.ingest_whales_zone_lead_unrouted(
    intake_source_system, intake_external_id, contact_full_name, contact_email,
    contact_tradingview, contact_whatsapp, routed_sales_owner_id,
    intake_registered_at, intake_payload_hash, intake_request_fingerprint
  ) intake;

  if intake_source_system = 'whales_zone_form'
    and intake_result.outcome in ('created', 'deduplicated')
    and intake_result.contact_id is not null then
    perform private.ensure_whales_zone_indicator_workflow(
      intake_result.event_id, target_organization_id, intake_result.contact_id,
      contact_full_name, activation_owner_id, routed_sales_owner_id,
      sales_delay_hours, workflow_actor_id
    );
  end if;

  return query select
    intake_result.event_id::uuid,
    intake_result.contact_id::uuid,
    intake_result.outcome::text,
    intake_result.should_mirror::boolean,
    intake_result.sheet_mirror_status::text;
end;
$$;

do $$
declare
  orphan record;
  workflow_actor_id uuid;
  activation_owner_id uuid;
  fallback_sales_owner_id uuid;
  sales_delay_hours smallint := 24;
begin
  select membership.user_id into workflow_actor_id
  from public.memberships membership
  where membership.status = 'active' and membership.role = 'owner'
  order by membership.created_at, membership.user_id
  limit 1;

  for orphan in
    select event.id as event_id, event.organization_id, event.contact_id,
      contact.full_name, contact.owner_id
    from public.crm_lead_intake_events event
    join public.crm_contacts contact on contact.id = event.contact_id
    where event.source_system = 'whales_zone_form'
      and event.outcome = 'deduplicated'
      and event.created_at >= '2026-08-23'::timestamptz
      and not exists (
        select 1 from public.crm_indicator_workflows workflow
        where workflow.intake_event_id = event.id
      )
  loop
    select settings.activation_owner_id, settings.sales_owner_id, settings.sales_follow_up_delay_hours
    into activation_owner_id, fallback_sales_owner_id, sales_delay_hours
    from public.crm_indicator_workflow_settings settings
    where settings.organization_id = orphan.organization_id;

    perform private.ensure_whales_zone_indicator_workflow(
      orphan.event_id, orphan.organization_id, orphan.contact_id, orphan.full_name,
      coalesce(activation_owner_id, workflow_actor_id),
      coalesce(orphan.owner_id, fallback_sales_owner_id, workflow_actor_id),
      coalesce(sales_delay_hours, 24::smallint), workflow_actor_id
    );
  end loop;
end
$$;

comment on column public.crm_contacts.trading_experience is
  'Whether the lead is new to trading, experienced, or not yet classified.';
comment on function public.search_crm_contacts_v7(
  uuid, text, uuid, public.crm_lead_stage, public.crm_source,
  public.crm_interest, text, text, text, text, text, integer, integer
) is 'CRM directory search with priority scoring and a strict indicator-versus-other segment.';
comment on function public.search_exness_agency_clients(uuid, text, text, integer, integer) is
  'Sanitized Exness agency account list for active CRM staff; excludes lots, commission, and partner financial fields.';
