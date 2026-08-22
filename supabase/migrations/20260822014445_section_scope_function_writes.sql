-- SECURITY DEFINER publishing commands predate per-section access. RLS protects
-- direct table access, while this trigger independently fences every trusted
-- publishing mutation by the caller's current section grant. Service workers
-- have no end-user auth.uid() and retain their existing automation access.

create or replace function private.guard_publishing_section_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
begin
  if (select auth.uid()) is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  target_organization_id := case
    when tg_op = 'DELETE' then old.organization_id
    else new.organization_id
  end;

  if not private.can_access_any_section(
    target_organization_id,
    array['publishing']::text[]
  ) then
    raise exception 'Publishing section access is required';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.guard_publishing_section_write()
from public, anon, authenticated;

create trigger publishing_admin_connections_section_guard
before insert or update or delete on public.publishing_admin_connections
for each row execute function private.guard_publishing_section_write();

create trigger publishing_channels_section_guard
before insert or update or delete on public.publishing_channels
for each row execute function private.guard_publishing_section_write();

create trigger publishing_controls_section_guard
before insert or update or delete on public.publishing_controls
for each row execute function private.guard_publishing_section_write();

create trigger publishing_occurrences_section_guard
before insert or update or delete on public.publishing_occurrences
for each row execute function private.guard_publishing_section_write();

create trigger publishing_posts_section_guard
before insert or update or delete on public.publishing_posts
for each row execute function private.guard_publishing_section_write();

create trigger publishing_publication_logs_section_guard
before insert or update or delete on public.publishing_publication_logs
for each row execute function private.guard_publishing_section_write();

create trigger publishing_schedule_channels_section_guard
before insert or update or delete on public.publishing_schedule_channels
for each row execute function private.guard_publishing_section_write();

create trigger publishing_schedules_section_guard
before insert or update or delete on public.publishing_schedules
for each row execute function private.guard_publishing_section_write();

create trigger publishing_telegram_assets_section_guard
before insert or update or delete on public.publishing_telegram_assets
for each row execute function private.guard_publishing_section_write();

-- Presence is allowed only for a section the active membership can open. This
-- prevents a crafted RPC call from manufacturing activity in a hidden area.
create or replace function public.record_member_presence(
  target_organization_id uuid,
  target_section text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if actor is null then raise exception 'Authentication is required'; end if;
  if target_section not in (
    'dashboard', 'tasks', 'planning', 'content', 'scripts', 'publishing', 'brand',
    'campaigns', 'crm', 'analytics', 'team', 'settings'
  ) then
    raise exception 'Unknown workspace section';
  end if;
  if not private.can_access_any_section(
    target_organization_id,
    array[target_section]::text[]
  ) then
    raise exception 'Workspace section access is required';
  end if;

  insert into public.member_presence (
    organization_id, user_id, current_section, session_started_at, last_seen_at, updated_at
  ) values (
    target_organization_id, actor, target_section, now(), now(), now()
  )
  on conflict (organization_id, user_id) do update
  set current_section = excluded.current_section,
      session_started_at = case
        when public.member_presence.last_seen_at < now() - interval '30 minutes' then now()
        else public.member_presence.session_started_at
      end,
      last_seen_at = now(),
      updated_at = now();
  return true;
end;
$$;

revoke all on function public.record_member_presence(uuid, text)
from public, anon, authenticated;
grant execute on function public.record_member_presence(uuid, text) to authenticated;
