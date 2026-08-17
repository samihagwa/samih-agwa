-- Content production pipeline.
-- A content item is the durable source of truth. Its operational work is represented
-- by regular tasks connected through explicit dependencies, so completion can safely
-- unlock the next owner without relying on the browser or Telegram.

create type public.content_format as enum (
  'reel',
  'carousel',
  'post',
  'story',
  'long_video',
  'live',
  'email'
);

create type public.content_status as enum (
  'planned',
  'production',
  'review',
  'scheduled',
  'published',
  'cancelled'
);

create type public.content_step as enum (
  'brief',
  'recording',
  'editing',
  'thumbnail',
  'caption',
  'approval',
  'publishing'
);

create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null,
  format public.content_format not null default 'reel',
  goal text not null,
  hook text not null,
  cta text not null,
  platforms text[] not null default array['instagram']::text[],
  status public.content_status not null default 'planned',
  publish_at timestamptz not null,
  published_at timestamptz,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_items_title_length check (char_length(trim(title)) between 3 and 180),
  constraint content_items_goal_length check (char_length(trim(goal)) between 5 and 1000),
  constraint content_items_hook_length check (char_length(trim(hook)) between 3 and 1000),
  constraint content_items_cta_length check (char_length(trim(cta)) between 2 and 500),
  constraint content_items_platforms_present check (cardinality(platforms) between 1 and 8),
  constraint content_items_platforms_allowed check (
    platforms <@ array['instagram', 'facebook', 'tiktok', 'youtube', 'linkedin', 'telegram', 'email']::text[]
  ),
  constraint content_items_version_positive check (version > 0),
  constraint content_items_published_at_consistent check (status <> 'published' or published_at is not null)
);

alter table public.tasks
  add column content_item_id uuid references public.content_items (id) on delete restrict,
  add column content_step public.content_step;

alter table public.tasks
  add constraint tasks_content_link_complete check (
    (content_item_id is null and content_step is null)
    or (content_item_id is not null and content_step is not null)
  ),
  add constraint tasks_one_step_per_content unique (content_item_id, content_step);

create table public.task_dependencies (
  task_id uuid not null references public.tasks (id) on delete cascade,
  depends_on_task_id uuid not null references public.tasks (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (task_id, depends_on_task_id),
  constraint task_dependencies_no_self_reference check (task_id <> depends_on_task_id)
);

create index content_items_org_status_publish_idx
  on public.content_items (organization_id, status, publish_at, id);

create index content_items_creator_idx
  on public.content_items (created_by);

create index tasks_content_item_idx
  on public.tasks (content_item_id, content_step)
  where content_item_id is not null;

create index task_dependencies_predecessor_idx
  on public.task_dependencies (depends_on_task_id, task_id);

-- Preserve the task security contract while allowing the trusted dependency trigger
-- to perform exactly one internal transition: linked backlog -> ready.
create or replace function private.enforce_task_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  actor_is_manager boolean;
  owner_is_active boolean;
begin
  if actor is null then
    raise exception 'An authenticated actor is required';
  end if;

  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then
    if old.content_item_id is null
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
    select 1
    from public.memberships membership
    where membership.organization_id = new.organization_id
      and membership.user_id = actor
      and membership.status = 'active'
      and membership.role in ('owner', 'admin', 'manager')
  ) into actor_is_manager;

  select exists (
    select 1
    from public.memberships membership
    where membership.organization_id = new.organization_id
      and membership.user_id = new.owner_id
      and membership.status = 'active'
  ) into owner_is_active;

  if not owner_is_active then
    raise exception 'Task owner must be an active member of the organization';
  end if;

  if tg_op = 'INSERT' then
    if not actor_is_manager then
      raise exception 'Only organization leadership can create tasks';
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
    or new.content_step is distinct from old.content_step then
    raise exception 'Task identity, organization, and workflow link fields are immutable';
  end if;

  if not actor_is_manager then
    if old.owner_id <> actor then
      raise exception 'Only task owners or organization leadership can update tasks';
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

  if not private.is_valid_task_transition(old.status, new.status) then
    raise exception 'Invalid task status transition from % to %', old.status, new.status;
  end if;

  if old.status <> 'in_progress' and new.status = 'in_progress' and new.started_at is null then
    new.started_at := now();
  end if;

  if new.status = 'done' then
    new.completed_at := coalesce(old.completed_at, now());
  elsif old.status = 'done' then
    new.completed_at := null;
  end if;

  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.advance_content_workflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_content_status public.content_status;
  previous_content_status public.content_status;
begin
  if new.content_item_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status <> 'done' and new.status = 'done' then
    update public.tasks candidate
    set status = 'ready'
    where candidate.content_item_id = new.content_item_id
      and candidate.status = 'backlog'
      and exists (
        select 1
        from public.task_dependencies dependency
        where dependency.task_id = candidate.id
      )
      and not exists (
        select 1
        from public.task_dependencies dependency
        join public.tasks predecessor on predecessor.id = dependency.depends_on_task_id
        where dependency.task_id = candidate.id
          and predecessor.status <> 'done'
      );
  end if;

  select item.status
  into previous_content_status
  from public.content_items item
  where item.id = new.content_item_id
  for update;

  select case
    when bool_or(task.content_step = 'publishing' and task.status = 'done') then 'published'::public.content_status
    when bool_or(task.content_step = 'publishing' and task.status in ('ready', 'in_progress', 'review')) then 'scheduled'::public.content_status
    when bool_or(task.content_step = 'approval' and task.status in ('ready', 'in_progress', 'review', 'done')) then 'review'::public.content_status
    when bool_or(task.content_step in ('recording', 'editing', 'thumbnail', 'caption') and task.status in ('ready', 'in_progress', 'review', 'done')) then 'production'::public.content_status
    else 'planned'::public.content_status
  end
  into next_content_status
  from public.tasks task
  where task.content_item_id = new.content_item_id;

  if next_content_status is distinct from previous_content_status then
    update public.content_items item
    set
      status = next_content_status,
      published_at = case
        when next_content_status = 'published' then coalesce(item.published_at, now())
        else null
      end,
      version = item.version + 1,
      updated_at = now()
    where item.id = new.content_item_id;

    insert into public.audit_events (
      organization_id,
      actor_id,
      action,
      entity_type,
      entity_id,
      before_data,
      after_data
    ) values (
      new.organization_id,
      (select auth.uid()),
      'content.status_changed',
      'content_item',
      new.content_item_id,
      jsonb_build_object('status', previous_content_status),
      jsonb_build_object('status', next_content_status)
    );
  end if;

  return new;
end;
$$;

create trigger tasks_advance_content_workflow
after insert or update of status on public.tasks
for each row execute function private.advance_content_workflow();

create or replace function public.create_reel_workflow(
  target_organization_id uuid,
  content_title text,
  content_goal text,
  content_hook text,
  content_cta text,
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
  actor uuid := (select auth.uid());
  content_id uuid;
  brief_task_id uuid;
  recording_task_id uuid;
  editing_task_id uuid;
  thumbnail_task_id uuid;
  caption_task_id uuid;
  approval_task_id uuid;
  publishing_task_id uuid;
  schedule_span interval;
begin
  if actor is null then
    raise exception 'Authentication is required';
  end if;

  if not exists (
    select 1
    from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = actor
      and membership.status = 'active'
      and membership.role in ('owner', 'admin', 'manager')
  ) then
    raise exception 'Only organization leadership can create content workflows';
  end if;

  if target_publish_at <= now() + interval '1 hour' then
    raise exception 'Publish time must be at least one hour in the future';
  end if;

  if char_length(trim(content_title)) not between 3 and 180
    or char_length(trim(content_goal)) not between 5 and 1000
    or char_length(trim(content_hook)) not between 3 and 1000
    or char_length(trim(content_cta)) not between 2 and 500 then
    raise exception 'Content brief fields are incomplete or exceed their allowed length';
  end if;

  if exists (
    select 1
    from unnest(array[
      brief_owner_id,
      recording_owner_id,
      editing_owner_id,
      thumbnail_owner_id,
      caption_owner_id,
      approval_owner_id,
      publishing_owner_id
    ]) as requested_owner(user_id)
    where requested_owner.user_id is null
      or not exists (
        select 1
        from public.memberships membership
        where membership.organization_id = target_organization_id
          and membership.user_id = requested_owner.user_id
          and membership.status = 'active'
      )
  ) then
    raise exception 'Every workflow owner must be an active organization member';
  end if;

  insert into public.content_items (
    organization_id,
    title,
    format,
    goal,
    hook,
    cta,
    platforms,
    status,
    publish_at,
    created_by
  ) values (
    target_organization_id,
    trim(content_title),
    'reel',
    trim(content_goal),
    trim(content_hook),
    trim(content_cta),
    array['instagram', 'facebook']::text[],
    'planned',
    target_publish_at,
    actor
  ) returning id into content_id;

  schedule_span := target_publish_at - now();

  insert into public.tasks (
    organization_id, title, description, status, priority, owner_id, created_by,
    acceptance_criteria, due_at, content_item_id, content_step
  ) values (
    target_organization_id,
    'اعتماد brief: ' || trim(content_title),
    'تثبيت الهدف والـhook والـCTA قبل بدء الإنتاج.',
    'ready',
    'high',
    brief_owner_id,
    actor,
    'Brief واضح ومعتمد ويحتوي الهدف والجمهور والرسالة والـhook والـCTA.',
    now() + schedule_span * 0.12,
    content_id,
    'brief'
  ) returning id into brief_task_id;

  insert into public.tasks (
    organization_id, title, description, status, priority, owner_id, created_by,
    acceptance_criteria, due_at, content_item_id, content_step
  ) values (
    target_organization_id,
    'تسجيل الريلز: ' || trim(content_title),
    'التسجيل يبدأ تلقائيًا بعد اعتماد الـbrief.',
    'backlog',
    'normal',
    recording_owner_id,
    actor,
    'الملف الخام كامل وواضح ومرفوع في مكانه المتفق عليه.',
    now() + schedule_span * 0.30,
    content_id,
    'recording'
  ) returning id into recording_task_id;

  insert into public.tasks (
    organization_id, title, description, status, priority, owner_id, created_by,
    acceptance_criteria, due_at, content_item_id, content_step
  ) values (
    target_organization_id,
    'مونتاج الريلز: ' || trim(content_title),
    'المونتاج يُفتح بعد اكتمال التسجيل.',
    'backlog',
    'normal',
    editing_owner_id,
    actor,
    'نسخة 1080×1920 سليمة لغويًا وصوتيًا ومتوافقة مع البراند.',
    now() + schedule_span * 0.56,
    content_id,
    'editing'
  ) returning id into editing_task_id;

  insert into public.tasks (
    organization_id, title, description, status, priority, owner_id, created_by,
    acceptance_criteria, due_at, content_item_id, content_step
  ) values (
    target_organization_id,
    'تصميم الغلاف: ' || trim(content_title),
    'الغلاف يُفتح بعد اكتمال نسخة المونتاج.',
    'backlog',
    'normal',
    thumbnail_owner_id,
    actor,
    'غلاف مقروء على الهاتف ومتوافق مع الهوية ومرفوع بالمقاس الصحيح.',
    now() + schedule_span * 0.72,
    content_id,
    'thumbnail'
  ) returning id into thumbnail_task_id;

  insert into public.tasks (
    organization_id, title, description, status, priority, owner_id, created_by,
    acceptance_criteria, due_at, content_item_id, content_step
  ) values (
    target_organization_id,
    'كتابة الكابشن: ' || trim(content_title),
    'الكابشن يمكن أن يبدأ بعد اعتماد الـbrief بالتوازي مع الإنتاج.',
    'backlog',
    'normal',
    caption_owner_id,
    actor,
    'كابشن معتمد يحتوي CTA واضحًا ونسخة نهائية خالية من الأخطاء.',
    now() + schedule_span * 0.70,
    content_id,
    'caption'
  ) returning id into caption_task_id;

  insert into public.tasks (
    organization_id, title, description, status, priority, owner_id, created_by,
    acceptance_criteria, due_at, content_item_id, content_step
  ) values (
    target_organization_id,
    'المراجعة النهائية: ' || trim(content_title),
    'لن تُفتح المراجعة قبل اكتمال المونتاج والغلاف والكابشن.',
    'backlog',
    'high',
    approval_owner_id,
    actor,
    'اعتماد الفيديو والغلاف والكابشن معًا أو إرجاع المطلوب بتعليق واضح.',
    now() + schedule_span * 0.86,
    content_id,
    'approval'
  ) returning id into approval_task_id;

  insert into public.tasks (
    organization_id, title, description, status, priority, owner_id, created_by,
    acceptance_criteria, due_at, content_item_id, content_step
  ) values (
    target_organization_id,
    'جدولة ونشر الريلز: ' || trim(content_title),
    'خطوة النشر لا تُفتح قبل الاعتماد النهائي.',
    'backlog',
    'urgent',
    publishing_owner_id,
    actor,
    'المحتوى منشور أو مجدول في الموعد الصحيح مع الرابط النهائي موثقًا.',
    target_publish_at,
    content_id,
    'publishing'
  ) returning id into publishing_task_id;

  insert into public.task_dependencies (task_id, depends_on_task_id) values
    (recording_task_id, brief_task_id),
    (editing_task_id, recording_task_id),
    (thumbnail_task_id, editing_task_id),
    (caption_task_id, brief_task_id),
    (approval_task_id, editing_task_id),
    (approval_task_id, thumbnail_task_id),
    (approval_task_id, caption_task_id),
    (publishing_task_id, approval_task_id);

  insert into public.audit_events (
    organization_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    after_data
  ) values (
    target_organization_id,
    actor,
    'content.workflow_created',
    'content_item',
    content_id,
    jsonb_build_object(
      'title', trim(content_title),
      'format', 'reel',
      'publish_at', target_publish_at,
      'task_count', 7
    )
  );

  return content_id;
end;
$$;

alter table public.content_items enable row level security;
alter table public.task_dependencies enable row level security;

create policy "content_items_select_organization_members"
on public.content_items
for select
to authenticated
using (private.is_org_member(organization_id));

create policy "task_dependencies_select_organization_members"
on public.task_dependencies
for select
to authenticated
using (
  exists (
    select 1
    from public.tasks task
    where task.id = task_dependencies.task_id
      and private.is_org_member(task.organization_id)
  )
);

revoke all on table public.content_items from anon, authenticated;
revoke all on table public.task_dependencies from anon, authenticated;
grant select on table public.content_items to authenticated;
grant select on table public.task_dependencies to authenticated;

revoke all on function private.advance_content_workflow() from public, anon, authenticated;
revoke all on function public.create_reel_workflow(
  uuid, text, text, text, text, timestamptz,
  uuid, uuid, uuid, uuid, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.create_reel_workflow(
  uuid, text, text, text, text, timestamptz,
  uuid, uuid, uuid, uuid, uuid, uuid, uuid
) to authenticated;

do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'content_items'
  ) then
    alter publication supabase_realtime add table public.content_items;
  end if;
end;
$$;
