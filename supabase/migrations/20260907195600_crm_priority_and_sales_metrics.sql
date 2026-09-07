create or replace function public.search_crm_contacts_v6(
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
            and contact.follow_up_required
            and contact.next_follow_up_at < now() then 45
          when contact.stage in ('new', 'contacted', 'qualified', 'follow_up')
            and contact.follow_up_required
            and (contact.next_follow_up_at at time zone 'Africa/Cairo')::date
              = (now() at time zone 'Africa/Cairo')::date then 30
          else 0
        end
        + case contact.stage
            when 'qualified' then 30
            when 'follow_up' then 18
            when 'new' then 14
            when 'contacted' then 10
            else 0
          end
        + case coalesce(profile.lead_temperature, 'cold')
            when 'hot' then 25
            when 'warm' then 12
            else 0
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
          and contact.follow_up_required
          and contact.next_follow_up_at < now() then 'متابعة متأخرة'
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
          and contact.follow_up_required
          and contact.next_follow_up_at < now()
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

revoke all on function public.search_crm_contacts_v6(
  uuid, text, uuid, public.crm_lead_stage, public.crm_source,
  public.crm_interest, text, text, text, text, integer, integer
) from public, anon;
grant execute on function public.search_crm_contacts_v6(
  uuid, text, uuid, public.crm_lead_stage, public.crm_source,
  public.crm_interest, text, text, text, text, integer, integer
) to authenticated;

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

create index if not exists crm_activities_first_response_idx
  on public.crm_activities (organization_id, contact_id, actor_id, occurred_at)
  where kind <> 'created';

comment on function public.search_crm_contacts_v6(
  uuid, text, uuid, public.crm_lead_stage, public.crm_source,
  public.crm_interest, text, text, text, text, integer, integer
) is 'Permission-aware CRM directory search with deterministic contact-priority scoring.';
comment on function public.get_crm_owner_performance_v2(uuid, integer)
is 'CRM leadership metrics for explicitly selected Sales members, including first-response speed.';
