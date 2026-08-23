-- Split every new Whales Zone registration into two accountable work items:
-- immediate indicator activation and a separately owned sales follow-up.
-- The intake event is the idempotency key, so retries never duplicate either task.

alter table public.tasks
  add column crm_work_kind text;

-- This is a one-time schema classification, not an operational task edit. Avoid
-- emitting historical notifications/events or invoking the authenticated task
-- command guard while the existing rows are labelled.
alter table public.tasks disable trigger user;

update public.tasks
set crm_work_kind = 'follow_up'
where crm_contact_id is not null
  and crm_work_kind is null;

alter table public.tasks enable trigger user;

alter table public.tasks
  add constraint tasks_crm_work_kind_check check (
    (crm_contact_id is null and crm_work_kind is null)
    or (
      crm_contact_id is not null
      and crm_work_kind in ('follow_up', 'indicator_activation')
    )
  );

drop index if exists public.tasks_one_open_crm_follow_up_idx;
create unique index tasks_one_open_crm_work_kind_idx
  on public.tasks (crm_contact_id, crm_work_kind)
  where crm_contact_id is not null
    and crm_work_kind is not null
    and status not in ('done', 'cancelled');

create index tasks_crm_work_kind_owner_due_idx
  on public.tasks (crm_work_kind, owner_id, due_at, id)
  where crm_contact_id is not null and status not in ('done', 'cancelled');

create or replace function private.enforce_crm_task_kind()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and new.crm_work_kind is distinct from old.crm_work_kind then
    raise exception 'CRM task purpose is immutable';
  end if;

  if new.crm_contact_id is null then
    if new.crm_work_kind is not null then
      raise exception 'CRM task purpose requires a CRM contact';
    end if;
  elsif new.crm_work_kind is null then
    new.crm_work_kind := 'follow_up';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_crm_task_kind()
from public, anon, authenticated;

create trigger tasks_05_enforce_crm_work_kind
before insert or update of crm_contact_id, crm_work_kind on public.tasks
for each row execute function private.enforce_crm_task_kind();

create table public.crm_indicator_workflow_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  activation_owner_id uuid not null references public.profiles (id) on delete restrict,
  sales_owner_id uuid not null references public.profiles (id) on delete restrict,
  sales_follow_up_delay_hours smallint not null default 24,
  updated_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_indicator_sales_delay_check check (
    sales_follow_up_delay_hours between 1 and 168
  )
);

create table public.crm_indicator_workflows (
  intake_event_id uuid primary key references public.crm_lead_intake_events (id) on delete restrict,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contact_id uuid not null references public.crm_contacts (id) on delete restrict,
  activation_owner_id uuid not null references public.profiles (id) on delete restrict,
  sales_owner_id uuid not null references public.profiles (id) on delete restrict,
  activation_task_id uuid unique references public.tasks (id) on delete restrict,
  sales_task_id uuid unique references public.tasks (id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint crm_indicator_workflow_contact_org_fkey
    foreign key (contact_id, organization_id)
    references public.crm_contacts (id, organization_id)
    on delete restrict
);

create index crm_indicator_workflows_contact_idx
  on public.crm_indicator_workflows (contact_id, created_at desc);

alter table public.crm_indicator_workflow_settings enable row level security;
alter table public.crm_indicator_workflows enable row level security;

revoke all on table public.crm_indicator_workflow_settings from public, anon, authenticated;
revoke all on table public.crm_indicator_workflows from public, anon, authenticated;
grant select, insert, update, delete on table public.crm_indicator_workflow_settings to service_role;
grant select, insert, update, delete on table public.crm_indicator_workflows to service_role;

insert into public.crm_indicator_workflow_settings (
  organization_id, activation_owner_id, sales_owner_id, updated_by
)
select organization.id, owner_membership.user_id, owner_membership.user_id, owner_membership.user_id
from public.organizations organization
join lateral (
  select membership.user_id
  from public.memberships membership
  where membership.organization_id = organization.id
    and membership.status = 'active'
    and membership.role = 'owner'
  order by membership.created_at, membership.user_id
  limit 1
) owner_membership on true
on conflict (organization_id) do nothing;

create or replace function public.get_crm_indicator_workflow_settings(
  target_user_id uuid,
  target_organization_id uuid
)
returns table (
  user_id uuid,
  full_name text,
  email text,
  role public.app_role,
  is_activation_owner boolean,
  is_sales_owner boolean,
  sales_follow_up_delay_hours smallint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_org_owner_or_admin_actor(target_user_id, target_organization_id)
    or not private.actor_can_access_any_section(
      target_user_id, target_organization_id, array['crm']::text[]
    ) then
    raise exception 'Only CRM platform leadership can view indicator routing';
  end if;

  return query
  select
    membership.user_id,
    coalesce(nullif(trim(profile.full_name), ''), auth_user.email, 'عضو فريق') as full_name,
    auth_user.email::text,
    membership.role,
    settings.activation_owner_id = membership.user_id,
    settings.sales_owner_id = membership.user_id,
    settings.sales_follow_up_delay_hours
  from public.memberships membership
  join public.profiles profile on profile.id = membership.user_id
  join auth.users auth_user on auth_user.id = membership.user_id
  join public.crm_indicator_workflow_settings settings
    on settings.organization_id = membership.organization_id
  where membership.organization_id = target_organization_id
    and membership.status = 'active'
    and membership.role <> 'viewer'
  order by membership.created_at, membership.user_id;
end;
$$;

create or replace function public.save_crm_indicator_workflow_settings(
  target_user_id uuid,
  target_organization_id uuid,
  target_activation_owner_id uuid,
  target_sales_owner_id uuid,
  target_sales_follow_up_delay_hours smallint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_org_owner_or_admin_actor(target_user_id, target_organization_id)
    or not private.actor_can_access_any_section(
      target_user_id, target_organization_id, array['crm']::text[]
    ) then
    raise exception 'Only CRM platform leadership can change indicator routing';
  end if;

  if target_sales_follow_up_delay_hours not between 1 and 168 then
    raise exception 'Sales follow-up delay must be between one hour and seven days';
  end if;

  if exists (
    select 1
    from unnest(array[target_activation_owner_id, target_sales_owner_id]) selected_user_id
    where selected_user_id is null
      or not exists (
        select 1
        from public.memberships membership
        where membership.organization_id = target_organization_id
          and membership.user_id = selected_user_id
          and membership.status = 'active'
          and membership.role <> 'viewer'
      )
  ) then
    raise exception 'Indicator and sales owners must be active working members';
  end if;

  insert into public.crm_indicator_workflow_settings (
    organization_id, activation_owner_id, sales_owner_id,
    sales_follow_up_delay_hours, updated_by
  ) values (
    target_organization_id, target_activation_owner_id, target_sales_owner_id,
    target_sales_follow_up_delay_hours, target_user_id
  )
  on conflict (organization_id) do update
  set activation_owner_id = excluded.activation_owner_id,
      sales_owner_id = excluded.sales_owner_id,
      sales_follow_up_delay_hours = excluded.sales_follow_up_delay_hours,
      updated_by = excluded.updated_by,
      updated_at = now();

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id, target_user_id, 'crm.indicator_routing_updated',
    'organization', target_organization_id,
    jsonb_build_object(
      'activation_owner_id', target_activation_owner_id,
      'sales_owner_id', target_sales_owner_id,
      'sales_follow_up_delay_hours', target_sales_follow_up_delay_hours
    )
  );

  return true;
end;
$$;

revoke all on function public.get_crm_indicator_workflow_settings(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.save_crm_indicator_workflow_settings(
  uuid, uuid, uuid, uuid, smallint
) from public, anon, authenticated;
grant execute on function public.get_crm_indicator_workflow_settings(uuid, uuid)
to service_role;
grant execute on function public.save_crm_indicator_workflow_settings(
  uuid, uuid, uuid, uuid, smallint
) to service_role;

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
  activation_owner_id uuid;
  sales_delay_hours smallint := 24;
  intake_result record;
  claimed_event_id uuid;
  existing_sales_task_id uuid;
  created_activation_task_id uuid;
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
    select
      settings.activation_owner_id,
      settings.sales_owner_id,
      settings.sales_follow_up_delay_hours
    into activation_owner_id, routed_sales_owner_id, sales_delay_hours
    from public.crm_indicator_workflow_settings settings
    where settings.organization_id = target_organization_id;
  end if;

  if intake_source_system = 'whales_zone_form' and routed_sales_owner_id is null then
    routed_sales_owner_id := private.pick_crm_lead_route(target_organization_id);
  end if;
  routed_sales_owner_id := coalesce(routed_sales_owner_id, workflow_actor_id);
  activation_owner_id := coalesce(activation_owner_id, workflow_actor_id);

  select intake.*
  into intake_result
  from public.ingest_whales_zone_lead_unrouted(
    intake_source_system,
    intake_external_id,
    contact_full_name,
    contact_email,
    contact_tradingview,
    contact_whatsapp,
    routed_sales_owner_id,
    intake_registered_at,
    intake_payload_hash,
    intake_request_fingerprint
  ) intake;

  if intake_source_system = 'whales_zone_form'
    and intake_result.outcome = 'created'
    and intake_result.contact_id is not null then

    select task.id into existing_sales_task_id
    from public.tasks task
    where task.crm_contact_id = intake_result.contact_id
      and task.crm_work_kind = 'follow_up'
      and task.status not in ('done', 'cancelled')
    order by task.created_at desc, task.id
    limit 1;

    if existing_sales_task_id is null then
      raise exception 'The sales follow-up task was not created with the CRM contact';
    end if;

    insert into public.crm_indicator_workflows (
      intake_event_id, organization_id, contact_id,
      activation_owner_id, sales_owner_id
    ) values (
      intake_result.event_id, target_organization_id, intake_result.contact_id,
      activation_owner_id, routed_sales_owner_id
    )
    on conflict (intake_event_id) do nothing
    returning intake_event_id into claimed_event_id;

    if claimed_event_id is not null then
      perform set_config('request.jwt.claim.sub', workflow_actor_id::text, true);
      perform set_config('app.crm_contact_id', intake_result.contact_id::text, true);

      update public.tasks task
      set title = 'متابعة سيلز — ' || trim(contact_full_name),
          description = 'تواصل مع العميل بعد تفعيل المؤشر، وسجّل نتيجة التواصل والموعد التالي داخل ملفه.',
          owner_id = routed_sales_owner_id,
          priority = 'high',
          acceptance_criteria = 'نتيجة التواصل مسجلة في ملف العميل مع المرحلة والموعد التالي أو سبب الإغلاق.',
          due_at = now() + make_interval(hours => sales_delay_hours)
      where task.id = existing_sales_task_id;

      update public.crm_contacts contact
      set owner_id = routed_sales_owner_id,
          next_follow_up_at = now() + make_interval(hours => sales_delay_hours),
          follow_up_required = true,
          updated_at = now(),
          version = version + 1
      where contact.id = intake_result.contact_id;

      insert into public.tasks (
        organization_id, title, description, status, priority,
        owner_id, created_by, acceptance_criteria, due_at,
        crm_contact_id, crm_work_kind
      ) values (
        target_organization_id,
        'عملية تفعيل المؤشر — ' || trim(contact_full_name),
        'افتح ملف العميل، راجع حساب TradingView، ونفّذ تفعيل Whales Zone فورًا ثم سجّل النتيجة.',
        'ready',
        'urgent',
        activation_owner_id,
        workflow_actor_id,
        'تم التحقق من حساب TradingView وتسجيل نجاح التفعيل أو سبب التعذر داخل ملف العميل.',
        now() + interval '1 hour',
        intake_result.contact_id,
        'indicator_activation'
      ) returning id into created_activation_task_id;

      update public.crm_indicator_workflows workflow
      set activation_task_id = created_activation_task_id,
          sales_task_id = existing_sales_task_id
      where workflow.intake_event_id = intake_result.event_id;

      insert into public.audit_events (
        organization_id, actor_id, action, entity_type, entity_id, after_data
      ) values (
        target_organization_id, workflow_actor_id,
        'crm.indicator_workflow_created', 'crm_contact', intake_result.contact_id,
        jsonb_build_object(
          'intake_event_id', intake_result.event_id,
          'activation_task_id', created_activation_task_id,
          'activation_owner_id', activation_owner_id,
          'sales_task_id', existing_sales_task_id,
          'sales_owner_id', routed_sales_owner_id,
          'sales_follow_up_delay_hours', sales_delay_hours
        )
      );
    end if;
  end if;

  return query select
    intake_result.event_id::uuid,
    intake_result.contact_id::uuid,
    intake_result.outcome::text,
    intake_result.should_mirror::boolean,
    intake_result.sheet_mirror_status::text;
end;
$$;

revoke all on function public.ingest_whales_zone_lead(
  text, text, text, text, text, text, uuid, timestamptz, text, text
) from public, anon, authenticated;
grant execute on function public.ingest_whales_zone_lead(
  text, text, text, text, text, text, uuid, timestamptz, text, text
) to service_role;

comment on column public.tasks.crm_work_kind is
  'Distinguishes sales follow-up work from indicator activation for the same CRM contact.';
comment on table public.crm_indicator_workflow_settings is
  'Owner-controlled Whales Zone activation owner, sales owner, and follow-up delay.';
comment on table public.crm_indicator_workflows is
  'Idempotent link from one live intake event to its separate activation and sales tasks.';
