-- Reel covers are independent creative work once the brief exists. They can run
-- in parallel with editing; publishing still waits for editing, the cover, and
-- the caption. Task participants can also read only the content resources and
-- deliveries attached to work they are already allowed to open.

create or replace function private.parallelize_reel_thumbnail_dependency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  dependent_task public.tasks%rowtype;
  prerequisite_task public.tasks%rowtype;
begin
  select * into dependent_task
  from public.tasks task
  where task.id = new.task_id;

  select * into prerequisite_task
  from public.tasks task
  where task.id = new.depends_on_task_id;

  if dependent_task.content_item_id is not null
    and prerequisite_task.content_item_id = dependent_task.content_item_id
    and dependent_task.content_step = 'thumbnail'
    and prerequisite_task.content_step = 'editing'
    and exists (
      select 1
      from public.content_items item
      where item.id = dependent_task.content_item_id
        and item.format = 'reel'
    ) then
    update public.tasks task
    set status = 'ready'
    where task.id = dependent_task.id
      and task.status = 'backlog';
    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists task_dependencies_parallelize_reel_thumbnail
on public.task_dependencies;

create trigger task_dependencies_parallelize_reel_thumbnail
before insert on public.task_dependencies
for each row execute function private.parallelize_reel_thumbnail_dependency();

-- Remove the obsolete wait from existing reels and expose their cover task now.
-- Only the enforcement trigger is paused for this system-owned backfill; event,
-- workflow, and notification triggers stay active and record the transition.
delete from public.task_dependencies dependency
using public.tasks thumbnail, public.tasks editing, public.content_items item
where thumbnail.id = dependency.task_id
  and editing.id = dependency.depends_on_task_id
  and thumbnail.content_item_id = editing.content_item_id
  and item.id = thumbnail.content_item_id
  and item.format = 'reel'
  and thumbnail.content_step = 'thumbnail'
  and editing.content_step = 'editing';

alter table public.tasks disable trigger tasks_enforce_rules;

update public.tasks task
set status = 'ready',
  version = task.version + 1,
  updated_at = now()
where task.status = 'backlog'
  and task.content_step = 'thumbnail'
  and task.content_item_id is not null
  and exists (
    select 1
    from public.content_items item
    where item.id = task.content_item_id
      and item.format = 'reel'
  )
  and not exists (
    select 1
    from public.task_dependencies dependency
    join public.tasks prerequisite on prerequisite.id = dependency.depends_on_task_id
    where dependency.task_id = task.id
      and prerequisite.status <> 'done'
  );

alter table public.tasks enable trigger tasks_enforce_rules;

drop policy if exists "section_scope_content_assets" on public.content_assets;
create policy "section_scope_content_assets" on public.content_assets
as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['content','tasks']::text[]));

drop policy if exists "section_scope_content_deliveries" on public.content_step_deliveries;
create policy "section_scope_content_deliveries" on public.content_step_deliveries
as restrictive for select to authenticated
using (private.can_access_any_section(organization_id, array['content','tasks']::text[]));

revoke all on function private.parallelize_reel_thumbnail_dependency()
from public, anon, authenticated;
