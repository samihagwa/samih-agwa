-- Keep the trusted heartbeat contract aligned with the publishing route that
-- was added to the member_presence check constraint earlier.

create or replace function public.record_member_presence(
  target_organization_id uuid,
  target_section text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if actor is null then raise exception 'Authentication is required'; end if;
  if target_section not in (
    'dashboard', 'tasks', 'content', 'publishing', 'brand',
    'campaigns', 'crm', 'analytics', 'team', 'settings'
  ) then
    raise exception 'Unknown workspace section';
  end if;

  insert into public.member_presence (
    organization_id, user_id, current_section, session_started_at, last_seen_at, updated_at
  ) values (
    target_organization_id, actor, target_section, now(), now(), now()
  )
  on conflict (organization_id, user_id) do update
  set current_section = excluded.current_section;
  return true;
end;
$$;

revoke all on function public.record_member_presence(uuid, text) from public, anon, authenticated;
grant execute on function public.record_member_presence(uuid, text) to authenticated;
