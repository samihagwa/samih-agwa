-- Telegram stays the raw-material inbox while the web app stores the approved,
-- structured execution contract. Direct uploads remain intentionally out of scope.

create type public.content_cue_kind as enum (
  'cut',
  'visual',
  'text',
  'audio',
  'review',
  'note'
);

alter table public.content_items
  add column intake_request text,
  add column intake_source_url text;

alter table public.content_items
  add constraint content_items_intake_request_length
    check (intake_request is null or char_length(trim(intake_request)) between 20 and 30000),
  add constraint content_items_intake_source_url_http
    check (intake_source_url is null or intake_source_url ~* '^https://(t\.me|telegram\.me)/[^[:space:]]+$'),
  add constraint content_items_intake_fields_together
    check ((intake_request is null) = (intake_source_url is null));

create table public.content_timeline_cues (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  content_item_id uuid not null,
  start_seconds integer not null,
  end_seconds integer,
  kind public.content_cue_kind not null,
  action text not null,
  source_url text,
  sort_order smallint not null,
  completed_by uuid references public.profiles (id) on delete set null,
  completed_at timestamptz,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint content_timeline_cues_content_org_fkey
    foreign key (content_item_id, organization_id)
    references public.content_items (id, organization_id)
    on delete cascade,
  constraint content_timeline_cues_start_range check (start_seconds between 0 and 86399),
  constraint content_timeline_cues_end_range check (end_seconds is null or end_seconds between start_seconds and 86399),
  constraint content_timeline_cues_action_length check (char_length(trim(action)) between 3 and 2000),
  constraint content_timeline_cues_source_url_http check (source_url is null or source_url ~* '^https?://[^[:space:]]+$'),
  constraint content_timeline_cues_sort_order_positive check (sort_order between 1 and 500),
  constraint content_timeline_cues_completion_consistent check (
    (completed_at is null and completed_by is null)
    or (completed_at is not null and completed_by is not null)
  )
);

create index content_timeline_cues_content_sort_idx
  on public.content_timeline_cues (content_item_id, sort_order, id);

create index content_timeline_cues_content_org_fk_idx
  on public.content_timeline_cues (content_item_id, organization_id);

create index content_timeline_cues_org_content_idx
  on public.content_timeline_cues (organization_id, content_item_id);

create index content_timeline_cues_creator_idx
  on public.content_timeline_cues (created_by);

create index content_timeline_cues_completer_idx
  on public.content_timeline_cues (completed_by)
  where completed_by is not null;

alter table public.content_timeline_cues enable row level security;

create policy "content_timeline_select_organization_members"
on public.content_timeline_cues
for select
to authenticated
using (private.is_org_member(organization_id));

revoke all on table public.content_timeline_cues from anon, authenticated;
grant select on table public.content_timeline_cues to authenticated;

create or replace function public.create_reel_from_intake(
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
  intake_request_text text,
  telegram_source_url text,
  parsed_timeline jsonb,
  parsed_assets jsonb,
  target_publish_at timestamptz,
  brief_owner_id uuid,
  recording_owner_id uuid,
  editing_owner_id uuid,
  thumbnail_owner_id uuid,
  caption_owner_id uuid,
  approval_owner_id uuid,
  publishing_owner_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  content_id uuid;
  brief_task_id uuid;
  recording_task_id uuid;
  editing_task_id uuid;
  thumbnail_task_id uuid;
  caption_task_id uuid;
  approval_task_id uuid;
  publishing_task_id uuid;
  timeline_count integer;
  asset_count integer;
begin
  if target_user_id is null then
    raise exception 'A verified target user is required';
  end if;

  if char_length(trim(intake_request_text)) not between 20 and 30000 then
    raise exception 'Telegram request text must be between 20 and 30000 characters';
  end if;

  if telegram_source_url !~* '^https://(t\.me|telegram\.me)/[^[:space:]]+$' then
    raise exception 'Telegram source link must be a valid t.me or telegram.me URL';
  end if;

  if jsonb_typeof(parsed_timeline) <> 'array'
    or jsonb_array_length(parsed_timeline) > 120
    or jsonb_typeof(parsed_assets) <> 'array'
    or jsonb_array_length(parsed_assets) > 60 then
    raise exception 'Parsed intake collections are invalid or exceed their limits';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(parsed_timeline) cue
    where jsonb_typeof(cue) <> 'object'
      or coalesce(cue->>'start_seconds', '') !~ '^\d{1,5}$'
      or (cue ? 'end_seconds' and jsonb_typeof(cue->'end_seconds') <> 'null' and coalesce(cue->>'end_seconds', '') !~ '^\d{1,5}$')
      or coalesce(cue->>'kind', '') not in ('cut', 'visual', 'text', 'audio', 'review', 'note')
      or char_length(trim(coalesce(cue->>'action', ''))) not between 3 and 2000
      or (
        nullif(trim(coalesce(cue->>'source_url', '')), '') is not null
        and (cue->>'source_url') !~* '^https?://[^[:space:]]+$'
      )
  ) then
    raise exception 'One or more timeline instructions are invalid';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(parsed_assets) asset
    where jsonb_typeof(asset) <> 'object'
      or coalesce(asset->>'stage', '') not in ('brief', 'recording', 'editing', 'thumbnail', 'caption', 'approval', 'publishing')
      or coalesce(asset->>'kind', '') not in ('raw_video', 'source', 'b_roll', 'image', 'audio', 'reference', 'draft_video', 'thumbnail', 'caption', 'final_export')
      or char_length(trim(coalesce(asset->>'title', ''))) not between 2 and 160
      or coalesce(asset->>'url', '') !~* '^https?://[^[:space:]]+$'
      or char_length(coalesce(asset->>'notes', '')) > 2000
  ) then
    raise exception 'One or more extracted links are invalid';
  end if;

  content_id := public.create_reel_production_workflow(
    target_user_id,
    target_organization_id,
    content_title,
    content_goal,
    content_hook,
    content_cta,
    content_script_outline,
    content_editing_brief,
    content_thumbnail_brief,
    content_brand_notes,
    target_publish_at,
    brief_owner_id,
    recording_owner_id,
    editing_owner_id,
    thumbnail_owner_id,
    caption_owner_id,
    approval_owner_id,
    publishing_owner_id,
    '',
    '',
    ''
  );

  update public.content_items item
  set
    intake_request = trim(intake_request_text),
    intake_source_url = trim(telegram_source_url),
    version = item.version + 1,
    updated_at = now()
  where item.id = content_id;

  insert into public.content_assets (
    organization_id, content_item_id, stage, kind, title, url, notes, created_by
  ) values (
    target_organization_id,
    content_id,
    'recording',
    'raw_video',
    'المادة الخام على Telegram',
    trim(telegram_source_url),
    'الرابط الأصلي للرسالة أو الملف قبل أي تعديل',
    target_user_id
  );

  insert into public.content_assets (
    organization_id, content_item_id, stage, kind, title, url, notes, created_by
  )
  select
    target_organization_id,
    content_id,
    (asset->>'stage')::public.content_step,
    (asset->>'kind')::public.content_asset_kind,
    trim(asset->>'title'),
    trim(asset->>'url'),
    nullif(trim(coalesce(asset->>'notes', '')), ''),
    target_user_id
  from jsonb_array_elements(parsed_assets) asset;

  insert into public.content_timeline_cues (
    organization_id,
    content_item_id,
    start_seconds,
    end_seconds,
    kind,
    action,
    source_url,
    sort_order,
    created_by
  )
  select
    target_organization_id,
    content_id,
    (cue->>'start_seconds')::integer,
    case when jsonb_typeof(cue->'end_seconds') = 'number' then (cue->>'end_seconds')::integer else null end,
    (cue->>'kind')::public.content_cue_kind,
    trim(cue->>'action'),
    nullif(trim(coalesce(cue->>'source_url', '')), ''),
    (row_number() over ())::smallint,
    target_user_id
  from jsonb_array_elements(parsed_timeline) cue;

  select
    (max(task.id::text) filter (where task.content_step = 'brief'))::uuid,
    (max(task.id::text) filter (where task.content_step = 'recording'))::uuid,
    (max(task.id::text) filter (where task.content_step = 'editing'))::uuid,
    (max(task.id::text) filter (where task.content_step = 'thumbnail'))::uuid,
    (max(task.id::text) filter (where task.content_step = 'caption'))::uuid,
    (max(task.id::text) filter (where task.content_step = 'approval'))::uuid,
    (max(task.id::text) filter (where task.content_step = 'publishing'))::uuid
  into
    brief_task_id,
    recording_task_id,
    editing_task_id,
    thumbnail_task_id,
    caption_task_id,
    approval_task_id,
    publishing_task_id
  from public.tasks task
  where task.content_item_id = content_id;

  delete from public.task_dependencies dependency
  using public.tasks task
  where dependency.task_id = task.id
    and task.content_item_id = content_id;

  insert into public.task_dependencies (task_id, depends_on_task_id) values
    (recording_task_id, brief_task_id),
    (editing_task_id, recording_task_id),
    (thumbnail_task_id, brief_task_id),
    (caption_task_id, brief_task_id),
    (approval_task_id, editing_task_id),
    (approval_task_id, thumbnail_task_id),
    (approval_task_id, caption_task_id),
    (publishing_task_id, approval_task_id);

  timeline_count := jsonb_array_length(parsed_timeline);
  asset_count := jsonb_array_length(parsed_assets) + 1;

  update public.tasks task
  set
    title = case task.content_step
      when 'recording' then 'استلام وتجهيز المادة الخام: ' || trim(content_title)
      else task.title
    end,
    description = case task.content_step
      when 'recording' then left('المادة الخام محفوظة على Telegram:' || chr(10) || trim(telegram_source_url) || chr(10) || 'تحقق من سلامتها قبل بدء المونتاج.', 5000)
      when 'editing' then left('Production Brief للمونتاج:' || chr(10) || trim(content_editing_brief) || chr(10) || 'عدد تعليمات الـTimeline: ' || timeline_count, 5000)
      when 'thumbnail' then left('Design Brief للغلاف:' || chr(10) || trim(content_thumbnail_brief) || chr(10) || 'يمكن بدء الغلاف بعد اعتماد الـBrief بالتوازي مع المونتاج.', 5000)
      else task.description
    end
  where task.content_item_id = content_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id,
    target_user_id,
    'content.telegram_intake_created',
    'content_item',
    content_id,
    jsonb_build_object(
      'timeline_count', timeline_count,
      'asset_count', asset_count,
      'parallel_thumbnail', true,
      'direct_upload_enabled', false
    )
  );

  return content_id;
end;
$$;

revoke all on function public.create_reel_from_intake(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text,
  jsonb, jsonb, timestamptz, uuid, uuid, uuid, uuid, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.create_reel_from_intake(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text,
  jsonb, jsonb, timestamptz, uuid, uuid, uuid, uuid, uuid, uuid, uuid
) to service_role;

create or replace function public.change_timeline_cue(
  target_user_id uuid,
  target_cue_id uuid,
  target_completed boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  cue_record public.content_timeline_cues%rowtype;
  editor_id uuid;
begin
  if target_user_id is null then
    raise exception 'A verified target user is required';
  end if;

  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  select cue.*
  into cue_record
  from public.content_timeline_cues cue
  where cue.id = target_cue_id
  for update;

  if cue_record.id is null then
    raise exception 'Timeline instruction was not found';
  end if;

  select task.owner_id
  into editor_id
  from public.tasks task
  where task.content_item_id = cue_record.content_item_id
    and task.content_step = 'editing';

  if editor_id is distinct from target_user_id
    and not private.has_org_role(
      cue_record.organization_id,
      array['owner', 'admin', 'manager']::public.app_role[]
    ) then
    raise exception 'Only the editor or organization leadership can update the timeline';
  end if;

  update public.content_timeline_cues cue
  set
    completed_by = case when target_completed then target_user_id else null end,
    completed_at = case when target_completed then now() else null end
  where cue.id = target_cue_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    cue_record.organization_id,
    target_user_id,
    'content.timeline_' || case when target_completed then 'completed' else 'reopened' end,
    'content_timeline_cue',
    target_cue_id,
    jsonb_build_object('completed', cue_record.completed_at is not null),
    jsonb_build_object('completed', target_completed)
  );

  return true;
end;
$$;

revoke all on function public.change_timeline_cue(uuid, uuid, boolean)
from public, anon, authenticated;
grant execute on function public.change_timeline_cue(uuid, uuid, boolean)
to service_role;

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
    and (
      exists (
        select 1
        from public.content_revision_requests revision
        where revision.content_item_id = new.content_item_id
          and revision.status in ('requested', 'in_progress')
      )
      or exists (
        select 1
        from public.content_timeline_cues cue
        where cue.content_item_id = new.content_item_id
          and cue.completed_at is null
      )
    ) then
    raise exception 'Resolve every open revision and timeline instruction before approval or publishing';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_content_approval_revisions()
from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'content_timeline_cues'
    ) then
    alter publication supabase_realtime add table public.content_timeline_cues;
  end if;
end;
$$;
