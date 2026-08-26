-- A later task-permission hardening correctly rejected nested status changes,
-- while this legacy dependency trigger was still trying to cancel the internal
-- approval gate from inside another trigger. Defer that cancellation to the
-- existing compact-workflow normalizer, which already performs it as an
-- authenticated, fenced top-level mutation.

create or replace function private.reroute_content_approval_dependency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  dependent_task public.tasks%rowtype;
  predecessor_task public.tasks%rowtype;
begin
  select * into dependent_task from public.tasks where id = new.task_id;
  select * into predecessor_task from public.tasks where id = new.depends_on_task_id;
  if dependent_task.content_item_id is null
    or predecessor_task.content_item_id is distinct from dependent_task.content_item_id
    or predecessor_task.content_step <> 'approval' then
    return new;
  end if;

  delete from public.task_dependencies dependency
  where dependency.task_id = new.task_id
    and dependency.depends_on_task_id = new.depends_on_task_id;

  -- Do not mutate the approval task here: this function is running at nested
  -- trigger depth. private.normalize_compact_reel_workflow cancels it safely.
  delete from public.task_dependencies dependency
  where dependency.task_id = predecessor_task.id;

  if dependent_task.content_step = 'scheduling' then
    insert into public.task_dependencies (task_id, depends_on_task_id)
    select dependent_task.id, prerequisite.id
    from public.tasks prerequisite
    where prerequisite.content_item_id = dependent_task.content_item_id
      and prerequisite.content_step in ('caption', 'design')
    on conflict do nothing;
  elsif dependent_task.content_step = 'publishing' then
    insert into public.task_dependencies (task_id, depends_on_task_id)
    select dependent_task.id, prerequisite.id
    from public.tasks prerequisite
    join public.content_items item on item.id = prerequisite.content_item_id
    where prerequisite.content_item_id = dependent_task.content_item_id
      and prerequisite.content_step in (
        case when item.format = 'post' then 'scheduling'::public.content_step else 'editing'::public.content_step end,
        case when item.format = 'post' then 'scheduling'::public.content_step else 'thumbnail'::public.content_step end,
        case when item.format = 'post' then 'scheduling'::public.content_step else 'caption'::public.content_step end
      )
    on conflict do nothing;
  end if;
  return new;
end;
$$;

revoke all on function private.reroute_content_approval_dependency()
from public, anon, authenticated;
