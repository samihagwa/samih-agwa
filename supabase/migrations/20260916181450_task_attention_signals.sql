-- Attention is separate from execution status: acknowledging a ping does not
-- start a task, change its deadline, or bypass CRM/content dependency rules.
create table public.task_attention (
  task_id uuid primary key references public.tasks(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assignee_id uuid not null references public.profiles(id),
  revision integer not null default 0 check (revision >= 0),
  urgency jsonb not null default '{}'::jsonb check (jsonb_typeof(urgency) = 'object'),
  blocker jsonb not null default '{}'::jsonb check (jsonb_typeof(blocker) = 'object'),
  updated_at timestamptz not null default now()
);
create index task_attention_organization_idx on public.task_attention(organization_id);
create index task_attention_assignee_idx on public.task_attention(assignee_id);
alter table public.task_attention enable row level security;
revoke all on public.task_attention from public, anon, authenticated;
grant select on public.task_attention to authenticated;
create policy task_attention_read_task_members on public.task_attention
for select to authenticated using (
  private.can_read_task_actor((select auth.uid()), organization_id, task_id)
);

alter table public.notifications drop constraint notifications_kind_allowed;
alter table public.notifications add constraint notifications_kind_allowed check (kind = any (array[
  'task_assigned', 'task_ready', 'task_review', 'task_blocked', 'task_done',
  'revision_requested', 'publication_published', 'publication_failed',
  'publication_held', 'script_assigned', 'script_ready',
  'script_research_assigned', 'content_brief_updated', 'team_joined',
  'team_access_changed', 'task_due_soon', 'task_overdue',
  'task_overdue_escalated', 'chat_reply', 'task_question',
  'task_discussion', 'telegram_test', 'team_access_requested',
  'team_access_approved', 'password_recovery_requested',
  'task_urgent', 'task_urgent_acknowledged', 'task_help_requested', 'task_help_resolved'
]));

-- The privileged implementation is private; the public RPC is an invoker
-- wrapper. Only the verified JWT actor is used, never a client-supplied user.
create function private.change_task_attention(
  target_task_id uuid, target_action text, expected_revision integer,
  message text default null, reason text default null, promised_at timestamptz default null
) returns public.task_attention
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  task_record public.tasks%rowtype;
  attention public.task_attention%rowtype;
  before_state jsonb;
  actor_role public.app_role;
  actor_name text;
  recipient uuid;
  event_id uuid := gen_random_uuid();
  notification_kind text;
  notification_title text;
  notification_body text;
  clean_message text := nullif(trim(message), '');
  reason_label text;
begin
  if actor is null then raise exception 'Attention authentication required'; end if;
  if target_action is null or target_action not in ('urgent','acknowledge','help','resolve_help') then
    raise exception 'Unknown attention action';
  end if;
  -- Serialize both competing first inserts and every later command with task
  -- reassignment/closure. A stale page cannot acknowledge a newer ping.
  select * into task_record from public.tasks where id = target_task_id for update;
  if task_record.id is null or not private.can_read_task_actor(actor, task_record.organization_id, target_task_id) then
    raise exception 'Attention access denied';
  end if;
  select role into actor_role from public.memberships
  where user_id = actor and organization_id = task_record.organization_id and status = 'active';
  if actor_role is null or actor_role = 'viewer' then raise exception 'Attention access denied'; end if;
  if not task_record.is_work_item or task_record.status in ('done','cancelled') then
    raise exception 'Attention task is closed';
  end if;
  if target_action = 'urgent' then
    if actor <> task_record.created_by or actor = task_record.owner_id then
      raise exception 'Only the task requester can send urgency';
    end if;
  elsif actor <> task_record.owner_id then
    raise exception 'Only the assignee can respond to attention';
  end if;
  if clean_message is not null and char_length(clean_message) > 1000 then
    raise exception 'Attention message too long';
  end if;
  if promised_at is not null and (target_action <> 'acknowledge' or promised_at <= now() or promised_at > now() + interval '1 year') then
    raise exception 'Attention expected time must be in the future';
  end if;
  select * into attention from public.task_attention where task_id = target_task_id for update;
  if expected_revision is null or expected_revision <> coalesce(attention.revision, 0) then
    raise exception 'Attention changed; refresh and retry';
  end if;
  if attention.task_id is null then
    insert into public.task_attention(task_id, organization_id, assignee_id)
    values(target_task_id, task_record.organization_id, task_record.owner_id) returning * into attention;
  end if;
  before_state := to_jsonb(attention);
  if attention.assignee_id <> task_record.owner_id then
    -- A new assignee never inherits a previous assignee's acknowledgement or
    -- blocker. Old states remain in the immutable audit trail.
    attention.assignee_id := task_record.owner_id;
    attention.urgency := '{}'::jsonb;
    attention.blocker := '{}'::jsonb;
  end if;
  select coalesce(nullif(trim(full_name), ''), 'عضو الفريق') into actor_name from public.profiles where id = actor;
  if target_action = 'urgent' then
    if (attention.urgency->>'sent_at')::timestamptz > now() - interval '15 minutes' then
      raise exception 'Attention cooldown; wait 15 minutes';
    end if;
    attention.urgency := jsonb_build_object('id', event_id, 'sent_at', now(), 'sent_by', actor, 'note', clean_message);
    recipient := task_record.owner_id;
    notification_kind := 'task_urgent';
    notification_title := 'تنبيه عاجل من ' || actor_name;
    notification_body := task_record.title || coalesce(' — ' || clean_message, '') || ' — افتح المهمة وأكّد استلام التنبيه.';
  elsif target_action = 'acknowledge' then
    if attention.urgency->>'id' is null then raise exception 'No active urgency to acknowledge'; end if;
    if attention.urgency->>'acknowledged_at' is not null then return attention; end if;
    attention.urgency := attention.urgency || jsonb_build_object('acknowledged_at', now(), 'acknowledged_by', actor, 'promised_at', promised_at);
    recipient := (attention.urgency->>'sent_by')::uuid;
    notification_kind := 'task_urgent_acknowledged';
    notification_title := actor_name || ' شاف التنبيه العاجل';
    notification_body := task_record.title || case when promised_at is null then '' else ' — أضاف موعد إنجاز متوقع؛ افتح المهمة لمراجعته.' end;
  elsif target_action = 'help' then
    if task_record.status not in ('ready','in_progress','blocked') then raise exception 'Attention help unavailable in this state'; end if;
    if reason is null or reason not in ('materials','clarification','approval','other') or clean_message is null or char_length(clean_message) < 3 then
      raise exception 'Attention help requires reason and details';
    end if;
    if attention.blocker->>'id' is not null and attention.blocker->>'resolved_at' is null then
      raise exception 'Attention help already open';
    end if;
    reason_label := case reason when 'materials' then 'مادة خام ناقصة' when 'clarification' then 'محتاج توضيح' when 'approval' then 'بانتظار موافقة' else 'سبب آخر' end;
    attention.blocker := jsonb_build_object('id', event_id, 'created_at', now(), 'created_by', actor, 'reason', reason, 'details', clean_message);
    recipient := task_record.created_by;
    notification_kind := 'task_help_requested';
    notification_title := actor_name || ' محتاج حاجة عشان يكمل';
    notification_body := task_record.title || ' — ' || reason_label || ': ' || clean_message;
  else
    if attention.blocker->>'id' is null then raise exception 'No active help request'; end if;
    if attention.blocker->>'resolved_at' is not null then return attention; end if;
    attention.blocker := attention.blocker || jsonb_build_object('resolved_at', now(), 'resolved_by', actor);
    recipient := task_record.created_by;
    notification_kind := 'task_help_resolved';
    notification_title := actor_name || ' أكد إن العائق اتحل';
    notification_body := task_record.title;
  end if;
  update public.task_attention set
    assignee_id = attention.assignee_id, urgency = attention.urgency, blocker = attention.blocker,
    revision = revision + 1, updated_at = now()
  where task_id = target_task_id returning * into attention;
  if recipient is distinct from actor then
    perform private.add_notification(task_record.organization_id, recipient, notification_kind,
      notification_title, notification_body, 'task', target_task_id, '/tasks/' || target_task_id,
      'task-attention:' || event_id || ':' || recipient);
  end if;
  insert into public.audit_events(organization_id, actor_id, action, entity_type, entity_id, before_data, after_data, request_id)
  values(task_record.organization_id, actor, 'task.attention.' || target_action, 'task', target_task_id, before_state, to_jsonb(attention), event_id);
  return attention;
end;
$$;
revoke all on function private.change_task_attention(uuid,text,integer,text,text,timestamptz) from public, anon, authenticated;
grant execute on function private.change_task_attention(uuid,text,integer,text,text,timestamptz) to authenticated;

create function public.change_task_attention(
  target_task_id uuid, target_action text, expected_revision integer,
  message text default null, reason text default null, promised_at timestamptz default null
) returns public.task_attention language sql security invoker set search_path = '' as $$
  select private.change_task_attention(target_task_id, target_action, expected_revision, message, reason, promised_at);
$$;
revoke all on function public.change_task_attention(uuid,text,integer,text,text,timestamptz) from public, anon;
grant execute on function public.change_task_attention(uuid,text,integer,text,text,timestamptz) to authenticated;

alter publication supabase_realtime add table public.task_attention;
