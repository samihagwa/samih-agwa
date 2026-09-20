-- Reports are factual snapshots, not attendance/payroll or productivity scores.
-- Disabled on installation. Presence history starts now; no fabricated backfill.
create table private.team_report_settings (
  organization_id uuid primary key references public.organizations(id),
  daily_enabled boolean not null default false,
  weekly_enabled boolean not null default false,
  delivery_hour integer not null default 8 check (delivery_hour between 0 and 23),
  weekly_day integer not null default 6 check (weekly_day between 0 and 6),
  included_users uuid[] not null default '{}',
  recipients jsonb not null default '[]',
  revision integer not null default 0,
  updated_at timestamptz not null default now()
);
create table private.team_presence_days (
  organization_id uuid not null references public.organizations(id),
  user_id uuid not null references public.profiles(id),
  day date not null,
  first_seen timestamptz not null,
  last_seen timestamptz not null,
  primary key(organization_id, user_id, day)
);
create table private.team_report_coverage (
  singleton boolean primary key default true check(singleton),
  presence_since timestamptz not null default now()
);
insert into private.team_report_coverage default values;
create table private.team_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  recipient_id uuid not null references public.profiles(id),
  scope text not null check(scope in ('team','self')),
  cadence text not null check(cadence in ('daily','weekly')),
  period_start date not null,
  period_end date not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique(organization_id, recipient_id, scope, cadence, period_start, period_end)
);
create index team_reports_recipient_time on private.team_reports(organization_id,recipient_id,created_at desc);
alter table private.team_report_settings enable row level security;
alter table private.team_presence_days enable row level security;
alter table private.team_report_coverage enable row level security;
alter table private.team_reports enable row level security;
revoke all on private.team_report_settings, private.team_presence_days, private.team_report_coverage, private.team_reports from public, anon, authenticated;

create function private.capture_team_presence_day() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into private.team_presence_days values(new.organization_id,new.user_id,(new.last_seen_at at time zone 'Africa/Cairo')::date,new.last_seen_at,new.last_seen_at)
  on conflict(organization_id,user_id,day) do update set last_seen=excluded.last_seen;
  return new;
end $$;
create trigger team_presence_daily_history after insert or update on public.member_presence
for each row execute function private.capture_team_presence_day();
revoke all on function private.capture_team_presence_day() from public,anon,authenticated;

-- Count distinct work objects, not autosaves, requests to AI or imported batch size.
create function private.team_report_metric(action text, before_data jsonb, after_data jsonb) returns text
language sql immutable set search_path='' as $$
 select case
 when action in ('task.created','task.updated') and after_data->>'is_work_item'='false' then null
 when action='task.created' then 'tasks_created'
 when action='task.updated' and after_data->>'status'='done' and before_data->>'status' is distinct from 'done' then 'completed'
 when action in ('task.delivery_submitted','content.step_completed') then case when after_data->>'step'='publishing' then 'publishing_deliveries' else 'deliveries' end
 when action in ('content.direct_reel_workflow_created','content.simplified_request_created') then 'content_created'
 when action in ('script.created','script.created_from_research') then 'scripts_created'
 when action='script.saved' then 'scripts_edited'
 when action in ('crm.customer_created','crm.lead_created') then 'crm_added'
 when action='crm.follow_up_recorded' then 'followups'
 when action='crm.purchase_recorded' then 'purchases_recorded'
 when action in ('script.review_commented','task.comment_added','task.discussion_added','chat.message_sent') then 'comments'
 when action in ('publishing.schedule_created','publishing.schedule_revised') then 'scheduled'
 when action='content.revision_requested' then 'revisions'
 when action='content.calendar_rescheduled' then 'rescheduled'
 else null end;
$$;
revoke all on function private.team_report_metric(text,jsonb,jsonb) from public,anon,authenticated;

create function private.build_team_activity_report(org uuid, start_day date, end_day date, users uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; starts timestamptz; ends timestamptz;
begin
  if start_day is null or end_day is null or end_day<start_day or end_day-start_day>30
    or end_day>(now() at time zone 'Africa/Cairo')::date then raise exception 'اختر فترة صحيحة لا تتجاوز 31 يومًا'; end if;
  starts:=start_day::timestamp at time zone 'Africa/Cairo';
  ends:=(end_day+1)::timestamp at time zone 'Africa/Cairo';
  with events as materialized (
    select e.*, private.team_report_metric(e.action,e.before_data,e.after_data) metric,
      case when e.action='task.updated' and e.after_data->>'status'='done'
        then coalesce(nullif(e.after_data->>'owner_id','')::uuid,e.actor_id) else e.actor_id end credited_user,
      coalesce(e.after_data->>'task_id',e.entity_id::text,e.id::text) object_key
    from public.audit_events e where e.organization_id=org and e.occurred_at>=starts and e.occurred_at<ends
  ), counts as (
    select credited_user,metric,count(distinct object_key) n,max(occurred_at) latest
    from events where metric is not null and credited_user=any(users) group by credited_user,metric
  ), people as (
    select m.user_id,coalesce(p.full_name,'عضو فريق') name,
      (select coalesce(jsonb_object_agg(c.metric,c.n),'{}') from counts c where c.credited_user=m.user_id) metrics,
      (select max(c.latest) from counts c where c.credited_user=m.user_id) last_activity,
      (select count(*) from private.team_presence_days d where d.organization_id=org and d.user_id=m.user_id and d.day between start_day and end_day) presence_days,
      (select min(d.first_seen) from private.team_presence_days d where d.organization_id=org and d.user_id=m.user_id and d.day between start_day and end_day) first_seen,
      (select max(d.last_seen) from private.team_presence_days d where d.organization_id=org and d.user_id=m.user_id and d.day between start_day and end_day) last_seen,
      (select count(*) from public.tasks t where t.organization_id=org and t.owner_id=m.user_id and t.status not in ('done','cancelled') and t.due_at<now()) overdue_now,
      (select count(distinct l.occurrence_id) from public.publishing_publication_logs l join public.publishing_posts p on p.id=l.post_id and p.organization_id=l.organization_id
        where l.organization_id=org and p.created_by=m.user_id and l.status='published' and l.published_at>=starts and l.published_at<ends) auto_published
    from public.memberships m join public.profiles p on p.id=m.user_id
    where m.organization_id=org and m.status='active' and m.user_id=any(users)
  ) select jsonb_build_object('start',start_day,'end',end_day,'generated_at',now(),
      'presence_since',(select presence_since from private.team_report_coverage),
      'partial',ends>now(),'members',coalesce(jsonb_agg(to_jsonb(people) order by name),'[]')) into result from people;
  return result;
end $$;
revoke all on function private.build_team_activity_report(uuid,date,date,uuid[]) from public,anon,authenticated;

create function private.can_receive_team_report(org uuid, recipient uuid, report_scope text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.team_report_settings s join public.memberships m on m.organization_id=s.organization_id
   cross join lateral jsonb_array_elements(s.recipients) r
   where s.organization_id=org and m.user_id=recipient and m.status='active'
     and r->>'user_id'=recipient::text and r->>'scope'=report_scope
     and (report_scope='self' or m.role in ('owner','admin','manager')));
$$;
revoke all on function private.can_receive_team_report(uuid,uuid,text) from public,anon,authenticated;

-- A single authenticated invoker RPC delegates to a private implementation with
-- fresh membership/owner checks. Neither caller identity nor raw audit text is accepted.
create function private.team_reports_command(command text, org uuid, payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); actor_role public.app_role; cfg private.team_report_settings; r jsonb;
  rid uuid; included uuid[]; report private.team_reports; rows jsonb;
begin
  select role into actor_role from public.memberships where organization_id=org and user_id=actor and status='active';
  if actor is null or actor_role is null then raise exception 'غير مسموح'; end if;
  if command in ('settings','save','preview') and actor_role<>'owner' then raise exception 'إدارة التقارير متاحة للمالك فقط'; end if;
  if command='settings' then
    select * into cfg from private.team_report_settings where organization_id=org;
    return (case when found then to_jsonb(cfg) else jsonb_build_object('daily_enabled',false,'weekly_enabled',false,'delivery_hour',8,'weekly_day',6,'revision',0,
      'included_users',(select coalesce(jsonb_agg(user_id),'[]') from public.memberships where organization_id=org and status='active'),
      'recipients',jsonb_build_array(jsonb_build_object('user_id',actor,'scope','team','telegram',false))) end) || jsonb_build_object('scheduler_available',exists(select 1 from pg_extension where extname='pg_cron'));
  elsif command='save' then
    if jsonb_typeof(payload->'included_users') is distinct from 'array' or jsonb_typeof(payload->'recipients') is distinct from 'array'
      or jsonb_array_length(payload->'recipients')>100 then raise exception 'راجع الأعضاء والمستلمين'; end if;
    select coalesce(array_agg(distinct x::uuid),'{}') into included from jsonb_array_elements_text(payload->'included_users') x;
    if exists(select 1 from unnest(included) u where not exists(select 1 from public.memberships where organization_id=org and user_id=u and status='active')) then raise exception 'اختر أعضاء نشطين من نفس الفريق'; end if;
    if (select count(*) from jsonb_array_elements(payload->'recipients'))<>(select count(distinct x->>'user_id') from jsonb_array_elements(payload->'recipients') x) then raise exception 'المستلم مكرر'; end if;
    for r in select * from jsonb_array_elements(payload->'recipients') loop
      rid:=(r->>'user_id')::uuid;
      if r->>'scope' is null or r->>'scope' not in ('team','self') or not exists(select 1 from public.memberships where organization_id=org and user_id=rid and status='active' and (r->>'scope'='self' or role in ('owner','admin','manager'))) then raise exception 'الشامل للمالك أو مدير تختاره، والشخصي لصاحبه فقط'; end if;
      if r->>'scope'='self' and not(rid=any(included)) then raise exception 'أضف مستلم التقرير الشخصي إلى الأعضاء المشمولين'; end if;
      if coalesce((r->>'telegram')::boolean,false) and not exists(select 1 from public.publishing_admin_connections where organization_id=org and user_id=rid and connected_at is not null and telegram_chat_id is not null and telegram_user_id is not null and workflow_notifications_enabled) then raise exception 'اربط تيليجرام وفعّل إشعاراته للمستلم أولًا'; end if;
    end loop;
    if ((payload->>'daily_enabled')::boolean or (payload->>'weekly_enabled')::boolean) and (cardinality(included)=0 or jsonb_array_length(payload->'recipients')=0) then raise exception 'اختر أعضاء ومستلمين قبل التفعيل'; end if;
    if ((payload->>'daily_enabled')::boolean or (payload->>'weekly_enabled')::boolean) and not exists(select 1 from pg_extension where extname='pg_cron') then raise exception 'الجدولة غير متاحة؛ يلزم تجهيز Cron قبل التفعيل'; end if;
    insert into private.team_report_settings(organization_id) values(org) on conflict do nothing;
    select * into cfg from private.team_report_settings where organization_id=org for update;
    if cfg.revision is distinct from (payload->>'revision')::integer then raise exception 'تغيرت الإعدادات؛ أعد تحميلها قبل الحفظ'; end if;
    update private.team_report_settings set daily_enabled=(payload->>'daily_enabled')::boolean,weekly_enabled=(payload->>'weekly_enabled')::boolean,
      delivery_hour=(payload->>'delivery_hour')::integer,weekly_day=(payload->>'weekly_day')::integer,included_users=included,
      recipients=payload->'recipients',revision=revision+1,updated_at=now() where organization_id=org returning * into cfg;
    insert into public.audit_events(organization_id,actor_id,action,entity_type,entity_id,after_data)
      values(org,actor,'team.report_settings_updated','organization',org,to_jsonb(cfg));
    return to_jsonb(cfg);
  elsif command='preview' then
    select * into cfg from private.team_report_settings where organization_id=org;
    included:=coalesce(cfg.included_users,(select array_agg(user_id) from public.memberships where organization_id=org and status='active'));
    return private.build_team_activity_report(org,(payload->>'start')::date,(payload->>'end')::date,included);
  elsif command='list' then
    select coalesce(jsonb_agg(to_jsonb(q)),'[]') into rows from (
      select id,scope,cadence,period_start,period_end,created_at from private.team_reports t
      where organization_id=org and recipient_id=actor and private.can_receive_team_report(org,actor,t.scope)
      order by created_at desc limit 60
    ) q;
    return rows;
  elsif command='get' then
    select * into report from private.team_reports where id=(payload->>'id')::uuid and organization_id=org and recipient_id=actor;
    if not found or not private.can_receive_team_report(org,actor,report.scope) then raise exception 'التقرير غير متاح لحسابك'; end if;
    return report.snapshot;
  end if;
  raise exception 'أمر غير معروف';
end $$;
revoke all on function private.team_reports_command(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function private.team_reports_command(text,uuid,jsonb) to authenticated;
create function public.team_reports_command(command text, org uuid, payload jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$ select private.team_reports_command(command,org,payload); $$;
revoke all on function public.team_reports_command(text,uuid,jsonb) from public,anon;
grant execute on function public.team_reports_command(text,uuid,jsonb) to authenticated;

alter table public.notifications drop constraint notifications_kind_allowed;
alter table public.notifications add constraint notifications_kind_allowed check(kind=any(array[
 'task_assigned','task_ready','task_review','task_blocked','task_done','revision_requested','publication_published','publication_failed',
 'publication_held','script_assigned','script_ready','script_research_assigned','content_brief_updated','team_joined','team_access_changed',
 'task_due_soon','task_overdue','task_overdue_escalated','chat_reply','task_question','task_discussion','telegram_test','team_access_requested',
 'team_access_approved','password_recovery_requested','task_urgent','task_urgent_acknowledged','task_help_requested','task_help_resolved','team_report'
]));

create function private.team_report_telegram_allowed(notification_id bigint) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.notifications n join private.team_reports t on t.id=n.entity_id
  join private.team_report_settings s on s.organization_id=t.organization_id
  cross join lateral jsonb_array_elements(s.recipients) r
  where n.id=notification_id and n.kind='team_report' and n.user_id=t.recipient_id
    and r->>'user_id'=t.recipient_id::text and r->>'scope'=t.scope and coalesce((r->>'telegram')::boolean,false)
    and private.can_receive_team_report(t.organization_id,t.recipient_id,t.scope));
$$;
revoke all on function private.team_report_telegram_allowed(bigint) from public,anon,authenticated;
-- Existing workflow delivery keeps its connection checks, retry/unknown-state
-- handling and dedupe. Gate this new kind before it enters that same outbox.
create function private.filter_team_report_outbox() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.notifications where id=new.notification_id and kind='team_report')
    and not private.team_report_telegram_allowed(new.notification_id) then return null; end if;
  return new;
end $$;
create trigger team_report_outbox_gate before insert on private.telegram_notification_outbox
for each row execute function private.filter_team_report_outbox();
revoke all on function private.filter_team_report_outbox() from public,anon,authenticated;
create function public.authorize_team_report_delivery(notification_id bigint) returns boolean
language sql security invoker set search_path='' as $$ select private.team_report_telegram_allowed(notification_id); $$;
revoke all on function public.authorize_team_report_delivery(bigint) from public,anon,authenticated;
grant execute on function public.authorize_team_report_delivery(bigint), private.team_report_telegram_allowed(bigint) to service_role;

create function private.materialize_team_activity_reports() returns integer
language plpgsql security definer set search_path='' as $$
declare s private.team_report_settings; r jsonb; report_cadence text; start_day date; end_day date;
  local_now timestamp:=now() at time zone 'Africa/Cairo'; boundary date; recipient uuid; report_id uuid; snap jsonb; body text; member jsonb; created_count integer:=0;
begin
  -- One scheduler at a time; unique periods also protect retries/catch-up.
  if not pg_try_advisory_xact_lock(7200920) then return 0; end if;
  for s in select * from private.team_report_settings where daily_enabled or weekly_enabled loop
    if extract(hour from local_now)<s.delivery_hour then continue; end if;
    foreach report_cadence in array array['daily','weekly'] loop
      if report_cadence='daily' then
        if not s.daily_enabled then continue; end if;
        end_day:=local_now::date-1; start_day:=end_day;
      else
        if not s.weekly_enabled then continue; end if;
        boundary:=local_now::date-((extract(dow from local_now)::integer-s.weekly_day+7)%7);
        end_day:=boundary-1; start_day:=boundary-7;
      end if;
      for r in select * from jsonb_array_elements(s.recipients) loop
        recipient:=(r->>'user_id')::uuid;
        if not private.can_receive_team_report(s.organization_id,recipient,r->>'scope') then continue; end if;
        if exists(select 1 from private.team_reports where organization_id=s.organization_id and recipient_id=recipient and scope=r->>'scope' and cadence=report_cadence and period_start=start_day and period_end=end_day) then continue; end if;
        snap:=private.build_team_activity_report(s.organization_id,start_day,end_day,case when r->>'scope'='self' then array[recipient] else s.included_users end);
        insert into private.team_reports(organization_id,recipient_id,scope,cadence,period_start,period_end,snapshot)
          values(s.organization_id,recipient,r->>'scope',report_cadence,start_day,end_day,snap) on conflict do nothing returning id into report_id;
        if report_id is null then continue; end if;
        body:='الفترة: '||start_day||' — '||end_day||E'\n';
        for member in select * from jsonb_array_elements(snap->'members') loop
          body:=body||left(member->>'name',60)||': تسليمات '||coalesce(member->'metrics'->>'deliveries','0')||'، اكتمل '||coalesce(member->'metrics'->>'completed','0')||'، طلبات محتوى '||coalesce(member->'metrics'->>'content_created','0')||E'\n';
        end loop;
        body:=left(body,830)||E'\nالملخص من السجل فقط؛ التقرير الكامل والحضور داخل الموقع.';
        perform private.add_notification(s.organization_id,recipient,'team_report',case when report_cadence='daily' then 'تقرير النشاط اليومي' else 'تقرير النشاط الأسبوعي' end,body,'team_report',report_id,'/?report='||report_id,'team-report:'||report_id);
        created_count:=created_count+1;
      end loop;
    end loop;
  end loop;
  return created_count;
end $$;
revoke all on function private.materialize_team_activity_reports() from public,anon,authenticated;
-- No sends on installation: owner must save enabled settings and recipients.
-- If Cron is unavailable, release checks must flag scheduling as unavailable.
do $$ begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
   perform cron.schedule('team-activity-reports','*/15 * * * *','select private.materialize_team_activity_reports()');
 end if;
end $$;
