create index tasks_source_plan_item_org_fk_idx
  on public.tasks (source_plan_item_id, organization_id)
  where source_plan_item_id is not null;

create index team_capacity_settings_user_idx
  on public.team_capacity_settings (user_id);

create index team_capacity_settings_created_by_idx
  on public.team_capacity_settings (created_by);

create index team_capacity_settings_updated_by_idx
  on public.team_capacity_settings (updated_by);
