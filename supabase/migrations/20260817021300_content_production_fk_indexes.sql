-- Cover every new foreign key in its declared column order.
create index content_assets_content_org_fk_idx
  on public.content_assets (content_item_id, organization_id);

create index content_revisions_content_org_fk_idx
  on public.content_revision_requests (content_item_id, organization_id);

create index content_revisions_org_idx
  on public.content_revision_requests (organization_id);
