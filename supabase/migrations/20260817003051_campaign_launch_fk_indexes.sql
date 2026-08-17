-- Cover the composite foreign keys in their declared column order. These indexes
-- protect parent updates/deletes from full child-table scans as launch data grows.

create index launch_content_items_launch_org_fk_idx
  on public.launch_content_items (launch_id, organization_id);

create index launch_content_items_content_org_fk_idx
  on public.launch_content_items (content_item_id, organization_id);

create index tasks_launch_org_fk_idx
  on public.tasks (launch_id, organization_id)
  where launch_id is not null;
