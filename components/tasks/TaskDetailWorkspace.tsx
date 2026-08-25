"use client";

import type { Session } from "@supabase/supabase-js";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleUserRound,
  Clock3,
  ContactRound,
  FileText,
  History,
  LoaderCircle,
  MessageSquareText,
  Route,
  Send,
  ShieldCheck,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { contentStepConfig } from "../../lib/content";
import { taskReference } from "../../lib/deep-links";
import { launchGateConfig } from "../../lib/launches";
import {
  allowedTaskTransitionsForActor,
  canManageAllTaskExecution,
  taskPriorityConfig,
  taskStatusConfig,
  taskStatusLabel,
  taskTransitionLabel,
  type TaskStatus,
} from "../../lib/tasks";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Tables } from "../../lib/supabase/database.types";
import { useWorkspaceAuth } from "../../lib/supabase/use-workspace-auth";
import { Button } from "../ui/Button";
import { StatusBadge } from "../ui/StatusBadge";

type Task = Tables<"tasks">;
type TaskEvent = Tables<"task_events">;
type TaskRevisionRequest = Tables<"task_revision_requests">;
type Membership = Tables<"memberships">;
type Organization = Tables<"organizations">;
type Person = { id: string; name: string; role: Membership["role"] };
type Workspace = {
  organization: Organization;
  membership: Membership;
  people: Person[];
  task: Task;
  events: TaskEvent[];
  revisions: TaskRevisionRequest[];
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String(error.message) : "";
  if (/Task changed/i.test(message)) return "المهمة اتغيرت عند عضو آخر. حدّث الصفحة ثم أعد المحاولة.";
  if (/Only the task requester/i.test(message)) return "طلب التعديل متاح لطالب المهمة أو إدارة المنصة فقط.";
  if (/assignee cannot request/i.test(message)) return "المنفّذ لا يطلب تعديلًا من نفسه.";
  if (/Linked workflow revisions/i.test(message)) return "التعديل على هذه المهمة يتم من ملف المحتوى أو العميل أو الإطلاق المرتبط بها.";
  if (/cancelled task/i.test(message)) return "المهمة الملغاة لا تستقبل طلبات تعديل.";
  if (/Platform leadership cannot execute/i.test(message)) return "تنفيذ المهمة وتغيير حالتها متاحان للمسؤول المسند إليه فقط.";
  return message || "حدث خطأ غير متوقع.";
}

function taskEventTitle(event: TaskEvent) {
  if (event.event_type === "created") return "تم إنشاء المهمة";
  if (event.event_type === "reassigned") return "تم تغيير المسؤول";
  if (event.event_type === "status_changed") {
    const from = event.from_status ? taskStatusConfig[event.from_status].label : "بداية المهمة";
    const to = event.to_status ? taskStatusConfig[event.to_status].label : "حالة جديدة";
    return `${from} ← ${to}`;
  }
  return "تم تحديث المهمة";
}

export function TaskDetailWorkspace({ taskId }: { taskId: string }) {
  const configured = isSupabaseConfigured();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(configured);
  const [working, setWorking] = useState(false);
  const [showRevisionForm, setShowRevisionForm] = useState(false);
  const [error, setError] = useState<string | null>(configured ? null : "اتصال تسجيل الدخول غير متاح مؤقتًا.");
  const [notice, setNotice] = useState<string | null>(null);

  const clearWorkspace = useCallback(() => setWorkspace(null), []);
  const clearTransientState = useCallback(() => { setError(null); setNotice(null); }, []);

  const loadTaskData = useCallback(async (activeSession: Session, showLoading = true) => {
    const supabase = getSupabaseBrowserClient();
    if (showLoading) setLoading(true);
    try {
      const { data: membership, error: membershipError } = await supabase
        .from("memberships")
        .select("*")
        .eq("user_id", activeSession.user.id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) { setWorkspace(null); return; }

      const [{ data: organization, error: organizationError }, { data: task, error: taskError }, { data: memberRows, error: membersError }] = await Promise.all([
        supabase.from("organizations").select("*").eq("id", membership.organization_id).single(),
        supabase.from("tasks").select("*").eq("id", taskId).eq("organization_id", membership.organization_id).maybeSingle(),
        supabase.from("memberships").select("user_id, role").eq("organization_id", membership.organization_id).eq("status", "active"),
      ]);
      if (organizationError) throw organizationError;
      if (taskError) throw taskError;
      if (membersError) throw membersError;
      if (!task) throw new Error("المهمة غير موجودة أو خارج صلاحيات حسابك.");

      const [{ data: events, error: eventsError }, { data: revisions, error: revisionsError }] = await Promise.all([
        supabase.from("task_events").select("*").eq("task_id", task.id).order("occurred_at", { ascending: false }).limit(100),
        supabase.from("task_revision_requests").select("*").eq("task_id", task.id).order("requested_at", { ascending: false }).limit(100),
      ]);
      if (eventsError) throw eventsError;
      if (revisionsError) throw revisionsError;

      const profileIds = [...new Set([
        ...(memberRows ?? []).map((member) => member.user_id),
        ...(events ?? []).flatMap((event) => event.actor_id ? [event.actor_id] : []),
        ...(revisions ?? []).map((revision) => revision.requested_by),
      ])];
      const { data: profiles, error: profilesError } = profileIds.length
        ? await supabase.from("profiles").select("id, full_name").in("id", profileIds)
        : { data: [], error: null };
      if (profilesError) throw profilesError;

      const people = (memberRows ?? []).map((member) => ({
        id: member.user_id,
        role: member.role,
        name: profiles?.find((profile) => profile.id === member.user_id)?.full_name
          ?? (member.user_id === activeSession.user.id ? activeSession.user.email : null)
          ?? "عضو فريق",
      }));
      for (const profile of profiles ?? []) {
        if (!people.some((person) => person.id === profile.id)) {
          people.push({ id: profile.id, role: "viewer", name: profile.full_name ?? "عضو سابق" });
        }
      }

      setWorkspace({ organization, membership, people, task, events: events ?? [], revisions: revisions ?? [] });
      setError(null);
    } catch (loadError) {
      setError(friendlyError(loadError));
      if (showLoading) setWorkspace(null);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [taskId]);

  const loadWorkspace = useCallback(async (activeSession: Session) => loadTaskData(activeSession, true), [loadTaskData]);
  const session = useWorkspaceAuth({ configured, loadWorkspace, clearWorkspace, setLoading, clearTransientState });

  useEffect(() => {
    if (!workspace || !session) return;
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`task-detail:${taskId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `id=eq.${taskId}` }, () => void loadTaskData(session, false))
      .on("postgres_changes", { event: "*", schema: "public", table: "task_events", filter: `task_id=eq.${taskId}` }, () => void loadTaskData(session, false))
      .on("postgres_changes", { event: "*", schema: "public", table: "task_revision_requests", filter: `task_id=eq.${taskId}` }, () => void loadTaskData(session, false))
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadTaskData, session, taskId, workspace]);

  const peopleById = useMemo(() => new Map(workspace?.people.map((person) => [person.id, person]) ?? []), [workspace?.people]);

  async function changeStatus(nextStatus: TaskStatus) {
    if (!workspace || nextStatus === workspace.task.status) return;
    setWorking(true); setError(null); setNotice(null);
    const { data, error: updateError } = await getSupabaseBrowserClient()
      .from("tasks")
      .update({ status: nextStatus })
      .eq("id", workspace.task.id)
      .eq("version", workspace.task.version)
      .select("id")
      .maybeSingle();
    if (updateError) setError(friendlyError(updateError));
    else if (!data) setError("المهمة اتغيرت عند عضو آخر. حدّث الصفحة ثم أعد المحاولة.");
    else {
      setNotice(`انتقلت المهمة إلى «${taskStatusLabel(nextStatus, workspace.task.content_step)}».`);
      await loadTaskData(session!, false);
    }
    setWorking(false);
  }

  async function requestRevision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || !session) return;
    const formElement = event.currentTarget;
    const instructions = String(new FormData(formElement).get("instructions") ?? "").trim();
    if (instructions.length < 3) { setError("اكتب التعديل المطلوب بوضوح."); return; }
    setWorking(true); setError(null); setNotice(null);
    const { error: insertError } = await getSupabaseBrowserClient().from("task_revision_requests").insert({
      task_id: workspace.task.id,
      instructions,
      task_version: workspace.task.version,
    });
    if (insertError) setError(friendlyError(insertError));
    else {
      formElement.reset();
      setShowRevisionForm(false);
      setNotice("تم إرسال طلب التعديل للمسؤول وإرجاع المهمة للتنفيذ عند الحاجة.");
      await loadTaskData(session, false);
    }
    setWorking(false);
  }

  if (loading) return <section className="panel empty-state"><LoaderCircle className="spin" size={20} /><div><h2>جارٍ فتح ملف المهمة</h2><p>نحمّل التفاصيل وطلبات التعديل وسجل الحالة.</p></div></section>;
  if (!configured) return <section className="panel empty-state"><AlertTriangle size={20} /><div><h2>اتصال تسجيل الدخول غير متاح مؤقتًا</h2><p>حدّث الصفحة بعد استعادة الاتصال.</p></div></section>;
  if (!session || !workspace) return <section className="panel empty-state"><AlertTriangle size={20} /><div><h2>تعذّر فتح ملف المهمة</h2><p>{error ?? "سجّل الدخول بحساب عضو مصرح له."}</p></div><Button href="/tasks" variant="secondary">العودة للمهام</Button></section>;

  const { task, revisions, events } = workspace;
  const isAssignee = task.owner_id === session.user.id;
  const isRequester = task.created_by === session.user.id;
  const platformAdmin = canManageAllTaskExecution(workspace.membership.role);
  const linkedWorkflow = Boolean(task.content_item_id || task.launch_id || task.launch_deliverable_id || task.crm_contact_id);
  const transitions = linkedWorkflow ? [] : allowedTaskTransitionsForActor({
    status: task.status,
    requiresReview: task.requires_review,
    isAssignee,
    isRequester,
    role: workspace.membership.role,
  });
  const canRequestRevision = !linkedWorkflow && !isAssignee && task.status !== "cancelled" && task.status !== "backlog" && (isRequester || platformAdmin);
  const owner = peopleById.get(task.owner_id);
  const requester = peopleById.get(task.created_by);
  const linkedHref = task.content_item_id ? `/content?content=${task.content_item_id}#content-${task.content_item_id}`
    : task.launch_deliverable_id ? `/campaigns?deliverable=${task.launch_deliverable_id}#deliverable-${task.launch_deliverable_id}`
      : task.launch_id ? `/campaigns?launch=${task.launch_id}#launch-${task.launch_id}`
        : task.crm_contact_id ? `/crm/${task.crm_contact_id}` : null;
  const linkedLabel = task.content_item_id ? "فتح ملف المحتوى"
    : task.launch_deliverable_id || task.launch_id ? "فتح ملف الإطلاق"
      : task.crm_contact_id ? "فتح ملف العميل" : null;

  return (
    <section className="task-detail-workspace">
      <div className="task-detail-toolbar">
        <Button href="/tasks" variant="ghost"><ArrowRight size={15} /> العودة للبورد</Button>
        <span className="task-reference">{taskReference(task.id)}</span>
      </div>

      <section className="panel task-detail-header">
        <div>
          <p className="overline">{taskPriorityConfig[task.priority].mark} أولوية {taskPriorityConfig[task.priority].label}</p>
          <h2>{task.title}</h2>
          <p>طلبها {requester?.name ?? "عضو فريق"} ومسندة إلى {owner?.name ?? "عضو فريق"}.</p>
        </div>
        <StatusBadge tone={taskStatusConfig[task.status].tone}>{taskStatusLabel(task.status, task.content_step)}</StatusBadge>
      </section>

      {notice ? <p className="form-notice success" role="status"><CheckCircle2 size={14} /> {notice}</p> : null}
      {error ? <p className="form-notice error" role="alert">{error}</p> : null}

      <div className="task-detail-layout">
        <aside className="panel task-detail-action">
          <div className="section-heading compact"><div><p className="overline">الإجراء الحالي</p><h2>{isAssignee ? "تنفيذ مهمتك" : isRequester ? "متابعة ما طلبته" : "متابعة المهمة"}</h2></div><ShieldCheck size={19} /></div>
          {isAssignee ? <p className="task-role-proof"><CircleUserRound size={14} /> أنت المسؤول عن التنفيذ.</p> : <p className="task-role-proof"><CircleUserRound size={14} /> التنفيذ يخص {owner?.name ?? "المسؤول"} فقط.</p>}
          {transitions.length ? <label className="task-detail-status"><span>الإجراء التالي</span><select value={task.status} disabled={working} onChange={(event) => void changeStatus(event.target.value as TaskStatus)}><option value={task.status}>{taskStatusLabel(task.status, task.content_step)} — الحالية</option>{transitions.map((status) => <option value={status} key={status}>{taskTransitionLabel(task.status, status)}</option>)}</select></label> : null}
          {task.status === "review" && isAssignee ? <p className="task-review-waiting">أرسلت المهمة للمراجعة. الاعتماد أو طلب التعديل عند طالب المهمة.</p> : null}
          {canRequestRevision ? <Button type="button" variant="secondary" onClick={() => setShowRevisionForm((value) => !value)}><MessageSquareText size={15} /> طلب تعديل</Button> : null}
          {linkedHref && linkedLabel ? <Button href={linkedHref} variant="secondary"><Route size={15} /> {linkedLabel}</Button> : null}
          {!transitions.length && !canRequestRevision && !linkedHref ? <p className="task-action-note">لا يوجد إجراء مطلوب من حسابك في الحالة الحالية.</p> : null}
        </aside>

        <div className="task-detail-main">
          {showRevisionForm && canRequestRevision ? <section className="panel task-detail-section task-revision-compose">
            <div className="section-heading compact"><div><p className="overline">تعليمات واضحة للمسؤول</p><h2>ما التعديل المطلوب؟</h2><p>بعد الإرسال ترجع المهمة إلى التنفيذ تلقائيًا لو كانت مكتملة أو تحت المراجعة أو متوقفة.</p></div><MessageSquareText size={19} /></div>
            <form onSubmit={requestRevision}>
              <label><span>تفاصيل التعديل</span><textarea name="instructions" required minLength={3} maxLength={5000} rows={5} placeholder="مثال: عدّل أول 10 ثوانٍ، واحذف الجزء من 00:22 إلى 00:38، ثم ارفع النسخة الجديدة على نفس الرابط." /></label>
              <div className="form-actions"><Button type="submit" disabled={working}>{working ? <LoaderCircle className="spin" size={14} /> : <Send size={14} />} إرسال التعديل للمسؤول</Button><button className="text-button" type="button" onClick={() => setShowRevisionForm(false)}>إلغاء</button></div>
            </form>
          </section> : null}

          <section className="panel task-detail-section">
            <div className="section-heading compact"><div><p className="overline">تفاصيل الطلب</p><h2>كل المطلوب للتنفيذ</h2></div><FileText size={19} /></div>
            <dl className="task-detail-facts">
              <div><dt><CircleUserRound size={13} /> المسؤول</dt><dd>{owner?.name ?? "عضو فريق"}</dd></div>
              <div><dt><CircleUserRound size={13} /> طالب المهمة</dt><dd>{requester?.name ?? "عضو فريق"}</dd></div>
              <div><dt><CalendarClock size={13} /> الموعد النهائي</dt><dd>{formatDate(task.due_at)}</dd></div>
              <div><dt><Clock3 size={13} /> تاريخ الطلب</dt><dd>{formatDate(task.created_at)}</dd></div>
              <div><dt><Clock3 size={13} /> بدأ التنفيذ</dt><dd>{formatDate(task.started_at)}</dd></div>
              <div><dt><CheckCircle2 size={13} /> اكتملت</dt><dd>{formatDate(task.completed_at)}</dd></div>
            </dl>
            {task.description ? <div className="task-detail-copy"><strong>شرح المهمة</strong><p>{task.description}</p></div> : null}
            {task.acceptance_criteria.trim() ? <div className="task-detail-copy acceptance"><strong>معيار القبول — اختياري</strong><p>{task.acceptance_criteria}</p></div> : null}
            {task.requires_review ? <p className="task-review-rule"><ShieldCheck size={13} /> هذه المهمة تحتاج اعتماد طالب المهمة قبل الإغلاق.</p> : <p className="task-direct-close-rule"><CheckCircle2 size={13} /> المسؤول يقدر يغلق المهمة مباشرة بعد التنفيذ.</p>}
            {task.content_step ? <span className="workflow-task-label"><FileText size={12} /> محتوى · {contentStepConfig[task.content_step].label}</span> : null}
            {task.launch_gate ? <span className="workflow-task-label launch-task-label"><Route size={12} /> إطلاق · {launchGateConfig[task.launch_gate].label}</span> : null}
            {task.crm_contact_id ? <span className="workflow-task-label crm-task-label"><ContactRound size={12} /> متابعة عميل</span> : null}
          </section>

          <section className="panel task-detail-section">
            <div className="section-heading compact"><div><p className="overline">طلبات التعديل</p><h2>تعليمات لا تضيع في الشات</h2></div><StatusBadge tone={revisions.length ? "warning" : "neutral"}>{revisions.length}</StatusBadge></div>
            {revisions.length ? <ol className="task-revision-list">{revisions.map((revision) => <li key={revision.id}><span aria-hidden="true" /><div><strong>{peopleById.get(revision.requested_by)?.name ?? "طالب المهمة"}</strong><p>{revision.instructions}</p><small>{formatDate(revision.requested_at)} · على نسخة v{revision.task_version}</small></div></li>)}</ol> : <p className="task-empty-proof"><CheckCircle2 size={14} /> لا توجد طلبات تعديل حتى الآن.</p>}
          </section>

          <section className="panel task-detail-section">
            <div className="section-heading compact"><div><p className="overline">سجل الحالة</p><h2>من غيّر ماذا ومتى</h2></div><History size={19} /></div>
            {events.length ? <ol className="task-event-list">{events.map((event) => <li key={event.id}><span aria-hidden="true" /><div><strong>{taskEventTitle(event)}</strong><p>{peopleById.get(event.actor_id ?? "")?.name ?? "النظام"}</p><small>{formatDate(event.occurred_at)}</small></div></li>)}</ol> : <p className="task-empty-proof">لا يوجد نشاط مسجل.</p>}
          </section>
        </div>
      </div>
    </section>
  );
}
