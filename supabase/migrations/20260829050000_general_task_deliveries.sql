-- Standalone tasks need the same durable delivery evidence as content steps.
-- Keep the delivery independent from the status transition so an assignee can
-- add or correct a missing link even after the task was marked complete.

alter table public.tasks
  add constraint tasks_id_organization_unique unique (id, organization_id);

create table public.task_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null,
  result_note text,
  result_url text,
  version bigint not null default 1,
  submitted_by uuid not null references public.profiles (id) on delete restrict,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_deliveries_task_unique unique (task_id),
  constraint task_deliveries_task_org_fkey
    foreign key (task_id, organization_id)
    references public.tasks (id, organization_id)
    on delete cascade,
  constraint task_deliveries_result_present check (
    result_note is not null or result_url is not null
  ),
  constraint task_deliveries_note_length check (
    result_note is null or char_length(trim(result_note)) between 3 and 10000
  ),
  constraint task_deliveries_url_http check (
    result_url is null or (
      char_length(result_url) <= 2000
      and result_url ~* '^https?://[^[:space:]]+$'
    )
  ),
  constraint task_deliveries_version_positive check (version > 0)
);

create index task_deliveries_org_time_idx
  on public.task_deliveries (organization_id, submitted_at desc, id);
create index task_deliveries_submitter_idx
  on public.task_deliveries (submitted_by);

alter table public.task_deliveries enable row level security;

create policy "task_deliveries_select_organization_members"
on public.task_deliveries for select to authenticated
using (private.is_org_member(organization_id));

create policy "section_scope_task_deliveries"
on public.task_deliveries
as restrictive for all to authenticated
using (
  private.can_access_any_section(
    organization_id,
    array['tasks','content','campaigns','crm']::text[]
  )
)
with check (
  private.can_access_any_section(
    organization_id,
    array['tasks','content','campaigns','crm']::text[]
  )
);

revoke all on table public.task_deliveries from public, anon, authenticated;
grant select on table public.task_deliveries to authenticated;

create or replace function public.submit_task_delivery(
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
  actor uuid := (select auth.uid());
  task_record public.tasks%rowtype;
  delivery_id uuid;
  clean_note text := nullif(trim(delivery_result_note), '');
  clean_url text := nullif(trim(delivery_result_url), '');
begin
  if actor is null then
    raise exception 'An authenticated actor is required';
  end if;

  select task.* into task_record
  from public.tasks task
  where task.id = target_task_id
  for update;

  if task_record.id is null then
    raise exception 'Task was not found';
  end if;
  if not private.is_org_member(task_record.organization_id) then
    raise exception 'Task is outside your organization';
  end if;
  if task_record.owner_id <> actor then
    raise exception 'Only the assigned task owner can submit its delivery';
  end if;
  if task_record.status = 'cancelled' then
    raise exception 'A cancelled task cannot receive a delivery';
  end if;
  if task_record.content_item_id is not null
    or task_record.launch_id is not null
    or task_record.launch_deliverable_id is not null
    or task_record.crm_contact_id is not null then
    raise exception 'Linked workflow deliveries must be submitted from their source workspace';
  end if;
  if clean_note is null and clean_url is null then
    raise exception 'Add a delivery note or URL';
  end if;
  if clean_note is not null and char_length(clean_note) not between 3 and 10000 then
    raise exception 'Delivery note must contain between 3 and 10000 characters';
  end if;
  if clean_url is not null and (
    char_length(clean_url) > 2000
    or clean_url !~* '^https?://[^[:space:]]+$'
  ) then
    raise exception 'Delivery URL must be a valid http or https link';
  end if;

  insert into public.task_deliveries (
    organization_id,
    task_id,
    result_note,
    result_url,
    submitted_by
  ) values (
    task_record.organization_id,
    task_record.id,
    clean_note,
    clean_url,
    actor
  )
  on conflict (task_id) do update set
    result_note = excluded.result_note,
    result_url = excluded.result_url,
    version = public.task_deliveries.version + 1,
    submitted_by = excluded.submitted_by,
    submitted_at = now(),
    updated_at = now()
  returning id into delivery_id;

  insert into public.audit_events (
    organization_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    after_data
  ) values (
    task_record.organization_id,
    actor,
    'task.delivery_submitted',
    'task_delivery',
    delivery_id,
    jsonb_build_object(
      'task_id', task_record.id,
      'has_note', clean_note is not null,
      'has_url', clean_url is not null
    )
  );

  return delivery_id;
end;
$$;

revoke all on function public.submit_task_delivery(uuid, text, text)
from public, anon;
grant execute on function public.submit_task_delivery(uuid, text, text)
to authenticated;

comment on table public.task_deliveries is
  'Latest delivery evidence for standalone team tasks. Content, launch, and CRM work keep their domain-specific delivery records.';
