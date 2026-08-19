-- A ready assignment is actionable even when the manager assigns it to themselves
-- during an owner-only trial. Dedupe keys still prevent duplicate notifications.
create or replace function private.notify_task_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  reviewer_id uuid;
  target_url text := case
    when new.crm_contact_id is not null then '/crm#lead-' || new.crm_contact_id
    when new.content_item_id is not null then '/content#content-' || new.content_item_id
    when new.launch_deliverable_id is not null then '/campaigns#deliverable-' || new.launch_deliverable_id
    else '/tasks'
  end;
begin
  if tg_op = 'INSERT' then
    if new.status = 'ready' then
      perform private.add_notification(
        new.organization_id, new.owner_id, 'task_assigned',
        'مهمة جديدة وصلت لك', new.title, 'task', new.id, target_url,
        'task:' || new.id || ':assigned:v' || new.version || ':user:' || new.owner_id
      );
    end if;
    return new;
  end if;

  if new.owner_id is distinct from old.owner_id
    and (new.is_work_item or new.status = 'ready') then
    perform private.add_notification(
      new.organization_id, new.owner_id, 'task_assigned',
      'تم إسناد مهمة لك', new.title, 'task', new.id, target_url,
      'task:' || new.id || ':reassigned:v' || new.version || ':user:' || new.owner_id
    );
  end if;

  if new.status is distinct from old.status and new.status = 'ready' then
    perform private.add_notification(
      new.organization_id, new.owner_id, 'task_ready',
      case when new.is_work_item then 'الخطوة السابقة اكتملت' else 'إجراء داخل ملف المحتوى' end,
      case when new.is_work_item then 'مهمتك جاهزة الآن: ' else 'جاهز الآن: ' end || new.title,
      'task', new.id, target_url,
      'task:' || new.id || ':ready:v' || new.version || ':user:' || new.owner_id
    );
  end if;

  if new.is_work_item and new.status is distinct from old.status and new.status = 'review' then
    if new.content_item_id is not null then
      select task.owner_id into reviewer_id
      from public.tasks task
      where task.content_item_id = new.content_item_id
        and task.content_step = 'approval';
    end if;
    reviewer_id := coalesce(reviewer_id, new.created_by);
    if reviewer_id is distinct from actor then
      perform private.add_notification(
        new.organization_id, reviewer_id, 'task_review',
        'تسليم جديد يحتاج مراجعتك', new.title,
        'task', new.id, target_url,
        'task:' || new.id || ':review:v' || new.version || ':user:' || reviewer_id
      );
    end if;
  end if;

  if new.is_work_item and new.status is distinct from old.status
    and new.status = 'blocked' and new.created_by is distinct from actor then
    perform private.add_notification(
      new.organization_id, new.created_by, 'task_blocked',
      'مهمة متوقفة وتحتاج تدخلًا', new.title,
      'task', new.id, target_url,
      'task:' || new.id || ':blocked:v' || new.version || ':user:' || new.created_by
    );
  end if;

  if new.is_work_item and new.status is distinct from old.status
    and new.status = 'done' and new.created_by is distinct from actor then
    perform private.add_notification(
      new.organization_id, new.created_by, 'task_done',
      'اكتملت مهمة', new.title,
      'task', new.id, target_url,
      'task:' || new.id || ':done:v' || new.version || ':user:' || new.created_by
    );
  end if;
  return new;
end;
$$;

revoke all on function private.notify_task_change() from public, anon, authenticated;
