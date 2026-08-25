-- Defense in depth for manual tasks: a forged browser update must not expose
-- admin/requester accounts to execution transitions or let an assignee reopen
-- their own completed work. Written revision requests are the only reopen path.

create or replace function private.guard_manual_task_status_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  revision_request_id text := nullif(current_setting('app.task_revision_request_id', true), '');
  valid_revision_command boolean := false;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- Linked workflows keep their existing content, launch, and CRM command
  -- guards. This trigger owns manual team tasks only.
  if old.content_item_id is not null
    or old.launch_id is not null
    or old.launch_deliverable_id is not null
    or old.crm_contact_id is not null then
    return new;
  end if;

  if actor is null then
    raise exception 'An authenticated actor is required';
  end if;

  if revision_request_id is not null then
    select exists (
      select 1
      from public.task_revision_requests revision
      where revision.id::text = revision_request_id
        and revision.task_id = old.id
        and revision.organization_id = old.organization_id
        and revision.requested_by = actor
    ) into valid_revision_command;
    if valid_revision_command then
      return new;
    end if;
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
    if old.status = 'in_progress' and old.requires_review and new.status = 'review' then return new; end if;
    if old.status = 'in_progress' and not old.requires_review and new.status = 'done' then return new; end if;
    if old.status = 'blocked' and new.status = 'in_progress' then return new; end if;
    raise exception 'The assignee cannot approve, cancel, or reopen their own task';
  end if;

  if old.status = 'review' and new.status = 'in_progress' then
    raise exception 'Return reviewed work through a written revision request';
  end if;

  raise exception 'Only the assigned task owner can execute this task';
end;
$$;

drop trigger if exists tasks_actor_status_guard on public.tasks;

create trigger tasks_actor_status_guard
before update of status on public.tasks
for each row execute function private.guard_manual_task_status_actor();

revoke all on function private.guard_manual_task_status_actor()
from public, anon, authenticated;
