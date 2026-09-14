-- A draft text autosave does not create a meaningful version. The existing
-- explicit save remains the only path that appends a manual script_version.
create or replace function public.autosave_script_text(
  target_user_id uuid,
  target_script_id uuid,
  expected_edit_version bigint,
  draft_text text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  script_record public.scripts%rowtype;
  next_version bigint;
begin
  if draft_text is null or length(draft_text) > 30000 then
    raise exception 'Draft text is invalid';
  end if;
  select * into script_record from public.scripts where id = target_script_id for update;
  if script_record.id is null or script_record.assigned_to <> target_user_id
    or not private.can_access_script_actor(target_user_id, script_record.organization_id, script_record.assigned_to) then
    raise exception 'Private script is not available to this writer';
  end if;
  if script_record.status in ('handed_off', 'archived') then
    raise exception 'Handed-off or archived scripts are read-only';
  end if;
  if script_record.edit_version <> expected_edit_version then
    raise exception 'Script changed in another session; refresh before saving';
  end if;
  if script_record.spoken_script = draft_text then return script_record.edit_version; end if;

  update public.scripts set
    spoken_script = draft_text,
    cta = coalesce(private.extract_script_cta(draft_text), ''),
    status = case when status = 'ready_to_record' then 'draft'::public.script_status else status end,
    production_pack_stale = case when production_pack_source_version is not null then true else production_pack_stale end,
    edit_version = edit_version + 1
  where id = target_script_id
  returning edit_version into next_version;
  if script_record.status = 'ready_to_record' then
    insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, before_data, after_data)
    values (script_record.organization_id, target_user_id, 'script.autosave_reopened', 'script', target_script_id,
      jsonb_build_object('edit_version', expected_edit_version, 'status', script_record.status),
      jsonb_build_object('edit_version', next_version, 'status', 'draft'));
  end if;
  return next_version;
end;
$$;

revoke all on function public.autosave_script_text(uuid, uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.autosave_script_text(uuid, uuid, bigint, text) to service_role;

-- Keep the existing content_pillar/series untouched. Old scripts receive a
-- conservative default; authors can choose a kind on their next manual save.
alter table public.scripts add column content_kind text not null default 'educational';
alter table public.scripts add constraint scripts_content_kind_allowed check (
  content_kind in ('chart', 'educational', 'personal_story', 'awareness', 'opinion', 'advertisement')
);

create or replace function public.create_script_with_kind(
  target_user_id uuid, target_organization_id uuid, target_assigned_to uuid,
  script_title text, script_input_mode public.script_input_mode,
  script_source_url text, script_source_text text, script_objective text,
  script_audience text, script_platform text, script_duration_seconds integer,
  script_content_pillar text, script_content_kind text
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare result_id uuid;
begin
  if script_content_kind not in ('chart', 'educational', 'personal_story', 'awareness', 'opinion', 'advertisement') then
    raise exception 'Invalid script content kind';
  end if;
  result_id := public.create_script_draft(
    target_user_id, target_organization_id, target_assigned_to, script_title,
    script_input_mode, script_source_url, script_source_text, script_objective,
    script_audience, script_platform, script_duration_seconds, script_content_pillar
  );
  update public.scripts set content_kind = script_content_kind where id = result_id;
  update public.script_versions set snapshot = jsonb_set(snapshot, '{content_kind}', to_jsonb(script_content_kind))
  where script_id = result_id and version_number = 1;
  return result_id;
end;
$$;

create or replace function public.save_script_with_kind(
  target_user_id uuid, target_script_id uuid, expected_edit_version bigint,
  script_title text, script_input_mode public.script_input_mode,
  script_source_url text, script_source_text text, script_objective text,
  script_audience text, script_platform text, script_duration_seconds integer,
  script_content_pillar text, script_content_kind text, script_hook_variants text[],
  script_spoken_script text, script_cta text, script_caption text,
  script_hashtags text[], script_recording_notes text, script_editing_notes text,
  script_thumbnail_notes text, script_on_screen_text text, script_b_roll_notes text,
  script_claims_notes text, version_note text
)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare result_version bigint; old_kind text; org_id uuid;
begin
  if script_content_kind not in ('chart', 'educational', 'personal_story', 'awareness', 'opinion', 'advertisement') then
    raise exception 'Invalid script content kind';
  end if;
  select content_kind, organization_id into old_kind, org_id from public.scripts
  where id = target_script_id and edit_version = expected_edit_version for update;
  -- A failed base save rolls back this metadata update in the same transaction.
  update public.scripts set
    status = case when content_kind is distinct from script_content_kind and status = 'ready_to_record'
      then 'draft'::public.script_status else status end,
    production_pack_stale = case when content_kind is distinct from script_content_kind
      and production_pack_source_version is not null then true else production_pack_stale end,
    content_kind = script_content_kind
  where id = target_script_id and edit_version = expected_edit_version;
  result_version := public.save_script_draft(
    target_user_id, target_script_id, expected_edit_version, script_title, script_input_mode,
    script_source_url, script_source_text, script_objective, script_audience,
    script_platform, script_duration_seconds, script_content_pillar,
    script_hook_variants, script_spoken_script, script_cta, script_caption, script_hashtags,
    script_recording_notes, script_editing_notes, script_thumbnail_notes,
    script_on_screen_text, script_b_roll_notes, script_claims_notes, version_note
  );
  if old_kind is distinct from script_content_kind then
    insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, before_data, after_data)
    values (org_id, target_user_id, 'script.content_kind_changed', 'script', target_script_id,
      jsonb_build_object('content_kind', old_kind), jsonb_build_object('content_kind', script_content_kind));
  end if;
  return result_version;
end;
$$;

revoke all on function public.create_script_with_kind(uuid, uuid, uuid, text, public.script_input_mode, text, text, text, text, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.create_script_with_kind(uuid, uuid, uuid, text, public.script_input_mode, text, text, text, text, text, integer, text, text) to service_role;
revoke all on function public.save_script_with_kind(uuid, uuid, bigint, text, public.script_input_mode, text, text, text, text, text, integer, text, text, text[], text, text, text, text[], text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.save_script_with_kind(uuid, uuid, bigint, text, public.script_input_mode, text, text, text, text, text, integer, text, text, text[], text, text, text, text[], text, text, text, text, text, text, text) to service_role;

-- Review permission is per-script, never inherited from being the owner of the
-- organization. Neither these rows nor comments contain the writer's voice.
create table public.script_review_access (
  script_id uuid not null,
  organization_id uuid not null,
  reviewer_id uuid not null references public.profiles(id) on delete restrict,
  granted_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (script_id, reviewer_id),
  foreign key (script_id, organization_id) references public.scripts(id, organization_id) on delete cascade
);
create index script_review_access_reviewer_idx on public.script_review_access(reviewer_id, organization_id);
alter table public.script_review_access enable row level security;
revoke all on public.script_review_access from public, anon, authenticated;
grant select on public.script_review_access to authenticated;
create policy script_review_access_read on public.script_review_access for select to authenticated
using (
  (reviewer_id = (select auth.uid()) or granted_by = (select auth.uid()))
  -- This granted helper also checks active membership. The internal writer
  -- helper is deliberately not executable by authenticated browser roles.
  and private.actor_can_access_any_section((select auth.uid()), organization_id, array['scripts']::text[])
);

drop policy if exists scripts_select_assignee_only on public.scripts;
create policy scripts_select_assignee_or_reviewer on public.scripts for select to authenticated
using (
  private.actor_can_access_any_section((select auth.uid()), organization_id, array['scripts']::text[])
  and (
    assigned_to = (select auth.uid())
    or exists (select 1 from public.script_review_access review
      where review.script_id = scripts.id and review.organization_id = scripts.organization_id
        and review.reviewer_id = (select auth.uid()))
  )
);

create table public.script_review_comments (
  id uuid primary key default gen_random_uuid(),
  script_id uuid not null,
  organization_id uuid not null,
  author_id uuid not null references public.profiles(id) on delete restrict,
  body text not null check (char_length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  foreign key (script_id, organization_id) references public.scripts(id, organization_id) on delete cascade
);
create index script_review_comments_script_idx on public.script_review_comments(script_id, created_at desc);
alter table public.script_review_comments enable row level security;
revoke all on public.script_review_comments from public, anon, authenticated;
grant select on public.script_review_comments to authenticated;
create policy script_review_comments_read on public.script_review_comments for select to authenticated
using (exists (select 1 from public.scripts script
  where script.id = script_review_comments.script_id and script.organization_id = script_review_comments.organization_id));

create or replace function public.set_script_review_access(
  target_user_id uuid, target_script_id uuid, target_reviewer_id uuid, allow_review boolean
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare script_record public.scripts%rowtype; changed integer;
begin
  select * into script_record from public.scripts where id = target_script_id for update;
  if script_record.id is null or not private.can_access_script_actor(
    target_user_id, script_record.organization_id, script_record.assigned_to) then
    raise exception 'Only the script writer can share it for review';
  end if;
  if allow_review then
    if target_reviewer_id = target_user_id or not private.is_active_script_actor(target_reviewer_id, script_record.organization_id)
      or not private.actor_can_access_any_section(target_reviewer_id, script_record.organization_id, array['scripts']::text[]) then
      raise exception 'Reviewer must be an active member with Scripts access';
    end if;
    insert into public.script_review_access(script_id, organization_id, reviewer_id, granted_by)
    values (target_script_id, script_record.organization_id, target_reviewer_id, target_user_id)
    on conflict (script_id, reviewer_id) do nothing;
    get diagnostics changed = row_count;
  else
    delete from public.script_review_access where script_id = target_script_id
      and reviewer_id = target_reviewer_id and granted_by = target_user_id;
    get diagnostics changed = row_count;
  end if;
  if changed > 0 then
    insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, after_data)
    values (script_record.organization_id, target_user_id,
      case when allow_review then 'script.review_shared' else 'script.review_revoked' end,
      'script', target_script_id, jsonb_build_object('reviewer_id', target_reviewer_id));
  end if;
  return true;
end;
$$;

create or replace function public.add_script_review_comment(
  target_user_id uuid, target_script_id uuid, comment_body text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare script_record public.scripts%rowtype; comment_id uuid;
begin
  select * into script_record from public.scripts where id = target_script_id;
  if script_record.id is null or not private.actor_can_access_any_section(
    target_user_id, script_record.organization_id, array['scripts']::text[])
    or not private.is_active_script_actor(target_user_id, script_record.organization_id)
    or not (script_record.assigned_to = target_user_id or exists (
      select 1 from public.script_review_access review
      where review.script_id = target_script_id and review.reviewer_id = target_user_id
    )) then raise exception 'Private script review is not available'; end if;
  if comment_body is null or char_length(trim(comment_body)) not between 1 and 4000 then
    raise exception 'Comment must contain 1 to 4000 characters';
  end if;
  insert into public.script_review_comments(script_id, organization_id, author_id, body)
  values (target_script_id, script_record.organization_id, target_user_id, trim(comment_body))
  returning id into comment_id;
  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, after_data)
  values (script_record.organization_id, target_user_id, 'script.review_commented', 'script', target_script_id,
    jsonb_build_object('comment_id', comment_id));
  return comment_id;
end;
$$;
revoke all on function public.set_script_review_access(uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_script_review_access(uuid, uuid, uuid, boolean) to service_role;
revoke all on function public.add_script_review_comment(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.add_script_review_comment(uuid, uuid, text) to service_role;

-- Old approved_examples remain byte-for-byte unchanged and unclassified. New
-- examples have an explicit category and an independent active switch.
create table public.script_voice_samples (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  source_script_id uuid references public.scripts(id) on delete set null,
  content_kind text not null check (content_kind in ('chart', 'educational', 'personal_story', 'awareness', 'opinion', 'advertisement')),
  sample_text text not null check (char_length(trim(sample_text)) between 20 and 5000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index script_voice_samples_source_idx on public.script_voice_samples(owner_id, source_script_id) where source_script_id is not null;
create index script_voice_samples_kind_idx on public.script_voice_samples(owner_id, content_kind, active, updated_at desc);
create trigger script_voice_samples_set_updated_at before update on public.script_voice_samples
for each row execute function private.set_updated_at();
alter table public.script_voice_samples enable row level security;
revoke all on public.script_voice_samples from public, anon, authenticated;
grant select on public.script_voice_samples to authenticated;
create policy script_voice_samples_self on public.script_voice_samples for select to authenticated
using (owner_id = (select auth.uid()) and private.actor_can_access_any_section(
  (select auth.uid()), organization_id, array['scripts']::text[]));

create or replace function public.manage_script_voice_sample(
  target_user_id uuid, target_organization_id uuid, target_sample_id uuid,
  target_script_id uuid, new_text text, new_kind text, enabled boolean
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare script_record public.scripts%rowtype; sample_record public.script_voice_samples%rowtype; result_id uuid;
begin
  if not private.can_access_script_actor(target_user_id, target_organization_id, target_user_id) then
    raise exception 'Private voice sample is not available'; end if;
  if new_kind not in ('chart', 'educational', 'personal_story', 'awareness', 'opinion', 'advertisement')
    or new_text is null or char_length(trim(new_text)) not between 20 and 5000 then
    raise exception 'Voice sample text or content category is invalid'; end if;
  if target_script_id is not null then
    select * into script_record from public.scripts where id = target_script_id;
    if script_record.id is null or script_record.organization_id <> target_organization_id
      or script_record.assigned_to <> target_user_id or script_record.content_kind <> new_kind
      or script_record.spoken_script <> new_text then
      raise exception 'Only your saved script can be approved in its category'; end if;
  end if;
  if target_sample_id is null then
    insert into public.script_voice_samples(organization_id, owner_id, source_script_id, content_kind, sample_text, active)
    values (target_organization_id, target_user_id, target_script_id, new_kind, trim(new_text), enabled)
    returning id into result_id;
  else
    select * into sample_record from public.script_voice_samples where id = target_sample_id for update;
    if sample_record.id is null or sample_record.owner_id <> target_user_id
      or sample_record.organization_id <> target_organization_id or target_script_id is not null then
      raise exception 'Private voice sample is not available'; end if;
    update public.script_voice_samples set sample_text = trim(new_text), content_kind = new_kind, active = enabled
    where id = target_sample_id returning id into result_id;
  end if;
  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, after_data)
  values (target_organization_id, target_user_id,
    case when target_sample_id is null then 'script.voice_sample_created' else 'script.voice_sample_updated' end,
    'script_voice_sample', result_id, jsonb_build_object('content_kind', new_kind, 'active', enabled));
  return result_id;
end;
$$;
revoke all on function public.manage_script_voice_sample(uuid, uuid, uuid, uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.manage_script_voice_sample(uuid, uuid, uuid, uuid, text, text, boolean) to service_role;

create or replace function public.approve_script_voice_sample_v2(
  target_user_id uuid, target_script_id uuid, expected_script_version bigint
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare script_record public.scripts%rowtype; latest_source public.script_version_source; latest_version_number bigint; sample_id uuid;
begin
  select * into script_record from public.scripts where id = target_script_id for update;
  if script_record.id is null or not private.can_access_script_actor(
    target_user_id, script_record.organization_id, script_record.assigned_to) then
    raise exception 'Only the assigned writer can approve this sample'; end if;
  if script_record.edit_version <> expected_script_version then
    raise exception 'Script changed in another session; refresh before approving'; end if;
  if char_length(trim(script_record.spoken_script)) < 20 then raise exception 'Complete the spoken script first'; end if;
  select source, version_number into latest_source, latest_version_number from public.script_versions
    where script_id = target_script_id order by version_number desc, created_at desc limit 1;
  if latest_source is distinct from 'manual_save'::public.script_version_source
    or latest_version_number is distinct from script_record.edit_version then
    raise exception 'Save a manual edit before approving a writing voice sample'; end if;
  insert into public.script_voice_samples(organization_id, owner_id, source_script_id, content_kind, sample_text)
  values (script_record.organization_id, target_user_id, target_script_id,
    script_record.content_kind, trim(script_record.spoken_script))
  on conflict (owner_id, source_script_id) where source_script_id is not null
    do update set content_kind = excluded.content_kind, sample_text = excluded.sample_text, active = true
  returning id into sample_id;
  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, after_data)
  values (script_record.organization_id, target_user_id, 'script.voice_sample_approved', 'script_voice_sample', sample_id,
    jsonb_build_object('script_id', target_script_id, 'content_kind', script_record.content_kind));
  return sample_id;
end;
$$;
revoke all on function public.approve_script_voice_sample_v2(uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.approve_script_voice_sample_v2(uuid, uuid, bigint) to service_role;
