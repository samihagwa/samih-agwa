-- Invite-only authentication and per-section authorization.
-- The browser receives no operational shell until an active membership is
-- confirmed, while RLS remains the final enforcement layer for direct API use.

alter table public.memberships
  add column allowed_sections text[] not null default array['tasks']::text[];

alter table public.team_invitations
  add column allowed_sections text[] not null default array['tasks']::text[];

create or replace function private.valid_workspace_sections(target_sections text[])
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select target_sections is not null
    and cardinality(target_sections) > 0
    and target_sections <@ array[
      'dashboard', 'tasks', 'planning', 'content', 'scripts', 'publishing',
      'brand', 'campaigns', 'crm', 'analytics', 'team', 'settings'
    ]::text[];
$$;

alter table public.memberships
  add constraint memberships_allowed_sections_valid
  check (private.valid_workspace_sections(allowed_sections));

alter table public.team_invitations
  add constraint team_invitations_allowed_sections_valid
  check (private.valid_workspace_sections(allowed_sections));

create or replace function private.enforce_membership_section_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  invited_sections text[];
begin
  if new.role = 'owner' then
    new.allowed_sections := array[
      'dashboard', 'tasks', 'planning', 'content', 'scripts', 'publishing',
      'brand', 'campaigns', 'crm', 'analytics', 'team', 'settings'
    ]::text[];
    return new;
  end if;

  if (tg_op = 'INSERT' or (tg_op = 'UPDATE' and old.status <> 'active' and new.status = 'active')) then
    select invitation.allowed_sections
      into invited_sections
    from public.team_invitations invitation
    join auth.users auth_user
      on lower(auth_user.email) = invitation.email
    where invitation.organization_id = new.organization_id
      and auth_user.id = new.user_id
      and invitation.status = 'pending'
      and invitation.expires_at > now()
    order by invitation.created_at desc
    limit 1;

    if invited_sections is not null then
      new.allowed_sections := invited_sections;
    end if;
  end if;

  if not private.valid_workspace_sections(new.allowed_sections) then
    raise exception 'Choose at least one valid workspace section';
  end if;
  return new;
end;
$$;

create trigger memberships_enforce_section_access
before insert or update of role, status, user_id, organization_id, allowed_sections
on public.memberships
for each row execute function private.enforce_membership_section_access();

update public.memberships membership
set role = 'owner',
    status = 'active',
    allowed_sections = array[
      'dashboard', 'tasks', 'planning', 'content', 'scripts', 'publishing',
      'brand', 'campaigns', 'crm', 'analytics', 'team', 'settings'
    ]::text[]
from auth.users auth_user
where auth_user.id = membership.user_id
  and lower(auth_user.email) = 'samihsmaih1234@gmail.com';

create or replace function private.can_access_any_section(
  target_organization_id uuid,
  target_sections text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and (
        membership.role = 'owner'
        or membership.allowed_sections && target_sections
      )
  );
$$;

create or replace function private.can_access_task_sections(
  target_task_id uuid,
  target_sections text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks task
    where task.id = target_task_id
      and private.can_access_any_section(task.organization_id, target_sections)
  );
$$;

revoke all on function private.valid_workspace_sections(text[]) from public, anon, authenticated;
revoke all on function private.enforce_membership_section_access() from public, anon, authenticated;
revoke all on function private.can_access_any_section(uuid, text[]) from public, anon;
revoke all on function private.can_access_task_sections(uuid, text[]) from public, anon;
grant execute on function private.can_access_any_section(uuid, text[]) to authenticated;
grant execute on function private.can_access_task_sections(uuid, text[]) to authenticated;

-- The login resolver is callable only by the trusted Edge Function. It returns
-- no membership data to anonymous clients.
create or replace function public.resolve_workspace_login(
  target_email text,
  target_token_hash text default null
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(trim(coalesce(target_email, '')));
begin
  if exists (
    select 1
    from auth.users auth_user
    join public.memberships membership on membership.user_id = auth_user.id
    where lower(auth_user.email) = normalized_email
      and membership.status = 'active'
  ) then
    return 'existing';
  end if;

  if target_token_hash is not null and exists (
    select 1
    from public.team_invitations invitation
    where invitation.email = normalized_email
      and invitation.token_hash = target_token_hash
      and invitation.status = 'pending'
      and invitation.expires_at > now()
  ) then
    return 'invitation';
  end if;

  return null;
end;
$$;

revoke all on function public.resolve_workspace_login(text, text)
from public, anon, authenticated;
grant execute on function public.resolve_workspace_login(text, text) to service_role;

-- Auth signup hook: even a direct call to the public Auth endpoint cannot create
-- an account unless the owner already approved that exact email.
create or replace function public.hook_restrict_market_whales_signup(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  signup_email text := lower(trim(coalesce(event -> 'user' ->> 'email', '')));
begin
  if signup_email = 'samihsmaih1234@gmail.com'
    or exists (
      select 1
      from public.team_invitations invitation
      where invitation.email = signup_email
        and invitation.status = 'pending'
        and invitation.expires_at > now()
    ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'هذا البريد غير مضاف إلى فريق Market Whales.'
    )
  );
end;
$$;

revoke all on function public.hook_restrict_market_whales_signup(jsonb)
from public, anon, authenticated;
grant execute on function public.hook_restrict_market_whales_signup(jsonb)
to supabase_auth_admin;

-- Atomic wrappers keep role, status, and visible sections in one audited write.
create or replace function public.create_team_invitation_with_sections(
  target_actor_id uuid,
  target_organization_id uuid,
  target_email text,
  target_full_name text,
  target_role public.app_role,
  target_allowed_sections text[],
  plain_token text,
  target_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation_id uuid;
begin
  if not private.valid_workspace_sections(target_allowed_sections) then
    raise exception 'Choose at least one valid workspace section';
  end if;

  invitation_id := public.create_team_invitation(
    target_actor_id,
    target_organization_id,
    target_email,
    target_full_name,
    target_role,
    plain_token,
    target_expires_at
  );

  update public.team_invitations invitation
  set allowed_sections = target_allowed_sections
  where invitation.id = invitation_id;

  update public.audit_events audit
  set after_data = coalesce(audit.after_data, '{}'::jsonb)
        || jsonb_build_object('allowed_sections', target_allowed_sections)
  where audit.organization_id = target_organization_id
    and audit.entity_type = 'team_invitation'
    and audit.entity_id = invitation_id
    and audit.action = 'team.invitation_created';

  return invitation_id;
end;
$$;

create or replace function public.manage_team_membership_access(
  target_actor_id uuid,
  target_organization_id uuid,
  target_user_id uuid,
  target_role public.app_role,
  target_status public.membership_status,
  target_allowed_sections text[]
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_sections text[];
  membership_id uuid;
begin
  if not private.valid_workspace_sections(target_allowed_sections) then
    raise exception 'Choose at least one valid workspace section';
  end if;

  select membership.id, membership.allowed_sections
    into membership_id, previous_sections
  from public.memberships membership
  where membership.organization_id = target_organization_id
    and membership.user_id = target_user_id;

  perform public.manage_team_membership(
    target_actor_id,
    target_organization_id,
    target_user_id,
    target_role,
    target_status
  );

  update public.memberships membership
  set allowed_sections = target_allowed_sections
  where membership.id = membership_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id,
    before_data, after_data
  ) values (
    target_organization_id, target_actor_id, 'team.sections_updated',
    'membership', membership_id,
    jsonb_build_object('allowed_sections', previous_sections),
    jsonb_build_object('allowed_sections', target_allowed_sections)
  );
  return true;
end;
$$;

revoke all on function public.create_team_invitation_with_sections(
  uuid, uuid, text, text, public.app_role, text[], text, timestamptz
) from public, anon, authenticated;
grant execute on function public.create_team_invitation_with_sections(
  uuid, uuid, text, text, public.app_role, text[], text, timestamptz
) to service_role;

revoke all on function public.manage_team_membership_access(
  uuid, uuid, uuid, public.app_role, public.membership_status, text[]
) from public, anon, authenticated;
grant execute on function public.manage_team_membership_access(
  uuid, uuid, uuid, public.app_role, public.membership_status, text[]
) to service_role;

-- Restrictive policies are ANDed with the existing ownership and role policies.
-- This preserves every current rule and adds an independent section gate.
create policy "section_scope_ai_providers" on public.ai_providers
as restrictive for all to authenticated
using (private.can_access_any_section(organization_id, array['settings']::text[]))
with check (private.can_access_any_section(organization_id, array['settings']::text[]));

create policy "section_scope_audit_events" on public.audit_events
as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['dashboard','team','settings']::text[]));

create policy "section_scope_brand_articles" on public.brand_articles
as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['brand','content']::text[]));

create policy "section_scope_content_assets" on public.content_assets
as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['content']::text[]));

create policy "section_scope_content_brand_references" on public.content_brand_references
as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['content']::text[]));

create policy "section_scope_content_items" on public.content_items
as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['dashboard','planning','content','scripts','publishing','campaigns']::text[]));

create policy "section_scope_content_revisions" on public.content_revision_requests
as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['content']::text[]));

create policy "section_scope_content_deliveries" on public.content_step_deliveries
as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['content']::text[]));

create policy "section_scope_content_timeline" on public.content_timeline_cues
as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['content']::text[]));

create policy "section_scope_content_plans" on public.content_plans
as restrictive for all to authenticated
using (private.can_access_any_section(organization_id, array['dashboard','planning']::text[]))
with check (private.can_access_any_section(organization_id, array['planning']::text[]));

create policy "section_scope_content_plan_pillars" on public.content_plan_pillars
as restrictive for all to authenticated
using (private.can_access_any_section(organization_id, array['planning']::text[]))
with check (private.can_access_any_section(organization_id, array['planning']::text[]));

create policy "section_scope_content_plan_items" on public.content_plan_items
as restrictive for all to authenticated
using (private.can_access_any_section(organization_id, array['dashboard','planning']::text[]))
with check (private.can_access_any_section(organization_id, array['planning']::text[]));

create policy "section_scope_crm_contacts" on public.crm_contacts
as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['dashboard','crm']::text[]));

create policy "section_scope_crm_identities" on public.crm_identities
as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['crm']::text[]));

create policy "section_scope_crm_activities" on public.crm_activities
as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['crm']::text[]));

create policy "section_scope_crm_conversation_links" on public.crm_conversation_links
as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['crm']::text[]));

create policy "section_scope_launches" on public.launches
as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['dashboard','campaigns']::text[]));

create policy "section_scope_launch_content" on public.launch_content_items
as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['campaigns']::text[]));

create policy "section_scope_launch_dependencies" on public.launch_deliverable_dependencies
as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['campaigns']::text[]));

create policy "section_scope_launch_deliverables" on public.launch_deliverables
as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['campaigns']::text[]));

create policy "section_scope_launch_documents" on public.launch_documents
as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['campaigns']::text[]));

create policy "section_scope_publishing_connections" on public.publishing_admin_connections
as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['publishing']::text[]));

create policy "section_scope_publishing_channels" on public.publishing_channels
as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['publishing']::text[]));

create policy "section_scope_publishing_controls" on public.publishing_controls
as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['publishing']::text[]));

create policy "section_scope_publishing_occurrences" on public.publishing_occurrences
as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['publishing']::text[]));

create policy "section_scope_publishing_posts" on public.publishing_posts
as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['publishing']::text[]));

create policy "section_scope_publishing_logs" on public.publishing_publication_logs
as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['publishing']::text[]));

create policy "section_scope_publishing_schedule_channels" on public.publishing_schedule_channels
as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['publishing']::text[]));

create policy "section_scope_publishing_schedules" on public.publishing_schedules
as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['publishing']::text[]));

create policy "section_scope_publishing_assets" on public.publishing_telegram_assets
as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['publishing']::text[]));

create policy "section_scope_scripts" on public.scripts
as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['scripts']::text[]));

create policy "section_scope_script_versions" on public.script_versions
as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['scripts']::text[]));

create policy "section_scope_script_research" on public.script_research_items
as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['scripts']::text[]));

create policy "section_scope_script_voice" on public.script_voice_profiles
as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['scripts']::text[]));

create policy "section_scope_tasks" on public.tasks
as restrictive for all to authenticated
using (private.can_access_any_section(organization_id, array['dashboard','tasks','content','scripts','campaigns','crm']::text[]))
with check (private.can_access_any_section(organization_id, array['tasks','content','scripts','campaigns','crm']::text[]));

create policy "section_scope_task_events" on public.task_events
as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['tasks','content','scripts','campaigns','crm']::text[]));

create policy "section_scope_task_dependencies" on public.task_dependencies
as restrictive for select to authenticated
using (private.can_access_task_sections(task_id, array['tasks','content','scripts','campaigns']::text[]));

alter policy "publishing_media_previews_select_members"
on storage.objects
using (
  bucket_id = 'publishing-media-previews'
  and exists (
    select 1
    from public.publishing_telegram_assets asset
    where asset.preview_object_path = storage.objects.name
      and private.is_org_member(asset.organization_id)
      and private.can_access_any_section(asset.organization_id, array['publishing']::text[])
  )
);

-- A member can always read their own membership so the shell can decide whether
-- to render. Colleague lists require an operational section that actually uses them.
drop policy "memberships_select_colleagues" on public.memberships;
create policy "memberships_select_colleagues"
on public.memberships
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (
    private.can_access_any_section(
      organization_id,
      array['tasks','planning','content','scripts','campaigns','crm','team']::text[]
    )
    and (
      status = 'active'
      or private.has_org_role(
        organization_id,
        array['owner','admin','manager']::public.app_role[]
      )
    )
  )
);

drop policy "profiles_select_self_or_colleague" on public.profiles;
create policy "profiles_select_self_or_colleague"
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or exists (
    select 1
    from public.memberships colleague
    where colleague.user_id = profiles.id
      and colleague.status = 'active'
      and private.can_access_any_section(
        colleague.organization_id,
        array['tasks','planning','content','scripts','campaigns','crm','team']::text[]
      )
  )
);
