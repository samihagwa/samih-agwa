-- Completing a task and saving its delivery are one atomic action. The board
-- may start or block work, but it cannot mark manual work complete without a
-- durable delivery. Linked workflows keep their established command guards.

revoke all on function public.submit_task_delivery(uuid, text, text)
from public, anon, authenticated;
drop function public.submit_task_delivery(uuid, text, text);

create function public.submit_task_delivery(
  target_task_id uuid,
  delivery_result_note text,
  delivery_result_url text,
  expected_task_version bigint,
  expected_delivery_version bigint
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
  completion_status public.task_status;
  current_delivery_version bigint;
begin
  if actor is null then
    raise exception 'An authenticated actor is required';
  end if;

  select task.* into task_record
  from public.tasks task
  where task.id = target_task_id
  for update;

  if task_record.id is null then raise exception 'Task was not found'; end if;
  if not private.is_org_member(task_record.organization_id) then
    raise exception 'Task is outside your organization';
  end if;
  if task_record.owner_id <> actor then
    raise exception 'Only the assigned task owner can submit its delivery';
  end if;
  if expected_task_version is null
    or task_record.version <> expected_task_version then
    raise exception 'Task changed since this page was opened; refresh before submitting';
  end if;
  if task_record.content_item_id is not null
    or task_record.launch_id is not null
    or task_record.launch_deliverable_id is not null
    or task_record.crm_contact_id is not null then
    raise exception 'Linked workflow deliveries must be submitted from their source workflow';
  end if;
  if task_record.status in ('backlog', 'ready') then
    raise exception 'Start the task before submitting its delivery';
  end if;
  if task_record.status = 'blocked' then
    raise exception 'Resume the task before submitting its delivery';
  end if;
  if task_record.status = 'cancelled' then
    raise exception 'A cancelled task cannot receive a delivery';
  end if;
  if task_record.status = 'review' then
    raise exception 'This delivery is awaiting review and cannot be changed';
  end if;
  if task_record.status = 'done' and task_record.requires_review then
    raise exception 'An approved delivery can only change through a new revision request';
  end if;

  select delivery.version into current_delivery_version
  from public.task_deliveries delivery
  where delivery.task_id = task_record.id
  for update;

  if current_delivery_version is distinct from expected_delivery_version then
    raise exception 'Delivery changed since this page was opened; refresh before submitting';
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

  if task_record.status = 'in_progress' then
    completion_status := case
      when task_record.requires_review then 'review'::public.task_status
      else 'done'::public.task_status
    end;
    perform set_config('app.task_delivery_task_id', task_record.id::text, true);
    update public.tasks
    set status = completion_status
    where id = task_record.id;
  else
    completion_status := task_record.status;
  end if;

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
      'has_url', clean_url is not null,
      'task_status', completion_status,
      'expected_task_version', expected_task_version,
      'expected_delivery_version', expected_delivery_version,
      'completed_by_single_submission', task_record.status = 'in_progress'
    )
  );

  return delivery_id;
end;
$$;

revoke all on function public.submit_task_delivery(uuid, text, text, bigint, bigint)
from public, anon;
grant execute on function public.submit_task_delivery(uuid, text, text, bigint, bigint)
to authenticated;

create or replace function private.guard_manual_task_status_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  revision_request_id text := nullif(current_setting('app.task_revision_request_id', true), '');
  delivery_task_id text := nullif(current_setting('app.task_delivery_task_id', true), '');
  valid_revision_command boolean := false;
begin
  if new.status is not distinct from old.status then return new; end if;

  if old.content_item_id is not null
    or old.launch_id is not null
    or old.launch_deliverable_id is not null
    or old.crm_contact_id is not null then
    return new;
  end if;

  if actor is null then raise exception 'An authenticated actor is required'; end if;

  if revision_request_id is not null then
    select exists (
      select 1
      from public.task_revision_requests revision
      where revision.id::text = revision_request_id
        and revision.task_id = old.id
        and revision.organization_id = old.organization_id
        and revision.requested_by = actor
    ) into valid_revision_command;
    if valid_revision_command then return new; end if;
    raise exception 'Invalid task revision command';
  end if;

  if old.requires_review
    and old.status = 'review'
    and new.status = 'done'
    and old.owner_id <> actor
    and (
      old.created_by = actor
      or private.is_org_owner_or_admin_actor(actor, old.organization_id)
    ) then
    return new;
  end if;

  if old.owner_id = actor then
    if old.status = 'ready' and new.status = 'in_progress' then return new; end if;
    if old.status = 'in_progress' and new.status = 'blocked' then return new; end if;
    if old.status = 'blocked' and new.status = 'in_progress' then return new; end if;
    if old.status = 'in_progress'
      and new.status = (
        case
          when old.requires_review then 'review'::public.task_status
          else 'done'::public.task_status
        end
      )
      and delivery_task_id = old.id::text
      and exists (
        select 1 from public.task_deliveries delivery
        where delivery.task_id = old.id
          and delivery.organization_id = old.organization_id
          and delivery.submitted_by = actor
      ) then
      return new;
    end if;
    if old.status = 'in_progress' and new.status in ('review', 'done') then
      raise exception 'Submit the task result before completion';
    end if;
    raise exception 'The assignee cannot approve, cancel, or reopen their own task';
  end if;

  if old.status = 'review' and new.status = 'in_progress' then
    raise exception 'Return reviewed work through a written revision request';
  end if;

  raise exception 'Only the assigned task owner can execute this task';
end;
$$;

revoke all on function private.guard_manual_task_status_actor()
from public, anon, authenticated;
