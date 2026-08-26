-- RLS policies execute as the authenticated caller, so the boolean policy
-- helper needs execute permission. It exposes no rows or mutation surface.
grant execute on function private.is_org_planning_leadership(uuid) to authenticated;

