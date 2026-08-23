create index crm_lead_routing_members_user_idx
  on public.crm_lead_routing_members (user_id, organization_id);

create index crm_lead_routing_members_created_by_idx
  on public.crm_lead_routing_members (created_by, organization_id);
