create index crm_sales_profiles_contact_org_fk_idx
  on public.crm_sales_profiles (contact_id, organization_id);

create index crm_sales_profiles_created_by_idx
  on public.crm_sales_profiles (created_by);

create index crm_sales_profiles_updated_by_idx
  on public.crm_sales_profiles (updated_by);
