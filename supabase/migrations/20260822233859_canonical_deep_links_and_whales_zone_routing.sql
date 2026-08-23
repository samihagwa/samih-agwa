-- Canonical deep links and Whales Zone lead routing.
--
-- Invariants:
-- 1. Every notification points at the exact entity it names.
-- 2. Historical Whales Zone imports create CRM records without follow-up tasks.
-- 3. New Whales Zone registrations can be distributed only to explicitly
--    selected active members, with the organization owner as a safe fallback.

create table public.crm_lead_routing_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  position smallint not null,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id),
  constraint crm_lead_routing_members_position_positive check (position between 1 and 20)
);

create unique index crm_lead_routing_members_org_position_idx
  on public.crm_lead_routing_members (organization_id, position);

-- Historical contacts are valid CRM records, but they have already been handled
-- and therefore must not pretend to need a future follow-up.
alter table public.crm_contacts
  add column follow_up_required boolean not null default true;

alter table public.crm_contacts
  drop constraint crm_contacts_follow_up_contract;

alter table public.crm_contacts
  add constraint crm_contacts_follow_up_contract check (
    (
      stage in ('new', 'contacted', 'qualified', 'follow_up')
      and (
        (follow_up_required and next_follow_up_at is not null)
        or (not follow_up_required and next_follow_up_at is null)
      )
    )
    or (
      stage in ('won', 'lost', 'do_not_contact')
      and next_follow_up_at is null
    )
  );

alter table public.crm_lead_routing_members enable row level security;
revoke all on table public.crm_lead_routing_members from public, anon, authenticated;
grant select, insert, update, delete on table public.crm_lead_routing_members to service_role;

create or replace function private.pick_crm_lead_route(
  target_organization_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select route.user_id
  from public.crm_lead_routing_members route
  join public.memberships membership
    on membership.organization_id = route.organization_id
   and membership.user_id = route.user_id
   and membership.status = 'active'
   and membership.role <> 'viewer'
  where route.organization_id = target_organization_id
  order by (
    select count(*)
    from public.crm_lead_intake_events intake
    join public.crm_contacts contact on contact.id = intake.contact_id
    where intake.organization_id = route.organization_id
      and intake.source_system = 'whales_zone_form'
      and intake.outcome = 'created'
      and contact.owner_id = route.user_id
  ), route.position, route.user_id
  limit 1;
$$;

revoke all on function private.pick_crm_lead_route(uuid)
from public, anon, authenticated;

create or replace function public.get_crm_lead_routing(
  target_user_id uuid,
  target_organization_id uuid
)
returns table (
  user_id uuid,
  full_name text,
  email text,
  role public.app_role,
  selected boolean,
  route_position smallint,
  assigned_live_leads bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_org_owner_or_admin_actor(target_user_id, target_organization_id)
    or not private.actor_can_access_any_section(
      target_user_id,
      target_organization_id,
      array['crm']::text[]
    ) then
    raise exception 'Only CRM platform leadership can view lead routing';
  end if;

  return query
  select
    membership.user_id,
    coalesce(nullif(trim(profile.full_name), ''), auth_user.email, 'عضو فريق') as full_name,
    auth_user.email::text,
    membership.role,
    route.user_id is not null as selected,
    route.position,
    (
      select count(*)
      from public.crm_lead_intake_events intake
      join public.crm_contacts contact on contact.id = intake.contact_id
      where intake.organization_id = target_organization_id
        and intake.source_system = 'whales_zone_form'
        and intake.outcome = 'created'
        and contact.owner_id = membership.user_id
    ) as assigned_live_leads
  from public.memberships membership
  join public.profiles profile on profile.id = membership.user_id
  join auth.users auth_user on auth_user.id = membership.user_id
  left join public.crm_lead_routing_members route
    on route.organization_id = membership.organization_id
   and route.user_id = membership.user_id
  where membership.organization_id = target_organization_id
    and membership.status = 'active'
    and membership.role <> 'viewer'
  order by route.position nulls last, membership.created_at, membership.user_id;
end;
$$;

create or replace function public.save_crm_lead_routing(
  target_user_id uuid,
  target_organization_id uuid,
  route_user_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_user_ids uuid[] := coalesce(route_user_ids, '{}'::uuid[]);
  selected_count integer := cardinality(coalesce(route_user_ids, '{}'::uuid[]));
begin
  if not private.is_org_owner_or_admin_actor(target_user_id, target_organization_id)
    or not private.actor_can_access_any_section(
      target_user_id,
      target_organization_id,
      array['crm']::text[]
    ) then
    raise exception 'Only CRM platform leadership can change lead routing';
  end if;

  if selected_count > 20 then
    raise exception 'Choose no more than twenty lead recipients';
  end if;

  if selected_count <> (
    select count(distinct selected_user_id)
    from unnest(clean_user_ids) selected_user_id
  ) then
    raise exception 'Lead recipients must be unique';
  end if;

  if exists (
    select 1
    from unnest(clean_user_ids) selected_user_id
    where not exists (
      select 1
      from public.memberships membership
      where membership.organization_id = target_organization_id
        and membership.user_id = selected_user_id
        and membership.status = 'active'
        and membership.role <> 'viewer'
    )
  ) then
    raise exception 'Every lead recipient must be an active working member';
  end if;

  delete from public.crm_lead_routing_members route
  where route.organization_id = target_organization_id;

  insert into public.crm_lead_routing_members (
    organization_id, user_id, position, created_by
  )
  select
    target_organization_id,
    selected.user_id,
    selected.ordinality::smallint,
    target_user_id
  from unnest(clean_user_ids) with ordinality selected(user_id, ordinality);

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id,
    target_user_id,
    'crm.lead_routing_updated',
    'organization',
    target_organization_id,
    jsonb_build_object('recipient_user_ids', to_jsonb(clean_user_ids), 'count', selected_count)
  );

  return selected_count;
end;
$$;

revoke all on function public.get_crm_lead_routing(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.save_crm_lead_routing(uuid, uuid, uuid[])
from public, anon, authenticated;
grant execute on function public.get_crm_lead_routing(uuid, uuid) to service_role;
grant execute on function public.save_crm_lead_routing(uuid, uuid, uuid[]) to service_role;

-- Preserve the already deployed intake implementation as the low-level,
-- idempotent operation, then wrap it with deterministic lead routing.
alter function public.ingest_whales_zone_lead(
  text, text, text, text, text, text, uuid, timestamptz, text, text
) rename to ingest_whales_zone_lead_unrouted;

revoke all on function public.ingest_whales_zone_lead_unrouted(
  text, text, text, text, text, text, uuid, timestamptz, text, text
) from public, anon, authenticated, service_role;

create function public.ingest_whales_zone_lead(
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
  routed_owner_id uuid := intake_owner_id;
begin
  if intake_source_system = 'whales_zone_form' and routed_owner_id is null then
    select organization.id into target_organization_id
    from public.organizations organization
    where organization.slug = 'market-whales'
    limit 1;

    routed_owner_id := private.pick_crm_lead_route(target_organization_id);
  end if;

  return query
  select intake.*
  from public.ingest_whales_zone_lead_unrouted(
    intake_source_system,
    intake_external_id,
    contact_full_name,
    contact_email,
    contact_tradingview,
    contact_whatsapp,
    routed_owner_id,
    intake_registered_at,
    intake_payload_hash,
    intake_request_fingerprint
  ) intake;
end;
$$;

revoke all on function public.ingest_whales_zone_lead(
  text, text, text, text, text, text, uuid, timestamptz, text, text
) from public, anon, authenticated;
grant execute on function public.ingest_whales_zone_lead(
  text, text, text, text, text, text, uuid, timestamptz, text, text
) to service_role;

create or replace function private.remove_historical_whales_zone_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  historical_task_ids uuid[];
  audit_actor uuid;
begin
  if new.source_system <> 'google_sheet_whales_zone'
    or new.outcome <> 'created'
    or new.contact_id is null then
    return new;
  end if;

  select array_agg(task.id) into historical_task_ids
  from public.tasks task
  where task.crm_contact_id = new.contact_id;

  if coalesce(cardinality(historical_task_ids), 0) > 0 then
    delete from public.notifications notification
    where notification.entity_type = 'task'
      and notification.entity_id = any(historical_task_ids);

    delete from public.task_events event
    where event.task_id = any(historical_task_ids);

    delete from public.tasks task
    where task.id = any(historical_task_ids);
  end if;

  update public.crm_contacts contact
  set follow_up_required = false,
      next_follow_up_at = null,
      updated_at = now()
  where contact.id = new.contact_id;

  update public.crm_activities activity
  set summary = 'تم استرداد ملف التسجيل التاريخي بدون إنشاء مهمة متابعة جديدة.',
      next_follow_up_at = null
  where activity.contact_id = new.contact_id
    and activity.kind = 'created';

  select membership.user_id into audit_actor
  from public.memberships membership
  where membership.organization_id = new.organization_id
    and membership.status = 'active'
    and membership.role = 'owner'
  order by membership.created_at, membership.user_id
  limit 1;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    new.organization_id,
    audit_actor,
    'crm.historical_contact_imported_without_task',
    'crm_contact',
    new.contact_id,
    jsonb_build_object('intake_event_id', new.id, 'removed_task_count', coalesce(cardinality(historical_task_ids), 0))
  );

  return new;
end;
$$;

create trigger crm_lead_intake_events_remove_historical_task
after insert on public.crm_lead_intake_events
for each row execute function private.remove_historical_whales_zone_task();

revoke all on function private.remove_historical_whales_zone_task()
from public, anon, authenticated;

-- Remove the 115 untouched follow-up tasks that were generated for the first
-- historical sheet import. Contacts and intake/audit records remain intact.
with historical_task_ids as (
  select distinct task.id
  from public.crm_lead_intake_events intake
  join public.tasks task on task.crm_contact_id = intake.contact_id
  where intake.source_system = 'google_sheet_whales_zone'
    and intake.outcome = 'created'
    and task.version = 1
)
delete from public.notifications notification
using historical_task_ids historical
where notification.entity_type = 'task'
  and notification.entity_id = historical.id;

with historical_task_ids as (
  select distinct task.id
  from public.crm_lead_intake_events intake
  join public.tasks task on task.crm_contact_id = intake.contact_id
  where intake.source_system = 'google_sheet_whales_zone'
    and intake.outcome = 'created'
    and task.version = 1
)
delete from public.task_events event
using historical_task_ids historical
where event.task_id = historical.id;

with historical_task_ids as (
  select distinct task.id
  from public.crm_lead_intake_events intake
  join public.tasks task on task.crm_contact_id = intake.contact_id
  where intake.source_system = 'google_sheet_whales_zone'
    and intake.outcome = 'created'
    and task.version = 1
)
delete from public.tasks task
using historical_task_ids historical
where task.id = historical.id;

update public.crm_contacts contact
set follow_up_required = false,
    next_follow_up_at = null,
    updated_at = now()
where contact.id in (
  select distinct intake.contact_id
  from public.crm_lead_intake_events intake
  where intake.source_system = 'google_sheet_whales_zone'
    and intake.outcome = 'created'
    and intake.contact_id is not null
);

update public.crm_activities activity
set summary = 'تم استرداد ملف التسجيل التاريخي بدون إنشاء مهمة متابعة جديدة.',
    next_follow_up_at = null
where activity.kind = 'created'
  and activity.contact_id in (
    select distinct intake.contact_id
    from public.crm_lead_intake_events intake
    where intake.source_system = 'google_sheet_whales_zone'
      and intake.outcome = 'created'
      and intake.contact_id is not null
  );

insert into public.audit_events (
  organization_id, actor_id, action, entity_type, after_data
)
select
  organization.id,
  owner_membership.user_id,
  'crm.historical_follow_up_tasks_removed',
  'crm_import',
  jsonb_build_object(
    'source_system', 'google_sheet_whales_zone',
    'reason', 'Historical registrations were already contacted and must not create tasks.'
  )
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
where organization.slug = 'market-whales';

create or replace function private.canonicalize_notification_url()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  related_id uuid;
begin
  if new.entity_id is null then
    return new;
  end if;

  case new.entity_type
    when 'task' then
      new.url := '/tasks?task=' || new.entity_id || '#task-' || new.entity_id;
    when 'crm_contact' then
      new.url := '/crm?contact=' || new.entity_id || '#crm-' || new.entity_id;
    when 'content_item' then
      new.url := '/content?content=' || new.entity_id || '#content-' || new.entity_id;
    when 'content_revision' then
      select revision.content_item_id into related_id
      from public.content_revision_requests revision
      where revision.id = new.entity_id;
      if related_id is not null then
        new.url := '/content?content=' || related_id || '&revision=' || new.entity_id || '#revision-' || new.entity_id;
      end if;
    when 'script' then
      new.url := '/scripts/' || new.entity_id;
    when 'script_research' then
      new.url := '/scripts?tab=radar&research=' || new.entity_id || '#research-' || new.entity_id;
    when 'publishing_occurrence' then
      new.url := '/publishing?occurrence=' || new.entity_id || '#occurrence-' || new.entity_id;
    when 'launch' then
      new.url := '/campaigns?launch=' || new.entity_id || '#launch-' || new.entity_id;
    when 'launch_deliverable' then
      new.url := '/campaigns?deliverable=' || new.entity_id || '#deliverable-' || new.entity_id;
    when 'membership' then
      select membership.user_id into related_id
      from public.memberships membership
      where membership.id = new.entity_id;
      related_id := coalesce(related_id, new.entity_id);
      new.url := '/team?member=' || related_id || '#member-' || related_id;
    else
      null;
  end case;

  return new;
end;
$$;

create trigger notifications_canonical_entity_url
before insert or update of entity_type, entity_id, url on public.notifications
for each row execute function private.canonicalize_notification_url();

revoke all on function private.canonicalize_notification_url()
from public, anon, authenticated;

-- Backfill every existing notification through the canonicalizer.
update public.notifications notification set url = notification.url;

comment on table public.crm_lead_routing_members is
  'Owner-controlled recipients for new Whales Zone registrations. The intake path assigns the least-loaded selected member.';
comment on function public.get_crm_lead_routing(uuid, uuid) is
  'Service-only owner/admin view of eligible lead recipients, including their login email.';
comment on function public.save_crm_lead_routing(uuid, uuid, uuid[]) is
  'Service-only replacement of the ordered Whales Zone lead recipient list with audit logging.';
comment on function public.ingest_whales_zone_lead(
  text, text, text, text, text, text, uuid, timestamptz, text, text
) is 'Routes a live Whales Zone registration to an explicitly selected active member, then performs the durable idempotent intake.';
