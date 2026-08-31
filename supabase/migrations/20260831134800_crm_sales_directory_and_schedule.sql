-- CRM sales ownership is an explicit roster, not every active team member.
-- This migration also adds compact directory filtering and a read-only monthly
-- projection for weekly task routines without materializing a month of tasks.

create index if not exists crm_contacts_org_interest_registered_idx
  on public.crm_contacts (
    organization_id,
    interest,
    coalesce(source_registered_at, created_at) desc,
    id
  );

-- Only explicitly eligible CRM + Tasks members may be selected for live lead
-- routing. These checks are enforced in the database, not merely in the UI.
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
   and (
     membership.role = 'owner'
     or (
       'crm' = any(membership.allowed_sections)
       and 'tasks' = any(membership.allowed_sections)
     )
   )
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
      target_user_id, target_organization_id, array['crm']::text[]
    ) then
    raise exception 'Only CRM platform leadership can view lead routing';
  end if;

  return query
  select
    membership.user_id,
    coalesce(nullif(trim(profile.full_name), ''), auth_user.email, 'عضو فريق') as full_name,
    auth_user.email::text,
    membership.role,
    route.user_id is not null,
    route.position,
    (
      select count(*)
      from public.crm_lead_intake_events intake
      join public.crm_contacts contact on contact.id = intake.contact_id
      where intake.organization_id = target_organization_id
        and intake.source_system = 'whales_zone_form'
        and intake.outcome = 'created'
        and contact.owner_id = membership.user_id
    )
  from public.memberships membership
  join public.profiles profile on profile.id = membership.user_id
  join auth.users auth_user on auth_user.id = membership.user_id
  left join public.crm_lead_routing_members route
    on route.organization_id = membership.organization_id
   and route.user_id = membership.user_id
  where membership.organization_id = target_organization_id
    and membership.status = 'active'
    and membership.role <> 'viewer'
    and (
      membership.role = 'owner'
      or (
        'crm' = any(membership.allowed_sections)
        and 'tasks' = any(membership.allowed_sections)
      )
    )
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
      target_user_id, target_organization_id, array['crm']::text[]
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
        and (
          membership.role = 'owner'
          or (
            'crm' = any(membership.allowed_sections)
            and 'tasks' = any(membership.allowed_sections)
          )
        )
    )
  ) then
    raise exception 'Every Sales recipient must have active CRM and Tasks access';
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

-- Save the Sales roster and the indicator fallback settings in one database
-- transaction. If either validation fails, neither half is persisted.
create or replace function public.save_crm_sales_setup(
  target_user_id uuid,
  target_organization_id uuid,
  route_user_ids uuid[],
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
  perform public.save_crm_lead_routing(
    target_user_id, target_organization_id, route_user_ids
  );
  perform public.save_crm_indicator_workflow_settings(
    target_user_id,
    target_organization_id,
    target_activation_owner_id,
    target_sales_owner_id,
    target_sales_follow_up_delay_hours
  );
  return true;
end;
$$;

revoke all on function public.save_crm_sales_setup(
  uuid, uuid, uuid[], uuid, uuid, smallint
) from public, anon, authenticated;
grant execute on function public.save_crm_sales_setup(
  uuid, uuid, uuid[], uuid, uuid, smallint
) to service_role;

create or replace function public.search_crm_contacts_v4(
  target_organization_id uuid,
  search_query text,
  target_owner_id uuid,
  target_stage public.crm_lead_stage,
  target_source public.crm_source,
  target_interest public.crm_interest,
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
  if target_scope is null or target_scope not in ('all', 'mine', 'overdue') then
    raise exception 'CRM search scope is invalid';
  end if;
  if target_view is null or target_view not in ('all', 'current', 'archive') then
    raise exception 'CRM directory view is invalid';
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
  select contact.id, count(*) over () as total_count
  from public.crm_contacts contact
  where contact.organization_id = target_organization_id
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
        and contact.follow_up_required
        and contact.next_follow_up_at < now()
      )
    )
    and (
      clean_query is null
      or lower(
        coalesce(contact.full_name, '') || ' ' ||
        coalesce(contact.notes, '') || ' ' ||
        contact.source::text || ' ' ||
        coalesce(contact.source_detail, '') || ' ' ||
        contact.interest::text || ' ' ||
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
  order by coalesce(contact.source_registered_at, contact.created_at) desc, contact.id
  limit result_limit
  offset result_offset;
end;
$$;

revoke all on function public.search_crm_contacts_v4(
  uuid, text, uuid, public.crm_lead_stage, public.crm_source,
  public.crm_interest, text, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.search_crm_contacts_v4(
  uuid, text, uuid, public.crm_lead_stage, public.crm_source,
  public.crm_interest, text, text, integer, integer
) to authenticated;

create or replace function public.get_crm_summary(
  target_organization_id uuid
)
returns table (
  total_contacts bigint,
  active_contacts bigint,
  new_contacts bigint,
  overdue_contacts bigint,
  won_contacts bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if actor is null
    or not private.actor_can_access_any_section(
      actor, target_organization_id, array['crm']::text[]
    ) then
    raise exception 'CRM access is required';
  end if;

  return query
  select
    count(*),
    count(*) filter (where contact.stage in ('new', 'contacted', 'qualified', 'follow_up')),
    count(*) filter (where contact.stage = 'new'),
    count(*) filter (
      where contact.stage in ('new', 'contacted', 'qualified', 'follow_up')
        and contact.follow_up_required
        and contact.next_follow_up_at < now()
    ),
    count(*) filter (where contact.stage = 'won')
  from public.crm_contacts contact
  where contact.organization_id = target_organization_id
    and (
      private.is_org_owner_or_admin_actor(actor, target_organization_id)
      or exists (
        select 1 from public.memberships membership
        where membership.organization_id = target_organization_id
          and membership.user_id = actor
          and membership.status = 'active'
          and membership.role = 'manager'
          and (membership.role = 'owner' or 'crm' = any(membership.allowed_sections))
      )
      or contact.owner_id = actor
    );
end;
$$;

revoke all on function public.get_crm_summary(uuid)
from public, anon, authenticated;
grant execute on function public.get_crm_summary(uuid) to authenticated;

create or replace function public.get_crm_owner_performance(
  target_organization_id uuid,
  target_range_days integer
)
returns table (
  owner_id uuid,
  total_contacts bigint,
  active_contacts bigint,
  new_contacts bigint,
  won_contacts bigint,
  won_in_period bigint,
  lost_contacts bigint,
  overdue_contacts bigint,
  activities_in_period bigint,
  completed_follow_ups bigint,
  on_time_follow_ups bigint,
  last_activity_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  period_start timestamptz;
begin
  if target_range_days is null or target_range_days not between 1 and 365 then
    raise exception 'CRM performance range must be between 1 and 365 days';
  end if;
  if actor is null
    or not private.actor_can_access_any_section(actor, target_organization_id, array['crm']::text[])
    or not exists (
      select 1 from public.memberships membership
      where membership.organization_id = target_organization_id
        and membership.user_id = actor
        and membership.status = 'active'
        and membership.role in ('owner', 'admin', 'manager')
    ) then
    raise exception 'CRM leadership access is required';
  end if;

  period_start := now() - make_interval(days => target_range_days);

  return query
  with sales_team as (
    select route.user_id, route.position
    from public.crm_lead_routing_members route
    join public.memberships membership
      on membership.organization_id = route.organization_id
     and membership.user_id = route.user_id
     and membership.status = 'active'
     and membership.role <> 'viewer'
     and (membership.role = 'owner' or 'crm' = any(membership.allowed_sections))
    where route.organization_id = target_organization_id
  ),
  contact_stats as (
    select
      contact.owner_id,
      count(*) as total_contacts,
      count(*) filter (where contact.stage in ('new', 'contacted', 'qualified', 'follow_up')) as active_contacts,
      count(*) filter (where contact.stage = 'new') as new_contacts,
      count(*) filter (where contact.stage = 'won') as won_contacts,
      count(*) filter (where contact.stage = 'won' and contact.converted_at >= period_start) as won_in_period,
      count(*) filter (where contact.stage = 'lost') as lost_contacts,
      count(*) filter (
        where contact.stage in ('new', 'contacted', 'qualified', 'follow_up')
          and contact.follow_up_required
          and contact.next_follow_up_at < now()
      ) as overdue_contacts
    from public.crm_contacts contact
    where contact.organization_id = target_organization_id
    group by contact.owner_id
  ),
  activity_stats as (
    select
      activity.actor_id as owner_id,
      count(*) filter (where activity.kind <> 'created' and activity.occurred_at >= period_start) as activities_in_period,
      max(activity.occurred_at) filter (where activity.kind <> 'created') as last_activity_at
    from public.crm_activities activity
    where activity.organization_id = target_organization_id
      and activity.actor_id is not null
    group by activity.actor_id
  ),
  task_stats as (
    select
      task.owner_id,
      count(*) filter (where task.status = 'done' and task.completed_at >= period_start) as completed_follow_ups,
      count(*) filter (
        where task.status = 'done'
          and task.completed_at >= period_start
          and task.completed_at <= task.due_at
      ) as on_time_follow_ups
    from public.tasks task
    where task.organization_id = target_organization_id
      and task.crm_contact_id is not null
      and task.crm_work_kind = 'follow_up'
    group by task.owner_id
  )
  select
    sales_team.user_id,
    coalesce(contact_stats.total_contacts, 0),
    coalesce(contact_stats.active_contacts, 0),
    coalesce(contact_stats.new_contacts, 0),
    coalesce(contact_stats.won_contacts, 0),
    coalesce(contact_stats.won_in_period, 0),
    coalesce(contact_stats.lost_contacts, 0),
    coalesce(contact_stats.overdue_contacts, 0),
    coalesce(activity_stats.activities_in_period, 0),
    coalesce(task_stats.completed_follow_ups, 0),
    coalesce(task_stats.on_time_follow_ups, 0),
    activity_stats.last_activity_at
  from sales_team
  left join contact_stats on contact_stats.owner_id = sales_team.user_id
  left join activity_stats on activity_stats.owner_id = sales_team.user_id
  left join task_stats on task_stats.owner_id = sales_team.user_id
  order by coalesce(contact_stats.won_in_period, 0) desc,
    coalesce(activity_stats.activities_in_period, 0) desc,
    sales_team.position;
end;
$$;

revoke all on function public.get_crm_owner_performance(uuid, integer)
from public, anon, authenticated;
grant execute on function public.get_crm_owner_performance(uuid, integer)
to authenticated;

-- Live Whales Zone registrations use the selected Sales roster first. The
-- single workflow setting remains only a safe fallback for an empty roster.
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
          'sales_follow_up_delay_hours', sales_delay_hours,
          'sales_route', case
            when exists (
              select 1 from public.crm_lead_routing_members route
              where route.organization_id = target_organization_id
                and route.user_id = routed_sales_owner_id
            ) then 'selected_roster'
            else 'fallback'
          end
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

create or replace function public.get_recurring_task_schedule(
  target_organization_id uuid,
  range_starts_on date,
  range_ends_on date,
  target_owner_id uuid
)
returns table (
  template_id uuid,
  task_id uuid,
  owner_id uuid,
  title text,
  description text,
  scheduled_at timestamptz,
  status public.task_status,
  priority public.task_priority,
  requires_review boolean,
  materialized boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  actor_role public.app_role;
  can_manage boolean := false;
  effective_owner_id uuid;
begin
  if actor is null then raise exception 'Authentication is required'; end if;
  if range_starts_on is null or range_ends_on is null
    or range_ends_on < range_starts_on
    or range_ends_on - range_starts_on > 62 then
    raise exception 'Task schedule range must be between one and sixty-three days';
  end if;

  select membership.role into actor_role
  from public.memberships membership
  where membership.organization_id = target_organization_id
    and membership.user_id = actor
    and membership.status = 'active'
    and (membership.role = 'owner' or 'tasks' = any(membership.allowed_sections));
  if actor_role is null then raise exception 'Tasks access is required'; end if;

  can_manage := actor_role in ('owner', 'admin', 'manager');
  if not can_manage and target_owner_id is not null and target_owner_id <> actor then
    raise exception 'Members can only inspect their own task schedule';
  end if;
  effective_owner_id := case when can_manage then target_owner_id else actor end;

  return query
  with days as (
    select generated_day::date as local_day
    from generate_series(
      range_starts_on::timestamp,
      range_ends_on::timestamp,
      interval '1 day'
    ) generated_day
  ), projected as (
    select
      template.id as template_id,
      template.owner_id,
      template.title,
      template.description,
      ((days.local_day + template.time_local) at time zone 'Africa/Cairo') as scheduled_at,
      template.priority,
      template.requires_review
    from public.recurring_task_templates template
    join days on extract(isodow from days.local_day)::smallint = template.weekday
    where template.organization_id = target_organization_id
      and template.archived_at is null
      and not template.paused
      and days.local_day >= template.starts_on
      and (template.ends_on is null or days.local_day <= template.ends_on)
      and (effective_owner_id is null or template.owner_id = effective_owner_id)
  )
  select
    projected.template_id,
    task.id,
    projected.owner_id,
    projected.title,
    projected.description,
    coalesce(task.due_at, projected.scheduled_at),
    coalesce(task.status, 'ready'::public.task_status),
    projected.priority,
    projected.requires_review,
    task.id is not null
  from projected
  left join public.tasks task
    on task.organization_id = target_organization_id
   and task.recurring_template_id = projected.template_id
   and task.recurrence_slot_at = projected.scheduled_at
  order by coalesce(task.due_at, projected.scheduled_at), projected.owner_id, projected.template_id;
end;
$$;

revoke all on function public.get_recurring_task_schedule(uuid, date, date, uuid)
from public, anon, authenticated;
grant execute on function public.get_recurring_task_schedule(uuid, date, date, uuid)
to authenticated;

create or replace function public.get_operational_analytics(
  target_organization_id uuid,
  target_range_days integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  period_start timestamptz;
  result jsonb;
begin
  if target_range_days is null or target_range_days not between 1 and 365 then
    raise exception 'Analytics range must be between one and 365 days';
  end if;
  if actor is null
    or not private.actor_can_access_any_section(
      actor, target_organization_id, array['analytics']::text[]
    ) then
    raise exception 'Analytics access is required';
  end if;
  period_start := now() - make_interval(days => target_range_days);

  select jsonb_build_object(
    'range_days', target_range_days,
    'generated_at', now(),
    'tasks', jsonb_build_object(
      'completed', count(*) filter (where task.status = 'done' and task.completed_at >= period_start),
      'completed_on_time', count(*) filter (
        where task.status = 'done' and task.completed_at >= period_start and task.completed_at <= task.due_at
      ),
      'completed_late', count(*) filter (
        where task.status = 'done' and task.completed_at >= period_start and task.completed_at > task.due_at
      ),
      'open_overdue', count(*) filter (
        where task.status not in ('done', 'cancelled') and task.due_at < now()
      )
    )
  ) into result
  from public.tasks task
  where task.organization_id = target_organization_id;

  result := result || jsonb_build_object(
    'content', (
      select jsonb_build_object(
        'published', count(*) filter (
          where item.status = 'published' and item.published_at >= period_start
        ),
        'in_production', count(*) filter (
          where item.status not in ('published', 'cancelled')
        )
      )
      from public.content_items item
      where item.organization_id = target_organization_id
    ),
    'telegram', (
      select jsonb_build_object(
        'published', count(*) filter (
          where publication.status = 'published' and publication.published_at >= period_start
        ),
        'failed', count(*) filter (
          where publication.status = 'failed' and publication.updated_at >= period_start
        ),
        'unknown', count(*) filter (
          where publication.status = 'unknown' and publication.updated_at >= period_start
        )
      )
      from public.publishing_publication_logs publication
      where publication.organization_id = target_organization_id
    ),
    'crm', (
      select jsonb_build_object(
        'active', count(*) filter (
          where contact.stage in ('new', 'contacted', 'qualified', 'follow_up')
        ),
        'new', count(*) filter (where contact.stage = 'new'),
        'won', count(*) filter (
          where contact.stage = 'won' and contact.converted_at >= period_start
        ),
        'follow_up_overdue', count(*) filter (
          where contact.stage in ('new', 'contacted', 'qualified', 'follow_up')
            and contact.follow_up_required
            and contact.next_follow_up_at < now()
        )
      )
      from public.crm_contacts contact
      where contact.organization_id = target_organization_id
    )
  );

  return result;
end;
$$;

revoke all on function public.get_operational_analytics(uuid, integer)
from public, anon, authenticated;
grant execute on function public.get_operational_analytics(uuid, integer)
to authenticated;

comment on function public.search_crm_contacts_v4(
  uuid, text, uuid, public.crm_lead_stage, public.crm_source,
  public.crm_interest, text, text, integer, integer
) is 'RLS-aware paginated CRM directory search with source and interest filters.';
comment on function public.get_crm_summary(uuid) is
  'Permission-scoped CRM totals independent from the selected sales roster.';
comment on function public.get_crm_owner_performance(uuid, integer) is
  'Evidence-backed performance for explicitly selected CRM sales members only.';
comment on function public.get_recurring_task_schedule(uuid, date, date, uuid) is
  'Read-only Cairo-time projection of recurring weekly tasks for up to sixty-three days.';
comment on function public.get_operational_analytics(uuid, integer) is
  'Honest operational analytics from tasks, content, Telegram publishing, and CRM; no fabricated external metrics.';
