alter table public.content_items
  add column caption_brief text not null default '';

alter table public.content_items
  add constraint content_items_caption_brief_length
  check (char_length(caption_brief) <= 10000);

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

  update public.content_items set
    caption_brief = left(concat_ws(E'\n\n', nullif(trim(script_record.caption), ''),
      nullif(array_to_string(script_record.hashtags, ' '), '')), 10000)
  where id = content_id and organization_id = script_record.organization_id;

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
    jsonb_build_object('status', 'handed_off', 'content_item_id', content_id,
      'caption_brief_carried', nullif(trim(script_record.caption), '') is not null)
  );
  return content_id;
end;
$$;

revoke all on function public.handoff_script_to_content(
  uuid, uuid, bigint, timestamptz, uuid, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.handoff_script_to_content(
  uuid, uuid, bigint, timestamptz, uuid, uuid, uuid, uuid
) to service_role;
