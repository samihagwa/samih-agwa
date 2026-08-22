-- The original import policies called a general private helper whose EXECUTE
-- privilege is intentionally revoked from authenticated users. Give the policy
-- one narrow internal predicate instead of widening the general helper.

create or replace function private.can_manage_crm_imports(
  target_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and membership.role in ('owner', 'admin')
      and (
        membership.role = 'owner'
        or membership.allowed_sections && array['crm']::text[]
      )
  );
$$;

revoke all on function private.can_manage_crm_imports(uuid) from public, anon, authenticated;
grant execute on function private.can_manage_crm_imports(uuid) to authenticated;

drop policy if exists "crm_import_batches_leadership_select" on public.crm_import_batches;
create policy "crm_import_batches_leadership_select"
on public.crm_import_batches for select to authenticated
using ((select private.can_manage_crm_imports(organization_id)));

drop policy if exists "crm_import_rows_leadership_select" on public.crm_import_rows;
create policy "crm_import_rows_leadership_select"
on public.crm_import_rows for select to authenticated
using ((select private.can_manage_crm_imports(organization_id)));

comment on function private.can_manage_crm_imports(uuid) is
  'Narrow RLS predicate for owner/admin CRM import audit reads; it exposes no row data.';
