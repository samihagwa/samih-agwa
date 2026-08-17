-- Campaign and launch control room.
-- Launch readiness is deliberately represented by ordinary tasks. This keeps one
-- canonical workflow engine for owners, deadlines, transitions, dependencies, and
-- audit history instead of introducing a second task system.

create type public.launch_type as enum (
  'webinar',
  'course',
  'service',
  'book',
  'indicator'
);

create type public.launch_status as enum (
  'planning',
  'production',
  'review',
  'ready',
  'live',
  'completed',
  'cancelled'
);

create type public.launch_gate as enum (
  'strategy',
  'offer',
  'registration',
  'delivery',
  'promotion',
  'tracking',
  'go_no_go',
  'launch_day'
);

create table public.launches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null,
  type public.launch_type not null,
  objective text not null,
  audience text not null,
  offer text not null,
  primary_cta text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  lead_target integer,
  sales_target integer,
  revenue_target numeric(14, 2),
  currency text not null default 'EGP',
  status public.launch_status not null default 'planning',
  owner_id uuid not null references public.profiles (id) on delete restrict,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint launches_id_organization_unique unique (id, organization_id),
  constraint launches_title_length check (char_length(trim(title)) between 3 and 180),
  constraint launches_objective_length check (char_length(trim(objective)) between 5 and 1500),
  constraint launches_audience_length check (char_length(trim(audience)) between 3 and 1000),
  constraint launches_offer_length check (char_length(trim(offer)) between 3 and 1500),
  constraint launches_cta_length check (char_length(trim(primary_cta)) between 2 and 500),
  constraint launches_time_order check (ends_at > starts_at),
  constraint launches_lead_target_nonnegative check (lead_target is null or lead_target >= 0),
  constraint launches_sales_target_nonnegative check (sales_target is null or sales_target >= 0),
  constraint launches_revenue_target_nonnegative check (revenue_target is null or revenue_target >= 0),
  constraint launches_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint launches_version_positive check (version > 0),
  constraint launches_has_target check (
    lead_target is not null or sales_target is not null or revenue_target is not null
  )
);

-- A content asset may support more than one launch. The organization is included
-- in both composite foreign keys so cross-tenant links are impossible even to a
-- privileged command by mistake.
alter table public.content_items
  add constraint content_items_id_organization_unique unique (id, organization_id);

create table public.launch_content_items (
  organization_id uuid not null,
  launch_id uuid not null,
  content_item_id uuid not null,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (launch_id, content_item_id),
  foreign key (launch_id, organization_id)
    references public.launches (id, organization_id) on delete cascade,
  foreign key (content_item_id, organization_id)
    references public.content_items (id, organization_id) on delete restrict
);

alter table public.tasks
  add column launch_id uuid,
  add column launch_gate public.launch_gate;

alter table public.tasks
  add constraint tasks_launch_link_complete check (
    (launch_id is null and launch_gate is null)
    or (launch_id is not null and launch_gate is not null)
  ),
  add constraint tasks_workflow_link_exclusive check (
    not (content_item_id is not null and launch_id is not null)
  ),
  add constraint tasks_one_gate_per_launch unique (launch_id, launch_gate),
  add foreign key (launch_id, organization_id)
    references public.launches (id, organization_id) on delete restrict;

create index launches_org_status_start_idx
  on public.launches (organization_id, status, starts_at, id);

create index launches_org_open_start_idx
  on public.launches (organization_id, starts_at, id)
  where status not in ('completed', 'cancelled');

create index launches_owner_idx
  on public.launches (owner_id);

create index launches_created_by_idx
  on public.launches (created_by);

create index launch_content_items_org_launch_idx
  on public.launch_content_items (organization_id, launch_id, content_item_id);

create index launch_content_items_content_idx
  on public.launch_content_items (content_item_id, launch_id);

create index launch_content_items_created_by_idx
  on public.launch_content_items (created_by);

create index tasks_launch_gate_idx
  on public.tasks (launch_id, launch_gate)
  where launch_id is not null;

-- Extend the immutable workflow-link contract for launch tasks and allow the
-- dependency trigger to perform only its narrow backlog -> ready transition.
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
    if (old.content_item_id is null and old.launch_id is null)
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
    or new.content_step is distinct from old.content_step
    or new.launch_id is distinct from old.launch_id
    or new.launch_gate is distinct from old.launch_gate then
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

-- Dependency unlocking belongs to the task engine, not a specific workflow.
create or replace function private.unlock_task_dependencies()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.status <> 'done' and new.status = 'done' then
    update public.tasks candidate
    set status = 'ready'
    where candidate.organization_id = new.organization_id
      and candidate.status = 'backlog'
      and exists (
        select 1
        from public.task_dependencies dependency
        where dependency.task_id = candidate.id
          and dependency.depends_on_task_id = new.id
      )
      and not exists (
        select 1
        from public.task_dependencies dependency
        join public.tasks predecessor on predecessor.id = dependency.depends_on_task_id
        where dependency.task_id = candidate.id
          and predecessor.status <> 'done'
      );
  end if;

  return new;
end;
$$;

-- Content status remains derived from content tasks; dependency unlocking is now
-- shared by both content and launch workflows.
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

create or replace function private.advance_launch_workflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_launch_status public.launch_status;
  previous_launch_status public.launch_status;
begin
  if new.launch_id is null then
    return new;
  end if;

  select launch.status
  into previous_launch_status
  from public.launches launch
  where launch.id = new.launch_id
  for update;

  select case
    when bool_and(task.status = 'cancelled') then 'cancelled'::public.launch_status
    when bool_or(task.launch_gate = 'launch_day' and task.status = 'done') then 'completed'::public.launch_status
    when bool_or(task.launch_gate = 'launch_day' and task.status in ('in_progress', 'review')) then 'live'::public.launch_status
    when bool_or(task.launch_gate = 'launch_day' and task.status = 'ready') then 'ready'::public.launch_status
    when bool_or(task.launch_gate = 'go_no_go' and task.status in ('ready', 'in_progress', 'review', 'done')) then 'review'::public.launch_status
    when bool_or(task.launch_gate in ('offer', 'registration', 'delivery', 'promotion', 'tracking') and task.status in ('ready', 'in_progress', 'review', 'done')) then 'production'::public.launch_status
    else 'planning'::public.launch_status
  end
  into next_launch_status
  from public.tasks task
  where task.launch_id = new.launch_id;

  if next_launch_status is distinct from previous_launch_status then
    update public.launches launch
    set
      status = next_launch_status,
      version = launch.version + 1,
      updated_at = now()
    where launch.id = new.launch_id;

    insert into public.audit_events (
      organization_id, actor_id, action, entity_type, entity_id, before_data, after_data
    ) values (
      new.organization_id,
      (select auth.uid()),
      'launch.status_changed',
      'launch',
      new.launch_id,
      jsonb_build_object('status', previous_launch_status),
      jsonb_build_object('status', next_launch_status)
    );
  end if;

  return new;
end;
$$;

drop trigger tasks_advance_content_workflow on public.tasks;

create trigger tasks_10_unlock_dependencies
after insert or update of status on public.tasks
for each row execute function private.unlock_task_dependencies();

create trigger tasks_20_advance_content_workflow
after insert or update of status on public.tasks
for each row execute function private.advance_content_workflow();

create trigger tasks_30_advance_launch_workflow
after insert or update of status on public.tasks
for each row execute function private.advance_launch_workflow();

create or replace function public.create_launch_workflow(
  target_user_id uuid,
  target_organization_id uuid,
  launch_title text,
  launch_kind public.launch_type,
  launch_objective text,
  launch_audience text,
  launch_offer text,
  launch_cta text,
  launch_starts_at timestamptz,
  launch_ends_at timestamptz,
  launch_lead_target integer,
  launch_sales_target integer,
  launch_revenue_target numeric,
  launch_currency text,
  strategy_owner_id uuid,
  offer_owner_id uuid,
  registration_owner_id uuid,
  delivery_owner_id uuid,
  promotion_owner_id uuid,
  tracking_owner_id uuid,
  go_no_go_owner_id uuid,
  launch_day_owner_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  launch_id uuid;
  strategy_task_id uuid;
  offer_task_id uuid;
  registration_task_id uuid;
  delivery_task_id uuid;
  promotion_task_id uuid;
  tracking_task_id uuid;
  go_no_go_task_id uuid;
  launch_day_task_id uuid;
  schedule_span interval;
begin
  if target_user_id is null then
    raise exception 'A verified target user is required';
  end if;

  perform set_config('request.jwt.claim.sub', target_user_id::text, true);
  actor := (select auth.uid());

  if not exists (
    select 1
    from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = actor
      and membership.status = 'active'
      and membership.role in ('owner', 'admin', 'manager')
  ) then
    raise exception 'Only organization leadership can create launch workflows';
  end if;

  if launch_starts_at <= now() + interval '24 hours' then
    raise exception 'Launch start must be at least 24 hours in the future';
  end if;

  if launch_ends_at <= launch_starts_at then
    raise exception 'Launch end must be after its start';
  end if;

  if char_length(trim(launch_title)) not between 3 and 180
    or char_length(trim(launch_objective)) not between 5 and 1500
    or char_length(trim(launch_audience)) not between 3 and 1000
    or char_length(trim(launch_offer)) not between 3 and 1500
    or char_length(trim(launch_cta)) not between 2 and 500 then
    raise exception 'Launch brief fields are incomplete or exceed their allowed length';
  end if;

  if launch_lead_target is null
    and launch_sales_target is null
    and launch_revenue_target is null then
    raise exception 'At least one measurable launch target is required';
  end if;

  if coalesce(launch_lead_target, 0) < 0
    or coalesce(launch_sales_target, 0) < 0
    or coalesce(launch_revenue_target, 0) < 0 then
    raise exception 'Launch targets cannot be negative';
  end if;

  if upper(trim(launch_currency)) !~ '^[A-Z]{3}$' then
    raise exception 'Currency must be a three-letter ISO code';
  end if;

  if exists (
    select 1
    from unnest(array[
      strategy_owner_id,
      offer_owner_id,
      registration_owner_id,
      delivery_owner_id,
      promotion_owner_id,
      tracking_owner_id,
      go_no_go_owner_id,
      launch_day_owner_id
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
    raise exception 'Every launch owner must be an active organization member';
  end if;

  insert into public.launches (
    organization_id, title, type, objective, audience, offer, primary_cta,
    starts_at, ends_at, lead_target, sales_target, revenue_target, currency,
    status, owner_id, created_by
  ) values (
    target_organization_id,
    trim(launch_title),
    launch_kind,
    trim(launch_objective),
    trim(launch_audience),
    trim(launch_offer),
    trim(launch_cta),
    launch_starts_at,
    launch_ends_at,
    launch_lead_target,
    launch_sales_target,
    launch_revenue_target,
    upper(trim(launch_currency)),
    'planning',
    launch_day_owner_id,
    actor
  ) returning id into launch_id;

  schedule_span := launch_starts_at - now();

  insert into public.tasks (
    organization_id, title, description, status, priority, owner_id, created_by,
    acceptance_criteria, due_at, launch_id, launch_gate
  ) values (
    target_organization_id,
    'استراتيجية الإطلاق: ' || trim(launch_title),
    'تثبيت النتيجة المطلوبة والجمهور والرسالة والمقياس الرئيسي قبل التنفيذ.',
    'ready',
    'high',
    strategy_owner_id,
    actor,
    'هدف رقمي معتمد، جمهور محدد، وعد واضح، ورسالة رئيسية واحدة موثقة.',
    now() + schedule_span * 0.10,
    launch_id,
    'strategy'
  ) returning id into strategy_task_id;

  insert into public.tasks (
    organization_id, title, description, status, priority, owner_id, created_by,
    acceptance_criteria, due_at, launch_id, launch_gate
  ) values (
    target_organization_id,
    'اعتماد العرض: ' || trim(launch_title),
    'صياغة العرض والسعر والضمان والمكافآت والـCTA بعد اعتماد الاستراتيجية.',
    'backlog',
    'high',
    offer_owner_id,
    actor,
    'العرض والسعر والضمان والمكافآت والـCTA معتمدة ولا توجد تفاصيل تجارية معلقة.',
    now() + schedule_span * 0.24,
    launch_id,
    'offer'
  ) returning id into offer_task_id;

  insert into public.tasks (
    organization_id, title, description, status, priority, owner_id, created_by,
    acceptance_criteria, due_at, launch_id, launch_gate
  ) values (
    target_organization_id,
    'مسار التسجيل والشراء: ' || trim(launch_title),
    'تجهيز صفحة التسجيل أو الشراء ورسائل التأكيد واختبار الرحلة كاملة.',
    'backlog',
    'high',
    registration_owner_id,
    actor,
    'الرابط يعمل على الهاتف، البيانات تصل صحيحة، ورسالة التأكيد أو الدفع مجرّبة بنجاح.',
    now() + schedule_span * 0.42,
    launch_id,
    'registration'
  ) returning id into registration_task_id;

  insert into public.tasks (
    organization_id, title, description, status, priority, owner_id, created_by,
    acceptance_criteria, due_at, launch_id, launch_gate
  ) values (
    target_organization_id,
    'جاهزية التسليم: ' || trim(launch_title),
    'تجهيز المنتج أو الويبنار أو الخدمة وتجربة وصول العميل لما وُعد به.',
    'backlog',
    'high',
    delivery_owner_id,
    actor,
    'المادة أو الخدمة جاهزة، الوصول مجرّب، وخطة الدعم والمسؤول وقت الإطلاق محددان.',
    now() + schedule_span * 0.58,
    launch_id,
    'delivery'
  ) returning id into delivery_task_id;

  insert into public.tasks (
    organization_id, title, description, status, priority, owner_id, created_by,
    acceptance_criteria, due_at, launch_id, launch_gate
  ) values (
    target_organization_id,
    'خطة الترويج: ' || trim(launch_title),
    'تحويل الاستراتيجية والعرض إلى جدول محتوى ورسائل وإعلانات بمواعيد واضحة.',
    'backlog',
    'high',
    promotion_owner_id,
    actor,
    'القنوات والتواريخ والرسائل والأصول والمسؤول عن كل نشر محددة ومربوطة بالخطة.',
    now() + schedule_span * 0.64,
    launch_id,
    'promotion'
  ) returning id into promotion_task_id;

  insert into public.tasks (
    organization_id, title, description, status, priority, owner_id, created_by,
    acceptance_criteria, due_at, launch_id, launch_gate
  ) values (
    target_organization_id,
    'التتبع ولوحة الأرقام: ' || trim(launch_title),
    'تحديد مصادر البيانات واختبار تتبع التسجيل والحضور والمبيعات قبل الإطلاق.',
    'backlog',
    'high',
    tracking_owner_id,
    actor,
    'كل مقياس له مصدر ومالك وتوقيت تحديث، وتم اختبار التسجيل أو التحويل تجريبيًا.',
    now() + schedule_span * 0.72,
    launch_id,
    'tracking'
  ) returning id into tracking_task_id;

  insert into public.tasks (
    organization_id, title, description, status, priority, owner_id, created_by,
    acceptance_criteria, due_at, launch_id, launch_gate
  ) values (
    target_organization_id,
    'قرار Go / No-Go: ' || trim(launch_title),
    'مراجعة العرض والتسجيل والتسليم والترويج والتتبع قبل السماح ببدء الإطلاق.',
    'backlog',
    'urgent',
    go_no_go_owner_id,
    actor,
    'كل البوابات السابقة مكتملة بالأدلة، المخاطر الحرجة مغلقة، والقرار موثق بوضوح.',
    now() + schedule_span * 0.88,
    launch_id,
    'go_no_go'
  ) returning id into go_no_go_task_id;

  insert into public.tasks (
    organization_id, title, description, status, priority, owner_id, created_by,
    acceptance_criteria, due_at, launch_id, launch_gate
  ) values (
    target_organization_id,
    'تشغيل يوم الإطلاق: ' || trim(launch_title),
    'تنفيذ قائمة يوم الإطلاق ومتابعة الأرقام والمشكلات والتواصل حتى الإغلاق.',
    'backlog',
    'urgent',
    launch_day_owner_id,
    actor,
    'التشغيل بدأ في الموعد، الروابط منشورة، القياس يعمل، والمشكلات والنتائج موثقة.',
    launch_starts_at,
    launch_id,
    'launch_day'
  ) returning id into launch_day_task_id;

  insert into public.task_dependencies (task_id, depends_on_task_id) values
    (offer_task_id, strategy_task_id),
    (registration_task_id, offer_task_id),
    (delivery_task_id, offer_task_id),
    (promotion_task_id, offer_task_id),
    (tracking_task_id, registration_task_id),
    (go_no_go_task_id, registration_task_id),
    (go_no_go_task_id, delivery_task_id),
    (go_no_go_task_id, promotion_task_id),
    (go_no_go_task_id, tracking_task_id),
    (launch_day_task_id, go_no_go_task_id);

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id,
    actor,
    'launch.workflow_created',
    'launch',
    launch_id,
    jsonb_build_object(
      'title', trim(launch_title),
      'type', launch_kind,
      'starts_at', launch_starts_at,
      'task_count', 8
    )
  );

  return launch_id;
end;
$$;

create or replace function public.attach_content_to_launch(
  target_user_id uuid,
  target_launch_id uuid,
  target_content_item_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  target_organization_id uuid;
  inserted_count integer;
begin
  if target_user_id is null then
    raise exception 'A verified target user is required';
  end if;

  perform set_config('request.jwt.claim.sub', target_user_id::text, true);
  actor := (select auth.uid());

  select launch.organization_id
  into target_organization_id
  from public.launches launch
  where launch.id = target_launch_id;

  if target_organization_id is null then
    raise exception 'Launch was not found';
  end if;

  if not exists (
    select 1
    from public.memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = actor
      and membership.status = 'active'
      and membership.role in ('owner', 'admin', 'manager')
  ) then
    raise exception 'Only organization leadership can attach launch content';
  end if;

  if not exists (
    select 1
    from public.content_items content
    where content.id = target_content_item_id
      and content.organization_id = target_organization_id
  ) then
    raise exception 'Content item must belong to the same organization';
  end if;

  insert into public.launch_content_items (
    organization_id, launch_id, content_item_id, created_by
  ) values (
    target_organization_id, target_launch_id, target_content_item_id, actor
  ) on conflict (launch_id, content_item_id) do nothing;

  get diagnostics inserted_count = row_count;

  if inserted_count = 1 then
    insert into public.audit_events (
      organization_id, actor_id, action, entity_type, entity_id, after_data
    ) values (
      target_organization_id,
      actor,
      'launch.content_attached',
      'launch',
      target_launch_id,
      jsonb_build_object('content_item_id', target_content_item_id)
    );
  end if;

  return inserted_count = 1;
end;
$$;

alter table public.launches enable row level security;
alter table public.launch_content_items enable row level security;

create policy "launches_select_organization_members"
on public.launches
for select
to authenticated
using (private.is_org_member(organization_id));

create policy "launch_content_items_select_organization_members"
on public.launch_content_items
for select
to authenticated
using (private.is_org_member(organization_id));

revoke all on table public.launches from anon, authenticated;
revoke all on table public.launch_content_items from anon, authenticated;
grant select on table public.launches to authenticated;
grant select on table public.launch_content_items to authenticated;

revoke all on function private.unlock_task_dependencies() from public, anon, authenticated;
revoke all on function private.advance_launch_workflow() from public, anon, authenticated;
revoke all on function public.create_launch_workflow(
  uuid, uuid, text, public.launch_type, text, text, text, text, timestamptz,
  timestamptz, integer, integer, numeric, text, uuid, uuid, uuid, uuid, uuid,
  uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.create_launch_workflow(
  uuid, uuid, text, public.launch_type, text, text, text, text, timestamptz,
  timestamptz, integer, integer, numeric, text, uuid, uuid, uuid, uuid, uuid,
  uuid, uuid, uuid
) to service_role;

revoke all on function public.attach_content_to_launch(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.attach_content_to_launch(uuid, uuid, uuid)
  to service_role;

do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'launches'
  ) then
    alter publication supabase_realtime add table public.launches;
  end if;

  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'launch_content_items'
  ) then
    alter publication supabase_realtime add table public.launch_content_items;
  end if;
end;
$$;
