-- Preserve the explicit task_priority enum in CRM task inserts.
-- The original migration is also corrected for clean environment rebuilds.

create or replace function public.create_crm_lead(
  target_user_id uuid,
  target_organization_id uuid,
  contact_full_name text,
  contact_source public.crm_source,
  contact_interest public.crm_interest,
  contact_owner_id uuid,
  contact_consent_status public.crm_consent_status,
  identity_kind public.crm_identity_kind,
  identity_value text,
  initial_notes text,
  target_follow_up_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role public.app_role;
  normalized_identity text;
  contact_id uuid;
begin
  if target_user_id is null then
    raise exception 'A verified target user is required';
  end if;

  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  select membership.role
  into actor_role
  from public.memberships membership
  where membership.organization_id = target_organization_id
    and membership.user_id = target_user_id
    and membership.status = 'active';

  if actor_role is null or actor_role = 'viewer' then
    raise exception 'Only an active working member can create CRM leads';
  end if;

  if actor_role not in ('owner', 'admin', 'manager')
    and contact_owner_id <> target_user_id then
    raise exception 'Team members can create CRM leads for themselves only';
  end if;

  if not exists (
    select 1
    from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = contact_owner_id
      and membership.status = 'active'
  ) then
    raise exception 'CRM owner must be an active organization member';
  end if;

  if contact_consent_status = 'denied' then
    raise exception 'A denied contact cannot be created with an active follow-up';
  end if;

  if trim(contact_full_name) is null
    or char_length(trim(contact_full_name)) not between 2 and 160 then
    raise exception 'CRM contact name must contain between 2 and 160 characters';
  end if;

  if target_follow_up_at is null or target_follow_up_at <= now() then
    raise exception 'CRM follow-up time must be in the future';
  end if;

  normalized_identity := private.normalize_crm_identity(identity_kind, identity_value);

  if identity_kind = 'email' and normalized_identity !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Email identity is invalid';
  elsif identity_kind = 'phone' and normalized_identity !~ '^\+?[0-9]{7,16}$' then
    raise exception 'Phone identity is invalid';
  elsif identity_kind = 'telegram' and normalized_identity !~ '^[a-z0-9_]{5,32}$' then
    raise exception 'Telegram username is invalid';
  end if;

  if exists (
    select 1
    from public.crm_identities identity
    where identity.organization_id = target_organization_id
      and identity.kind = identity_kind
      and identity.normalized_value = normalized_identity
  ) then
    raise exception 'This contact identity already belongs to another CRM record';
  end if;

  insert into public.crm_contacts (
    organization_id,
    full_name,
    stage,
    source,
    interest,
    owner_id,
    consent_status,
    next_follow_up_at,
    notes,
    created_by
  ) values (
    target_organization_id,
    trim(contact_full_name),
    'new',
    contact_source,
    contact_interest,
    contact_owner_id,
    contact_consent_status,
    target_follow_up_at,
    nullif(trim(initial_notes), ''),
    target_user_id
  ) returning id into contact_id;

  insert into public.crm_identities (
    organization_id,
    contact_id,
    kind,
    value,
    normalized_value,
    is_primary,
    created_by
  ) values (
    target_organization_id,
    contact_id,
    identity_kind,
    trim(identity_value),
    normalized_identity,
    true,
    target_user_id
  );

  insert into public.crm_activities (
    organization_id,
    contact_id,
    actor_id,
    kind,
    from_stage,
    to_stage,
    summary,
    next_follow_up_at
  ) values (
    target_organization_id,
    contact_id,
    target_user_id,
    'created',
    null,
    'new',
    'تم إنشاء سجل العميل المحتمل وتحديد أول متابعة.',
    target_follow_up_at
  );

  perform set_config('app.crm_contact_id', contact_id::text, true);

  insert into public.tasks (
    organization_id,
    title,
    description,
    status,
    priority,
    owner_id,
    created_by,
    acceptance_criteria,
    due_at,
    crm_contact_id
  ) values (
    target_organization_id,
    'متابعة عميل محتمل',
    'افتح ملف CRM المرتبط وسجّل نتيجة التواصل والموعد التالي.',
    'ready',
    case when target_follow_up_at <= now() + interval '24 hours'
      then 'high'::public.task_priority
      else 'normal'::public.task_priority
    end,
    contact_owner_id,
    target_user_id,
    'نتيجة التواصل مسجلة في CRM مع المرحلة والموعد التالي أو سبب الإغلاق.',
    target_follow_up_at,
    contact_id
  );

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id,
    target_user_id,
    'crm.lead_created',
    'crm_contact',
    contact_id,
    jsonb_build_object(
      'source', contact_source,
      'interest', contact_interest,
      'owner_id', contact_owner_id,
      'identity_kind', identity_kind,
      'follow_up_at', target_follow_up_at
    )
  );

  return contact_id;
end;
$$;

create or replace function public.record_crm_activity(
  target_user_id uuid,
  target_contact_id uuid,
  activity_kind public.crm_activity_kind,
  next_stage public.crm_lead_stage,
  activity_summary text,
  target_next_follow_up_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  contact_record public.crm_contacts%rowtype;
  actor_role public.app_role;
begin
  if target_user_id is null then
    raise exception 'A verified target user is required';
  end if;

  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  select contact.*
  into contact_record
  from public.crm_contacts contact
  where contact.id = target_contact_id
  for update;

  if contact_record.id is null then
    raise exception 'CRM contact was not found';
  end if;

  select membership.role
  into actor_role
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

  if not private.is_valid_crm_transition(contact_record.stage, next_stage) then
    raise exception 'Invalid CRM stage transition from % to %', contact_record.stage, next_stage;
  end if;

  if next_stage in ('new', 'contacted', 'qualified', 'follow_up') then
    if target_next_follow_up_at is null or target_next_follow_up_at <= now() then
      raise exception 'An active CRM lead requires a future follow-up time';
    end if;
  elsif target_next_follow_up_at is not null then
    raise exception 'Closed CRM stages cannot keep an open follow-up time';
  end if;

  perform set_config('app.crm_contact_id', target_contact_id::text, true);

  update public.tasks task
  set status = 'ready'
  where task.crm_contact_id = target_contact_id
    and task.status = 'backlog';

  update public.tasks task
  set status = 'in_progress'
  where task.crm_contact_id = target_contact_id
    and task.status in ('ready', 'blocked');

  update public.tasks task
  set status = 'review'
  where task.crm_contact_id = target_contact_id
    and task.status = 'in_progress';

  update public.tasks task
  set status = 'done'
  where task.crm_contact_id = target_contact_id
    and task.status = 'review';

  update public.crm_contacts contact
  set
    stage = next_stage,
    next_follow_up_at = case
      when next_stage in ('new', 'contacted', 'qualified', 'follow_up') then target_next_follow_up_at
      else null
    end,
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
      else contact.consent_status
    end,
    version = contact.version + 1,
    updated_at = now()
  where contact.id = target_contact_id;

  insert into public.crm_activities (
    organization_id,
    contact_id,
    actor_id,
    kind,
    from_stage,
    to_stage,
    summary,
    next_follow_up_at
  ) values (
    contact_record.organization_id,
    target_contact_id,
    target_user_id,
    activity_kind,
    contact_record.stage,
    next_stage,
    trim(activity_summary),
    case
      when next_stage in ('new', 'contacted', 'qualified', 'follow_up') then target_next_follow_up_at
      else null
    end
  );

  if next_stage in ('new', 'contacted', 'qualified', 'follow_up') then
    insert into public.tasks (
      organization_id,
      title,
      description,
      status,
      priority,
      owner_id,
      created_by,
      acceptance_criteria,
      due_at,
      crm_contact_id
    ) values (
      contact_record.organization_id,
      'متابعة عميل محتمل',
      'افتح ملف CRM المرتبط وسجّل نتيجة التواصل والموعد التالي.',
      'ready',
      case when target_next_follow_up_at <= now() + interval '24 hours'
        then 'high'::public.task_priority
        else 'normal'::public.task_priority
      end,
      contact_record.owner_id,
      target_user_id,
      'نتيجة التواصل مسجلة في CRM مع المرحلة والموعد التالي أو سبب الإغلاق.',
      target_next_follow_up_at,
      target_contact_id
    );
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
      'next_follow_up_at', contact_record.next_follow_up_at,
      'version', contact_record.version
    ),
    jsonb_build_object(
      'stage', next_stage,
      'next_follow_up_at', target_next_follow_up_at,
      'version', contact_record.version + 1,
      'activity_kind', activity_kind
    )
  );

  return true;
end;
$$;

revoke all on function public.create_crm_lead(
  uuid, uuid, text, public.crm_source, public.crm_interest, uuid,
  public.crm_consent_status, public.crm_identity_kind, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.create_crm_lead(
  uuid, uuid, text, public.crm_source, public.crm_interest, uuid,
  public.crm_consent_status, public.crm_identity_kind, text, text, timestamptz
) to service_role;

revoke all on function public.record_crm_activity(
  uuid, uuid, public.crm_activity_kind, public.crm_lead_stage, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.record_crm_activity(
  uuid, uuid, public.crm_activity_kind, public.crm_lead_stage, text, timestamptz
) to service_role;

