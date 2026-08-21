-- Let the actual caption/thumbnail owner ask the configured AI provider for
-- choices after handoff, while keeping the final choice explicit and versioned.

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
      and (
        membership.role in ('owner', 'admin', 'manager')
        or exists (
          select 1
          from public.tasks task
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
declare
  item_record public.content_items%rowtype;
  voice_context jsonb;
  brand_context jsonb;
begin
  if not private.can_use_content_ai_actor(target_user_id, target_content_item_id, target_scope) then
    raise exception 'You cannot generate choices for this content step';
  end if;

  select * into item_record
  from public.content_items item
  where item.id = target_content_item_id;

  select coalesce(to_jsonb(profile), '{}'::jsonb) into voice_context
  from public.script_voice_profiles profile
  where profile.organization_id = item_record.organization_id;

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
    select *
    from public.brand_articles
    where organization_id = item_record.organization_id
      and status = 'approved'
      and category in ('foundation', 'copy_voice', 'visual_identity', 'compliance', 'offer_product')
    order by updated_at desc
    limit 20
  ) article;

  return jsonb_build_object(
    'script', jsonb_build_object(
      'id', item_record.id,
      'organization_id', item_record.organization_id,
      'title', item_record.title,
      'input_mode', 'manual',
      'source_url', item_record.intake_source_url,
      'source_text', item_record.intake_request,
      'objective', item_record.goal,
      'audience', 'متداولون عرب',
      'platform', coalesce(item_record.platforms[1], 'instagram'),
      'duration_seconds', 60,
      'content_pillar', null,
      'edit_version', item_record.version,
      'hook_variants', array[item_record.hook],
      'spoken_script', item_record.script_outline,
      'cta', item_record.cta,
      'caption', item_record.caption_brief,
      'thumbnail_notes', item_record.thumbnail_brief,
      'brand_notes', item_record.brand_notes,
      'status', 'ready_to_record'
    ),
    'voice_profile', coalesce(voice_context, '{}'::jsonb),
    'brand_articles', coalesce(brand_context, '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_content_ai_provider_runtime(
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
declare
  target_organization_id uuid;
  provider_record public.ai_providers%rowtype;
  api_key text;
begin
  if not private.can_use_content_ai_actor(target_user_id, target_content_item_id, target_scope) then
    raise exception 'You cannot generate choices for this content step';
  end if;

  select item.organization_id into target_organization_id
  from public.content_items item
  where item.id = target_content_item_id;

  select * into provider_record
  from public.ai_providers provider
  where provider.organization_id = target_organization_id
    and provider.is_enabled
    and provider.is_default
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

create or replace function public.apply_content_ai_choice(
  target_user_id uuid,
  target_content_item_id uuid,
  target_scope text,
  expected_content_version bigint,
  selected_text text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_record public.content_items%rowtype;
  new_version bigint;
  step_owner_id uuid;
begin
  select * into item_record
  from public.content_items item
  where item.id = target_content_item_id
  for update;
  if item_record.id is null then raise exception 'Content item not found'; end if;
  if not private.can_use_content_ai_actor(target_user_id, target_content_item_id, target_scope) then
    raise exception 'You cannot choose AI output for this content step';
  end if;
  if item_record.version <> expected_content_version then
    raise exception 'Content changed while AI choices were open';
  end if;
  if target_scope = 'caption' and char_length(trim(selected_text)) not between 3 and 10000 then
    raise exception 'Caption choice is invalid';
  elsif target_scope = 'thumbnail' and char_length(trim(selected_text)) not between 10 and 4000 then
    raise exception 'Thumbnail choice is invalid';
  elsif target_scope not in ('caption', 'thumbnail') then
    raise exception 'AI choice scope is invalid';
  end if;

  update public.content_items item set
    caption_brief = case when target_scope = 'caption' then trim(selected_text) else item.caption_brief end,
    thumbnail_brief = case when target_scope = 'thumbnail' then trim(selected_text) else item.thumbnail_brief end,
    version = item.version + 1,
    updated_at = now()
  where item.id = target_content_item_id
  returning version into new_version;

  select task.owner_id into step_owner_id
  from public.tasks task
  where task.content_item_id = target_content_item_id
    and task.status <> 'cancelled'
    and task.content_step = target_scope::public.content_step
  limit 1;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    item_record.organization_id, target_user_id, 'content.ai_choice_selected',
    'content_item', target_content_item_id,
    jsonb_build_object('scope', target_scope, 'version', new_version)
  );

  if step_owner_id is distinct from target_user_id then
    perform private.add_notification(
      item_record.organization_id, step_owner_id, 'content_brief_updated',
      case when target_scope = 'caption' then 'تم تحديث الكابشن' else 'تم تحديث تعليمات الغلاف' end,
      item_record.title, 'content_item', target_content_item_id,
      '/content#content-' || target_content_item_id,
      'content:' || target_content_item_id || ':ai-choice:' || target_scope || ':v' || new_version || ':user:' || step_owner_id
    );
  end if;
  return new_version;
end;
$$;

alter table public.notifications drop constraint if exists notifications_kind_allowed;
alter table public.notifications add constraint notifications_kind_allowed check (
  kind in (
    'task_assigned', 'task_ready', 'task_review', 'task_blocked', 'task_done',
    'revision_requested', 'publication_published', 'publication_failed',
    'publication_held', 'script_assigned', 'script_ready', 'script_research_assigned',
    'content_brief_updated'
  )
);

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

  perform private.add_notification(
    target_organization_id, target_assigned_to, 'script_research_assigned',
    'فكرة أو بحث جديد وصل لك', trim(research_title), 'script_research', research_id,
    '/scripts',
    'script-research:' || research_id || ':assigned:user:' || target_assigned_to
  );
  return research_id;
end;
$$;

revoke all on function private.can_use_content_ai_actor(uuid, uuid, text)
from public, anon, authenticated;
revoke all on function public.get_content_ai_context(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.get_content_ai_context(uuid, uuid, text) to service_role;
revoke all on function public.get_content_ai_provider_runtime(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.get_content_ai_provider_runtime(uuid, uuid, text) to service_role;
revoke all on function public.apply_content_ai_choice(uuid, uuid, text, bigint, text)
from public, anon, authenticated;
grant execute on function public.apply_content_ai_choice(uuid, uuid, text, bigint, text) to service_role;
