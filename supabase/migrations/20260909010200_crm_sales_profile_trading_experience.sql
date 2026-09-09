create or replace function public.save_crm_sales_profile_v2(
  target_user_id uuid,
  target_contact_id uuid,
  expected_profile_version bigint,
  target_lead_temperature text,
  target_preferred_contact_method text,
  target_preferred_contact_time text,
  target_needs text,
  target_objections text,
  target_next_action text,
  target_tags text[],
  target_trading_experience public.crm_trading_experience
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  contact_record public.crm_contacts%rowtype;
begin
  result := public.save_crm_sales_profile(
    target_user_id,
    target_contact_id,
    expected_profile_version,
    target_lead_temperature,
    target_preferred_contact_method,
    target_preferred_contact_time,
    target_needs,
    target_objections,
    target_next_action,
    target_tags
  );

  select contact.* into contact_record
  from public.crm_contacts contact
  where contact.id = target_contact_id
  for update;

  if contact_record.trading_experience is distinct from target_trading_experience then
    update public.crm_contacts contact
    set trading_experience = target_trading_experience,
        version = contact.version + 1,
        updated_at = now()
    where contact.id = target_contact_id;

    insert into public.audit_events (
      organization_id, actor_id, action, entity_type, entity_id, before_data, after_data
    ) values (
      contact_record.organization_id,
      target_user_id,
      'crm.trading_experience_updated',
      'crm_contact',
      target_contact_id,
      jsonb_build_object('trading_experience', contact_record.trading_experience),
      jsonb_build_object('trading_experience', target_trading_experience)
    );
  end if;

  return result || jsonb_build_object('trading_experience', target_trading_experience);
end;
$$;

revoke all on function public.save_crm_sales_profile_v2(
  uuid, uuid, bigint, text, text, text, text, text, text, text[], public.crm_trading_experience
) from public, anon, authenticated;
grant execute on function public.save_crm_sales_profile_v2(
  uuid, uuid, bigint, text, text, text, text, text, text, text[], public.crm_trading_experience
) to service_role;

comment on function public.save_crm_sales_profile_v2(
  uuid, uuid, bigint, text, text, text, text, text, text, text[], public.crm_trading_experience
) is 'Atomically saves the CRM sales summary and the contact trading-experience classification.';
