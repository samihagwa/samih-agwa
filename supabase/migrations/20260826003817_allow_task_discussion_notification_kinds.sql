alter table public.notifications
  drop constraint notifications_kind_allowed;

alter table public.notifications
  add constraint notifications_kind_allowed check (kind = any (array[
    'task_assigned',
    'task_ready',
    'task_review',
    'task_blocked',
    'task_done',
    'revision_requested',
    'publication_published',
    'publication_failed',
    'publication_held',
    'script_assigned',
    'script_ready',
    'script_research_assigned',
    'content_brief_updated',
    'team_joined',
    'team_access_changed',
    'task_due_soon',
    'task_overdue',
    'task_overdue_escalated',
    'chat_reply',
    'task_question',
    'task_discussion'
  ]));
