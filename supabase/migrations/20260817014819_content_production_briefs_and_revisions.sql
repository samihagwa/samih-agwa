-- Production-ready content briefs, durable source links, and explicit revision rounds.
-- Existing content remains valid; leadership can enrich legacy rows from the UI.

create type public.content_asset_kind as enum (
  'raw_video',
  'source',
  'b_roll',
  'image',
  'audio',
  'reference',
  'draft_video',
  'thumbnail',
  'caption',
  'final_export'
);

create type public.content_revision_status as enum (
  'requested',
  'in_progress',
  'resolved',
  'cancelled'
);

alter table public.content_items
  add column script_outline text not null default '',
  add column editing_brief text not null default '',
  add column thumbnail_brief text not null default '',
  add column brand_notes text;

alter table public.content_items
  add constraint content_items_script_outline_length
    check (char_length(script_outline) <= 8000),
  add constraint content_items_editing_brief_length
    check (char_length(editing_brief) <= 8000),
  add constraint content_items_thumbnail_brief_length
    check (char_length(thumbnail_brief) <= 4000),
  add constraint content_items_brand_notes_length
    check (brand_notes is null or char_length(brand_notes) <= 4000);

create table public.content_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  content_item_id uuid not null,
  stage public.content_step,
  kind public.content_asset_kind not null,
  title text not null,
  url text not null,
  notes text,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint content_assets_content_org_fkey
    foreign key (content_item_id, organization_id)
    references public.content_items (id, organization_id)
    on delete cascade,
  constraint content_assets_title_length
    check (char_length(trim(title)) between 2 and 160),
  constraint content_assets_url_http
    check (url ~* '^https?://[^[:space:]]+$'),
  constraint content_assets_notes_length
    check (notes is null or char_length(notes) <= 2000)
);

create table public.content_revision_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  content_item_id uuid not null,
  task_id uuid not null references public.tasks (id) on delete restrict,
  stage public.content_step not null,
  round bigint not null,
  instructions text not null,
  status public.content_revision_status not null default 'requested',
  requested_by uuid not null references public.profiles (id) on delete restrict,
  assigned_to uuid not null references public.profiles (id) on delete restrict,
  resolved_by uuid references public.profiles (id) on delete set null,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  resolved_at timestamptz,
  constraint content_revision_requests_content_org_fkey
    foreign key (content_item_id, organization_id)
    references public.content_items (id, organization_id)
    on delete cascade,
  constraint content_revision_requests_round_unique unique (content_item_id, round),
  constraint content_revision_requests_round_positive check (round > 0),
  constraint content_revision_requests_stage_allowed
    check (stage in ('recording', 'editing', 'thumbnail', 'caption')),
  constraint content_revision_requests_instructions_length
    check (char_length(trim(instructions)) between 5 and 5000),
  constraint content_revision_requests_timestamps_consistent check (
    (status = 'requested' and started_at is null and resolved_at is null)
    or (status = 'in_progress' and started_at is not null and resolved_at is null)
    or (status in ('resolved', 'cancelled') and resolved_at is not null)
  )
);

create index content_assets_content_time_idx
  on public.content_assets (content_item_id, created_at desc, id desc);

create index content_assets_org_kind_idx
  on public.content_assets (organization_id, kind, created_at desc, id desc);

create index content_assets_creator_idx
  on public.content_assets (created_by);

create index content_revisions_content_status_idx
  on public.content_revision_requests (content_item_id, status, round desc);

create index content_revisions_assignee_status_idx
  on public.content_revision_requests (assigned_to, status, requested_at, id);

create index content_revisions_task_idx
  on public.content_revision_requests (task_id, status, id);

create index content_revisions_requester_idx
  on public.content_revision_requests (requested_by);

create index content_revisions_resolver_idx
  on public.content_revision_requests (resolved_by)
  where resolved_by is not null;

alter table public.content_assets enable row level security;
alter table public.content_revision_requests enable row level security;

create policy "content_assets_select_organization_members"
on public.content_assets
for select
to authenticated
using (private.is_org_member(organization_id));

create policy "content_revisions_select_organization_members"
on public.content_revision_requests
for select
to authenticated
using (private.is_org_member(organization_id));

revoke all on table public.content_assets from anon, authenticated;
revoke all on table public.content_revision_requests from anon, authenticated;
grant select on table public.content_assets to authenticated;
grant select on table public.content_revision_requests to authenticated;

create or replace function private.guard_content_approval_revisions()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'done'
    and old.status <> 'done'
    and new.content_item_id is not null
    and new.content_step in ('approval', 'publishing')
    and exists (
      select 1
      from public.content_revision_requests revision
      where revision.content_item_id = new.content_item_id
        and revision.status in ('requested', 'in_progress')
    ) then
    raise exception 'Resolve every open revision before approval or publishing';
  end if;

  return new;
end;
$$;

create trigger tasks_guard_content_approval_revisions
before update of status on public.tasks
for each row execute function private.guard_content_approval_revisions();

revoke all on function private.guard_content_approval_revisions()
from public, anon, authenticated;

create or replace function public.create_reel_production_workflow(
  target_user_id uuid,
  target_organization_id uuid,
  content_title text,
  content_goal text,
  content_hook text,
  content_cta text,
  content_script_outline text,
  content_editing_brief text,
  content_thumbnail_brief text,
  content_brand_notes text,
  target_publish_at timestamptz,
  brief_owner_id uuid,
  recording_owner_id uuid,
  editing_owner_id uuid,
  thumbnail_owner_id uuid,
  caption_owner_id uuid,
  approval_owner_id uuid,
  publishing_owner_id uuid,
  initial_raw_url text,
  initial_source_url text,
  initial_reference_url text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  content_id uuid;
begin
  if target_user_id is null then
    raise exception 'A verified target user is required';
  end if;

  if char_length(trim(content_script_outline)) not between 10 and 8000
    or char_length(trim(content_editing_brief)) not between 10 and 8000
    or char_length(trim(content_thumbnail_brief)) not between 10 and 4000
    or (content_brand_notes is not null and char_length(content_brand_notes) > 4000) then
    raise exception 'Production brief fields are incomplete or exceed their allowed length';
  end if;

  if exists (
    select 1
    from unnest(array[initial_raw_url, initial_source_url, initial_reference_url]) requested_url
    where nullif(trim(requested_url), '') is not null
      and requested_url !~* '^https?://[^[:space:]]+$'
  ) then
    raise exception 'Every supplied asset link must be a valid HTTP or HTTPS URL';
  end if;

  content_id := public.create_reel_workflow(
    target_user_id,
    target_organization_id,
    content_title,
    content_goal,
    content_hook,
    content_cta,
    target_publish_at,
    brief_owner_id,
    recording_owner_id,
    editing_owner_id,
    thumbnail_owner_id,
    caption_owner_id,
    approval_owner_id,
    publishing_owner_id
  );

  update public.content_items item
  set
    script_outline = trim(content_script_outline),
    editing_brief = trim(content_editing_brief),
    thumbnail_brief = trim(content_thumbnail_brief),
    brand_notes = nullif(trim(content_brand_notes), ''),
    version = item.version + 1,
    updated_at = now()
  where item.id = content_id;

  update public.tasks task
  set description = case task.content_step
    when 'brief' then left('السكريبت أو التسلسل المطلوب:' || chr(10) || trim(content_script_outline), 5000)
    when 'editing' then left('Production Brief للمونتاج:' || chr(10) || trim(content_editing_brief), 5000)
    when 'thumbnail' then left('Design Brief للغلاف:' || chr(10) || trim(content_thumbnail_brief), 5000)
    else task.description
  end
  where task.content_item_id = content_id
    and task.content_step in ('brief', 'editing', 'thumbnail');

  insert into public.content_assets (
    organization_id, content_item_id, stage, kind, title, url, created_by
  )
  select
    target_organization_id,
    content_id,
    initial_asset.stage,
    initial_asset.kind,
    initial_asset.title,
    trim(initial_asset.url),
    target_user_id
  from (
    values
      ('recording'::public.content_step, 'raw_video'::public.content_asset_kind, 'المادة الخام', initial_raw_url),
      ('brief'::public.content_step, 'source'::public.content_asset_kind, 'المصدر الأساسي', initial_source_url),
      ('editing'::public.content_step, 'reference'::public.content_asset_kind, 'مرجع بصري أو أسلوبي', initial_reference_url)
  ) as initial_asset(stage, kind, title, url)
  where nullif(trim(initial_asset.url), '') is not null;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id,
    target_user_id,
    'content.production_brief_added',
    'content_item',
    content_id,
    jsonb_build_object(
      'has_script', true,
      'has_editing_brief', true,
      'has_thumbnail_brief', true,
      'initial_asset_count',
        (select count(*) from public.content_assets asset where asset.content_item_id = content_id)
    )
  );

  return content_id;
end;
$$;

revoke all on function public.create_reel_production_workflow(
  uuid, uuid, text, text, text, text, text, text, text, text, timestamptz,
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.create_reel_production_workflow(
  uuid, uuid, text, text, text, text, text, text, text, text, timestamptz,
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text
) to service_role;

create or replace function public.update_content_production_brief(
  target_user_id uuid,
  target_content_item_id uuid,
  content_script_outline text,
  content_editing_brief text,
  content_thumbnail_brief text,
  content_brand_notes text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
begin
  if target_user_id is null then
    raise exception 'A verified target user is required';
  end if;

  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  select item.organization_id
  into target_organization_id
  from public.content_items item
  where item.id = target_content_item_id
  for update;

  if target_organization_id is null then
    raise exception 'Content item was not found';
  end if;

  if not private.has_org_role(
    target_organization_id,
    array['owner', 'admin', 'manager']::public.app_role[]
  ) then
    raise exception 'Only organization leadership can update production briefs';
  end if;

  if char_length(trim(content_script_outline)) not between 10 and 8000
    or char_length(trim(content_editing_brief)) not between 10 and 8000
    or char_length(trim(content_thumbnail_brief)) not between 10 and 4000
    or (content_brand_notes is not null and char_length(content_brand_notes) > 4000) then
    raise exception 'Production brief fields are incomplete or exceed their allowed length';
  end if;

  update public.content_items item
  set
    script_outline = trim(content_script_outline),
    editing_brief = trim(content_editing_brief),
    thumbnail_brief = trim(content_thumbnail_brief),
    brand_notes = nullif(trim(content_brand_notes), ''),
    version = item.version + 1,
    updated_at = now()
  where item.id = target_content_item_id;

  update public.tasks task
  set description = case task.content_step
    when 'brief' then left('السكريبت أو التسلسل المطلوب:' || chr(10) || trim(content_script_outline), 5000)
    when 'editing' then left('Production Brief للمونتاج:' || chr(10) || trim(content_editing_brief), 5000)
    when 'thumbnail' then left('Design Brief للغلاف:' || chr(10) || trim(content_thumbnail_brief), 5000)
    else task.description
  end
  where task.content_item_id = target_content_item_id
    and task.content_step in ('brief', 'editing', 'thumbnail');

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id,
    target_user_id,
    'content.production_brief_updated',
    'content_item',
    target_content_item_id,
    jsonb_build_object('production_brief_complete', true)
  );

  return true;
end;
$$;

revoke all on function public.update_content_production_brief(
  uuid, uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.update_content_production_brief(
  uuid, uuid, text, text, text, text
) to service_role;

create or replace function public.add_content_asset(
  target_user_id uuid,
  target_content_item_id uuid,
  asset_stage public.content_step,
  asset_kind public.content_asset_kind,
  asset_title text,
  asset_url text,
  asset_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  asset_id uuid;
begin
  if target_user_id is null then
    raise exception 'A verified target user is required';
  end if;

  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  select item.organization_id
  into target_organization_id
  from public.content_items item
  where item.id = target_content_item_id;

  if target_organization_id is null then
    raise exception 'Content item was not found';
  end if;

  if not private.is_org_member(target_organization_id) then
    raise exception 'An active organization membership is required';
  end if;

  if not (
    private.has_org_role(
      target_organization_id,
      array['owner', 'admin', 'manager']::public.app_role[]
    )
    or exists (
      select 1
      from public.tasks task
      where task.content_item_id = target_content_item_id
        and task.owner_id = target_user_id
    )
  ) then
    raise exception 'Only workflow owners or organization leadership can add content links';
  end if;

  if char_length(trim(asset_title)) not between 2 and 160
    or asset_url !~* '^https?://[^[:space:]]+$'
    or (asset_notes is not null and char_length(asset_notes) > 2000) then
    raise exception 'Asset link details are invalid';
  end if;

  insert into public.content_assets (
    organization_id,
    content_item_id,
    stage,
    kind,
    title,
    url,
    notes,
    created_by
  ) values (
    target_organization_id,
    target_content_item_id,
    asset_stage,
    asset_kind,
    trim(asset_title),
    trim(asset_url),
    nullif(trim(asset_notes), ''),
    target_user_id
  ) returning id into asset_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id,
    target_user_id,
    'content.asset_added',
    'content_asset',
    asset_id,
    jsonb_build_object(
      'content_item_id', target_content_item_id,
      'kind', asset_kind,
      'stage', asset_stage,
      'title', trim(asset_title)
    )
  );

  return asset_id;
end;
$$;

revoke all on function public.add_content_asset(
  uuid, uuid, public.content_step, public.content_asset_kind, text, text, text
) from public, anon, authenticated;
grant execute on function public.add_content_asset(
  uuid, uuid, public.content_step, public.content_asset_kind, text, text, text
) to service_role;

create or replace function public.remove_content_asset(
  target_user_id uuid,
  target_asset_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  target_content_item_id uuid;
  asset_creator_id uuid;
  asset_kind public.content_asset_kind;
begin
  if target_user_id is null then
    raise exception 'A verified target user is required';
  end if;

  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  select asset.organization_id, asset.content_item_id, asset.created_by, asset.kind
  into target_organization_id, target_content_item_id, asset_creator_id, asset_kind
  from public.content_assets asset
  where asset.id = target_asset_id
  for update;

  if target_organization_id is null then
    return false;
  end if;

  if not (
    asset_creator_id = target_user_id
    or private.has_org_role(
      target_organization_id,
      array['owner', 'admin', 'manager']::public.app_role[]
    )
  ) then
    raise exception 'Only the link creator or organization leadership can remove it';
  end if;

  delete from public.content_assets asset where asset.id = target_asset_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, before_data
  ) values (
    target_organization_id,
    target_user_id,
    'content.asset_removed',
    'content_asset',
    target_asset_id,
    jsonb_build_object(
      'content_item_id', target_content_item_id,
      'kind', asset_kind
    )
  );

  return true;
end;
$$;

revoke all on function public.remove_content_asset(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.remove_content_asset(uuid, uuid)
to service_role;

create or replace function public.request_content_revision(
  target_user_id uuid,
  target_content_item_id uuid,
  target_stage public.content_step,
  revision_instructions text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  target_task_id uuid;
  target_assignee_id uuid;
  next_round bigint;
  revision_id uuid;
begin
  if target_user_id is null then
    raise exception 'A verified target user is required';
  end if;

  if target_stage not in ('recording', 'editing', 'thumbnail', 'caption') then
    raise exception 'This workflow stage cannot receive a revision request';
  end if;

  if char_length(trim(revision_instructions)) not between 5 and 5000 then
    raise exception 'Revision instructions must be clear and within the allowed length';
  end if;

  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  select item.organization_id, task.id, task.owner_id
  into target_organization_id, target_task_id, target_assignee_id
  from public.content_items item
  join public.tasks task
    on task.content_item_id = item.id
   and task.content_step = target_stage
  where item.id = target_content_item_id;

  if target_organization_id is null then
    raise exception 'Content workflow stage was not found';
  end if;

  if not (
    private.has_org_role(
      target_organization_id,
      array['owner', 'admin', 'manager']::public.app_role[]
    )
    or exists (
      select 1
      from public.tasks approval_task
      where approval_task.content_item_id = target_content_item_id
        and approval_task.content_step = 'approval'
        and approval_task.owner_id = target_user_id
    )
  ) then
    raise exception 'Only the reviewer or organization leadership can request revisions';
  end if;

  perform 1
  from public.content_items item
  where item.id = target_content_item_id
  for update;

  select coalesce(max(revision.round), 0) + 1
  into next_round
  from public.content_revision_requests revision
  where revision.content_item_id = target_content_item_id;

  insert into public.content_revision_requests (
    organization_id,
    content_item_id,
    task_id,
    stage,
    round,
    instructions,
    requested_by,
    assigned_to
  ) values (
    target_organization_id,
    target_content_item_id,
    target_task_id,
    target_stage,
    next_round,
    trim(revision_instructions),
    target_user_id,
    target_assignee_id
  ) returning id into revision_id;

  update public.content_items item
  set version = item.version + 1, updated_at = now()
  where item.id = target_content_item_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id,
    target_user_id,
    'content.revision_requested',
    'content_revision',
    revision_id,
    jsonb_build_object(
      'content_item_id', target_content_item_id,
      'stage', target_stage,
      'round', next_round,
      'assigned_to', target_assignee_id
    )
  );

  return revision_id;
end;
$$;

revoke all on function public.request_content_revision(
  uuid, uuid, public.content_step, text
) from public, anon, authenticated;
grant execute on function public.request_content_revision(
  uuid, uuid, public.content_step, text
) to service_role;

create or replace function public.change_content_revision(
  target_user_id uuid,
  target_revision_id uuid,
  target_action text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  revision_record public.content_revision_requests%rowtype;
  task_status public.task_status;
  actor_is_leadership boolean;
begin
  if target_user_id is null then
    raise exception 'A verified target user is required';
  end if;

  if target_action not in ('start', 'resolve', 'cancel') then
    raise exception 'Unknown revision action';
  end if;

  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  select revision.*
  into revision_record
  from public.content_revision_requests revision
  where revision.id = target_revision_id
  for update;

  if revision_record.id is null then
    raise exception 'Revision request was not found';
  end if;

  actor_is_leadership := private.has_org_role(
    revision_record.organization_id,
    array['owner', 'admin', 'manager']::public.app_role[]
  );

  if target_action in ('start', 'resolve')
    and revision_record.assigned_to <> target_user_id
    and not actor_is_leadership then
    raise exception 'Only the assigned owner or organization leadership can work this revision';
  end if;

  if target_action = 'cancel'
    and revision_record.requested_by <> target_user_id
    and not actor_is_leadership then
    raise exception 'Only the requester or organization leadership can cancel this revision';
  end if;

  if revision_record.status in ('resolved', 'cancelled') then
    raise exception 'This revision request is already closed';
  end if;

  if target_action = 'cancel' then
    update public.content_revision_requests revision
    set status = 'cancelled', resolved_by = target_user_id, resolved_at = now()
    where revision.id = target_revision_id;
  else
    select task.status
    into task_status
    from public.tasks task
    where task.id = revision_record.task_id
    for update;

    if task_status = 'cancelled' then
      raise exception 'A cancelled workflow task cannot receive revisions';
    end if;

    if task_status = 'backlog' then
      update public.tasks set status = 'ready' where id = revision_record.task_id;
      task_status := 'ready';
    end if;

    if task_status in ('ready', 'review', 'blocked', 'done') then
      update public.tasks set status = 'in_progress' where id = revision_record.task_id;
      task_status := 'in_progress';
    end if;

    if target_action = 'start' then
      update public.content_revision_requests revision
      set status = 'in_progress', started_at = coalesce(revision.started_at, now())
      where revision.id = target_revision_id;
    else
      if task_status = 'in_progress' then
        update public.tasks set status = 'review' where id = revision_record.task_id;
      end if;

      update public.content_revision_requests revision
      set
        status = 'resolved',
        started_at = coalesce(revision.started_at, now()),
        resolved_by = target_user_id,
        resolved_at = now()
      where revision.id = target_revision_id;
    end if;
  end if;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    revision_record.organization_id,
    target_user_id,
    'content.revision_' || target_action,
    'content_revision',
    target_revision_id,
    jsonb_build_object('status', revision_record.status),
    jsonb_build_object(
      'status', case target_action
        when 'start' then 'in_progress'
        when 'resolve' then 'resolved'
        else 'cancelled'
      end
    )
  );

  return true;
end;
$$;

revoke all on function public.change_content_revision(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.change_content_revision(uuid, uuid, text)
to service_role;

do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'content_assets'
    ) then
      alter publication supabase_realtime add table public.content_assets;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'content_revision_requests'
    ) then
      alter publication supabase_realtime add table public.content_revision_requests;
    end if;
  end if;
end;
$$;
