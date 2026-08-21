-- Cover every Script Studio foreign-key lookup explicitly. The workspace is
-- expected to grow to a large script and research archive, so deletes and joins
-- must not fall back to full-table scans.

create index scripts_assigned_to_idx on public.scripts (assigned_to);
create index scripts_content_org_fk_idx on public.scripts (content_item_id, organization_id)
  where content_item_id is not null;
create index scripts_handed_off_by_idx on public.scripts (handed_off_by)
  where handed_off_by is not null;
create index scripts_archived_by_idx on public.scripts (archived_by)
  where archived_by is not null;
create index scripts_ai_generated_by_idx on public.scripts (ai_last_generated_by)
  where ai_last_generated_by is not null;

create index script_versions_org_idx on public.script_versions (organization_id);
create index script_versions_script_org_fk_idx on public.script_versions (script_id, organization_id);
create index script_versions_creator_idx on public.script_versions (created_by);

create index script_research_creator_idx on public.script_research_items (created_by);
create index script_research_assigned_to_idx on public.script_research_items (assigned_to);
create index script_research_linked_script_org_idx
  on public.script_research_items (linked_script_id, organization_id)
  where linked_script_id is not null;

create index script_voice_updated_by_idx on public.script_voice_profiles (updated_by);
