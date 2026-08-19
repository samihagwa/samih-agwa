create index content_step_deliveries_content_org_fk_idx
  on public.content_step_deliveries (content_item_id, organization_id);

create index content_step_deliveries_task_identity_fk_idx
  on public.content_step_deliveries (task_id, organization_id, content_item_id, step);

create index launch_content_items_deliverable_org_fk_idx
  on public.launch_content_items (launch_deliverable_id, launch_id, organization_id)
  where launch_deliverable_id is not null;
