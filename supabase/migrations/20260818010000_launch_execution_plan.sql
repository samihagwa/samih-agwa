-- Turn every launch into an executable project: gate outputs live inside the
-- launch, quantified deliverables create ordinary tasks, and budgets/dependencies
-- remain visible without creating a second task workflow.

create type public.launch_document_status as enum ('draft', 'submitted', 'approved');
create type public.launch_deliverable_kind as enum (
  'reel', 'story', 'design', 'telegram_post', 'social_post', 'email', 'ad',
  'landing_page', 'webinar_asset', 'other'
);
create type public.launch_budget_category as enum (
  'production', 'media_spend', 'tools', 'event', 'other'
);

create table public.launch_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  launch_id uuid not null,
  gate public.launch_gate not null,
  title text not null,
  summary text not null,
  document_url text,
  status public.launch_document_status not null default 'submitted',
  version integer not null,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (launch_id, organization_id)
    references public.launches (id, organization_id) on delete cascade,
  constraint launch_documents_title_length check (char_length(trim(title)) between 3 and 180),
  constraint launch_documents_summary_length check (char_length(trim(summary)) between 5 and 10000),
  constraint launch_documents_url_length check (document_url is null or char_length(document_url) <= 2000),
  constraint launch_documents_version_positive check (version > 0),
  unique (launch_id, gate, version)
);

create table public.launch_deliverables (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  launch_id uuid not null,
  kind public.launch_deliverable_kind not null,
  title text not null,
  brief text not null,
  channel text,
  destination text,
  planned_quantity integer not null default 1,
  owner_id uuid not null references public.profiles (id) on delete restrict,
  due_at timestamptz not null,
  budget_category public.launch_budget_category not null default 'production',
  budget_amount numeric(14, 2) not null default 0,
  currency text not null default 'EGP',
  result_note text,
  result_url text,
  delivered_at timestamptz,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (id, launch_id, organization_id),
  foreign key (launch_id, organization_id)
    references public.launches (id, organization_id) on delete cascade,
  constraint launch_deliverables_title_length check (char_length(trim(title)) between 3 and 180),
  constraint launch_deliverables_brief_length check (char_length(trim(brief)) between 5 and 5000),
  constraint launch_deliverables_channel_length check (channel is null or char_length(trim(channel)) between 2 and 120),
  constraint launch_deliverables_destination_length check (destination is null or char_length(trim(destination)) between 2 and 500),
  constraint launch_deliverables_quantity_positive check (planned_quantity between 1 and 500),
  constraint launch_deliverables_budget_nonnegative check (budget_amount >= 0),
  constraint launch_deliverables_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint launch_deliverables_result_note_length check (result_note is null or char_length(trim(result_note)) between 3 and 5000),
  constraint launch_deliverables_result_url_length check (result_url is null or char_length(result_url) <= 2000),
  constraint launch_deliverables_result_consistent check (
    (delivered_at is null and result_note is null and result_url is null)
    or (delivered_at is not null and (result_note is not null or result_url is not null))
  )
);

create table public.launch_deliverable_dependencies (
  organization_id uuid not null,
  launch_id uuid not null,
  deliverable_id uuid not null,
  depends_on_deliverable_id uuid not null,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (deliverable_id, depends_on_deliverable_id),
  foreign key (deliverable_id, launch_id, organization_id)
    references public.launch_deliverables (id, launch_id, organization_id) on delete cascade,
  foreign key (depends_on_deliverable_id, launch_id, organization_id)
    references public.launch_deliverables (id, launch_id, organization_id) on delete restrict,
  constraint launch_deliverable_no_self_dependency check (deliverable_id <> depends_on_deliverable_id)
);

alter table public.tasks
  add column launch_deliverable_id uuid,
  drop constraint tasks_workflow_link_exclusive,
  add constraint tasks_workflow_link_exclusive check (
    num_nonnulls(content_item_id, launch_id, crm_contact_id, launch_deliverable_id) <= 1
  ),
  add constraint tasks_launch_deliverable_org_fkey
    foreign key (launch_deliverable_id, organization_id)
    references public.launch_deliverables (id, organization_id) on delete restrict;

create unique index tasks_one_launch_deliverable_idx
  on public.tasks (launch_deliverable_id)
  where launch_deliverable_id is not null;
create index launch_documents_launch_gate_time_idx
  on public.launch_documents (launch_id, gate, created_at desc, id desc);
create index launch_documents_org_launch_idx
  on public.launch_documents (organization_id, launch_id, gate);
create index launch_documents_creator_idx on public.launch_documents (created_by);
create index launch_deliverables_launch_due_idx
  on public.launch_deliverables (launch_id, due_at, id);
create index launch_deliverables_org_launch_idx
  on public.launch_deliverables (organization_id, launch_id, kind);
create index launch_deliverables_owner_due_idx
  on public.launch_deliverables (owner_id, due_at, id);
create index launch_deliverables_creator_idx on public.launch_deliverables (created_by);
create index launch_deliverable_dependencies_parent_idx
  on public.launch_deliverable_dependencies (depends_on_deliverable_id, deliverable_id);
create index launch_deliverable_dependencies_org_launch_idx
  on public.launch_deliverable_dependencies (organization_id, launch_id, deliverable_id);
create index launch_deliverable_dependencies_creator_idx
  on public.launch_deliverable_dependencies (created_by);

-- Preserve the canonical task rules while recognizing the new immutable workflow link.
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
  actor_owns_crm_contact boolean := false;
  crm_command_contact_id text := nullif(current_setting('app.crm_contact_id', true), '');
begin
  if actor is null then
    raise exception 'An authenticated actor is required';
  end if;

  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then
    if (old.content_item_id is null and old.launch_id is null and old.crm_contact_id is null and old.launch_deliverable_id is null)
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
    select 1 from public.memberships membership
    where membership.organization_id = new.organization_id
      and membership.user_id = actor
      and membership.status = 'active'
      and membership.role in ('owner', 'admin', 'manager')
  ) into actor_is_manager;

  select exists (
    select 1 from public.memberships membership
    where membership.organization_id = new.organization_id
      and membership.user_id = new.owner_id
      and membership.status = 'active'
  ) into owner_is_active;

  if not owner_is_active then
    raise exception 'Task owner must be an active member of the organization';
  end if;

  if new.crm_contact_id is not null then
    select exists (
      select 1 from public.crm_contacts contact
      where contact.id = new.crm_contact_id
        and contact.organization_id = new.organization_id
        and contact.owner_id = actor
    ) into actor_owns_crm_contact;

    if crm_command_contact_id is distinct from new.crm_contact_id::text then
      raise exception 'CRM follow-up tasks are managed through the CRM workflow only';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if not actor_is_manager and not actor_owns_crm_contact then
      raise exception 'Only organization leadership can create tasks, except a CRM owner creating their own follow-up';
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
    or new.launch_gate is distinct from old.launch_gate
    or new.crm_contact_id is distinct from old.crm_contact_id
    or new.launch_deliverable_id is distinct from old.launch_deliverable_id then
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

create or replace function private.require_launch_output_before_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'done' and old.status is distinct from new.status
    and new.launch_id is not null
    and not exists (
      select 1 from public.launch_documents document
      where document.launch_id = new.launch_id
        and document.organization_id = new.organization_id
        and document.gate = new.launch_gate
        and document.status in ('submitted', 'approved')
    ) then
    raise exception 'Save the launch gate output inside the launch before completing this task';
  end if;

  if new.status in ('review', 'done') and old.status is distinct from new.status
    and new.launch_deliverable_id is not null
    and not exists (
      select 1 from public.launch_deliverables deliverable
      where deliverable.id = new.launch_deliverable_id
        and deliverable.organization_id = new.organization_id
        and deliverable.delivered_at is not null
        and (deliverable.result_note is not null or deliverable.result_url is not null)
    ) then
    raise exception 'Submit the launch deliverable result before review or completion';
  end if;
  return new;
end;
$$;

create trigger tasks_require_launch_output
before update on public.tasks
for each row execute function private.require_launch_output_before_review();

create or replace function public.save_launch_gate_document(
  target_user_id uuid,
  target_launch_id uuid,
  document_gate public.launch_gate,
  document_title text,
  document_summary text,
  target_document_url text,
  document_status public.launch_document_status
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  launch_record public.launches%rowtype;
  actor_is_manager boolean;
  actor_is_gate_owner boolean;
  next_version integer;
  document_id uuid;
begin
  if target_user_id is null then raise exception 'A verified target user is required'; end if;
  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  select launch.* into launch_record from public.launches launch
  where launch.id = target_launch_id for update;
  if launch_record.id is null then raise exception 'Launch was not found'; end if;

  select private.has_org_role(
    launch_record.organization_id,
    array['owner', 'admin', 'manager']::public.app_role[]
  ) into actor_is_manager;
  select exists (
    select 1 from public.tasks task
    where task.launch_id = target_launch_id
      and task.launch_gate = document_gate
      and task.owner_id = target_user_id
  ) into actor_is_gate_owner;

  if not actor_is_manager and not actor_is_gate_owner then
    raise exception 'Only the gate owner or organization leadership can save this launch output';
  end if;
  if document_status = 'approved' and not actor_is_manager then
    raise exception 'Only organization leadership can approve launch outputs';
  end if;
  if char_length(trim(document_title)) not between 3 and 180
    or char_length(trim(document_summary)) not between 5 and 10000 then
    raise exception 'Launch output title or summary is incomplete';
  end if;
  if nullif(trim(target_document_url), '') is not null
    and (char_length(trim(target_document_url)) > 2000 or trim(target_document_url) !~* '^https?://') then
    raise exception 'Launch output URL must be a valid http or https link';
  end if;

  select coalesce(max(document.version), 0) + 1 into next_version
  from public.launch_documents document
  where document.launch_id = target_launch_id and document.gate = document_gate;

  insert into public.launch_documents (
    organization_id, launch_id, gate, title, summary, document_url,
    status, version, created_by
  ) values (
    launch_record.organization_id, target_launch_id, document_gate,
    trim(document_title), trim(document_summary), nullif(trim(target_document_url), ''),
    document_status, next_version, target_user_id
  ) returning id into document_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    launch_record.organization_id, target_user_id, 'launch.gate_output_saved',
    'launch', target_launch_id,
    jsonb_build_object('gate', document_gate, 'status', document_status, 'version', next_version)
  );
  return document_id;
end;
$$;

create or replace function public.create_launch_deliverable(
  target_user_id uuid,
  target_launch_id uuid,
  deliverable_kind public.launch_deliverable_kind,
  deliverable_title text,
  deliverable_brief text,
  deliverable_channel text,
  deliverable_destination text,
  deliverable_quantity integer,
  deliverable_owner_id uuid,
  deliverable_due_at timestamptz,
  deliverable_budget_category public.launch_budget_category,
  deliverable_budget_amount numeric,
  deliverable_currency text,
  depends_on_deliverable_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  launch_record public.launches%rowtype;
  deliverable_id uuid;
  task_id uuid;
  dependency_task_id uuid;
begin
  if target_user_id is null then raise exception 'A verified target user is required'; end if;
  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  select launch.* into launch_record from public.launches launch
  where launch.id = target_launch_id for update;
  if launch_record.id is null then raise exception 'Launch was not found'; end if;
  if not private.has_org_role(
    launch_record.organization_id,
    array['owner', 'admin', 'manager']::public.app_role[]
  ) then
    raise exception 'Only organization leadership can plan launch deliverables';
  end if;
  if not exists (
    select 1 from public.memberships membership
    where membership.organization_id = launch_record.organization_id
      and membership.user_id = deliverable_owner_id
      and membership.status = 'active'
      and membership.role <> 'viewer'
  ) then raise exception 'Deliverable owner must be an active working member'; end if;
  if char_length(trim(deliverable_title)) not between 3 and 180
    or char_length(trim(deliverable_brief)) not between 5 and 5000 then
    raise exception 'Deliverable title or brief is incomplete';
  end if;
  if deliverable_quantity not between 1 and 500 then
    raise exception 'Deliverable quantity must be between one and 500';
  end if;
  if deliverable_due_at <= now() or deliverable_due_at > launch_record.ends_at then
    raise exception 'Deliverable deadline must be in the future and no later than launch end';
  end if;
  if deliverable_budget_amount < 0 then raise exception 'Deliverable budget cannot be negative'; end if;
  if upper(trim(deliverable_currency)) !~ '^[A-Z]{3}$' then
    raise exception 'Currency must be a three-letter ISO code';
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
    currency, created_by
  ) values (
    launch_record.organization_id, target_launch_id, deliverable_kind,
    trim(deliverable_title), trim(deliverable_brief), nullif(trim(deliverable_channel), ''),
    nullif(trim(deliverable_destination), ''), deliverable_quantity,
    deliverable_owner_id, deliverable_due_at, deliverable_budget_category,
    deliverable_budget_amount, upper(trim(deliverable_currency)), target_user_id
  ) returning id into deliverable_id;

  insert into public.tasks (
    organization_id, title, description, status, priority, owner_id, created_by,
    acceptance_criteria, due_at, launch_deliverable_id
  ) values (
    launch_record.organization_id,
    'تسليم إطلاق: ' || trim(deliverable_title),
    trim(deliverable_brief),
    case when dependency_task_id is null then 'ready'::public.task_status else 'backlog'::public.task_status end,
    'high', deliverable_owner_id, target_user_id,
    'تسليم واعتماد ' || deliverable_quantity || ' وحدة، مع رابط أو ملاحظة نتيجة محفوظة داخل غرفة الإطلاق.',
    deliverable_due_at, deliverable_id
  ) returning id into task_id;

  if dependency_task_id is not null then
    insert into public.launch_deliverable_dependencies (
      organization_id, launch_id, deliverable_id, depends_on_deliverable_id, created_by
    ) values (
      launch_record.organization_id, target_launch_id, deliverable_id,
      depends_on_deliverable_id, target_user_id
    );
    insert into public.task_dependencies (task_id, depends_on_task_id)
    values (task_id, dependency_task_id);
  end if;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    launch_record.organization_id, target_user_id, 'launch.deliverable_created',
    'launch_deliverable', deliverable_id,
    jsonb_build_object(
      'launch_id', target_launch_id, 'kind', deliverable_kind,
      'quantity', deliverable_quantity, 'task_id', task_id,
      'budget_category', deliverable_budget_category,
      'budget_amount', deliverable_budget_amount, 'currency', upper(trim(deliverable_currency))
    )
  );
  return deliverable_id;
end;
$$;

create or replace function public.submit_launch_deliverable(
  target_user_id uuid,
  target_deliverable_id uuid,
  deliverable_result_note text,
  deliverable_result_url text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  deliverable_record public.launch_deliverables%rowtype;
  task_record public.tasks%rowtype;
  actor_is_manager boolean;
begin
  if target_user_id is null then raise exception 'A verified target user is required'; end if;
  perform set_config('request.jwt.claim.sub', target_user_id::text, true);

  select deliverable.* into deliverable_record
  from public.launch_deliverables deliverable
  where deliverable.id = target_deliverable_id for update;
  if deliverable_record.id is null then raise exception 'Launch deliverable was not found'; end if;

  select private.has_org_role(
    deliverable_record.organization_id,
    array['owner', 'admin', 'manager']::public.app_role[]
  ) into actor_is_manager;
  if not actor_is_manager and deliverable_record.owner_id <> target_user_id then
    raise exception 'Only the deliverable owner or organization leadership can submit the result';
  end if;
  if nullif(trim(deliverable_result_note), '') is null
    and nullif(trim(deliverable_result_url), '') is null then
    raise exception 'Add a result note or delivery URL';
  end if;
  if nullif(trim(deliverable_result_note), '') is not null
    and char_length(trim(deliverable_result_note)) not between 3 and 5000 then
    raise exception 'Deliverable result note is invalid';
  end if;
  if nullif(trim(deliverable_result_url), '') is not null
    and (char_length(trim(deliverable_result_url)) > 2000 or trim(deliverable_result_url) !~* '^https?://') then
    raise exception 'Deliverable result URL must be a valid http or https link';
  end if;

  select task.* into task_record from public.tasks task
  where task.launch_deliverable_id = target_deliverable_id for update;
  if task_record.id is null then raise exception 'Launch deliverable task was not found'; end if;
  if task_record.status = 'backlog' then raise exception 'Complete the deliverable dependency before submitting this result'; end if;
  if task_record.status in ('blocked', 'cancelled') then raise exception 'Resolve or reopen the deliverable task before submission'; end if;

  update public.launch_deliverables
  set result_note = nullif(trim(deliverable_result_note), ''),
      result_url = nullif(trim(deliverable_result_url), ''),
      delivered_at = now()
  where id = target_deliverable_id;

  if task_record.status = 'ready' then
    update public.tasks set status = 'in_progress' where id = task_record.id;
    update public.tasks set status = 'review' where id = task_record.id;
  elsif task_record.status = 'in_progress' then
    update public.tasks set status = 'review' where id = task_record.id;
  end if;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    deliverable_record.organization_id, target_user_id, 'launch.deliverable_submitted',
    'launch_deliverable', target_deliverable_id,
    jsonb_build_object('has_note', nullif(trim(deliverable_result_note), '') is not null,
      'has_url', nullif(trim(deliverable_result_url), '') is not null)
  );
  return true;
end;
$$;

alter table public.launch_documents enable row level security;
alter table public.launch_deliverables enable row level security;
alter table public.launch_deliverable_dependencies enable row level security;

create policy "launch_documents_select_organization_members"
on public.launch_documents for select to authenticated
using (private.is_org_member(organization_id));
create policy "launch_deliverables_select_organization_members"
on public.launch_deliverables for select to authenticated
using (private.is_org_member(organization_id));
create policy "launch_deliverable_dependencies_select_organization_members"
on public.launch_deliverable_dependencies for select to authenticated
using (private.is_org_member(organization_id));

revoke all on table public.launch_documents from anon, authenticated;
revoke all on table public.launch_deliverables from anon, authenticated;
revoke all on table public.launch_deliverable_dependencies from anon, authenticated;
grant select on table public.launch_documents to authenticated;
grant select on table public.launch_deliverables to authenticated;
grant select on table public.launch_deliverable_dependencies to authenticated;

revoke all on function private.require_launch_output_before_review() from public, anon, authenticated;
revoke all on function public.save_launch_gate_document(
  uuid, uuid, public.launch_gate, text, text, text, public.launch_document_status
) from public, anon, authenticated;
grant execute on function public.save_launch_gate_document(
  uuid, uuid, public.launch_gate, text, text, text, public.launch_document_status
) to service_role;
revoke all on function public.create_launch_deliverable(
  uuid, uuid, public.launch_deliverable_kind, text, text, text, text, integer,
  uuid, timestamptz, public.launch_budget_category, numeric, text, uuid
) from public, anon, authenticated;
grant execute on function public.create_launch_deliverable(
  uuid, uuid, public.launch_deliverable_kind, text, text, text, text, integer,
  uuid, timestamptz, public.launch_budget_category, numeric, text, uuid
) to service_role;
revoke all on function public.submit_launch_deliverable(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_launch_deliverable(uuid, uuid, text, text)
  to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'launch_documents'
    ) then alter publication supabase_realtime add table public.launch_documents; end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'launch_deliverables'
    ) then alter publication supabase_realtime add table public.launch_deliverables; end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'launch_deliverable_dependencies'
    ) then alter publication supabase_realtime add table public.launch_deliverable_dependencies; end if;
  end if;
end;
$$;

comment on table public.launch_documents is 'Versioned in-launch outputs for strategy, offer, promotion, tracking, decisions, and other launch gates.';
comment on table public.launch_deliverables is 'Quantified launch execution lines backed by canonical tasks, budgets, deadlines, and delivery evidence.';
