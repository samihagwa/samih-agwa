-- Repair the v2 Sales performance query after the initial rollout introduced
-- a duplicate CTE output name. Keep the public signature and permission fence
-- unchanged so existing clients continue to work.

create or replace function public.get_crm_owner_performance_v2(
  target_organization_id uuid,
  target_range_days integer
)
returns table (
  owner_id uuid,
  total_contacts bigint,
  assigned_in_period bigint,
  active_contacts bigint,
  new_contacts bigint,
  won_contacts bigint,
  won_in_period bigint,
  lost_contacts bigint,
  overdue_contacts bigint,
  activities_in_period bigint,
  completed_follow_ups bigint,
  on_time_follow_ups bigint,
  average_first_response_minutes numeric,
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
  ), contact_stats as (
    select contact.owner_id,
      count(*) as total_contacts,
      count(*) filter (where contact.created_at >= period_start) as assigned_in_period,
      count(*) filter (where contact.stage in ('new', 'contacted', 'qualified', 'follow_up')) as active_contacts,
      count(*) filter (where contact.stage = 'new') as new_contacts,
      count(*) filter (where contact.stage = 'won') as won_contacts,
      count(*) filter (where contact.stage = 'won' and contact.converted_at >= period_start) as won_in_period,
      count(*) filter (where contact.stage = 'lost') as lost_contacts,
      count(*) filter (
        where contact.stage in ('new', 'contacted', 'qualified', 'follow_up')
          and contact.follow_up_required and contact.next_follow_up_at < now()
      ) as overdue_contacts
    from public.crm_contacts contact
    where contact.organization_id = target_organization_id
    group by contact.owner_id
  ), activity_stats as (
    select activity.actor_id as owner_id,
      count(*) filter (where activity.kind <> 'created' and activity.occurred_at >= period_start) as activities_in_period,
      max(activity.occurred_at) filter (where activity.kind <> 'created') as last_activity_at
    from public.crm_activities activity
    where activity.organization_id = target_organization_id and activity.actor_id is not null
    group by activity.actor_id
  ), first_response_per_contact as (
    select contact.id, contact.owner_id,
      extract(epoch from (min(activity.occurred_at) - contact.created_at)) / 60.0 as response_minutes
    from public.crm_contacts contact
    join public.crm_activities activity
      on activity.organization_id = contact.organization_id
     and activity.contact_id = contact.id
     and activity.actor_id = contact.owner_id
     and activity.kind <> 'created'
     and activity.occurred_at >= contact.created_at
    where contact.organization_id = target_organization_id
      and contact.created_at >= period_start
    group by contact.id, contact.owner_id, contact.created_at
  ), response_stats as (
    select response.owner_id, round(avg(response.response_minutes), 1) as average_first_response_minutes
    from first_response_per_contact response
    group by response.owner_id
  ), task_stats as (
    select task.owner_id,
      count(*) filter (where task.status = 'done' and task.completed_at >= period_start) as completed_follow_ups,
      count(*) filter (
        where task.status = 'done' and task.completed_at >= period_start and task.completed_at <= task.due_at
      ) as on_time_follow_ups
    from public.tasks task
    where task.organization_id = target_organization_id
      and task.crm_contact_id is not null and task.crm_work_kind = 'follow_up'
    group by task.owner_id
  )
  select sales_team.user_id,
    coalesce(contact_stats.total_contacts, 0),
    coalesce(contact_stats.assigned_in_period, 0),
    coalesce(contact_stats.active_contacts, 0),
    coalesce(contact_stats.new_contacts, 0),
    coalesce(contact_stats.won_contacts, 0),
    coalesce(contact_stats.won_in_period, 0),
    coalesce(contact_stats.lost_contacts, 0),
    coalesce(contact_stats.overdue_contacts, 0),
    coalesce(activity_stats.activities_in_period, 0),
    coalesce(task_stats.completed_follow_ups, 0),
    coalesce(task_stats.on_time_follow_ups, 0),
    response_stats.average_first_response_minutes,
    activity_stats.last_activity_at
  from sales_team
  left join contact_stats on contact_stats.owner_id = sales_team.user_id
  left join activity_stats on activity_stats.owner_id = sales_team.user_id
  left join response_stats on response_stats.owner_id = sales_team.user_id
  left join task_stats on task_stats.owner_id = sales_team.user_id
  order by coalesce(contact_stats.won_in_period, 0) desc,
    coalesce(activity_stats.activities_in_period, 0) desc,
    sales_team.position;
end;
$$;

revoke all on function public.get_crm_owner_performance_v2(uuid, integer)
from public, anon, authenticated;
grant execute on function public.get_crm_owner_performance_v2(uuid, integer)
to authenticated;

comment on function public.get_crm_owner_performance_v2(uuid, integer)
is 'CRM leadership metrics for explicitly selected Sales members, including first-response speed.';
