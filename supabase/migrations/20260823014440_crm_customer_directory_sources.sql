-- A read-only customer directory needs precise acquisition-source filters
-- without changing the existing follow-up board contract.

alter type public.crm_source add value if not exists 'market_whales_dashboard';
alter type public.crm_source add value if not exists 'harmonic_book';
alter type public.crm_source add value if not exists 'facebook';
alter type public.crm_source add value if not exists 'whatsapp';
alter type public.crm_source add value if not exists 'email';

create or replace function public.search_crm_contacts_v3(
  target_organization_id uuid,
  search_query text,
  target_owner_id uuid,
  target_stage public.crm_lead_stage,
  target_source public.crm_source,
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
  if target_scope not in ('all', 'mine', 'overdue') then
    raise exception 'CRM search scope is invalid';
  end if;
  if target_view not in ('all', 'current', 'archive') then
    raise exception 'CRM directory view is invalid';
  end if;
  if clean_query is not null and char_length(clean_query) < 2 then
    raise exception 'CRM search needs at least two characters';
  end if;
  if result_limit not between 1 and 100 or result_offset not between 0 and 1000000 then
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
    and (
      target_scope = 'all'
      or (target_scope = 'mine' and contact.owner_id = (select auth.uid()))
      or (
        target_scope = 'overdue'
        and contact.stage in ('new', 'contacted', 'qualified', 'follow_up')
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

revoke all on function public.search_crm_contacts_v3(
  uuid, text, uuid, public.crm_lead_stage, public.crm_source, text, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.search_crm_contacts_v3(
  uuid, text, uuid, public.crm_lead_stage, public.crm_source, text, text, integer, integer
) to authenticated;

comment on function public.search_crm_contacts_v3(
  uuid, text, uuid, public.crm_lead_stage, public.crm_source, text, text, integer, integer
) is 'Permission-scoped CRM directory search across all stages with acquisition-source filtering.';
