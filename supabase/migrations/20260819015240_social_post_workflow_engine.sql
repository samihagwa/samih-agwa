-- A social-post deliverable is counted once in the launch plan, while each planned
-- unit becomes an individual content card with a guarded production workflow.

alter table public.content_items
  add column copy_brief text not null default '',
  add column design_brief text not null default '';

alter table public.content_items
  add constraint content_items_copy_brief_length
    check (char_length(copy_brief) <= 8000),
  add constraint content_items_design_brief_length
    check (char_length(design_brief) <= 8000);

alter table public.launch_deliverables
  add column workflow_template text not null default 'single_task',
  add column creation_request_id uuid;

alter table public.launch_deliverables
  add constraint launch_deliverables_workflow_template_allowed
    check (workflow_template in ('single_task', 'social_post')),
  add constraint launch_deliverables_social_template_kind
    check (workflow_template <> 'social_post' or kind = 'social_post');

create unique index launch_deliverables_creation_request_idx
  on public.launch_deliverables (launch_id, creation_request_id)
  where creation_request_id is not null;

alter table public.launch_content_items
  add column launch_deliverable_id uuid,
  add column deliverable_sequence integer;

alter table public.launch_content_items
  add constraint launch_content_items_deliverable_fields_together check (
    (launch_deliverable_id is null and deliverable_sequence is null)
    or (launch_deliverable_id is not null and deliverable_sequence > 0)
  ),
  add constraint launch_content_items_deliverable_org_fkey
    foreign key (launch_deliverable_id, launch_id, organization_id)
    references public.launch_deliverables (id, launch_id, organization_id)
    on delete restrict;

create unique index launch_content_items_deliverable_sequence_idx
  on public.launch_content_items (launch_deliverable_id, deliverable_sequence)
  where launch_deliverable_id is not null;

create index launch_content_items_deliverable_content_idx
  on public.launch_content_items (launch_deliverable_id, content_item_id)
  where launch_deliverable_id is not null;

alter table public.tasks
  add constraint tasks_content_delivery_identity_unique
    unique (id, organization_id, content_item_id, content_step);

create table public.content_step_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  content_item_id uuid not null,
  task_id uuid not null,
  step public.content_step not null,
  result_note text,
  result_url text,
  version bigint not null default 1,
  submitted_by uuid not null references public.profiles (id) on delete restrict,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_step_deliveries_task_unique unique (task_id),
  constraint content_step_deliveries_content_org_fkey
    foreign key (content_item_id, organization_id)
    references public.content_items (id, organization_id)
    on delete cascade,
  constraint content_step_deliveries_task_identity_fkey
    foreign key (task_id, organization_id, content_item_id, step)
    references public.tasks (id, organization_id, content_item_id, content_step)
    on delete cascade,
  constraint content_step_deliveries_step_allowed
    check (step in ('caption', 'design', 'scheduling', 'publishing')),
  constraint content_step_deliveries_result_present
    check (result_note is not null or result_url is not null),
  constraint content_step_deliveries_note_length
    check (result_note is null or char_length(trim(result_note)) between 3 and 10000),
  constraint content_step_deliveries_url_http
    check (result_url is null or (
      char_length(result_url) <= 2000
      and result_url ~* '^https?://[^[:space:]]+$'
    )),
  constraint content_step_deliveries_version_positive check (version > 0)
);

create index content_step_deliveries_content_step_idx
  on public.content_step_deliveries (content_item_id, step, submitted_at desc, id);
create index content_step_deliveries_org_time_idx
  on public.content_step_deliveries (organization_id, submitted_at desc, id);
create index content_step_deliveries_submitter_idx
  on public.content_step_deliveries (submitted_by);

alter table public.content_revision_requests
  drop constraint content_revision_requests_stage_allowed,
  add constraint content_revision_requests_stage_allowed
    check (stage in ('recording', 'editing', 'thumbnail', 'caption', 'design'));

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

  select item.status
  into previous_content_status
  from public.content_items item
  where item.id = new.content_item_id
  for update;

  select case
    when bool_or(task.content_step = 'publishing' and task.status = 'done')
      then 'published'::public.content_status
    when bool_or(task.content_step = 'publishing' and task.status in ('ready', 'in_progress', 'review'))
      or bool_or(task.content_step = 'scheduling' and task.status in ('review', 'done'))
      then 'scheduled'::public.content_status
    when bool_or(task.content_step = 'approval' and task.status in ('ready', 'in_progress', 'review', 'done'))
      then 'review'::public.content_status
    when bool_or(task.content_step in ('recording', 'editing', 'thumbnail', 'caption', 'design')
      and task.status in ('ready', 'in_progress', 'review', 'done'))
      then 'production'::public.content_status
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
      organization_id, actor_id, action, entity_type, entity_id, before_data, after_data
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

create or replace function private.require_content_step_delivery()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.content_item_id is not null
    and new.content_step in ('caption', 'design', 'scheduling', 'publishing')
    and new.status in ('review', 'done')
    and old.status is distinct from new.status
    and not exists (
      select 1
      from public.content_step_deliveries delivery
      where delivery.task_id = new.id
        and delivery.organization_id = new.organization_id
    ) then
    raise exception 'Submit the step result from the content card before review or completion';
  end if;

  return new;
end;
$$;

create trigger tasks_require_content_step_delivery
before update of status on public.tasks
for each row execute function private.require_content_step_delivery();

create or replace function public.create_social_post_deliverable(
  target_user_id uuid,
  target_launch_id uuid,
  deliverable_title text,
  deliverable_brief text,
  deliverable_destination text,
  deliverable_quantity integer,
  deliverable_owner_id uuid,
  first_publish_at timestamptz,
  deliverable_due_at timestamptz,
  deliverable_budget_category public.launch_budget_category,
  deliverable_budget_amount numeric,
  deliverable_currency text,
  depends_on_deliverable_id uuid,
  content_goal text,
  content_hook text,
  content_cta text,
  content_copy_brief text,
  content_design_brief text,
  content_platforms text[],
  brief_owner_id uuid,
  caption_owner_id uuid,
  design_owner_id uuid,
  approval_owner_id uuid,
  scheduling_owner_id uuid,
  publishing_owner_id uuid,
  target_creation_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  launch_record public.launches%rowtype;
  existing_deliverable_id uuid;
  deliverable_id uuid;
  parent_task_id uuid;
  dependency_task_id uuid;
  content_id uuid;
  brief_task_id uuid;
  caption_task_id uuid;
  design_task_id uuid;
  approval_task_id uuid;
  scheduling_task_id uuid;
  publishing_task_id uuid;
  item_number integer;
  item_title text;
  item_publish_at timestamptz;
  production_span interval;
begin
  if target_user_id is null or target_creation_request_id is null then
    raise exception 'A verified user and request identity are required';
  end if;

  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  select launch.* into launch_record
  from public.launches launch
  where launch.id = target_launch_id
  for update;

  if launch_record.id is null then
    raise exception 'Launch was not found';
  end if;

  select deliverable.id into existing_deliverable_id
  from public.launch_deliverables deliverable
  where deliverable.launch_id = target_launch_id
    and deliverable.creation_request_id = target_creation_request_id;

  if existing_deliverable_id is not null then
    return existing_deliverable_id;
  end if;

  if not private.has_org_role(
    launch_record.organization_id,
    array['owner', 'admin', 'manager']::public.app_role[]
  ) then
    raise exception 'Only organization leadership can plan social post workflows';
  end if;

  if char_length(trim(deliverable_title)) not between 3 and 180
    or char_length(trim(deliverable_brief)) not between 5 and 5000
    or char_length(trim(content_goal)) not between 5 and 1000
    or char_length(trim(content_hook)) not between 3 and 1000
    or char_length(trim(content_cta)) not between 2 and 500
    or char_length(trim(content_copy_brief)) not between 10 and 8000
    or char_length(trim(content_design_brief)) not between 10 and 8000 then
    raise exception 'Social post brief fields are incomplete or exceed their allowed length';
  end if;

  if deliverable_quantity not between 1 and 60 then
    raise exception 'An automated social post batch must contain between one and 60 posts';
  end if;

  if first_publish_at is null
    or deliverable_due_at is null
    or first_publish_at <= now() + interval '2 hours'
    or first_publish_at > deliverable_due_at
    or deliverable_due_at > launch_record.ends_at then
    raise exception 'Social post dates must start after two hours and end no later than the launch end';
  end if;

  if deliverable_budget_amount < 0 then
    raise exception 'Deliverable budget cannot be negative';
  end if;

  if upper(trim(deliverable_currency)) !~ '^[A-Z]{3}$' then
    raise exception 'Currency must be a three-letter ISO code';
  end if;

  if content_platforms is null
    or cardinality(content_platforms) not between 1 and 8
    or exists (
      select 1 from unnest(content_platforms) platform
      where platform not in ('instagram', 'facebook', 'tiktok', 'youtube', 'linkedin', 'telegram', 'email')
    ) then
    raise exception 'Choose at least one supported publishing platform';
  end if;

  if exists (
    select 1
    from unnest(array[
      deliverable_owner_id, brief_owner_id, caption_owner_id, design_owner_id,
      approval_owner_id, scheduling_owner_id, publishing_owner_id
    ]) requested_owner(user_id)
    where requested_owner.user_id is null
      or not exists (
        select 1
        from public.memberships membership
        where membership.organization_id = launch_record.organization_id
          and membership.user_id = requested_owner.user_id
          and membership.status = 'active'
          and membership.role <> 'viewer'
      )
  ) then
    raise exception 'Every social post workflow owner must be an active working member';
  end if;

  if depends_on_deliverable_id is not null then
    select task.id into dependency_task_id
    from public.launch_deliverables dependency
    join public.tasks task on task.launch_deliverable_id = dependency.id
    where dependency.id = depends_on_deliverable_id
      and dependency.launch_id = target_launch_id
      and dependency.organization_id = launch_record.organization_id;

    if dependency_task_id is null then
      raise exception 'Deliverable dependency was not found in the same launch';
    end if;
  end if;

  insert into public.launch_deliverables (
    organization_id, launch_id, kind, title, brief, channel, destination,
    planned_quantity, owner_id, due_at, budget_category, budget_amount,
    currency, workflow_template, creation_request_id, created_by
  ) values (
    launch_record.organization_id, target_launch_id, 'social_post',
    trim(deliverable_title), trim(deliverable_brief),
    array_to_string(content_platforms, ', '), nullif(trim(deliverable_destination), ''),
    deliverable_quantity, deliverable_owner_id, deliverable_due_at,
    deliverable_budget_category, deliverable_budget_amount,
    upper(trim(deliverable_currency)), 'social_post', target_creation_request_id,
    target_user_id
  ) returning id into deliverable_id;

  insert into public.tasks (
    organization_id, title, description, status, priority, owner_id, created_by,
    acceptance_criteria, due_at, launch_deliverable_id
  ) values (
    launch_record.organization_id,
    'اعتماد دفعة بوستات: ' || trim(deliverable_title),
    'مراجعة اكتمال ونشر كل كروت البوست المرتبطة بهذا البند.',
    'backlog', 'high', deliverable_owner_id, target_user_id,
    'كل البوستات المخططة منشورة بروابط موثقة، ثم تُعتمد الدفعة مرة واحدة من غرفة الإطلاق.',
    deliverable_due_at, deliverable_id
  ) returning id into parent_task_id;

  if dependency_task_id is not null then
    insert into public.launch_deliverable_dependencies (
      organization_id, launch_id, deliverable_id, depends_on_deliverable_id, created_by
    ) values (
      launch_record.organization_id, target_launch_id, deliverable_id,
      depends_on_deliverable_id, target_user_id
    );
  end if;

  for item_number in 1..deliverable_quantity loop
    item_title := case
      when deliverable_quantity = 1 then trim(deliverable_title)
      else trim(deliverable_title) || ' — بوست ' || item_number || '/' || deliverable_quantity
    end;

    item_publish_at := case
      when deliverable_quantity = 1 then deliverable_due_at
      else first_publish_at
        + (deliverable_due_at - first_publish_at)
          * ((item_number - 1)::numeric / (deliverable_quantity - 1)::numeric)
    end;
    production_span := item_publish_at - now();

    insert into public.content_items (
      organization_id, title, format, goal, hook, cta, platforms, status,
      publish_at, copy_brief, design_brief, brand_notes, created_by
    ) values (
      launch_record.organization_id, item_title, 'post', trim(content_goal),
      trim(content_hook), trim(content_cta), content_platforms, 'planned',
      item_publish_at, trim(content_copy_brief), trim(content_design_brief),
      'تم إنشاؤه تلقائيًا من بند الإطلاق: ' || trim(deliverable_title),
      target_user_id
    ) returning id into content_id;

    insert into public.launch_content_items (
      organization_id, launch_id, content_item_id, launch_deliverable_id,
      deliverable_sequence, created_by
    ) values (
      launch_record.organization_id, target_launch_id, content_id,
      deliverable_id, item_number, target_user_id
    );

    insert into public.tasks (
      organization_id, title, description, status, priority, owner_id, created_by,
      acceptance_criteria, due_at, content_item_id, content_step
    ) values (
      launch_record.organization_id, 'اعتماد Brief البوست: ' || item_title,
      left('تفاصيل بند الإطلاق:' || chr(10) || trim(deliverable_brief), 5000),
      case when dependency_task_id is null then 'ready'::public.task_status else 'backlog'::public.task_status end,
      'high', brief_owner_id, target_user_id,
      'الهدف والـHook والـCTA وتعليمات الكتابة والتصميم واضحة ومعتمدة قبل التنفيذ.',
      now() + production_span * 0.15, content_id, 'brief'
    ) returning id into brief_task_id;

    insert into public.tasks (
      organization_id, title, description, status, priority, owner_id, created_by,
      acceptance_criteria, due_at, content_item_id, content_step
    ) values (
      launch_record.organization_id, 'كتابة كابشن البوست: ' || item_title,
      left('تعليمات الكتابة:' || chr(10) || trim(content_copy_brief), 5000),
      'backlog', 'normal', caption_owner_id, target_user_id,
      'النص النهائي خالٍ من الأخطاء، مناسب للمنصات المحددة، ويحتوي CTA واضحًا.',
      now() + production_span * 0.48, content_id, 'caption'
    ) returning id into caption_task_id;

    insert into public.tasks (
      organization_id, title, description, status, priority, owner_id, created_by,
      acceptance_criteria, due_at, content_item_id, content_step
    ) values (
      launch_record.organization_id, 'تصميم البوست: ' || item_title,
      left('Design Brief:' || chr(10) || trim(content_design_brief), 5000),
      'backlog', 'normal', design_owner_id, target_user_id,
      'التصميم النهائي بالمقاسات المطلوبة، مقروء ومتوافق مع الهوية، ورابطه محفوظ.',
      now() + production_span * 0.48, content_id, 'design'
    ) returning id into design_task_id;

    insert into public.tasks (
      organization_id, title, description, status, priority, owner_id, created_by,
      acceptance_criteria, due_at, content_item_id, content_step
    ) values (
      launch_record.organization_id, 'مراجعة البوست: ' || item_title,
      'المراجعة تفتح بعد اكتمال الكابشن والتصميم معًا.',
      'backlog', 'high', approval_owner_id, target_user_id,
      'اعتماد الكابشن والتصميم كحزمة واحدة أو تسجيل جولة تعديل واضحة على المرحلة المطلوبة.',
      now() + production_span * 0.70, content_id, 'approval'
    ) returning id into approval_task_id;

    insert into public.tasks (
      organization_id, title, description, status, priority, owner_id, created_by,
      acceptance_criteria, due_at, content_item_id, content_step
    ) values (
      launch_record.organization_id, 'جدولة البوست: ' || item_title,
      'الجدولة تفتح بعد الاعتماد النهائي فقط.',
      'backlog', 'normal', scheduling_owner_id, target_user_id,
      'حفظ المنصات وموعد الجدولة وتأكيد أن النسخة النهائية الصحيحة هي المستخدمة.',
      now() + production_span * 0.86, content_id, 'scheduling'
    ) returning id into scheduling_task_id;

    insert into public.tasks (
      organization_id, title, description, status, priority, owner_id, created_by,
      acceptance_criteria, due_at, content_item_id, content_step
    ) values (
      launch_record.organization_id, 'نشر وتوثيق البوست: ' || item_title,
      'تأكيد النشر الفعلي في الموعد وحفظ رابط البوست المنشور.',
      'backlog', 'urgent', publishing_owner_id, target_user_id,
      'البوست منشور على المنصات المطلوبة والرابط النهائي محفوظ داخل كارت المحتوى.',
      item_publish_at, content_id, 'publishing'
    ) returning id into publishing_task_id;

    insert into public.task_dependencies (task_id, depends_on_task_id) values
      (caption_task_id, brief_task_id),
      (design_task_id, brief_task_id),
      (approval_task_id, caption_task_id),
      (approval_task_id, design_task_id),
      (scheduling_task_id, approval_task_id),
      (publishing_task_id, scheduling_task_id),
      (parent_task_id, publishing_task_id);

    if dependency_task_id is not null then
      insert into public.task_dependencies (task_id, depends_on_task_id)
      values (brief_task_id, dependency_task_id);
    end if;

    insert into public.audit_events (
      organization_id, actor_id, action, entity_type, entity_id, after_data
    ) values (
      launch_record.organization_id, target_user_id, 'content.workflow_created',
      'content_item', content_id,
      jsonb_build_object(
        'format', 'post', 'launch_id', target_launch_id,
        'launch_deliverable_id', deliverable_id,
        'sequence', item_number, 'task_count', 6,
        'publish_at', item_publish_at
      )
    );
  end loop;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    launch_record.organization_id, target_user_id, 'launch.deliverable_created',
    'launch_deliverable', deliverable_id,
    jsonb_build_object(
      'launch_id', target_launch_id, 'kind', 'social_post',
      'workflow_template', 'social_post', 'quantity', deliverable_quantity,
      'content_item_count', deliverable_quantity,
      'child_task_count', deliverable_quantity * 6,
      'parent_task_id', parent_task_id,
      'budget_category', deliverable_budget_category,
      'budget_amount', deliverable_budget_amount,
      'currency', upper(trim(deliverable_currency))
    )
  );

  return deliverable_id;
end;
$$;

create or replace function public.submit_content_step_delivery(
  target_user_id uuid,
  target_task_id uuid,
  delivery_result_note text,
  delivery_result_url text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_record public.tasks%rowtype;
  actor_is_manager boolean;
  delivery_id uuid;
begin
  if target_user_id is null then
    raise exception 'A verified target user is required';
  end if;

  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  select task.* into task_record
  from public.tasks task
  where task.id = target_task_id
    and task.content_item_id is not null
    and task.content_step in ('caption', 'design', 'scheduling', 'publishing')
  for update;

  if task_record.id is null then
    raise exception 'A deliverable content step was not found';
  end if;

  select private.has_org_role(
    task_record.organization_id,
    array['owner', 'admin', 'manager']::public.app_role[]
  ) into actor_is_manager;

  if not actor_is_manager and task_record.owner_id <> target_user_id then
    raise exception 'Only the step owner or organization leadership can submit its result';
  end if;

  if task_record.status in ('backlog', 'blocked', 'cancelled') then
    raise exception 'This step is not ready for result submission';
  end if;

  if nullif(trim(delivery_result_note), '') is null
    and nullif(trim(delivery_result_url), '') is null then
    raise exception 'Add a result note or URL';
  end if;

  if nullif(trim(delivery_result_note), '') is not null
    and char_length(trim(delivery_result_note)) not between 3 and 10000 then
    raise exception 'Step result note is invalid';
  end if;

  if nullif(trim(delivery_result_url), '') is not null
    and (char_length(trim(delivery_result_url)) > 2000
      or trim(delivery_result_url) !~* '^https?://[^[:space:]]+$') then
    raise exception 'Step result URL must be a valid http or https link';
  end if;

  if task_record.content_step in ('design', 'publishing')
    and nullif(trim(delivery_result_url), '') is null then
    raise exception 'Design and publishing steps require a result URL';
  end if;

  insert into public.content_step_deliveries (
    organization_id, content_item_id, task_id, step,
    result_note, result_url, submitted_by
  ) values (
    task_record.organization_id, task_record.content_item_id, task_record.id,
    task_record.content_step, nullif(trim(delivery_result_note), ''),
    nullif(trim(delivery_result_url), ''), target_user_id
  )
  on conflict (task_id) do update
  set
    result_note = excluded.result_note,
    result_url = excluded.result_url,
    version = public.content_step_deliveries.version + 1,
    submitted_by = excluded.submitted_by,
    submitted_at = now(),
    updated_at = now()
  returning id into delivery_id;

  if task_record.status = 'ready' then
    update public.tasks set status = 'in_progress' where id = task_record.id;
    update public.tasks set status = 'review' where id = task_record.id;
  elsif task_record.status = 'in_progress' then
    update public.tasks set status = 'review' where id = task_record.id;
  end if;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    task_record.organization_id, target_user_id, 'content.step_result_submitted',
    'content_step_delivery', delivery_id,
    jsonb_build_object(
      'content_item_id', task_record.content_item_id,
      'task_id', task_record.id,
      'step', task_record.content_step,
      'has_note', nullif(trim(delivery_result_note), '') is not null,
      'has_url', nullif(trim(delivery_result_url), '') is not null
    )
  );

  return delivery_id;
end;
$$;

create or replace function public.update_social_post_brief(
  target_user_id uuid,
  target_content_item_id uuid,
  content_title text,
  content_goal text,
  content_hook text,
  content_cta text,
  content_copy_brief text,
  content_design_brief text
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

  select item.organization_id into target_organization_id
  from public.content_items item
  where item.id = target_content_item_id
    and item.format = 'post'
  for update;

  if target_organization_id is null then
    raise exception 'Social post content item was not found';
  end if;

  if not private.has_org_role(
    target_organization_id,
    array['owner', 'admin', 'manager']::public.app_role[]
  ) then
    raise exception 'Only organization leadership can update social post briefs';
  end if;

  if char_length(trim(content_title)) not between 3 and 180
    or char_length(trim(content_goal)) not between 5 and 1000
    or char_length(trim(content_hook)) not between 3 and 1000
    or char_length(trim(content_cta)) not between 2 and 500
    or char_length(trim(content_copy_brief)) not between 10 and 8000
    or char_length(trim(content_design_brief)) not between 10 and 8000 then
    raise exception 'Social post brief fields are incomplete or exceed their allowed length';
  end if;

  update public.content_items item
  set
    title = trim(content_title),
    goal = trim(content_goal),
    hook = trim(content_hook),
    cta = trim(content_cta),
    copy_brief = trim(content_copy_brief),
    design_brief = trim(content_design_brief),
    version = item.version + 1,
    updated_at = now()
  where item.id = target_content_item_id;

  update public.tasks task
  set
    title = case task.content_step
      when 'brief' then 'اعتماد Brief البوست: ' || trim(content_title)
      when 'caption' then 'كتابة كابشن البوست: ' || trim(content_title)
      when 'design' then 'تصميم البوست: ' || trim(content_title)
      when 'approval' then 'مراجعة البوست: ' || trim(content_title)
      when 'scheduling' then 'جدولة البوست: ' || trim(content_title)
      when 'publishing' then 'نشر وتوثيق البوست: ' || trim(content_title)
      else task.title
    end,
    description = case task.content_step
      when 'caption' then left('تعليمات الكتابة:' || chr(10) || trim(content_copy_brief), 5000)
      when 'design' then left('Design Brief:' || chr(10) || trim(content_design_brief), 5000)
      else task.description
    end
  where task.content_item_id = target_content_item_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id, target_user_id, 'content.social_post_brief_updated',
    'content_item', target_content_item_id,
    jsonb_build_object('title', trim(content_title), 'brief_complete', true)
  );

  return true;
end;
$$;

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

  if target_stage not in ('recording', 'editing', 'thumbnail', 'caption', 'design') then
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
    organization_id, content_item_id, task_id, stage, round, instructions,
    requested_by, assigned_to
  ) values (
    target_organization_id, target_content_item_id, target_task_id, target_stage,
    next_round, trim(revision_instructions), target_user_id, target_assignee_id
  ) returning id into revision_id;

  update public.content_items item
  set version = item.version + 1, updated_at = now()
  where item.id = target_content_item_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id, target_user_id, 'content.revision_requested',
    'content_revision', revision_id,
    jsonb_build_object(
      'content_item_id', target_content_item_id, 'stage', target_stage,
      'round', next_round, 'assigned_to', target_assignee_id
    )
  );

  return revision_id;
end;
$$;

alter table public.content_step_deliveries enable row level security;

create policy "content_step_deliveries_select_organization_members"
on public.content_step_deliveries
for select
to authenticated
using (private.is_org_member(organization_id));

revoke all on table public.content_step_deliveries from anon, authenticated;
grant select on table public.content_step_deliveries to authenticated;

revoke all on function private.require_content_step_delivery()
from public, anon, authenticated;

revoke all on function public.create_social_post_deliverable(
  uuid, uuid, text, text, text, integer, uuid, timestamptz, timestamptz,
  public.launch_budget_category, numeric, text, uuid, text, text, text, text,
  text, text[], uuid, uuid, uuid, uuid, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.create_social_post_deliverable(
  uuid, uuid, text, text, text, integer, uuid, timestamptz, timestamptz,
  public.launch_budget_category, numeric, text, uuid, text, text, text, text,
  text, text[], uuid, uuid, uuid, uuid, uuid, uuid, uuid
) to service_role;

revoke all on function public.submit_content_step_delivery(uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.submit_content_step_delivery(uuid, uuid, text, text)
to service_role;

revoke all on function public.update_social_post_brief(
  uuid, uuid, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.update_social_post_brief(
  uuid, uuid, text, text, text, text, text, text
) to service_role;

revoke all on function public.request_content_revision(
  uuid, uuid, public.content_step, text
) from public, anon, authenticated;
grant execute on function public.request_content_revision(
  uuid, uuid, public.content_step, text
) to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'content_step_deliveries'
    ) then
    alter publication supabase_realtime add table public.content_step_deliveries;
  end if;
end;
$$;

comment on table public.content_step_deliveries is
  'Versioned result evidence for caption, design, scheduling, and publishing tasks.';
comment on column public.launch_deliverables.workflow_template is
  'single_task keeps legacy behavior; social_post generates individual content cards and child workflows.';
