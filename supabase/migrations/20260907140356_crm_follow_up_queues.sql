create or replace function public.search_crm_contacts_v5(
  target_organization_id uuid,
  search_query text,
  target_owner_id uuid,
  target_stage public.crm_lead_stage,
  target_source public.crm_source,
  target_interest public.crm_interest,
  target_scope text,
  target_view text,
  target_queue text,
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
  if target_queue is null or target_queue not in (
    'all', 'new', 'today', 'overdue', 'waiting', 'interested', 'converted', 'lost'
  ) then
    raise exception 'CRM follow-up queue is invalid';
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
      or (
        target_queue = 'waiting'
        and contact.stage = 'follow_up'
        and contact.follow_up_required
      )
      or (target_queue = 'interested' and contact.stage in ('follow_up', 'qualified'))
      or (target_queue = 'converted' and contact.stage = 'won')
      or (target_queue = 'lost' and contact.stage in ('lost', 'do_not_contact'))
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
  order by
    case
      when contact.stage in ('new', 'contacted', 'qualified', 'follow_up')
        and contact.follow_up_required
        and contact.next_follow_up_at < now() then 0
      else 1
    end,
    contact.next_follow_up_at asc nulls last,
    coalesce(contact.source_registered_at, contact.created_at) desc,
    contact.id;
end;
$$;

revoke all on function public.search_crm_contacts_v5(
  uuid, text, uuid, public.crm_lead_stage, public.crm_source,
  public.crm_interest, text, text, text, integer, integer
) from public, anon;

grant execute on function public.search_crm_contacts_v5(
  uuid, text, uuid, public.crm_lead_stage, public.crm_source,
  public.crm_interest, text, text, text, integer, integer
) to authenticated;

comment on function public.search_crm_contacts_v5(
  uuid, text, uuid, public.crm_lead_stage, public.crm_source,
  public.crm_interest, text, text, text, integer, integer
) is 'Permission-aware CRM directory search with operational follow-up queues and Cairo-local due-today filtering.';
