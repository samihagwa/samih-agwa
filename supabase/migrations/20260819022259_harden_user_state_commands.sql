create policy "notifications_update_recipient_read_state"
on public.notifications for update to authenticated
using (user_id = (select auth.uid()) and private.is_org_member(organization_id))
with check (user_id = (select auth.uid()) and private.is_org_member(organization_id));

create policy "member_presence_insert_self"
on public.member_presence for insert to authenticated
with check (
  user_id = (select auth.uid())
  and private.is_org_member(organization_id)
);

create policy "member_presence_update_self"
on public.member_presence for update to authenticated
using (user_id = (select auth.uid()) and private.is_org_member(organization_id))
with check (user_id = (select auth.uid()) and private.is_org_member(organization_id));

create or replace function private.enforce_member_presence_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if actor is null then raise exception 'Authentication is required'; end if;
  if not exists (
    select 1 from public.memberships membership
    where membership.organization_id = new.organization_id
      and membership.user_id = actor
      and membership.status = 'active'
  ) then raise exception 'Active organization membership is required'; end if;

  if tg_op = 'INSERT' then
    new.user_id := actor;
    new.session_started_at := now();
  elsif new.organization_id <> old.organization_id or old.user_id <> actor then
    raise exception 'Presence identity is immutable';
  else
    new.user_id := old.user_id;
    new.session_started_at := case
      when old.last_seen_at < now() - interval '30 minutes' then now()
      else old.session_started_at
    end;
  end if;
  new.last_seen_at := now();
  new.updated_at := now();
  return new;
end;
$$;

create trigger member_presence_enforce_write
before insert or update on public.member_presence
for each row execute function private.enforce_member_presence_write();

create or replace function public.mark_notification_read(target_notification_id bigint)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed integer;
begin
  if (select auth.uid()) is null then raise exception 'Authentication is required'; end if;
  update public.notifications notification
  set read_at = coalesce(notification.read_at, now())
  where notification.id = target_notification_id
    and notification.user_id = (select auth.uid());
  get diagnostics changed = row_count;
  return changed > 0;
end;
$$;

create or replace function public.mark_all_notifications_read(target_organization_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed integer;
begin
  if (select auth.uid()) is null then raise exception 'Authentication is required'; end if;
  update public.notifications notification
  set read_at = now()
  where notification.organization_id = target_organization_id
    and notification.user_id = (select auth.uid())
    and notification.read_at is null;
  get diagnostics changed = row_count;
  return changed;
end;
$$;

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
  if target_section not in ('dashboard', 'tasks', 'content', 'brand', 'campaigns', 'crm', 'analytics', 'team', 'settings') then
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

revoke all on table public.notifications from anon, authenticated;
grant select on table public.notifications to authenticated;
grant update (read_at) on table public.notifications to authenticated;

revoke all on table public.member_presence from anon, authenticated;
grant select on table public.member_presence to authenticated;
grant insert (
  organization_id, user_id, current_section, session_started_at, last_seen_at, updated_at
) on table public.member_presence to authenticated;
grant update (
  current_section, session_started_at, last_seen_at, updated_at
) on table public.member_presence to authenticated;

revoke all on function private.enforce_member_presence_write() from public, anon, authenticated;
