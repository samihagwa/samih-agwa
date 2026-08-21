-- Cover every new foreign-key path before the calendar grows. Index order
-- intentionally matches the referencing columns reported by the advisor.
create index if not exists content_plans_creator_idx
  on public.content_plans (created_by);

create index if not exists content_plans_updater_idx
  on public.content_plans (updated_by);

create index if not exists content_plan_pillars_plan_org_idx
  on public.content_plan_pillars (plan_id, organization_id);

create index if not exists content_plan_pillars_creator_idx
  on public.content_plan_pillars (created_by);

create index if not exists content_plan_pillars_updater_idx
  on public.content_plan_pillars (updated_by);

create index if not exists content_plan_items_plan_org_idx
  on public.content_plan_items (plan_id, organization_id);

create index if not exists content_plan_items_pillar_org_idx
  on public.content_plan_items (pillar_id, organization_id)
  where pillar_id is not null;

create index if not exists content_plan_items_creator_idx
  on public.content_plan_items (created_by);

create index if not exists content_plan_items_updater_idx
  on public.content_plan_items (updated_by);
