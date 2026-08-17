-- Cover the composite content/organization foreign key in its declared order.
create index content_brand_references_content_org_fk_idx
  on public.content_brand_references (content_item_id, organization_id);
