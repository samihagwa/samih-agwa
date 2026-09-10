-- Sales members may perform an exact, live Exness lookup through the guarded
-- Edge Function. Browsing or enumerating the agency directory remains owner-only.

revoke execute on function public.search_exness_agency_clients(uuid, text, text, integer, integer)
  from authenticated;
grant execute on function public.search_exness_agency_clients(uuid, text, text, integer, integer)
  to service_role;

comment on function public.search_exness_agency_clients(uuid, text, text, integer, integer) is
  'Owner-only agency directory. Sales uses exact live lookup and receives no totals, lots, commissions, or browsable client list.';
