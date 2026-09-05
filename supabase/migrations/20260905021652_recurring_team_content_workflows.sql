-- A weekly team deliverable is configured once, but materializes as one shared
-- content card whose role-specific tasks keep the existing dependency, RLS,
-- delivery, revision, notification, and audit contracts.

alter table public.recurring_task_templates
  add column content_bundle_id uuid,
  add column content_bundle_title text,
  add column content_bundle_request text,
  add column content_bundle_format public.content_format,
  add column content_step public.content_step,
  add column bundle_anchor_weekday smallint,
  add column bundle_anchor_time time without time zone;

alter table public.recurring_task_templates
  add constraint recurring_task_templates_content_bundle_complete check (
    (
      content_bundle_id is null
      and content_bundle_title is null
      and content_bundle_request is null
      and content_bundle_format is null
      and content_step is null
      and bundle_anchor_weekday is null
      and bundle_anchor_time is null
    )
    or (
      content_bundle_id is not null
      and content_bundle_title is not null
      and char_length(trim(content_bundle_title)) between 3 and 180
      and content_bundle_request is not null
      and char_length(trim(content_bundle_request)) between 5 and 30000
      and content_bundle_format is not null
      and content_bundle_format in ('reel', 'post')
      and content_step is not null
      and bundle_anchor_weekday between 1 and 7
      and bundle_anchor_time is not null
    )
  ),
  add constraint recurring_task_templates_content_bundle_step check (
    content_bundle_id is null
    or (content_bundle_format = 'reel' and content_step in ('recording', 'editing', 'thumbnail', 'publishing'))
    or (content_bundle_format = 'post' and content_step in ('caption', 'design', 'publishing'))
  );

create index recurring_task_templates_content_bundle_idx
  on public.recurring_task_templates (
    organization_id, content_bundle_id, content_step, archived_at
  )
  where content_bundle_id is not null;

create table public.recurring_content_occurrences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  content_bundle_id uuid not null,
  bundle_slot timestamptz not null,
  content_item_id uuid not null unique references public.content_items (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint recurring_content_occurrences_bundle_unique
    unique (organization_id, content_bundle_id, bundle_slot)
);

create index recurring_content_occurrences_org_slot_idx
  on public.recurring_content_occurrences (organization_id, bundle_slot desc, id);

alter table public.recurring_content_occurrences enable row level security;
revoke all on table public.recurring_content_occurrences
from public, anon, authenticated;
grant select, insert, update, delete on table public.recurring_content_occurrences
to service_role;

grant insert (
  content_bundle_id, content_bundle_title, content_bundle_request,
  content_bundle_format, content_step, bundle_anchor_weekday,
  bundle_anchor_time
) on table public.recurring_task_templates to authenticated;

-- Bundle fields are part of the rule itself, so they must pass through the
-- same optimistic versioning and audit path as every other editable field.
drop trigger recurring_task_templates_enforce_update
on public.recurring_task_templates;
create trigger recurring_task_templates_enforce_update
before update of
  id, organization_id, title, description, priority, owner_id, created_by,
  acceptance_criteria, requires_review, estimated_minutes, weekday,
  time_local, starts_on, ends_on, paused, archived_at, version, created_at,
  content_bundle_id, content_bundle_title, content_bundle_request,
  content_bundle_format, content_step, bundle_anchor_weekday,
  bundle_anchor_time
on public.recurring_task_templates
for each row execute function private.enforce_recurring_task_template_rules();

drop trigger recurring_task_templates_audit_update
on public.recurring_task_templates;
create trigger recurring_task_templates_audit_update
after update of
  title, description, priority, owner_id, acceptance_criteria,
  requires_review, estimated_minutes, weekday, time_local, starts_on,
  ends_on, paused, archived_at, content_bundle_id, content_bundle_title,
  content_bundle_request, content_bundle_format, content_step,
  bundle_anchor_weekday, bundle_anchor_time
on public.recurring_task_templates
for each row execute function private.audit_recurring_task_template_change();

create or replace function private.validate_recurring_content_bundle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if new.content_bundle_id is null then return new; end if;

  if actor is null
    or not private.can_access_any_section(
      new.organization_id,
      array['tasks']::text[]
    )
    or not private.can_access_any_section(
      new.organization_id,
      array['content']::text[]
    ) then
    raise exception 'Weekly team content requires Tasks and Content access';
  end if;

  return new;
end;
$$;

create trigger recurring_task_templates_zz_validate_content_bundle
before insert or update of
  content_bundle_id, content_bundle_title, content_bundle_request,
  content_bundle_format, content_step, bundle_anchor_weekday,
  bundle_anchor_time
on public.recurring_task_templates
for each row execute function private.validate_recurring_content_bundle();

revoke all on function private.validate_recurring_content_bundle()
from public, anon, authenticated, service_role;

create or replace function private.attach_recurring_content_occurrence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  template_record public.recurring_task_templates%rowtype;
  actor uuid := (select auth.uid());
  occurrence_date date;
  occurrence_slot timestamptz;
  content_id uuid;
  days_to_anchor integer;
  request_key uuid;
begin
  if new.recurring_template_id is null then return new; end if;

  select template.* into template_record
  from public.recurring_task_templates template
  where template.id = new.recurring_template_id
    and template.organization_id = new.organization_id;

  if template_record.content_bundle_id is null then return new; end if;
  if actor is null then raise exception 'Recurring content materialization requires a delegated actor'; end if;

  days_to_anchor := mod(
    template_record.bundle_anchor_weekday
      - extract(isodow from (new.recurrence_slot_at at time zone 'Africa/Cairo'))::integer
      + 7,
    7
  );
  occurrence_date := (new.recurrence_slot_at at time zone 'Africa/Cairo')::date + days_to_anchor;
  occurrence_slot := (occurrence_date + template_record.bundle_anchor_time) at time zone 'Africa/Cairo';
  if occurrence_slot <= now() then
    raise exception 'Weekly content publication must remain in the future';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    new.organization_id::text || ':' || template_record.content_bundle_id::text
      || ':' || occurrence_slot::text,
    0
  ));

  select occurrence.content_item_id into content_id
  from public.recurring_content_occurrences occurrence
  where occurrence.organization_id = new.organization_id
    and occurrence.content_bundle_id = template_record.content_bundle_id
    and occurrence.bundle_slot = occurrence_slot;

  if content_id is null then
    request_key := gen_random_uuid();
    insert into public.content_items (
      organization_id, title, format, goal, hook, cta, platforms,
      status, publish_at, script_outline, editing_brief,
      thumbnail_brief, intake_request, intake_request_key, created_by
    ) values (
      new.organization_id,
      trim(template_record.content_bundle_title),
      template_record.content_bundle_format,
      'تنفيذ التسليم الأسبوعي كما كُتب في الطلب المشترك.',
      'حسب الطلب الأسبوعي المشترك.',
      'حسب الطلب الأسبوعي المشترك.',
      case when template_record.content_bundle_format = 'reel'
        then array['instagram', 'facebook']::text[]
        else array['instagram', 'facebook', 'telegram']::text[]
      end,
      'planned',
      occurrence_slot,
      left(template_record.content_bundle_request, 8000),
      left(template_record.content_bundle_request, 8000),
      left(template_record.content_bundle_request, 4000),
      template_record.content_bundle_request,
      request_key,
      actor
    ) returning id into content_id;

    insert into public.recurring_content_occurrences (
      organization_id, content_bundle_id, bundle_slot, content_item_id
    ) values (
      new.organization_id, template_record.content_bundle_id,
      occurrence_slot, content_id
    );

    insert into public.audit_events (
      organization_id, actor_id, action, entity_type, entity_id, after_data
    ) values (
      new.organization_id,
      null,
      'content.recurring_workflow_materialized',
      'content_item',
      content_id,
      jsonb_build_object(
        'content_bundle_id', template_record.content_bundle_id,
        'bundle_slot', occurrence_slot,
        'generated_automatically', true
      )
    );
  end if;

  new.content_item_id := content_id;
  new.content_step := template_record.content_step;
  new.status := case
    when template_record.content_step in ('recording', 'caption', 'thumbnail')
      then 'ready'::public.task_status
    else 'backlog'::public.task_status
  end;
  return new;
end;
$$;

-- This trigger runs before the task guard. It only enriches a materialized
-- recurring task from its immutable template; the existing guard still checks
-- the delegated actor, assignee, deadline, and allowed starting status.
create trigger tasks_00_attach_recurring_content_occurrence
before insert on public.tasks
for each row execute function private.attach_recurring_content_occurrence();

revoke all on function private.attach_recurring_content_occurrence()
from public, anon, authenticated, service_role;

create or replace function private.link_recurring_content_dependencies()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.recurring_template_id is null or new.content_item_id is null then return new; end if;

  insert into public.task_dependencies (task_id, depends_on_task_id)
  select dependent.id, prerequisite.id
  from public.tasks dependent
  join public.tasks prerequisite
    on prerequisite.organization_id = dependent.organization_id
   and prerequisite.content_item_id = dependent.content_item_id
  where dependent.organization_id = new.organization_id
    and dependent.content_item_id = new.content_item_id
    and (
      (dependent.content_step = 'editing' and prerequisite.content_step = 'recording')
      or (dependent.content_step = 'design' and prerequisite.content_step = 'caption')
      or (
        dependent.content_step = 'publishing'
        and prerequisite.content_step in ('editing', 'thumbnail', 'design')
      )
    )
  on conflict (task_id, depends_on_task_id) do nothing;

  return new;
end;
$$;

create trigger tasks_12_link_recurring_content_dependencies
after insert on public.tasks
for each row execute function private.link_recurring_content_dependencies();

revoke all on function private.link_recurring_content_dependencies()
from public, anon, authenticated, service_role;

comment on table public.recurring_content_occurrences is
  'Internal idempotency mapping from a weekly content bundle and publication slot to one shared content card.';
