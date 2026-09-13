-- Keep manually created prospects separate from automatic indicator registrations.
-- Creation events are recorded atomically by the existing lead RPCs; the trigger
-- only marks provenance and never changes ownership, stage or financial data.
alter table public.crm_contacts
  add column intake_origin text not null default 'external'
  constraint crm_contacts_intake_origin_valid check (intake_origin in ('manual', 'external'));

update public.crm_contacts contact
set intake_origin = 'manual'
where exists (
  select 1 from public.audit_events event
  where event.entity_type = 'crm_contact'
    and event.entity_id = contact.id
    and event.organization_id = contact.organization_id
    and event.action = 'crm.customer_created'
);

create index crm_contacts_org_origin_stage_idx
  on public.crm_contacts (organization_id, intake_origin, stage, id);

create or replace function private.mark_manual_crm_intake()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.entity_type = 'crm_contact'
    and new.entity_id is not null
    and new.action = 'crm.customer_created' then
    update public.crm_contacts contact
       set intake_origin = 'manual'
     where contact.id = new.entity_id
       and contact.organization_id = new.organization_id
       and contact.created_by = new.actor_id
       and contact.intake_origin <> 'manual';
  end if;
  return new;
end;
$$;

revoke all on function private.mark_manual_crm_intake() from public, anon, authenticated;
create trigger audit_events_mark_manual_crm_intake
  after insert on public.audit_events
  for each row execute function private.mark_manual_crm_intake();

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
  if target_segment is null or target_segment not in ('all', 'manual', 'indicator', 'cashback', 'other') then
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

comment on column public.crm_contacts.intake_origin is 'Manual sales intake versus imported or automated registration; independent of acquisition source and interest.';
comment on function public.search_crm_contacts_v8(
  uuid, text, uuid, public.crm_lead_stage, public.crm_source,
  public.crm_interest, public.crm_trading_experience,
  text, text, text, text, text, integer, integer
) is 'Permission-scoped CRM queues; manual prospects and automatic registrations are disjoint by provenance.';
