-- These helpers are referenced directly by RLS policies. Authenticated callers
-- need EXECUTE to let Postgres evaluate the boolean policy, while the functions
-- themselves still enforce organization membership and return no table data.
grant execute on function private.can_read_content_actor(uuid, uuid, uuid)
to authenticated;

grant execute on function private.is_org_owner_or_admin_actor(uuid, uuid)
to authenticated;
