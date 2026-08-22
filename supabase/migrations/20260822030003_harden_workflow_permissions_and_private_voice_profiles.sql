-- Least-privilege workflow hardening.
--
-- Managers can still plan work and create workflows, but they may never execute,
-- complete, regenerate, or overwrite another person's assigned work. Owners and
-- admins retain platform-level operational control. Script voice profiles are
-- private per writer instead of being shared across the organization.

create or replace function private.is_org_owner_or_admin_actor(
  target_user_id uuid,
  target_organization_id uuid
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
      and membership.user_id = target_user_id
      and membership.status = 'active'
      and membership.role in ('owner', 'admin')
  );
$$;

revoke all on function private.is_org_owner_or_admin_actor(uuid, uuid)
from public, anon, authenticated;

create or replace function private.actor_can_access_any_section(
  target_user_id uuid,
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
      and membership.user_id = target_user_id
      and membership.status = 'active'
      and (
        membership.role = 'owner'
        or membership.allowed_sections && target_sections
      )
  );
$$;

revoke all on function private.actor_can_access_any_section(uuid, uuid, text[])
from public, anon, authenticated;

-- A Content Factory file is visible only to platform admins, its creator, or a
-- person assigned to one of its execution steps. This prevents a section grant
-- from exposing every script/brief in the organization.
create or replace function private.can_read_content_actor(
  target_user_id uuid,
  target_organization_id uuid,
  target_content_item_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user_id is not null
    and private.actor_can_access_any_section(
      target_user_id,
      target_organization_id,
      array['content', 'campaigns', 'scripts']::text[]
    )
    and (
      private.is_org_owner_or_admin_actor(target_user_id, target_organization_id)
      or exists (
        select 1
        from public.content_items item
        where item.id = target_content_item_id
          and item.organization_id = target_organization_id
          and item.created_by = target_user_id
      )
      or exists (
        select 1
        from public.tasks task
        where task.content_item_id = target_content_item_id
          and task.organization_id = target_organization_id
          and task.owner_id = target_user_id
      )
    );
$$;

revoke all on function private.can_read_content_actor(uuid, uuid, uuid)
from public, anon, authenticated;

drop policy if exists "content_items_select_organization_members" on public.content_items;
create policy "content_items_select_involved_members"
on public.content_items for select to authenticated
using (private.can_read_content_actor((select auth.uid()), organization_id, id));

drop policy if exists "content_assets_select_organization_members" on public.content_assets;
create policy "content_assets_select_involved_members"
on public.content_assets for select to authenticated
using (private.can_read_content_actor((select auth.uid()), organization_id, content_item_id));

drop policy if exists "content_revisions_select_organization_members" on public.content_revision_requests;
create policy "content_revisions_select_involved_members"
on public.content_revision_requests for select to authenticated
using (private.can_read_content_actor((select auth.uid()), organization_id, content_item_id));

drop policy if exists "content_step_deliveries_select_organization_members" on public.content_step_deliveries;
create policy "content_step_deliveries_select_involved_members"
on public.content_step_deliveries for select to authenticated
using (private.can_read_content_actor((select auth.uid()), organization_id, content_item_id));

drop policy if exists "content_timeline_select_organization_members" on public.content_timeline_cues;
create policy "content_timeline_select_involved_members"
on public.content_timeline_cues for select to authenticated
using (private.can_read_content_actor((select auth.uid()), organization_id, content_item_id));

drop policy if exists "content_brand_references_select_organization_members" on public.content_brand_references;
create policy "content_brand_references_select_involved_members"
on public.content_brand_references for select to authenticated
using (private.can_read_content_actor((select auth.uid()), organization_id, content_item_id));

-- Direct task updates are limited to the assignee or a platform owner/admin.
-- Managers retain INSERT so they can plan and assign work.
drop policy if exists "tasks_update_owner_or_leadership" on public.tasks;
create policy "tasks_update_assignee_or_platform_admin"
on public.tasks for update to authenticated
using (
  owner_id = (select auth.uid())
  or private.is_org_owner_or_admin_actor((select auth.uid()), organization_id)
)
with check (
  private.is_org_member(organization_id)
  and (
    owner_id = (select auth.uid())
    or private.is_org_owner_or_admin_actor((select auth.uid()), organization_id)
  )
);

create or replace function private.enforce_task_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  actor_can_plan boolean;
  actor_can_manage_all boolean;
  owner_is_active boolean;
  actor_owns_crm_contact boolean := false;
  publishing_completion boolean := false;
  launch_cancellation_id text := nullif(current_setting('app.cancel_launch_id', true), '');
  crm_command_contact_id text := nullif(current_setting('app.crm_contact_id', true), '');
  compact_workflow_content_id text := nullif(current_setting('app.compact_workflow_content_id', true), '');
  publishing_confirmation_task_id text := nullif(current_setting('app.confirm_content_publishing_task_id', true), '');
  task_belongs_to_cancelled_launch boolean := false;
begin
  if actor is null then
    raise exception 'An authenticated actor is required';
  end if;

  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then
    if launch_cancellation_id is not null and new.status = 'cancelled' then
      new.version := old.version + 1;
      new.updated_at := now();
      new.completed_at := null;
      return new;
    end if;
    if (old.content_item_id is null and old.launch_id is null and old.crm_contact_id is null and old.launch_deliverable_id is null)
      or old.status <> 'backlog'
      or new.status <> 'ready'
      or (to_jsonb(new) - array['status', 'version', 'updated_at']::text[])
        is distinct from
        (to_jsonb(old) - array['status', 'version', 'updated_at']::text[]) then
      raise exception 'Invalid internal task transition';
    end if;
    new.version := old.version + 1;
    new.updated_at := now();
    return new;
  end if;

  select exists (
    select 1 from public.memberships membership
    where membership.organization_id = new.organization_id
      and membership.user_id = actor
      and membership.status = 'active'
      and membership.role in ('owner', 'admin', 'manager')
  ) into actor_can_plan;

  actor_can_manage_all := private.is_org_owner_or_admin_actor(actor, new.organization_id);

  select exists (
    select 1 from public.memberships membership
    where membership.organization_id = new.organization_id
      and membership.user_id = new.owner_id
      and membership.status = 'active'
  ) into owner_is_active;

  if not owner_is_active then
    raise exception 'Task owner must be an active member of the organization';
  end if;

  if new.crm_contact_id is not null then
    select exists (
      select 1 from public.crm_contacts contact
      where contact.id = new.crm_contact_id
        and contact.organization_id = new.organization_id
        and contact.owner_id = actor
    ) into actor_owns_crm_contact;
    if crm_command_contact_id is distinct from new.crm_contact_id::text then
      raise exception 'CRM follow-up tasks are managed through the CRM workflow only';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if not actor_can_plan and not actor_owns_crm_contact then
      raise exception 'Only organization leadership can create tasks, except a CRM owner creating their own follow-up';
    end if;
    if new.status not in ('backlog', 'ready') then
      raise exception 'New tasks must start in backlog or ready';
    end if;
    if new.due_at <= now() then
      raise exception 'New task deadline must be in the future';
    end if;
    new.created_by := actor;
    new.version := 1;
    new.started_at := null;
    new.completed_at := null;
    return new;
  end if;

  if new.organization_id <> old.organization_id
    or new.id <> old.id
    or new.created_by <> old.created_by
    or new.created_at <> old.created_at
    or new.content_item_id is distinct from old.content_item_id
    or new.content_step is distinct from old.content_step
    or new.launch_id is distinct from old.launch_id
    or new.launch_gate is distinct from old.launch_gate
    or new.crm_contact_id is distinct from old.crm_contact_id
    or new.launch_deliverable_id is distinct from old.launch_deliverable_id
    or (
      new.is_work_item is distinct from old.is_work_item
      and compact_workflow_content_id is distinct from new.content_item_id::text
    ) then
    raise exception 'Task identity, organization, and workflow link fields are immutable';
  end if;

  select exists (
    select 1
    from public.launches launch
    where launch.status = 'cancelled'
      and (
        launch.id = old.launch_id
        or exists (
          select 1 from public.launch_deliverables deliverable
          where deliverable.id = old.launch_deliverable_id
            and deliverable.launch_id = launch.id
        )
      )
  ) into task_belongs_to_cancelled_launch;

  if task_belongs_to_cancelled_launch
    and old.status = 'cancelled'
    and new.status <> 'cancelled' then
    raise exception 'A cancelled launch task cannot be reopened';
  end if;

  if launch_cancellation_id is not null and new.status = 'cancelled' then
    if not actor_can_manage_all then
      raise exception 'Only a platform owner or admin can cancel launch tasks';
    end if;
  elsif not actor_can_manage_all then
    if old.owner_id <> actor then
      raise exception 'Only the assigned task owner can execute or update this task';
    end if;
    if new.title is distinct from old.title
      or new.description is distinct from old.description
      or new.priority is distinct from old.priority
      or new.owner_id is distinct from old.owner_id
      or new.acceptance_criteria is distinct from old.acceptance_criteria
      or new.due_at is distinct from old.due_at then
      raise exception 'Task owners may change status only';
    end if;
  end if;

  publishing_completion := old.content_step = 'publishing'
    and old.is_work_item
    and old.status in ('ready', 'in_progress', 'review')
    and new.status = 'done'
    and publishing_confirmation_task_id = new.id::text
    and exists (
      select 1 from public.content_step_deliveries delivery
      where delivery.task_id = new.id
        and delivery.organization_id = new.organization_id
        and delivery.result_url is not null
    );

  if launch_cancellation_id is null
    and not private.is_valid_task_transition(old.status, new.status)
    and not publishing_completion then
    raise exception 'Invalid task status transition from % to %', old.status, new.status;
  end if;
  if old.status <> 'in_progress' and new.status = 'in_progress' and new.started_at is null then
    new.started_at := now();
  end if;
  if new.status = 'done' then
    new.started_at := coalesce(old.started_at, now());
    new.completed_at := coalesce(old.completed_at, now());
  elsif old.status = 'done' or new.status = 'cancelled' then
    new.completed_at := null;
  end if;
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

-- Backstop every service-role content command with row-level action guards.
-- The Edge Functions pass the authenticated actor into auth.uid(); these guards
-- therefore remain effective even if a UI button or command check regresses.
create or replace function private.guard_content_item_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  changed_fields text[] := array(
    select key from jsonb_each(to_jsonb(new)) entry(key, value)
    where value is distinct from (to_jsonb(old) -> key)
  );
  allowed_internal_fields constant text[] := array['status', 'published_at', 'version', 'updated_at'];
  allowed_version_fields constant text[] := array['version', 'updated_at'];
  allowed_caption_fields constant text[] := array['caption_brief', 'version', 'updated_at'];
  allowed_thumbnail_fields constant text[] := array['thumbnail_brief', 'version', 'updated_at'];
begin
  if actor is null then return new; end if;
  if private.is_org_owner_or_admin_actor(actor, new.organization_id)
    or new.created_by = actor then
    return new;
  end if;
  if pg_trigger_depth() > 1 and changed_fields <@ allowed_internal_fields then
    return new;
  end if;
  if changed_fields <@ allowed_version_fields and exists (
    select 1 from public.tasks task
    where task.content_item_id = new.id and task.owner_id = actor
  ) then return new; end if;
  if changed_fields <@ allowed_caption_fields and exists (
    select 1 from public.tasks task
    where task.content_item_id = new.id
      and task.owner_id = actor
      and task.content_step in ('caption', 'publishing')
      and task.status <> 'cancelled'
  ) then return new; end if;
  if changed_fields <@ allowed_thumbnail_fields and exists (
    select 1 from public.tasks task
    where task.content_item_id = new.id
      and task.owner_id = actor
      and task.content_step = 'thumbnail'
      and task.status <> 'cancelled'
  ) then return new; end if;
  raise exception 'You cannot modify this content file';
end;
$$;

create or replace function private.guard_content_asset_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  row_organization_id uuid;
begin
  row_organization_id := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  if actor is null then return case when tg_op = 'DELETE' then old else new end; end if;
  if private.is_org_owner_or_admin_actor(actor, row_organization_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    if old.created_by = actor then return old; end if;
    raise exception 'Only the link creator can remove this content asset';
  end if;
  if exists (
    select 1 from public.content_items item
    where item.id = new.content_item_id and item.created_by = actor
  ) or exists (
    select 1 from public.tasks task
    where task.content_item_id = new.content_item_id and task.owner_id = actor
  ) then return new; end if;
  raise exception 'You cannot add assets to an unrelated content file';
end;
$$;

create or replace function private.guard_content_delivery_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare actor uuid := (select auth.uid());
begin
  if actor is null
    or private.is_org_owner_or_admin_actor(actor, new.organization_id)
    or exists (
      select 1 from public.tasks task
      where task.id = new.task_id
        and task.owner_id = actor
        and task.content_item_id = new.content_item_id
    ) then return new; end if;
  raise exception 'Only the assigned step owner can submit this content result';
end;
$$;

create or replace function private.guard_content_revision_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  row_organization_id uuid;
begin
  row_organization_id := case when tg_op = 'INSERT' then new.organization_id else old.organization_id end;
  if actor is null
    or private.is_org_owner_or_admin_actor(actor, row_organization_id) then return new; end if;
  if tg_op = 'INSERT' then
    if new.requested_by = actor and (
      exists (select 1 from public.content_items item where item.id = new.content_item_id and item.created_by = actor)
      or exists (select 1 from public.tasks task where task.content_item_id = new.content_item_id and task.owner_id = actor)
    ) then return new; end if;
    raise exception 'You cannot request a revision for an unrelated content file';
  end if;
  if new.status in ('in_progress', 'resolved') and old.assigned_to = actor then return new; end if;
  if new.status = 'cancelled' and old.requested_by = actor then return new; end if;
  raise exception 'Only the assigned revision owner can execute this revision';
end;
$$;

create or replace function private.guard_content_timeline_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare actor uuid := (select auth.uid());
begin
  if actor is null
    or private.is_org_owner_or_admin_actor(actor, new.organization_id)
    or exists (
      select 1 from public.tasks task
      where task.content_item_id = new.content_item_id
        and task.content_step = 'editing'
        and task.owner_id = actor
    ) then return new; end if;
  raise exception 'Only the assigned editor can update this timeline';
end;
$$;

revoke all on function private.guard_content_item_write() from public, anon, authenticated;
revoke all on function private.guard_content_asset_write() from public, anon, authenticated;
revoke all on function private.guard_content_delivery_write() from public, anon, authenticated;
revoke all on function private.guard_content_revision_write() from public, anon, authenticated;
revoke all on function private.guard_content_timeline_write() from public, anon, authenticated;

drop trigger if exists content_items_permission_guard on public.content_items;
create trigger content_items_permission_guard
before update on public.content_items
for each row execute function private.guard_content_item_write();

drop trigger if exists content_assets_permission_guard on public.content_assets;
create trigger content_assets_permission_guard
before insert or update or delete on public.content_assets
for each row execute function private.guard_content_asset_write();

drop trigger if exists content_deliveries_permission_guard on public.content_step_deliveries;
create trigger content_deliveries_permission_guard
before insert or update on public.content_step_deliveries
for each row execute function private.guard_content_delivery_write();

drop trigger if exists content_revisions_permission_guard on public.content_revision_requests;
create trigger content_revisions_permission_guard
before insert or update on public.content_revision_requests
for each row execute function private.guard_content_revision_write();

drop trigger if exists content_timeline_permission_guard on public.content_timeline_cues;
create trigger content_timeline_permission_guard
before update on public.content_timeline_cues
for each row execute function private.guard_content_timeline_write();

create or replace function private.can_use_content_ai_actor(
  target_user_id uuid,
  target_content_item_id uuid,
  target_scope text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_scope in ('caption', 'thumbnail') and exists (
    select 1
    from public.content_items item
    join public.memberships membership
      on membership.organization_id = item.organization_id
     and membership.user_id = target_user_id
     and membership.status = 'active'
    where item.id = target_content_item_id
      and item.status not in ('published', 'cancelled')
      and private.actor_can_access_any_section(
        target_user_id,
        item.organization_id,
        array['content', 'campaigns', 'scripts']::text[]
      )
      and (
        membership.role in ('owner', 'admin')
        or exists (
          select 1 from public.tasks task
          where task.content_item_id = item.id
            and task.owner_id = target_user_id
            and task.status <> 'cancelled'
            and (
              (target_scope = 'thumbnail' and task.content_step = 'thumbnail')
              or (target_scope = 'caption' and task.content_step in ('caption', 'publishing'))
            )
        )
      )
  );
$$;

revoke all on function private.can_use_content_ai_actor(uuid, uuid, text)
from public, anon, authenticated;

-- Each writer owns one private voice profile per organization. Existing shared
-- data belongs to the account that last maintained it (the current owner).
alter table public.script_voice_profiles
  add column user_id uuid references public.profiles (id) on delete cascade;

update public.script_voice_profiles profile
set user_id = profile.updated_by
where profile.user_id is null;

alter table public.script_voice_profiles
  alter column user_id set not null;

alter table public.script_voice_profiles
  drop constraint script_voice_profiles_pkey;

alter table public.script_voice_profiles
  add primary key (organization_id, user_id),
  add constraint script_voice_profile_owner_matches_updater
    check (user_id = updated_by);

create index script_voice_profiles_user_updated_idx
  on public.script_voice_profiles (user_id, updated_at desc);

drop policy if exists "script_voice_select_members" on public.script_voice_profiles;
create policy "script_voice_select_self"
on public.script_voice_profiles for select to authenticated
using (user_id = (select auth.uid()));

create or replace function public.save_script_voice_profile(
  target_user_id uuid,
  target_organization_id uuid,
  expected_edit_version bigint,
  profile_voice_summary text,
  profile_writing_rules text[],
  profile_banned_phrases text[],
  profile_story_bank text[],
  profile_approved_examples text,
  profile_source_notes text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare current_version bigint; new_version bigint;
begin
  if not private.is_active_script_actor(target_user_id, target_organization_id)
    or not private.actor_can_access_any_section(
      target_user_id,
      target_organization_id,
      array['scripts']::text[]
    ) then
    raise exception 'Active Scripts access is required';
  end if;

  select edit_version into current_version
  from public.script_voice_profiles
  where organization_id = target_organization_id and user_id = target_user_id
  for update;

  if current_version is null then
    if expected_edit_version <> 0 then raise exception 'Writing voice changed; refresh before saving'; end if;
    insert into public.script_voice_profiles (
      organization_id, user_id, voice_summary, writing_rules, banned_phrases,
      story_bank, approved_examples, source_notes, updated_by
    ) values (
      target_organization_id, target_user_id, coalesce(profile_voice_summary, ''),
      coalesce(profile_writing_rules, '{}'::text[]), coalesce(profile_banned_phrases, '{}'::text[]),
      coalesce(profile_story_bank, '{}'::text[]), coalesce(profile_approved_examples, ''),
      coalesce(profile_source_notes, ''), target_user_id
    ) returning edit_version into new_version;
  else
    if current_version <> expected_edit_version then raise exception 'Writing voice changed; refresh before saving'; end if;
    update public.script_voice_profiles set
      voice_summary = coalesce(profile_voice_summary, ''),
      writing_rules = coalesce(profile_writing_rules, '{}'::text[]),
      banned_phrases = coalesce(profile_banned_phrases, '{}'::text[]),
      story_bank = coalesce(profile_story_bank, '{}'::text[]),
      approved_examples = coalesce(profile_approved_examples, ''),
      source_notes = coalesce(profile_source_notes, ''),
      edit_version = edit_version + 1,
      updated_by = target_user_id
    where organization_id = target_organization_id and user_id = target_user_id
    returning edit_version into new_version;
  end if;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id, target_user_id, 'script_voice.saved',
    'script_voice_profile', target_user_id,
    jsonb_build_object('edit_version', new_version, 'private_profile', true)
  );
  return new_version;
end;
$$;

create or replace function public.approve_script_as_voice_sample(
  target_user_id uuid,
  target_script_id uuid,
  expected_script_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  script_record public.scripts%rowtype;
  profile_record public.script_voice_profiles%rowtype;
  latest_source public.script_version_source;
  sample_marker text;
  sample_block text;
  next_examples text;
  new_profile_version bigint;
begin
  select * into script_record from public.scripts where id = target_script_id for update;
  if script_record.id is null then raise exception 'Script not found'; end if;
  if script_record.assigned_to <> target_user_id
    or not private.is_active_script_actor(target_user_id, script_record.organization_id)
    or not private.actor_can_access_any_section(
      target_user_id,
      script_record.organization_id,
      array['scripts']::text[]
    ) then
    raise exception 'Only the assigned writer can add this script to their private voice profile';
  end if;
  if script_record.edit_version <> expected_script_version then
    raise exception 'Script changed in another session; refresh before approving voice sample';
  end if;
  if char_length(trim(script_record.spoken_script)) < 20 then
    raise exception 'Complete the spoken script before approving a voice sample';
  end if;

  select version.source into latest_source
  from public.script_versions version
  where version.script_id = script_record.id
  order by version.version_number desc, version.created_at desc
  limit 1;
  if latest_source is distinct from 'manual_save'::public.script_version_source then
    raise exception 'Save a manual edit before approving a writing voice sample';
  end if;

  select * into profile_record
  from public.script_voice_profiles
  where organization_id = script_record.organization_id and user_id = target_user_id
  for update;
  if profile_record.user_id is null then raise exception 'Create your private writing voice first'; end if;

  sample_marker := '[عينة معتمدة | script:' || script_record.id::text || ']';
  if position(sample_marker in profile_record.approved_examples) > 0 then
    raise exception 'Script already approved as a writing voice sample';
  end if;
  sample_block := sample_marker || E'\nالعنوان: ' || trim(script_record.title)
    || E'\nالنص:\n' || trim(script_record.spoken_script) || E'\n[نهاية العينة]';
  next_examples := case when trim(profile_record.approved_examples) = '' then sample_block
    else profile_record.approved_examples || E'\n\n---\n\n' || sample_block end;
  if char_length(next_examples) > 30000 then
    raise exception 'Writing voice examples are full; remove an old sample first';
  end if;

  update public.script_voice_profiles set
    approved_examples = next_examples,
    edit_version = edit_version + 1,
    updated_by = target_user_id
  where organization_id = script_record.organization_id and user_id = target_user_id
  returning edit_version into new_profile_version;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    script_record.organization_id, target_user_id, 'script_voice.sample_approved',
    'script', script_record.id,
    jsonb_build_object('script_edit_version', script_record.edit_version,
      'voice_profile_edit_version', new_profile_version, 'private_profile', true)
  );
  return new_profile_version;
end;
$$;

-- AI generation is deliberately limited to the assigned writer. The owner can
-- inspect team scripts, but cannot reveal or consume another writer's private
-- profile through a generation endpoint.
create or replace function public.get_script_ai_context(
  target_user_id uuid,
  target_script_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare script_record public.scripts%rowtype; voice_context jsonb; brand_context jsonb;
begin
  select * into script_record from public.scripts where id = target_script_id;
  if script_record.id is null then raise exception 'Script not found'; end if;
  if script_record.assigned_to <> target_user_id
    or not private.is_active_script_actor(target_user_id, script_record.organization_id)
    or not private.actor_can_access_any_section(
      target_user_id,
      script_record.organization_id,
      array['scripts']::text[]
    ) then
    raise exception 'Only the assigned writer can generate this private script';
  end if;
  if script_record.status in ('handed_off', 'archived') then
    raise exception 'Handed-off or archived scripts are read-only';
  end if;

  select coalesce(to_jsonb(profile), '{}'::jsonb) into voice_context
  from public.script_voice_profiles profile
  where profile.organization_id = script_record.organization_id
    and profile.user_id = target_user_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'category', article.category, 'title', article.title, 'summary', article.summary,
    'guidelines', article.guidelines, 'do_list', article.do_list,
    'dont_list', article.dont_list, 'examples', article.examples
  ) order by article.updated_at desc), '[]'::jsonb) into brand_context
  from (
    select * from public.brand_articles
    where organization_id = script_record.organization_id and status = 'approved'
      and category in ('foundation', 'copy_voice', 'compliance', 'offer_product')
    order by updated_at desc limit 20
  ) article;
  return jsonb_build_object('script', to_jsonb(script_record),
    'voice_profile', coalesce(voice_context, '{}'::jsonb),
    'brand_articles', coalesce(brand_context, '[]'::jsonb));
end;
$$;

create or replace function public.get_script_research_ai_context(
  target_user_id uuid,
  target_research_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare research_record public.script_research_items%rowtype; voice_context jsonb; brand_context jsonb;
begin
  select * into research_record from public.script_research_items where id = target_research_id;
  if research_record.id is null then raise exception 'Research item not found'; end if;
  if research_record.assigned_to <> target_user_id
    or not private.is_active_script_actor(target_user_id, research_record.organization_id)
    or not private.actor_can_access_any_section(
      target_user_id,
      research_record.organization_id,
      array['scripts']::text[]
    ) then
    raise exception 'Only the assigned writer can generate this private research item';
  end if;
  if research_record.status in ('used', 'archived') then raise exception 'This research item is already closed'; end if;

  select coalesce(to_jsonb(profile), '{}'::jsonb) into voice_context
  from public.script_voice_profiles profile
  where profile.organization_id = research_record.organization_id
    and profile.user_id = target_user_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'category', article.category, 'title', article.title, 'summary', article.summary,
    'guidelines', article.guidelines, 'do_list', article.do_list,
    'dont_list', article.dont_list, 'examples', article.examples
  ) order by article.updated_at desc), '[]'::jsonb) into brand_context
  from (
    select * from public.brand_articles
    where organization_id = research_record.organization_id and status = 'approved'
      and category in ('foundation', 'copy_voice', 'compliance', 'offer_product')
    order by updated_at desc limit 20
  ) article;

  return jsonb_build_object(
    'research', to_jsonb(research_record),
    'script', jsonb_build_object(
      'title', research_record.title,
      'input_mode', case when research_record.source_url is null then 'idea' else 'reference' end,
      'source_url', research_record.source_url,
      'source_text', concat_ws(E'\n\n', nullif(research_record.transcript, ''),
        nullif(research_record.raw_notes, ''), nullif(research_record.transferable_principle, ''),
        nullif(research_record.why_it_works, ''),
        nullif(array_to_string(research_record.original_angles, E'\n'), '')),
      'objective', coalesce(nullif(research_record.transferable_principle, ''),
        nullif(research_record.raw_notes, ''), research_record.title),
      'audience', 'متداولون عرب', 'platform', 'instagram', 'duration_seconds', 60,
      'hook_variants', case when research_record.hook = '' then jsonb_build_array()
        else jsonb_build_array(research_record.hook) end,
      'organization_id', research_record.organization_id,
      'assigned_to', research_record.assigned_to
    ),
    'voice_profile', coalesce(voice_context, '{}'::jsonb),
    'brand_articles', coalesce(brand_context, '[]'::jsonb)
  );
end;
$$;

-- Content Factory AI uses only the requesting member's private profile. It can
-- never fall back to Samih's or another writer's profile.
create or replace function public.get_content_ai_context(
  target_user_id uuid,
  target_content_item_id uuid,
  target_scope text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare item_record public.content_items%rowtype; voice_context jsonb; brand_context jsonb;
begin
  if not private.can_use_content_ai_actor(target_user_id, target_content_item_id, target_scope) then
    raise exception 'You cannot generate choices for this content step';
  end if;
  select * into item_record from public.content_items item where item.id = target_content_item_id;

  select coalesce(to_jsonb(profile), '{}'::jsonb) into voice_context
  from public.script_voice_profiles profile
  where profile.organization_id = item_record.organization_id
    and profile.user_id = target_user_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'category', article.category, 'title', article.title, 'summary', article.summary,
    'guidelines', article.guidelines, 'do_list', article.do_list,
    'dont_list', article.dont_list, 'examples', article.examples
  ) order by article.updated_at desc), '[]'::jsonb) into brand_context
  from (
    select * from public.brand_articles
    where organization_id = item_record.organization_id and status = 'approved'
      and category in ('foundation', 'copy_voice', 'visual_identity', 'compliance', 'offer_product')
    order by updated_at desc limit 20
  ) article;

  return jsonb_build_object(
    'script', jsonb_build_object(
      'id', item_record.id, 'organization_id', item_record.organization_id,
      'title', item_record.title, 'input_mode', 'manual',
      'source_url', item_record.intake_source_url, 'source_text', item_record.intake_request,
      'objective', item_record.goal, 'audience', 'متداولون عرب',
      'platform', coalesce(item_record.platforms[1], 'instagram'),
      'duration_seconds', 60, 'content_pillar', null, 'edit_version', item_record.version,
      'hook_variants', array[item_record.hook], 'spoken_script', item_record.script_outline,
      'cta', item_record.cta, 'caption', item_record.caption_brief,
      'thumbnail_notes', item_record.thumbnail_brief, 'brand_notes', item_record.brand_notes,
      'status', 'ready_to_record'
    ),
    'voice_profile', coalesce(voice_context, '{}'::jsonb),
    'brand_articles', coalesce(brand_context, '[]'::jsonb)
  );
end;
$$;

-- Launches are editable/cancellable by the platform owner/admin. Cancellation is
-- reversible only by creating a new launch; it preserves all outputs and audit
-- history while closing every still-open task atomically.
alter table public.launches
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references public.profiles (id) on delete restrict,
  add column cancellation_reason text;

update public.launches launch set
  cancelled_at = coalesce(launch.updated_at, now()),
  cancelled_by = launch.owner_id,
  cancellation_reason = 'إلغاء مسجل قبل إضافة سجل الإلغاء التفصيلي'
where launch.status = 'cancelled';

alter table public.launches
  add constraint launches_cancellation_reason_length
    check (cancellation_reason is null or char_length(trim(cancellation_reason)) between 3 and 1000),
  add constraint launches_cancellation_consistent check (
    (status = 'cancelled' and cancelled_at is not null and cancelled_by is not null and cancellation_reason is not null)
    or (status <> 'cancelled' and cancelled_at is null and cancelled_by is null and cancellation_reason is null)
  );

create or replace function public.update_launch(
  target_user_id uuid,
  target_launch_id uuid,
  expected_version bigint,
  launch_title text,
  launch_kind public.launch_type,
  launch_objective text,
  launch_audience text,
  launch_offer text,
  launch_cta text,
  launch_starts_at timestamptz,
  launch_ends_at timestamptz,
  launch_lead_target integer,
  launch_sales_target integer,
  launch_revenue_target numeric,
  launch_currency text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare launch_record public.launches%rowtype; new_version bigint; schedule_span interval;
begin
  select * into launch_record from public.launches where id = target_launch_id for update;
  if launch_record.id is null then raise exception 'Launch was not found'; end if;
  if not private.is_org_owner_or_admin_actor(target_user_id, launch_record.organization_id) then
    raise exception 'Only a platform owner or admin can edit a launch';
  end if;
  if launch_record.status in ('cancelled', 'completed') then
    raise exception 'A cancelled or completed launch is read-only';
  end if;
  if launch_record.version <> expected_version then
    raise exception 'Launch changed in another session; refresh before saving';
  end if;
  if char_length(trim(launch_title)) not between 3 and 180
    or char_length(trim(launch_objective)) not between 5 and 1500
    or char_length(trim(launch_audience)) not between 3 and 1000
    or char_length(trim(launch_offer)) not between 3 and 1500
    or char_length(trim(launch_cta)) not between 2 and 500 then
    raise exception 'Launch brief fields are incomplete or too long';
  end if;
  if launch_ends_at <= launch_starts_at then raise exception 'Launch end must be after its start'; end if;
  if launch_record.status not in ('planning', 'production', 'review', 'ready')
    and (launch_starts_at is distinct from launch_record.starts_at or launch_ends_at is distinct from launch_record.ends_at) then
    raise exception 'Live launch dates cannot be changed';
  end if;
  if launch_lead_target is null and launch_sales_target is null and launch_revenue_target is null then
    raise exception 'At least one measurable launch target is required';
  end if;
  if coalesce(launch_lead_target, 0) < 0 or coalesce(launch_sales_target, 0) < 0
    or coalesce(launch_revenue_target, 0) < 0 then raise exception 'Launch targets cannot be negative'; end if;
  if upper(trim(launch_currency)) !~ '^[A-Z]{3}$' then
    raise exception 'Currency must be a three-letter ISO code';
  end if;
  if exists (
    select 1 from public.launch_deliverables deliverable
    where deliverable.launch_id = target_launch_id
      and deliverable.due_at > launch_ends_at
      and deliverable.delivered_at is null
  ) then raise exception 'Move open deliverable deadlines before shortening the launch'; end if;

  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  update public.launches set
    title = trim(launch_title), type = launch_kind, objective = trim(launch_objective),
    audience = trim(launch_audience), offer = trim(launch_offer), primary_cta = trim(launch_cta),
    starts_at = launch_starts_at, ends_at = launch_ends_at,
    lead_target = launch_lead_target, sales_target = launch_sales_target,
    revenue_target = launch_revenue_target, currency = upper(trim(launch_currency)),
    version = version + 1, updated_at = now()
  where id = target_launch_id
  returning version into new_version;

  update public.tasks task set
    title = case task.launch_gate
      when 'strategy' then 'استراتيجية الإطلاق: ' || trim(launch_title)
      when 'offer' then 'اعتماد العرض: ' || trim(launch_title)
      when 'registration' then 'مسار التسجيل والشراء: ' || trim(launch_title)
      when 'delivery' then 'جاهزية التسليم: ' || trim(launch_title)
      when 'promotion' then 'خطة الترويج: ' || trim(launch_title)
      when 'tracking' then 'التتبع ولوحة الأرقام: ' || trim(launch_title)
      when 'go_no_go' then 'قرار Go / No-Go: ' || trim(launch_title)
      when 'launch_day' then 'تشغيل يوم الإطلاق: ' || trim(launch_title)
      else task.title end
  where task.launch_id = target_launch_id;

  if launch_starts_at is distinct from launch_record.starts_at and launch_starts_at > now() then
    schedule_span := launch_starts_at - now();
    update public.tasks task set due_at = case task.launch_gate
      when 'strategy' then now() + schedule_span * 0.10
      when 'offer' then now() + schedule_span * 0.24
      when 'registration' then now() + schedule_span * 0.42
      when 'delivery' then now() + schedule_span * 0.58
      when 'promotion' then now() + schedule_span * 0.64
      when 'tracking' then now() + schedule_span * 0.72
      when 'go_no_go' then now() + schedule_span * 0.88
      when 'launch_day' then launch_starts_at
      else task.due_at end
    where task.launch_id = target_launch_id and task.status not in ('done', 'cancelled');
  end if;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    launch_record.organization_id, target_user_id, 'launch.updated', 'launch', target_launch_id,
    to_jsonb(launch_record),
    jsonb_build_object('version', new_version, 'title', trim(launch_title),
      'starts_at', launch_starts_at, 'ends_at', launch_ends_at)
  );
  return new_version;
end;
$$;

create or replace function private.advance_launch_workflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_launch_status public.launch_status;
  previous_launch_status public.launch_status;
begin
  if new.launch_id is null then return new; end if;
  if nullif(current_setting('app.cancel_launch_id', true), '') = new.launch_id::text then
    return new;
  end if;

  select launch.status into previous_launch_status
  from public.launches launch where launch.id = new.launch_id for update;

  select case
    when bool_and(task.status = 'cancelled') then 'cancelled'::public.launch_status
    when bool_or(task.launch_gate = 'launch_day' and task.status = 'done') then 'completed'::public.launch_status
    when bool_or(task.launch_gate = 'launch_day' and task.status in ('in_progress', 'review')) then 'live'::public.launch_status
    when bool_or(task.launch_gate = 'launch_day' and task.status = 'ready') then 'ready'::public.launch_status
    when bool_or(task.launch_gate = 'go_no_go' and task.status in ('ready', 'in_progress', 'review', 'done')) then 'review'::public.launch_status
    when bool_or(task.launch_gate in ('offer', 'registration', 'delivery', 'promotion', 'tracking')
      and task.status in ('ready', 'in_progress', 'review', 'done')) then 'production'::public.launch_status
    else 'planning'::public.launch_status
  end into next_launch_status
  from public.tasks task where task.launch_id = new.launch_id;

  if next_launch_status is distinct from previous_launch_status then
    update public.launches launch set
      status = next_launch_status,
      version = launch.version + 1,
      updated_at = now()
    where launch.id = new.launch_id;
    insert into public.audit_events (
      organization_id, actor_id, action, entity_type, entity_id, before_data, after_data
    ) values (
      new.organization_id, (select auth.uid()), 'launch.status_changed', 'launch', new.launch_id,
      jsonb_build_object('status', previous_launch_status),
      jsonb_build_object('status', next_launch_status)
    );
  end if;
  return new;
end;
$$;

create or replace function public.cancel_launch(
  target_user_id uuid,
  target_launch_id uuid,
  expected_version bigint,
  cancellation_reason text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare launch_record public.launches%rowtype; new_version bigint;
begin
  select * into launch_record from public.launches where id = target_launch_id for update;
  if launch_record.id is null then raise exception 'Launch was not found'; end if;
  if not private.is_org_owner_or_admin_actor(target_user_id, launch_record.organization_id) then
    raise exception 'Only a platform owner or admin can cancel a launch';
  end if;
  if launch_record.version <> expected_version then
    raise exception 'Launch changed in another session; refresh before cancelling';
  end if;
  if launch_record.status = 'cancelled' then return launch_record.version; end if;
  if launch_record.status = 'completed' then raise exception 'A completed launch cannot be cancelled'; end if;
  if char_length(trim(cancellation_reason)) not between 3 and 1000 then
    raise exception 'Add a clear cancellation reason';
  end if;

  perform set_config('request.jwt.claim.sub', target_user_id::text, true);
  perform set_config('app.cancel_launch_id', target_launch_id::text, true);

  update public.tasks task set status = 'cancelled'
  where task.launch_id = target_launch_id and task.status <> 'cancelled';
  update public.tasks task set status = 'cancelled'
  where task.launch_deliverable_id in (
    select deliverable.id from public.launch_deliverables deliverable
    where deliverable.launch_id = target_launch_id
  ) and task.status <> 'cancelled';

  update public.launches set
    status = 'cancelled', cancelled_at = now(), cancelled_by = target_user_id,
    cancellation_reason = trim(cancellation_reason), version = version + 1, updated_at = now()
  where id = target_launch_id
  returning version into new_version;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    launch_record.organization_id, target_user_id, 'launch.cancelled', 'launch', target_launch_id,
    jsonb_build_object('status', launch_record.status, 'version', launch_record.version),
    jsonb_build_object('status', 'cancelled', 'version', new_version,
      'reason', trim(cancellation_reason))
  );
  return new_version;
end;
$$;

create or replace function private.guard_launch_document_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare actor uuid := (select auth.uid()); launch_status public.launch_status;
begin
  select status into launch_status from public.launches where id = new.launch_id;
  if launch_status = 'cancelled' then raise exception 'Cancelled launches are read-only'; end if;
  if actor is null or private.is_org_owner_or_admin_actor(actor, new.organization_id) then return new; end if;
  if new.status = 'approved' then raise exception 'Only a platform owner or admin can approve launch outputs'; end if;
  if exists (
    select 1 from public.tasks task
    where task.launch_id = new.launch_id and task.launch_gate = new.gate and task.owner_id = actor
  ) then return new; end if;
  raise exception 'Only the assigned gate owner can save this launch output';
end;
$$;

create or replace function private.guard_launch_deliverable_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare actor uuid := (select auth.uid()); launch_status public.launch_status;
begin
  select status into launch_status from public.launches where id = new.launch_id;
  if launch_status = 'cancelled' then raise exception 'Cancelled launches are read-only'; end if;
  if actor is null or private.is_org_owner_or_admin_actor(actor, new.organization_id) then return new; end if;
  if tg_op = 'INSERT' and exists (
    select 1 from public.memberships membership
    where membership.organization_id = new.organization_id and membership.user_id = actor
      and membership.status = 'active' and membership.role = 'manager'
  ) then return new; end if;
  if tg_op = 'UPDATE' and old.owner_id = actor
    and (to_jsonb(new) - array['result_note', 'result_url', 'delivered_at']::text[])
      is not distinct from
      (to_jsonb(old) - array['result_note', 'result_url', 'delivered_at']::text[]) then return new; end if;
  raise exception 'Only the assigned deliverable owner can submit this result';
end;
$$;

revoke all on function private.guard_launch_document_write() from public, anon, authenticated;
revoke all on function private.guard_launch_deliverable_write() from public, anon, authenticated;

create trigger launch_documents_permission_guard
before insert or update on public.launch_documents
for each row execute function private.guard_launch_document_write();

create trigger launch_deliverables_permission_guard
before insert or update on public.launch_deliverables
for each row execute function private.guard_launch_deliverable_write();

revoke all on function public.update_launch(
  uuid, uuid, bigint, text, public.launch_type, text, text, text, text,
  timestamptz, timestamptz, integer, integer, numeric, text
) from public, anon, authenticated;
grant execute on function public.update_launch(
  uuid, uuid, bigint, text, public.launch_type, text, text, text, text,
  timestamptz, timestamptz, integer, integer, numeric, text
) to service_role;

revoke all on function public.cancel_launch(uuid, uuid, bigint, text)
from public, anon, authenticated;
grant execute on function public.cancel_launch(uuid, uuid, bigint, text)
to service_role;

-- Existing task cards must not retain copied script/production text that would
-- bypass the new Content Factory RLS through the all-team board.
do $$
declare migration_actor uuid;
begin
  select membership.user_id into migration_actor
  from public.memberships membership
  where membership.status = 'active' and membership.role = 'owner'
  order by membership.created_at
  limit 1;

  if migration_actor is not null then
    perform set_config('request.jwt.claim.sub', migration_actor::text, true);
    update public.tasks task set description = case task.content_step
      when 'recording' then 'راجع ملف المحتوى الخاص بك لتعليمات التسجيل والمادة الخام.'
      when 'editing' then 'راجع ملف المحتوى الخاص بك لتعليمات المونتاج والمراجع.'
      when 'thumbnail' then 'راجع ملف المحتوى الخاص بك لتعليمات الغلاف والهوية البصرية.'
      when 'caption' then 'راجع ملف المحتوى الخاص بك لكتابة الكابشن والهاشتاجات.'
      when 'design' then 'راجع ملف المحتوى الخاص بك لتعليمات التصميم.'
      when 'scheduling' then 'راجع ملف المحتوى الخاص بك لموعد وجدول النشر.'
      when 'publishing' then 'راجع ملف المحتوى الخاص بك لتأكيد النشر وإضافة الرابط.'
      else task.description end
    where task.content_item_id is not null
      and task.content_step in ('recording', 'editing', 'thumbnail', 'caption', 'design', 'scheduling', 'publishing');
  end if;
end;
$$;

comment on column public.script_voice_profiles.user_id is
  'The only end user allowed to read or edit this private writing voice profile.';
comment on function public.cancel_launch(uuid, uuid, bigint, text) is
  'Atomically cancels an active launch and all of its open canonical tasks while preserving history.';
