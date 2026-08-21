-- Separate AI writing previews from the approved production package.
-- Writing previews never mutate a script. Production artifacts can only be
-- generated after the script is explicitly marked ready to record.

alter table public.scripts
  add column production_pack_source_version bigint,
  add column production_pack_stale boolean not null default false;

alter table public.scripts
  add constraint scripts_production_pack_version_positive
    check (production_pack_source_version is null or production_pack_source_version > 0),
  add constraint scripts_production_pack_state_consistent
    check (production_pack_source_version is not null or not production_pack_stale),
  add constraint scripts_ready_has_spoken_copy
    check (status not in ('ready_to_record', 'handed_off') or char_length(trim(spoken_script)) >= 20)
    not valid;

create or replace function private.extract_script_cta(script_body text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(trim(line), 500)
  from unnest(regexp_split_to_array(coalesce(script_body, ''), E'\\r?\\n+'))
    with ordinality as candidate(line, position)
  where trim(line) <> ''
    and lower(trim(line)) not in ('سلام', 'سلام يا حوت', 'سلام ياحوت')
  order by position desc
  limit 1;
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
  writing_changed boolean;
begin
  select * into script_record from public.scripts where id = target_script_id for update;
  if script_record.id is null then raise exception 'Script not found'; end if;
  if not private.can_access_script_actor(target_user_id, script_record.organization_id, script_record.assigned_to) then
    raise exception 'You cannot edit this private script';
  end if;
  if script_record.status in ('handed_off', 'archived') then
    raise exception 'Handed-off or archived scripts are read-only';
  end if;

  writing_changed := script_record.title is distinct from trim(script_title)
    or script_record.objective is distinct from trim(script_objective)
    or script_record.duration_seconds is distinct from script_duration_seconds
    or script_record.hook_variants is distinct from coalesce(script_hook_variants, '{}'::text[])
    or script_record.spoken_script is distinct from coalesce(script_spoken_script, '');

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
    -- CTA stays structured for the Content Factory, but the user edits it once
    -- inside the spoken script. The last useful line is the fallback metadata.
    cta = coalesce(nullif(trim(script_cta), ''), private.extract_script_cta(script_spoken_script), ''),
    caption = coalesce(script_caption, ''),
    hashtags = coalesce(script_hashtags, '{}'::text[]),
    recording_notes = coalesce(script_recording_notes, ''),
    editing_notes = coalesce(script_editing_notes, ''),
    thumbnail_notes = coalesce(script_thumbnail_notes, ''),
    on_screen_text = coalesce(script_on_screen_text, ''),
    b_roll_notes = coalesce(script_b_roll_notes, ''),
    claims_notes = coalesce(script_claims_notes, ''),
    status = case when writing_changed and status = 'ready_to_record' then 'draft'::public.script_status else status end,
    production_pack_stale = case
      when writing_changed and production_pack_source_version is not null then true
      else production_pack_stale
    end,
    edit_version = edit_version + 1
  where id = target_script_id and edit_version = expected_edit_version;
  get diagnostics changed = row_count;
  if changed = 0 then raise exception 'Script changed in another session; refresh before saving'; end if;

  select edit_version into new_version from public.scripts where id = target_script_id;
  perform private.add_script_version(target_script_id, 'manual_save', target_user_id, nullif(trim(version_note), ''));
  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    script_record.organization_id, target_user_id, 'script.saved', 'script', target_script_id,
    jsonb_build_object('edit_version', expected_edit_version, 'status', script_record.status),
    jsonb_build_object(
      'edit_version', new_version,
      'writing_changed', writing_changed,
      'status', case when writing_changed and script_record.status = 'ready_to_record' then 'draft' else script_record.status::text end,
      'production_pack_stale', writing_changed and script_record.production_pack_source_version is not null
    )
  );
  return new_version;
end;
$$;

create or replace function public.save_ai_script_production(
  target_user_id uuid,
  target_script_id uuid,
  expected_edit_version bigint,
  generation_scope text,
  generated_cta text,
  generated_caption text,
  generated_hashtags text[],
  generated_recording_notes text,
  generated_editing_notes text,
  generated_thumbnail_notes text,
  generated_on_screen_text text,
  generated_b_roll_notes text,
  generated_claims_notes text
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
  generation_label text;
begin
  if generation_scope not in ('production_pack', 'recording', 'editing', 'thumbnail', 'caption') then
    raise exception 'Unknown production generation scope';
  end if;

  select * into script_record from public.scripts where id = target_script_id for update;
  if script_record.id is null then raise exception 'Script not found'; end if;
  if not private.can_access_script_actor(target_user_id, script_record.organization_id, script_record.assigned_to) then
    raise exception 'You cannot generate this private script';
  end if;
  if script_record.status <> 'ready_to_record' then
    raise exception 'Approve the final script before generating production instructions';
  end if;
  if script_record.edit_version <> expected_edit_version then
    raise exception 'Script changed in another session; refresh before generating';
  end if;
  if generation_scope <> 'production_pack'
    and (script_record.production_pack_source_version is null or script_record.production_pack_stale) then
    raise exception 'Regenerate the full production pack after changing the script';
  end if;

  update public.scripts set
    cta = case
      when generation_scope in ('production_pack', 'caption') then coalesce(nullif(trim(generated_cta), ''), private.extract_script_cta(spoken_script), '')
      else cta
    end,
    caption = case when generation_scope in ('production_pack', 'caption') then coalesce(generated_caption, '') else caption end,
    hashtags = case when generation_scope in ('production_pack', 'caption') then coalesce(generated_hashtags, '{}'::text[]) else hashtags end,
    recording_notes = case when generation_scope in ('production_pack', 'recording') then coalesce(generated_recording_notes, '') else recording_notes end,
    editing_notes = case when generation_scope in ('production_pack', 'editing') then coalesce(generated_editing_notes, '') else editing_notes end,
    thumbnail_notes = case when generation_scope in ('production_pack', 'thumbnail') then coalesce(generated_thumbnail_notes, '') else thumbnail_notes end,
    on_screen_text = case when generation_scope in ('production_pack', 'editing') then coalesce(generated_on_screen_text, '') else on_screen_text end,
    b_roll_notes = case when generation_scope in ('production_pack', 'editing') then coalesce(generated_b_roll_notes, '') else b_roll_notes end,
    claims_notes = case when generation_scope in ('production_pack', 'editing') then coalesce(generated_claims_notes, '') else claims_notes end,
    production_pack_source_version = case when generation_scope = 'production_pack' then expected_edit_version else production_pack_source_version end,
    production_pack_stale = case when generation_scope = 'production_pack' then false else production_pack_stale end,
    ai_last_generated_at = now(),
    ai_last_generated_by = target_user_id,
    edit_version = edit_version + 1
  where id = target_script_id and edit_version = expected_edit_version;
  get diagnostics changed = row_count;
  if changed = 0 then raise exception 'Script changed in another session; refresh before generating'; end if;

  generation_label := case generation_scope
    when 'production_pack' then 'إنشاء حزمة التنفيذ من النص المعتمد'
    when 'recording' then 'إعادة توليد تعليمات التسجيل'
    when 'editing' then 'إعادة توليد تعليمات المونتاج'
    when 'thumbnail' then 'إعادة توليد تعليمات الغلاف'
    else 'إعادة توليد الكابشن والهاشتاجات'
  end;
  select edit_version into new_version from public.scripts where id = target_script_id;
  perform private.add_script_version(target_script_id, 'ai_generation', target_user_id, generation_label);
  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    script_record.organization_id, target_user_id, 'script.ai_production_generated', 'script', target_script_id,
    jsonb_build_object('edit_version', new_version, 'scope', generation_scope, 'source_version', expected_edit_version)
  );
  return new_version;
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
declare
  research_record public.script_research_items%rowtype;
  voice_context jsonb;
  brand_context jsonb;
begin
  select * into research_record from public.script_research_items where id = target_research_id;
  if research_record.id is null then raise exception 'Research item not found'; end if;
  if not private.can_access_script_actor(target_user_id, research_record.organization_id, research_record.assigned_to) then
    raise exception 'You cannot generate this private research item';
  end if;
  if research_record.status in ('used', 'archived') then raise exception 'This research item is already closed'; end if;

  select coalesce(to_jsonb(profile), '{}'::jsonb) into voice_context
  from public.script_voice_profiles profile
  where profile.organization_id = research_record.organization_id;

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
    where organization_id = research_record.organization_id
      and status = 'approved'
      and category in ('foundation', 'copy_voice', 'compliance', 'offer_product')
    order by updated_at desc
    limit 20
  ) article;

  return jsonb_build_object(
    'research', to_jsonb(research_record),
    'script', jsonb_build_object(
      'title', research_record.title,
      'input_mode', case when research_record.source_url is null then 'idea' else 'reference' end,
      'source_url', research_record.source_url,
      'source_text', concat_ws(E'\n\n', nullif(research_record.transcript, ''), nullif(research_record.raw_notes, ''),
        nullif(research_record.transferable_principle, ''), nullif(research_record.why_it_works, ''),
        nullif(array_to_string(research_record.original_angles, E'\n'), '')),
      'objective', coalesce(nullif(research_record.transferable_principle, ''), nullif(research_record.raw_notes, ''), research_record.title),
      'audience', 'متداولون عرب',
      'platform', 'instagram',
      'duration_seconds', 60,
      'hook_variants', case when research_record.hook = '' then jsonb_build_array() else jsonb_build_array(research_record.hook) end,
      'organization_id', research_record.organization_id,
      'assigned_to', research_record.assigned_to
    ),
    'voice_profile', coalesce(voice_context, '{}'::jsonb),
    'brand_articles', coalesce(brand_context, '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_script_research_ai_provider_runtime(
  target_user_id uuid,
  target_research_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  research_record public.script_research_items%rowtype;
  provider_record public.ai_providers%rowtype;
  api_key text;
begin
  select * into research_record from public.script_research_items where id = target_research_id;
  if research_record.id is null then raise exception 'Research item not found'; end if;
  if not private.can_access_script_actor(target_user_id, research_record.organization_id, research_record.assigned_to) then
    raise exception 'You cannot generate this private research item';
  end if;

  select * into provider_record
  from public.ai_providers
  where organization_id = research_record.organization_id and is_enabled and is_default
  limit 1;
  if provider_record.id is null then return null; end if;

  select decrypted.decrypted_secret into api_key
  from private.ai_provider_secrets secret_ref
  join vault.decrypted_secrets decrypted on decrypted.id = secret_ref.vault_secret_id
  where secret_ref.provider_id = provider_record.id;
  if api_key is null then return null; end if;

  return jsonb_build_object(
    'id', provider_record.id,
    'name', provider_record.name,
    'protocol', provider_record.protocol,
    'base_url', provider_record.base_url,
    'model', provider_record.model,
    'api_key', api_key
  );
end;
$$;

create or replace function public.create_script_from_research_variant(
  target_user_id uuid,
  target_research_id uuid,
  selected_hook_variants text[],
  selected_spoken_script text,
  selected_cta text
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
  if research_record.status in ('used', 'archived') then raise exception 'This research item is already closed'; end if;
  if char_length(trim(selected_spoken_script)) < 20 or char_length(selected_spoken_script) > 30000 then
    raise exception 'Choose a complete generated script before saving';
  end if;
  if not private.valid_script_text_list(coalesce(selected_hook_variants, '{}'::text[]), 8, 500) then
    raise exception 'Generated hook alternatives are invalid';
  end if;

  insert into public.scripts (
    organization_id, created_by, assigned_to, title, input_mode, source_url,
    source_text, objective, audience, platform, hook_variants, spoken_script, cta
  ) values (
    research_record.organization_id, target_user_id, research_record.assigned_to,
    research_record.title,
    case when research_record.source_url is null then 'idea'::public.script_input_mode else 'reference'::public.script_input_mode end,
    research_record.source_url,
    nullif(concat_ws(E'\n\n', nullif(research_record.transcript, ''), nullif(research_record.raw_notes, ''),
      nullif(research_record.transferable_principle, ''), nullif(research_record.why_it_works, ''),
      nullif(array_to_string(research_record.original_angles, E'\n'), '')), ''),
    coalesce(nullif(research_record.transferable_principle, ''), nullif(research_record.raw_notes, ''), research_record.title),
    'متداولون عرب', 'instagram', coalesce(selected_hook_variants, '{}'::text[]),
    trim(selected_spoken_script), coalesce(nullif(trim(selected_cta), ''), private.extract_script_cta(selected_spoken_script), '')
  ) returning id into script_id;

  perform private.add_script_version(script_id, 'manual_save', target_user_id, 'نسخة مختارة من معاينة AI');
  update public.script_research_items set status = 'used', linked_script_id = script_id, used_at = now()
  where id = target_research_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    research_record.organization_id, target_user_id, 'script.created_from_ai_preview', 'script', script_id,
    jsonb_build_object('research_id', target_research_id)
  );
  return script_id;
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
  resolved_cta text;
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
  if char_length(trim(script_record.spoken_script)) < 20 then
    raise exception 'Complete the spoken script before handoff';
  end if;
  if target_publish_at <= now() then raise exception 'Publish time must be in the future'; end if;
  resolved_cta := coalesce(private.extract_script_cta(script_record.spoken_script), nullif(trim(script_record.cta), ''), 'شاهد المحتوى كاملًا');

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
    resolved_cta,
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
    status = 'handed_off', content_item_id = content_id, handed_off_at = now(), handed_off_by = target_user_id,
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

drop function if exists public.save_ai_script_generation(
  uuid, uuid, bigint, text[], text, text, text, text[], text, text, text, text, text, text
);

revoke all on function private.extract_script_cta(text) from public, anon, authenticated;

revoke all on function public.save_ai_script_production(
  uuid, uuid, bigint, text, text, text, text[], text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.save_ai_script_production(
  uuid, uuid, bigint, text, text, text, text[], text, text, text, text, text, text
) to service_role;

revoke all on function public.get_script_research_ai_context(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_script_research_ai_context(uuid, uuid) to service_role;

revoke all on function public.get_script_research_ai_provider_runtime(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_script_research_ai_provider_runtime(uuid, uuid) to service_role;

revoke all on function public.create_script_from_research_variant(uuid, uuid, text[], text, text)
from public, anon, authenticated;
grant execute on function public.create_script_from_research_variant(uuid, uuid, text[], text, text)
to service_role;
