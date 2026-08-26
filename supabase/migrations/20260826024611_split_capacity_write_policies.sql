-- Keep one permissive SELECT policy and use action-specific write policies so
-- Postgres does not evaluate two permissive policies for every calendar read.

drop policy if exists "team_capacity_settings_write_leadership"
  on public.team_capacity_settings;

create policy "team_capacity_settings_insert_leadership"
on public.team_capacity_settings for insert to authenticated
with check (private.is_org_planning_leadership(organization_id));

create policy "team_capacity_settings_update_leadership"
on public.team_capacity_settings for update to authenticated
using (private.is_org_planning_leadership(organization_id))
with check (private.is_org_planning_leadership(organization_id));

