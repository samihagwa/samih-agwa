create or replace function private.notify_content_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.add_notification(
    new.organization_id,
    new.assigned_to,
    'revision_requested',
    case
      when new.assigned_to = new.requested_by then 'تم تسجيل طلب تعديل لك'
      else 'مطلوب تعديل على المحتوى'
    end,
    left(new.instructions, 1000),
    'content_revision',
    new.id,
    '/content#content-' || new.content_item_id,
    'revision:' || new.id || ':requested:user:' || new.assigned_to
  );
  return new;
end;
$$;

insert into public.notifications (
  organization_id,
  user_id,
  kind,
  title,
  body,
  entity_type,
  entity_id,
  url,
  dedupe_key,
  created_at
)
select
  revision.organization_id,
  revision.assigned_to,
  'revision_requested',
  case
    when revision.assigned_to = revision.requested_by then 'تم تسجيل طلب تعديل لك'
    else 'مطلوب تعديل على المحتوى'
  end,
  left(revision.instructions, 1000),
  'content_revision',
  revision.id,
  '/content#content-' || revision.content_item_id,
  'revision:' || revision.id || ':requested:user:' || revision.assigned_to,
  revision.requested_at
from public.content_revision_requests revision
join public.memberships membership
  on membership.organization_id = revision.organization_id
 and membership.user_id = revision.assigned_to
 and membership.status = 'active'
where revision.status in ('requested', 'in_progress')
on conflict (dedupe_key) do nothing;

revoke all on function private.notify_content_revision() from public, anon, authenticated;
