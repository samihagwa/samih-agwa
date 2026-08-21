-- A voice sample is useful only after Samih has manually edited and saved it.
-- Keep the existing profile as the single source of truth, but append explicit,
-- machine-readable samples so legacy/advertising examples can be ignored by AI.
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
  select * into script_record
  from public.scripts
  where id = target_script_id
  for update;

  if script_record.id is null then raise exception 'Script not found'; end if;
  if not private.is_script_owner_actor(target_user_id, script_record.organization_id) then
    raise exception 'Only the organization owner can approve writing voice samples';
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
  where organization_id = script_record.organization_id
  for update;

  if profile_record.organization_id is null then
    raise exception 'Writing voice profile not found';
  end if;

  sample_marker := '[عينة معتمدة من سميح | script:' || script_record.id::text || ']';
  if position(sample_marker in profile_record.approved_examples) > 0 then
    raise exception 'Script already approved as a writing voice sample';
  end if;

  sample_block := sample_marker
    || E'\nالعنوان: ' || trim(script_record.title)
    || E'\nالنص:\n' || trim(script_record.spoken_script)
    || E'\n[نهاية العينة]';
  next_examples := case
    when trim(profile_record.approved_examples) = '' then sample_block
    else profile_record.approved_examples || E'\n\n---\n\n' || sample_block
  end;

  if char_length(next_examples) > 30000 then
    raise exception 'Writing voice examples are full; remove an old sample first';
  end if;

  update public.script_voice_profiles set
    approved_examples = next_examples,
    edit_version = edit_version + 1,
    updated_by = target_user_id
  where organization_id = script_record.organization_id
  returning edit_version into new_profile_version;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    script_record.organization_id, target_user_id, 'script_voice.sample_approved', 'script', script_record.id,
    jsonb_build_object(
      'script_edit_version', script_record.edit_version,
      'voice_profile_edit_version', new_profile_version
    )
  );

  return new_profile_version;
end;
$$;

revoke all on function public.approve_script_as_voice_sample(uuid, uuid, bigint)
from public, anon, authenticated;
grant execute on function public.approve_script_as_voice_sample(uuid, uuid, bigint)
to service_role;
