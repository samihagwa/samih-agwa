-- RLS policies call this boolean helper directly. EXECUTE lets Postgres
-- evaluate the policy for authenticated members; the SECURITY DEFINER helper
-- still returns only a boolean and enforces active organization membership.
grant execute on function private.actor_can_access_any_section(uuid, uuid, text[])
to authenticated;
