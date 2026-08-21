-- Private script studio: per-writer scripts, owner oversight, manual research,
-- version history, organization voice profile, and atomic handoff to Content Factory.

create type public.script_status as enum (
  'draft',
  'ready_to_record',
  'handed_off',
  'archived'
);

create type public.script_input_mode as enum (
  'idea',
  'reference',
  'manual'
);

create type public.script_version_source as enum (
  'manual_save',
  'ai_generation',
  'handoff'
);

create type public.script_research_kind as enum (
  'idea',
  'reference',
  'competitor'
);

create type public.script_research_status as enum (
  'inbox',
  'selected',
  'used',
  'archived'
);

create or replace function private.valid_script_text_list(
  values_to_check text[],
  maximum_items integer,
  maximum_item_length integer
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select
    cardinality(coalesce(values_to_check, '{}'::text[])) <= maximum_items
    and not exists (
      select 1
      from unnest(coalesce(values_to_check, '{}'::text[])) item
      where char_length(trim(item)) not between 1 and maximum_item_length
    );
$$;

revoke all on function private.valid_script_text_list(text[], integer, integer)
from public, anon, authenticated;

create table public.scripts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete restrict,
  assigned_to uuid not null references public.profiles (id) on delete restrict,
  title text not null,
  input_mode public.script_input_mode not null default 'idea',
  source_url text,
  source_text text,
  objective text not null,
  audience text not null default 'متداولون عرب',
  platform text not null default 'instagram',
  duration_seconds integer not null default 60,
  content_pillar text,
  hook_variants text[] not null default '{}'::text[],
  spoken_script text not null default '',
  cta text not null default '',
  caption text not null default '',
  hashtags text[] not null default '{}'::text[],
  recording_notes text not null default '',
  editing_notes text not null default '',
  thumbnail_notes text not null default '',
  on_screen_text text not null default '',
  b_roll_notes text not null default '',
  claims_notes text not null default '',
  status public.script_status not null default 'draft',
  edit_version bigint not null default 1,
  content_item_id uuid,
  handed_off_at timestamptz,
  handed_off_by uuid references public.profiles (id) on delete restrict,
  archived_at timestamptz,
  archived_by uuid references public.profiles (id) on delete restrict,
  ai_last_generated_at timestamptz,
  ai_last_generated_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  constraint scripts_content_org_fkey foreign key (content_item_id, organization_id)
    references public.content_items (id, organization_id) on delete restrict,
  constraint scripts_title_length check (char_length(trim(title)) between 3 and 180),
  constraint scripts_objective_length check (char_length(trim(objective)) between 5 and 1000),
  constraint scripts_audience_length check (char_length(trim(audience)) between 2 and 300),
  constraint scripts_source_url_http check (
    source_url is null or (char_length(source_url) <= 2000 and source_url ~* '^https?://[^[:space:]]+$')
  ),
  constraint scripts_source_text_length check (source_text is null or char_length(source_text) <= 30000),
  constraint scripts_platform_allowed check (
    platform in ('instagram', 'facebook', 'tiktok', 'youtube', 'telegram', 'other')
  ),
  constraint scripts_duration_range check (duration_seconds between 10 and 1800),
  constraint scripts_content_pillar_length check (content_pillar is null or char_length(content_pillar) <= 120),
  constraint scripts_hooks_valid check (private.valid_script_text_list(hook_variants, 8, 500)),
  constraint scripts_hashtags_valid check (private.valid_script_text_list(hashtags, 30, 100)),
  constraint scripts_body_lengths check (
    char_length(spoken_script) <= 30000
    and char_length(cta) <= 1000
    and char_length(caption) <= 5000
    and char_length(recording_notes) <= 5000
    and char_length(editing_notes) <= 10000
    and char_length(thumbnail_notes) <= 5000
    and char_length(on_screen_text) <= 5000
    and char_length(b_roll_notes) <= 5000
    and char_length(claims_notes) <= 5000
  ),
  constraint scripts_edit_version_positive check (edit_version > 0),
  constraint scripts_handoff_consistent check (
    (
      content_item_id is null
      and handed_off_at is null
      and handed_off_by is null
      and status <> 'handed_off'
    )
    or (
      content_item_id is not null
      and handed_off_at is not null
      and handed_off_by is not null
      and status in ('handed_off', 'archived')
    )
  ),
  constraint scripts_archive_consistent check (
    (status = 'archived' and archived_at is not null and archived_by is not null)
    or (status <> 'archived' and archived_at is null and archived_by is null)
  )
);

create unique index scripts_content_item_unique_idx
  on public.scripts (content_item_id)
  where content_item_id is not null;
create index scripts_assignee_status_updated_idx
  on public.scripts (organization_id, assigned_to, status, updated_at desc, id);
create index scripts_org_status_updated_idx
  on public.scripts (organization_id, status, updated_at desc, id);
create index scripts_creator_idx on public.scripts (created_by, created_at desc);

create table public.script_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  script_id uuid not null,
  version_number bigint not null,
  source public.script_version_source not null,
  snapshot jsonb not null,
  note text,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (script_id, version_number),
  constraint script_versions_script_org_fkey foreign key (script_id, organization_id)
    references public.scripts (id, organization_id) on delete cascade,
  constraint script_versions_number_positive check (version_number > 0),
  constraint script_versions_snapshot_object check (jsonb_typeof(snapshot) = 'object'),
  constraint script_versions_note_length check (note is null or char_length(note) <= 500)
);

create index script_versions_script_time_idx
  on public.script_versions (script_id, version_number desc, created_at desc);

create table public.script_research_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete restrict,
  assigned_to uuid not null references public.profiles (id) on delete restrict,
  kind public.script_research_kind not null default 'idea',
  status public.script_research_status not null default 'inbox',
  title text not null,
  source_url text,
  raw_notes text not null default '',
  transcript text not null default '',
  hook text not null default '',
  transferable_principle text not null default '',
  why_it_works text not null default '',
  original_angles text[] not null default '{}'::text[],
  performance_signal smallint,
  brand_fit smallint,
  freshness smallint,
  linked_script_id uuid,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  constraint script_research_script_org_fkey foreign key (linked_script_id, organization_id)
    references public.scripts (id, organization_id) on delete restrict,
  constraint script_research_title_length check (char_length(trim(title)) between 3 and 180),
  constraint script_research_source_url_http check (
    source_url is null or (char_length(source_url) <= 2000 and source_url ~* '^https?://[^[:space:]]+$')
  ),
  constraint script_research_text_lengths check (
    char_length(raw_notes) <= 30000
    and char_length(transcript) <= 30000
    and char_length(hook) <= 1000
    and char_length(transferable_principle) <= 5000
    and char_length(why_it_works) <= 5000
  ),
  constraint script_research_angles_valid check (private.valid_script_text_list(original_angles, 10, 1000)),
  constraint script_research_scores_range check (
    (performance_signal is null or performance_signal between 0 and 100)
    and (brand_fit is null or brand_fit between 0 and 100)
    and (freshness is null or freshness between 0 and 100)
  ),
  constraint script_research_used_consistent check (
    (status = 'used' and linked_script_id is not null and used_at is not null)
    or (status <> 'used' and used_at is null)
  )
);

create index script_research_assignee_status_idx
  on public.script_research_items (organization_id, assigned_to, status, updated_at desc, id);

create table public.script_voice_profiles (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  voice_summary text not null default '',
  writing_rules text[] not null default '{}'::text[],
  banned_phrases text[] not null default '{}'::text[],
  story_bank text[] not null default '{}'::text[],
  approved_examples text not null default '',
  source_notes text not null default '',
  edit_version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles (id) on delete restrict,
  constraint script_voice_summary_length check (char_length(voice_summary) <= 5000),
  constraint script_voice_rules_valid check (private.valid_script_text_list(writing_rules, 50, 1000)),
  constraint script_voice_banned_valid check (private.valid_script_text_list(banned_phrases, 50, 500)),
  constraint script_voice_stories_valid check (private.valid_script_text_list(story_bank, 100, 2000)),
  constraint script_voice_examples_length check (char_length(approved_examples) <= 30000),
  constraint script_voice_source_notes_length check (char_length(source_notes) <= 10000),
  constraint script_voice_edit_version_positive check (edit_version > 0)
);

create trigger scripts_set_updated_at
before update on public.scripts
for each row execute function private.set_updated_at();

create trigger script_research_set_updated_at
before update on public.script_research_items
for each row execute function private.set_updated_at();

create trigger script_voice_profiles_set_updated_at
before update on public.script_voice_profiles
for each row execute function private.set_updated_at();

alter table public.scripts enable row level security;
alter table public.script_versions enable row level security;
alter table public.script_research_items enable row level security;
alter table public.script_voice_profiles enable row level security;

create policy "scripts_select_assignee_or_owner"
on public.scripts for select to authenticated
using (
  assigned_to = (select auth.uid())
  or private.has_org_role(organization_id, array['owner']::public.app_role[])
);

create policy "script_versions_select_through_script"
on public.script_versions for select to authenticated
using (
  exists (
    select 1
    from public.scripts script
    where script.id = script_versions.script_id
      and script.organization_id = script_versions.organization_id
      and (
        script.assigned_to = (select auth.uid())
        or private.has_org_role(script.organization_id, array['owner']::public.app_role[])
      )
  )
);

create policy "script_research_select_assignee_or_owner"
on public.script_research_items for select to authenticated
using (
  assigned_to = (select auth.uid())
  or private.has_org_role(organization_id, array['owner']::public.app_role[])
);

create policy "script_voice_select_members"
on public.script_voice_profiles for select to authenticated
using (private.is_org_member(organization_id));

revoke all on table public.scripts from anon, authenticated;
revoke all on table public.script_versions from anon, authenticated;
revoke all on table public.script_research_items from anon, authenticated;
revoke all on table public.script_voice_profiles from anon, authenticated;
grant select on table public.scripts to authenticated;
grant select on table public.script_versions to authenticated;
grant select on table public.script_research_items to authenticated;
grant select on table public.script_voice_profiles to authenticated;

create or replace function private.is_active_script_actor(
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
    select 1 from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = target_user_id
      and membership.status = 'active'
  );
$$;

create or replace function private.is_script_owner_actor(
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
    select 1 from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = target_user_id
      and membership.status = 'active'
      and membership.role = 'owner'
  );
$$;

create or replace function private.can_access_script_actor(
  target_user_id uuid,
  target_organization_id uuid,
  target_assigned_to uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_script_actor(target_user_id, target_organization_id)
    and (
      target_assigned_to = target_user_id
      or private.is_script_owner_actor(target_user_id, target_organization_id)
    );
$$;

create or replace function private.add_script_version(
  target_script_id uuid,
  version_source public.script_version_source,
  target_user_id uuid,
  version_note text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  script_record public.scripts%rowtype;
begin
  select * into script_record from public.scripts where id = target_script_id;
  if script_record.id is null then raise exception 'Script not found'; end if;

  insert into public.script_versions (
    organization_id, script_id, version_number, source, snapshot, note, created_by
  ) values (
    script_record.organization_id,
    script_record.id,
    script_record.edit_version,
    version_source,
    to_jsonb(script_record),
    nullif(trim(version_note), ''),
    target_user_id
  );
  return script_record.edit_version;
end;
$$;

revoke all on function private.is_active_script_actor(uuid, uuid) from public, anon, authenticated;
revoke all on function private.is_script_owner_actor(uuid, uuid) from public, anon, authenticated;
revoke all on function private.can_access_script_actor(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.add_script_version(uuid, public.script_version_source, uuid, text)
from public, anon, authenticated;

alter table public.notifications drop constraint notifications_kind_allowed;
alter table public.notifications add constraint notifications_kind_allowed check (
  kind in (
    'task_assigned', 'task_ready', 'task_review', 'task_blocked', 'task_done',
    'revision_requested', 'publication_published', 'publication_failed',
    'publication_held', 'script_assigned', 'script_ready'
  )
);

create or replace function public.create_script_draft(
  target_user_id uuid,
  target_organization_id uuid,
  target_assigned_to uuid,
  script_title text,
  script_input_mode public.script_input_mode,
  script_source_url text,
  script_source_text text,
  script_objective text,
  script_audience text,
  script_platform text,
  script_duration_seconds integer,
  script_content_pillar text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  script_id uuid;
begin
  if not private.is_active_script_actor(target_user_id, target_organization_id) then
    raise exception 'Active organization membership is required';
  end if;
  if not private.is_active_script_actor(target_assigned_to, target_organization_id) then
    raise exception 'Script assignee must be an active organization member';
  end if;
  if target_assigned_to <> target_user_id
    and not private.is_script_owner_actor(target_user_id, target_organization_id) then
    raise exception 'Only the organization owner can assign scripts to another member';
  end if;

  insert into public.scripts (
    organization_id, created_by, assigned_to, title, input_mode, source_url,
    source_text, objective, audience, platform, duration_seconds, content_pillar
  ) values (
    target_organization_id, target_user_id, target_assigned_to, trim(script_title),
    script_input_mode, nullif(trim(script_source_url), ''), nullif(trim(script_source_text), ''),
    trim(script_objective), trim(script_audience), script_platform,
    script_duration_seconds, nullif(trim(script_content_pillar), '')
  ) returning id into script_id;

  perform private.add_script_version(script_id, 'manual_save', target_user_id, 'إنشاء المسودة');
  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id, target_user_id, 'script.created', 'script', script_id,
    jsonb_build_object('assigned_to', target_assigned_to, 'input_mode', script_input_mode)
  );

  if target_assigned_to <> target_user_id then
    perform private.add_notification(
      target_organization_id, target_assigned_to, 'script_assigned',
      'اسكريبت جديد وصل لك', trim(script_title), 'script', script_id,
      '/scripts/' || script_id,
      'script:' || script_id || ':assigned:v1:user:' || target_assigned_to
    );
  end if;
  return script_id;
end;
$$;

create or replace function public.save_script_draft(
  target_user_id uuid,
  target_script_id uuid,
  expected_edit_version bigint,
  script_title text,
  script_input_mode public.script_input_mode,
  script_source_url text,
  script_source_text text,
  script_objective text,
  script_audience text,
  script_platform text,
  script_duration_seconds integer,
  script_content_pillar text,
  script_hook_variants text[],
  script_spoken_script text,
  script_cta text,
  script_caption text,
  script_hashtags text[],
  script_recording_notes text,
  script_editing_notes text,
  script_thumbnail_notes text,
  script_on_screen_text text,
  script_b_roll_notes text,
  script_claims_notes text,
  version_note text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  script_record public.scripts%rowtype;
  changed integer;
  new_version bigint;
begin
  select * into script_record from public.scripts where id = target_script_id for update;
  if script_record.id is null then raise exception 'Script not found'; end if;
  if not private.can_access_script_actor(target_user_id, script_record.organization_id, script_record.assigned_to) then
    raise exception 'You cannot edit this private script';
  end if;
  if script_record.status in ('handed_off', 'archived') then
    raise exception 'Handed-off or archived scripts are read-only';
  end if;

  update public.scripts set
    title = trim(script_title),
    input_mode = script_input_mode,
    source_url = nullif(trim(script_source_url), ''),
    source_text = nullif(trim(script_source_text), ''),
    objective = trim(script_objective),
    audience = trim(script_audience),
    platform = script_platform,
    duration_seconds = script_duration_seconds,
    content_pillar = nullif(trim(script_content_pillar), ''),
    hook_variants = coalesce(script_hook_variants, '{}'::text[]),
    spoken_script = coalesce(script_spoken_script, ''),
    cta = coalesce(script_cta, ''),
    caption = coalesce(script_caption, ''),
    hashtags = coalesce(script_hashtags, '{}'::text[]),
    recording_notes = coalesce(script_recording_notes, ''),
    editing_notes = coalesce(script_editing_notes, ''),
    thumbnail_notes = coalesce(script_thumbnail_notes, ''),
    on_screen_text = coalesce(script_on_screen_text, ''),
    b_roll_notes = coalesce(script_b_roll_notes, ''),
    claims_notes = coalesce(script_claims_notes, ''),
    edit_version = edit_version + 1
  where id = target_script_id and edit_version = expected_edit_version;
  get diagnostics changed = row_count;
  if changed = 0 then raise exception 'Script changed in another session; refresh before saving'; end if;

  select edit_version into new_version from public.scripts where id = target_script_id;
  perform private.add_script_version(target_script_id, 'manual_save', target_user_id, version_note);
  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    script_record.organization_id, target_user_id, 'script.saved', 'script', target_script_id,
    jsonb_build_object('edit_version', expected_edit_version),
    jsonb_build_object('edit_version', new_version)
  );
  return new_version;
end;
$$;

create or replace function public.save_ai_script_generation(
  target_user_id uuid,
  target_script_id uuid,
  expected_edit_version bigint,
  script_hook_variants text[],
  script_spoken_script text,
  script_cta text,
  script_caption text,
  script_hashtags text[],
  script_recording_notes text,
  script_editing_notes text,
  script_thumbnail_notes text,
  script_on_screen_text text,
  script_b_roll_notes text,
  script_claims_notes text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  script_record public.scripts%rowtype;
  changed integer;
  new_version bigint;
begin
  select * into script_record from public.scripts where id = target_script_id for update;
  if script_record.id is null then raise exception 'Script not found'; end if;
  if not private.can_access_script_actor(target_user_id, script_record.organization_id, script_record.assigned_to) then
    raise exception 'You cannot generate this private script';
  end if;
  if script_record.status in ('handed_off', 'archived') then
    raise exception 'Handed-off or archived scripts are read-only';
  end if;

  update public.scripts set
    hook_variants = coalesce(script_hook_variants, '{}'::text[]),
    spoken_script = coalesce(script_spoken_script, ''),
    cta = coalesce(script_cta, ''),
    caption = coalesce(script_caption, ''),
    hashtags = coalesce(script_hashtags, '{}'::text[]),
    recording_notes = coalesce(script_recording_notes, ''),
    editing_notes = coalesce(script_editing_notes, ''),
    thumbnail_notes = coalesce(script_thumbnail_notes, ''),
    on_screen_text = coalesce(script_on_screen_text, ''),
    b_roll_notes = coalesce(script_b_roll_notes, ''),
    claims_notes = coalesce(script_claims_notes, ''),
    ai_last_generated_at = now(),
    ai_last_generated_by = target_user_id,
    edit_version = edit_version + 1
  where id = target_script_id and edit_version = expected_edit_version;
  get diagnostics changed = row_count;
  if changed = 0 then raise exception 'Script changed in another session; refresh before generating'; end if;

  select edit_version into new_version from public.scripts where id = target_script_id;
  perform private.add_script_version(target_script_id, 'ai_generation', target_user_id, 'توليد بمساعدة AI');
  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    script_record.organization_id, target_user_id, 'script.ai_generated', 'script', target_script_id,
    jsonb_build_object('edit_version', new_version)
  );
  return new_version;
end;
$$;

create or replace function public.change_script_status(
  target_user_id uuid,
  target_script_id uuid,
  next_status public.script_status,
  expected_edit_version bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  script_record public.scripts%rowtype;
  new_version bigint;
  owner_record record;
begin
  select * into script_record from public.scripts where id = target_script_id for update;
  if script_record.id is null then raise exception 'Script not found'; end if;
  if not private.can_access_script_actor(target_user_id, script_record.organization_id, script_record.assigned_to) then
    raise exception 'You cannot change this private script';
  end if;
  if script_record.edit_version <> expected_edit_version then
    raise exception 'Script changed in another session; refresh before changing status';
  end if;
  if next_status = 'handed_off' then raise exception 'Use the Content Factory handoff command'; end if;
  if script_record.status = 'handed_off' and next_status <> 'archived' then
    raise exception 'A handed-off script cannot return to drafting';
  end if;
  if script_record.status = 'handed_off'
    and not private.is_script_owner_actor(target_user_id, script_record.organization_id) then
    raise exception 'Only the organization owner can archive a handed-off script';
  end if;

  update public.scripts set
    status = next_status,
    archived_at = case when next_status = 'archived' then now() else null end,
    archived_by = case when next_status = 'archived' then target_user_id else null end,
    edit_version = edit_version + 1
  where id = target_script_id;
  select edit_version into new_version from public.scripts where id = target_script_id;
  perform private.add_script_version(target_script_id, 'manual_save', target_user_id, 'تغيير حالة الاسكريبت');

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    script_record.organization_id, target_user_id, 'script.status_changed', 'script', target_script_id,
    jsonb_build_object('status', script_record.status, 'edit_version', script_record.edit_version),
    jsonb_build_object('status', next_status, 'edit_version', new_version)
  );

  if next_status = 'ready_to_record' and script_record.status <> 'ready_to_record' then
    for owner_record in
      select membership.user_id from public.memberships membership
      where membership.organization_id = script_record.organization_id
        and membership.status = 'active' and membership.role = 'owner'
        and membership.user_id <> target_user_id
    loop
      perform private.add_notification(
        script_record.organization_id, owner_record.user_id, 'script_ready',
        'اسكريبت جاهز للتسجيل', script_record.title, 'script', target_script_id,
        '/scripts/' || target_script_id,
        'script:' || target_script_id || ':ready:v' || new_version || ':user:' || owner_record.user_id
      );
    end loop;
  end if;
  return new_version;
end;
$$;

create or replace function public.create_script_research_item(
  target_user_id uuid,
  target_organization_id uuid,
  target_assigned_to uuid,
  research_kind public.script_research_kind,
  research_title text,
  research_source_url text,
  research_raw_notes text,
  research_transcript text,
  research_hook text,
  research_transferable_principle text,
  research_why_it_works text,
  research_original_angles text[],
  research_performance_signal smallint,
  research_brand_fit smallint,
  research_freshness smallint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  research_id uuid;
begin
  if not private.is_active_script_actor(target_user_id, target_organization_id) then
    raise exception 'Active organization membership is required';
  end if;
  if not private.is_active_script_actor(target_assigned_to, target_organization_id) then
    raise exception 'Research owner must be an active organization member';
  end if;
  if target_assigned_to <> target_user_id
    and not private.is_script_owner_actor(target_user_id, target_organization_id) then
    raise exception 'Only the organization owner can assign research to another member';
  end if;

  insert into public.script_research_items (
    organization_id, created_by, assigned_to, kind, title, source_url, raw_notes,
    transcript, hook, transferable_principle, why_it_works, original_angles,
    performance_signal, brand_fit, freshness
  ) values (
    target_organization_id, target_user_id, target_assigned_to, research_kind,
    trim(research_title), nullif(trim(research_source_url), ''),
    coalesce(research_raw_notes, ''), coalesce(research_transcript, ''),
    coalesce(research_hook, ''), coalesce(research_transferable_principle, ''),
    coalesce(research_why_it_works, ''), coalesce(research_original_angles, '{}'::text[]),
    research_performance_signal, research_brand_fit, research_freshness
  ) returning id into research_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id, target_user_id, 'script_research.created', 'script_research', research_id,
    jsonb_build_object('kind', research_kind, 'assigned_to', target_assigned_to)
  );
  return research_id;
end;
$$;

create or replace function public.create_script_from_research(
  target_user_id uuid,
  target_research_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  research_record public.script_research_items%rowtype;
  script_id uuid;
begin
  select * into research_record from public.script_research_items where id = target_research_id for update;
  if research_record.id is null then raise exception 'Research item not found'; end if;
  if not private.can_access_script_actor(target_user_id, research_record.organization_id, research_record.assigned_to) then
    raise exception 'You cannot use this private research item';
  end if;
  if research_record.status in ('used', 'archived') then
    raise exception 'This research item is already closed';
  end if;

  insert into public.scripts (
    organization_id, created_by, assigned_to, title, input_mode, source_url,
    source_text, objective, audience, platform, hook_variants
  ) values (
    research_record.organization_id, target_user_id, research_record.assigned_to,
    research_record.title,
    case when research_record.source_url is null then 'idea'::public.script_input_mode else 'reference'::public.script_input_mode end,
    research_record.source_url,
    nullif(concat_ws(E'\n\n', nullif(research_record.transcript, ''), nullif(research_record.raw_notes, ''),
      nullif(research_record.transferable_principle, ''), nullif(research_record.why_it_works, ''),
      nullif(array_to_string(research_record.original_angles, E'\n'), '')), ''),
    coalesce(nullif(research_record.transferable_principle, ''), nullif(research_record.raw_notes, ''), research_record.title),
    'متداولون عرب', 'instagram',
    case when nullif(research_record.hook, '') is null then '{}'::text[] else array[research_record.hook] end
  ) returning id into script_id;

  perform private.add_script_version(script_id, 'manual_save', target_user_id, 'مسودة من بنك الأفكار');
  update public.script_research_items set
    status = 'used', linked_script_id = script_id, used_at = now()
  where id = target_research_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    research_record.organization_id, target_user_id, 'script.created_from_research', 'script', script_id,
    jsonb_build_object('research_id', target_research_id)
  );
  return script_id;
end;
$$;

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
declare
  current_version bigint;
  new_version bigint;
begin
  if not private.is_script_owner_actor(target_user_id, target_organization_id) then
    raise exception 'Only the organization owner can edit the writing voice';
  end if;
  select edit_version into current_version
  from public.script_voice_profiles where organization_id = target_organization_id for update;

  if current_version is null then
    if expected_edit_version <> 0 then raise exception 'Writing voice changed; refresh before saving'; end if;
    insert into public.script_voice_profiles (
      organization_id, voice_summary, writing_rules, banned_phrases, story_bank,
      approved_examples, source_notes, updated_by
    ) values (
      target_organization_id, coalesce(profile_voice_summary, ''),
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
    where organization_id = target_organization_id
    returning edit_version into new_version;
  end if;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id, target_user_id, 'script_voice.saved', 'script_voice_profile', target_organization_id,
    jsonb_build_object('edit_version', new_version)
  );
  return new_version;
end;
$$;

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
declare
  script_record public.scripts%rowtype;
  voice_context jsonb;
  brand_context jsonb;
begin
  select * into script_record from public.scripts where id = target_script_id;
  if script_record.id is null then raise exception 'Script not found'; end if;
  if not private.can_access_script_actor(target_user_id, script_record.organization_id, script_record.assigned_to) then
    raise exception 'You cannot generate this private script';
  end if;
  if script_record.status in ('handed_off', 'archived') then
    raise exception 'Handed-off or archived scripts are read-only';
  end if;

  select coalesce(to_jsonb(profile), '{}'::jsonb) into voice_context
  from public.script_voice_profiles profile
  where profile.organization_id = script_record.organization_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'category', article.category,
    'title', article.title,
    'summary', article.summary,
    'guidelines', article.guidelines,
    'do_list', article.do_list,
    'dont_list', article.dont_list,
    'examples', article.examples
  ) order by article.updated_at desc), '[]'::jsonb) into brand_context
  from (
    select * from public.brand_articles
    where organization_id = script_record.organization_id
      and status = 'approved'
      and category in ('foundation', 'copy_voice', 'compliance', 'offer_product')
    order by updated_at desc
    limit 20
  ) article;

  return jsonb_build_object(
    'script', to_jsonb(script_record),
    'voice_profile', coalesce(voice_context, '{}'::jsonb),
    'brand_articles', coalesce(brand_context, '[]'::jsonb)
  );
end;
$$;

create or replace function public.handoff_script_to_content(
  target_user_id uuid,
  target_script_id uuid,
  expected_edit_version bigint,
  target_publish_at timestamptz,
  content_creator_id uuid,
  editing_owner_id uuid,
  thumbnail_owner_id uuid,
  publishing_owner_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  script_record public.scripts%rowtype;
  content_id uuid;
  brand_ids uuid[];
begin
  select * into script_record from public.scripts where id = target_script_id for update;
  if script_record.id is null then raise exception 'Script not found'; end if;
  if not private.is_script_owner_actor(target_user_id, script_record.organization_id) then
    raise exception 'Only the organization owner can hand off scripts to Content Factory';
  end if;
  if script_record.edit_version <> expected_edit_version then
    raise exception 'Script changed in another session; refresh before handoff';
  end if;
  if script_record.status <> 'ready_to_record' then
    raise exception 'Mark the script ready to record before handoff';
  end if;
  if char_length(trim(script_record.spoken_script)) < 20
    or char_length(trim(coalesce(script_record.cta, ''))) < 2 then
    raise exception 'Complete the spoken script and CTA before handoff';
  end if;
  if target_publish_at <= now() then raise exception 'Publish time must be in the future'; end if;

  select coalesce(array_agg(article.id order by article.updated_at desc), '{}'::uuid[])
  into brand_ids
  from (
    select id, updated_at from public.brand_articles
    where organization_id = script_record.organization_id and status = 'approved'
    order by updated_at desc limit 8
  ) article;

  content_id := public.create_reel_production_workflow_v3(
    target_user_id,
    script_record.organization_id,
    script_record.title,
    script_record.objective,
    coalesce(nullif(script_record.hook_variants[1], ''), script_record.title),
    script_record.cta,
    script_record.spoken_script,
    coalesce(nullif(script_record.editing_notes, ''), 'مونتاج نظيف وسريع يحافظ على وضوح الفكرة.'),
    coalesce(nullif(script_record.thumbnail_notes, ''), 'غلاف واضح يعكس الفكرة بدون مبالغة.'),
    concat_ws(E'\n\n', nullif(script_record.claims_notes, ''), nullif(script_record.recording_notes, ''), nullif(script_record.on_screen_text, '')),
    target_publish_at,
    content_creator_id,
    editing_owner_id,
    thumbnail_owner_id,
    publishing_owner_id,
    publishing_owner_id,
    '',
    coalesce(script_record.source_url, ''),
    coalesce(script_record.source_url, ''),
    brand_ids
  );

  update public.scripts set
    status = 'handed_off',
    content_item_id = content_id,
    handed_off_at = now(),
    handed_off_by = target_user_id,
    edit_version = edit_version + 1
  where id = target_script_id;
  perform private.add_script_version(target_script_id, 'handoff', target_user_id, 'تسليم لمصنع المحتوى');

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    script_record.organization_id, target_user_id, 'script.handed_off', 'script', target_script_id,
    jsonb_build_object('status', script_record.status),
    jsonb_build_object('status', 'handed_off', 'content_item_id', content_id)
  );
  return content_id;
end;
$$;

revoke all on function public.create_script_draft(
  uuid, uuid, uuid, text, public.script_input_mode, text, text, text, text, text, integer, text
) from public, anon, authenticated;
grant execute on function public.create_script_draft(
  uuid, uuid, uuid, text, public.script_input_mode, text, text, text, text, text, integer, text
) to service_role;

revoke all on function public.save_script_draft(
  uuid, uuid, bigint, text, public.script_input_mode, text, text, text, text, text,
  integer, text, text[], text, text, text, text[], text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.save_script_draft(
  uuid, uuid, bigint, text, public.script_input_mode, text, text, text, text, text,
  integer, text, text[], text, text, text, text[], text, text, text, text, text, text, text
) to service_role;

revoke all on function public.save_ai_script_generation(
  uuid, uuid, bigint, text[], text, text, text, text[], text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.save_ai_script_generation(
  uuid, uuid, bigint, text[], text, text, text, text[], text, text, text, text, text, text
) to service_role;

revoke all on function public.change_script_status(uuid, uuid, public.script_status, bigint)
from public, anon, authenticated;
grant execute on function public.change_script_status(uuid, uuid, public.script_status, bigint)
to service_role;

revoke all on function public.create_script_research_item(
  uuid, uuid, uuid, public.script_research_kind, text, text, text, text, text, text, text,
  text[], smallint, smallint, smallint
) from public, anon, authenticated;
grant execute on function public.create_script_research_item(
  uuid, uuid, uuid, public.script_research_kind, text, text, text, text, text, text, text,
  text[], smallint, smallint, smallint
) to service_role;

revoke all on function public.create_script_from_research(uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_script_from_research(uuid, uuid) to service_role;

revoke all on function public.save_script_voice_profile(
  uuid, uuid, bigint, text, text[], text[], text[], text, text
) from public, anon, authenticated;
grant execute on function public.save_script_voice_profile(
  uuid, uuid, bigint, text, text[], text[], text[], text, text
) to service_role;

revoke all on function public.get_script_ai_context(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_script_ai_context(uuid, uuid) to service_role;

revoke all on function public.handoff_script_to_content(
  uuid, uuid, bigint, timestamptz, uuid, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.handoff_script_to_content(
  uuid, uuid, bigint, timestamptz, uuid, uuid, uuid, uuid
) to service_role;

-- Add the new product area to the existing explicit presence contract.
alter table public.member_presence drop constraint member_presence_section_allowed;
alter table public.member_presence add constraint member_presence_section_allowed check (
  current_section in (
    'dashboard', 'tasks', 'content', 'scripts', 'publishing', 'brand',
    'campaigns', 'crm', 'analytics', 'team', 'settings'
  )
);

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
    'dashboard', 'tasks', 'content', 'scripts', 'publishing', 'brand',
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

-- Realtime only refreshes visible tenant-scoped rows; RLS still controls payload access.
do $$
declare
  target_table text;
begin
  foreach target_table in array array['scripts', 'script_research_items', 'script_voice_profiles']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = target_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', target_table);
    end if;
  end loop;
end;
$$;
