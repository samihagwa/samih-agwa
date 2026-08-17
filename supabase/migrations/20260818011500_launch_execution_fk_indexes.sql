-- Cover composite foreign-key column order exactly as reported by the database advisor.

create index launch_documents_launch_org_fk_idx
  on public.launch_documents (launch_id, organization_id);

create index launch_deliverables_launch_org_fk_idx
  on public.launch_deliverables (launch_id, organization_id);

create index launch_deliverable_dependencies_child_org_fk_idx
  on public.launch_deliverable_dependencies (deliverable_id, launch_id, organization_id);

create index launch_deliverable_dependencies_parent_org_fk_idx
  on public.launch_deliverable_dependencies (depends_on_deliverable_id, launch_id, organization_id);

create index tasks_launch_deliverable_org_fk_idx
  on public.tasks (launch_deliverable_id, organization_id)
  where launch_deliverable_id is not null;
