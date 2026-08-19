"use client";

import type { Session } from "@supabase/supabase-js";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CircleUserRound,
  ContactRound,
  FileText,
  Film,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RefreshCw,
  Route,
  Send,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { contentStepConfig } from "../../lib/content";
import { launchGateConfig } from "../../lib/launches";
import {
  allowedTaskTransitions,
  canManageTasks,
  taskPriorityConfig,
  taskStatusConfig,
  type TaskPriority,
  type TaskStatus,
  visibleBoardStatuses,
} from "../../lib/tasks";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Tables } from "../../lib/supabase/database.types";
import { getSupabaseFunctionErrorMessage } from "../../lib/supabase/function-errors";
import { useWorkspaceAuth } from "../../lib/supabase/use-workspace-auth";
import { Button } from "../ui/Button";
import { StatusBadge } from "../ui/StatusBadge";

type Task = Tables<"tasks">;
type Membership = Tables<"memberships">;
type Organization = Tables<"organizations">;

type TeamPerson = {
  id: string;
  name: string;
  role: Membership["role"];
};

type Workspace = {
  organization: Organization;
  membership: Membership;
  people: TeamPerson[];
};

type TaskFilter = "all" | "mine" | "overdue";

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) return String(error.message);
  return "حدث خطأ غير متوقع.";
}

function formatDeadline(value: string) {
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function isOverdue(task: Task, now: number) {
  return !["done", "cancelled"].includes(task.status) && new Date(task.due_at).getTime() < now;
}

export function TasksWorkspace() {
  const configured = isSupabaseConfigured();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(configured);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(configured ? null : "لم يتم إعداد اتصال Supabase لهذه النسخة.");
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [renderNow] = useState(() => Date.now());
  const [defaultDue] = useState(() => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16));

  const clearWorkspace = useCallback(() => {
    setWorkspace(null);
    setTasks([]);
  }, []);

  const clearTransientState = useCallback(() => setNotice(null), []);

  const refreshTasks = useCallback(async (organizationId: string) => {
    const supabase = getSupabaseBrowserClient();
    const { data, error: tasksError } = await supabase
      .from("tasks")
      .select("*")
      .eq("organization_id", organizationId)
      .order("due_at", { ascending: true })
      .order("id", { ascending: true });

    if (tasksError) throw tasksError;
    setTasks(data ?? []);
  }, []);

  const loadWorkspace = useCallback(async (activeSession: Session) => {
    const supabase = getSupabaseBrowserClient();
    setLoading(true);
    setError(null);

    try {
      const { data: membership, error: membershipError } = await supabase
        .from("memberships")
        .select("*")
        .eq("user_id", activeSession.user.id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();

      if (membershipError) throw membershipError;
      if (!membership) {
        setWorkspace(null);
        setTasks([]);
        return;
      }

      const [{ data: organization, error: organizationError }, { data: memberRows, error: membersError }] = await Promise.all([
        supabase.from("organizations").select("*").eq("id", membership.organization_id).single(),
        supabase
          .from("memberships")
          .select("user_id, role")
          .eq("organization_id", membership.organization_id)
          .eq("status", "active"),
      ]);

      if (organizationError) throw organizationError;
      if (membersError) throw membersError;

      const memberIds = (memberRows ?? []).map((member) => member.user_id);
      const { data: profiles, error: profilesError } = memberIds.length
        ? await supabase.from("profiles").select("id, full_name").in("id", memberIds)
        : { data: [], error: null };

      if (profilesError) throw profilesError;

      const people = (memberRows ?? []).map((member) => ({
        id: member.user_id,
        role: member.role,
        name:
          profiles?.find((profile) => profile.id === member.user_id)?.full_name
          ?? (member.user_id === activeSession.user.id ? activeSession.user.email : null)
          ?? "عضو فريق",
      }));

      setWorkspace({ organization, membership, people });
      await refreshTasks(membership.organization_id);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [refreshTasks]);

  const session = useWorkspaceAuth({
    configured,
    loadWorkspace,
    clearWorkspace,
    setLoading,
    clearTransientState,
  });

  useEffect(() => {
    if (!workspace) return;
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`tasks:${workspace.organization.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tasks",
          filter: `organization_id=eq.${workspace.organization.id}`,
        },
        () => void refreshTasks(workspace.organization.id),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refreshTasks, workspace]);

  const filteredTasks = useMemo(() => {
    if (!session) return [];
    if (filter === "mine") return tasks.filter((task) => task.owner_id === session.user.id);
    if (filter === "overdue") return tasks.filter((task) => isOverdue(task, renderNow));
    return tasks;
  }, [filter, renderNow, session, tasks]);

  async function requestMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    if (!email) return;

    setWorking(true);
    setError(null);
    setNotice(null);

    const { error: authError } = await getSupabaseBrowserClient().auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${window.location.origin}/tasks`,
      },
    });

    setWorking(false);
    if (authError) setError(authError.message);
    else setNotice("أرسلنا رابط دخول آمن إلى بريدك. افتحه من نفس المتصفح لإكمال الدخول.");
  }

  async function bootstrapWorkspace() {
    if (!session) return;
    setWorking(true);
    setError(null);

    const { error: invokeError } = await getSupabaseBrowserClient().functions.invoke("bootstrap-organization", {
      body: {},
    });

    if (invokeError) {
      setError(await getSupabaseFunctionErrorMessage(invokeError, "تعذّر إنشاء مساحة العمل."));
    } else {
      setNotice("تم إنشاء مساحة Market Whales وتفعيل حساب المالك.");
      await loadWorkspace(session);
    }
    setWorking(false);
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace) return;

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const dueValue = String(form.get("due_at") ?? "");
    const dueDate = new Date(dueValue);

    if (!dueValue || Number.isNaN(dueDate.getTime()) || dueDate.getTime() <= Date.now()) {
      setError("اختر موعدًا نهائيًا صحيحًا في المستقبل.");
      return;
    }

    setWorking(true);
    setError(null);
    setNotice(null);

    const { error: insertError } = await getSupabaseBrowserClient().from("tasks").insert({
      organization_id: workspace.organization.id,
      title: String(form.get("title") ?? "").trim(),
      description: String(form.get("description") ?? "").trim() || null,
      acceptance_criteria: String(form.get("acceptance_criteria") ?? "").trim(),
      owner_id: String(form.get("owner_id") ?? ""),
      priority: String(form.get("priority") ?? "normal") as TaskPriority,
      status: "backlog",
      due_at: dueDate.toISOString(),
    });

    setWorking(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }

    formElement.reset();
    setShowCreate(false);
    setNotice("تم إنشاء المهمة وتسجيلها في سجل النشاط.");
    await refreshTasks(workspace.organization.id);
  }

  async function changeStatus(task: Task, nextStatus: TaskStatus) {
    if (!workspace || nextStatus === task.status) return;
    setWorking(true);
    setError(null);
    setNotice(null);

    const { data, error: updateError } = await getSupabaseBrowserClient()
      .from("tasks")
      .update({ status: nextStatus })
      .eq("id", task.id)
      .eq("version", task.version)
      .select("id")
      .maybeSingle();

    setWorking(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    if (!data) {
      setError("المهمة تغيّرت عند عضو آخر. تم تحديث البورد قبل إعادة المحاولة.");
    } else {
      setNotice(`انتقلت المهمة إلى «${taskStatusConfig[nextStatus].label}».`);
    }
    await refreshTasks(workspace.organization.id);
  }

  if (loading) {
    return <section className="workspace-state" aria-live="polite"><LoaderCircle className="spin" size={24} /><div><h2>جارٍ تحميل مساحة العمل</h2><p>نتحقق من الجلسة والصلاحيات والمهام المتاحة لك.</p></div></section>;
  }

  if (!session) {
    return (
      <section className="auth-layout">
        <article className="panel auth-card">
          <span className="icon-tile large"><LockKeyhole size={22} /></span>
          <p className="overline">دخول آمن</p>
          <h2>ادخل ببريدك من دون كلمة مرور</h2>
          <p>سنرسل رابطًا يستخدم مرة واحدة. بعد الدخول سترى فقط مساحة الشركة والمهام المسموح بها لحسابك.</p>
          <form className="stacked-form" onSubmit={requestMagicLink}>
            <label htmlFor="login-email">البريد الإلكتروني</label>
            <input id="login-email" name="email" type="email" autoComplete="email" required placeholder="name@company.com" dir="ltr" />
            <Button type="submit" disabled={working}>{working ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />} إرسال رابط الدخول</Button>
          </form>
          {notice ? <p className="form-notice success" role="status">{notice}</p> : null}
          {error ? <p className="form-notice error" role="alert">{error}</p> : null}
        </article>
        <aside className="panel auth-explainer">
          <StatusBadge tone="success">RLS مفعّل</StatusBadge>
          <h2>الصلاحيات ليست شكلًا في الواجهة</h2>
          <p>كل قراءة أو تعديل يُفحص داخل قاعدة البيانات بحسب الشركة والدور ومالك المهمة، حتى لو حاول شخص تجاوز الواجهة.</p>
          <ul><li><CheckCircle2 size={16} /> لا توجد مهام تجريبية مخفية.</li><li><CheckCircle2 size={16} /> لا يمكن لعضو رؤية شركة أخرى.</li><li><CheckCircle2 size={16} /> كل تغيير مهم له سجل تدقيق.</li></ul>
        </aside>
      </section>
    );
  }

  if (!workspace) {
    return (
      <section className="workspace-state workspace-onboarding">
        <UserRoundCheck size={27} />
        <div><p className="overline">الحساب موثّق</p><h2>حسابك غير مرتبط بمساحة فريق بعد</h2><p>أنشئ مساحة Market Whales مرة واحدة للاختبار الشخصي. لن نضيف أي عضو أو نرسل أي دعوة في هذه المرحلة.</p></div>
        <Button type="button" onClick={bootstrapWorkspace} disabled={working}>{working ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} إنشاء مساحة الشركة</Button>
        {error ? <p className="form-notice error" role="alert">{error}</p> : null}
      </section>
    );
  }

  const manager = canManageTasks(workspace.membership.role);
  const peopleById = new Map(workspace.people.map((person) => [person.id, person]));
  const counts = Object.fromEntries(visibleBoardStatuses.map((status) => [status, filteredTasks.filter((task) => task.status === status).length]));
  return (
    <section className="tasks-workspace">
      <div className="workspace-toolbar">
        <div><p className="overline">{workspace.organization.name}</p><h2>بورد التنفيذ</h2><p>{tasks.length ? `${tasks.length} مهمة حقيقية مسجلة` : "لا توجد مهام حقيقية بعد — ابدأ بأول مهمة عند الجاهزية."}</p></div>
        <div className="toolbar-actions">
          <div className="segmented-control" aria-label="تصفية المهام">
            {(["all", "mine", "overdue"] as TaskFilter[]).map((value) => <button type="button" key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "all" ? "الكل" : value === "mine" ? "مهامي" : "متأخرة"}</button>)}
          </div>
          <button className="icon-button" type="button" aria-label="تحديث المهام" onClick={() => void refreshTasks(workspace.organization.id)}><RefreshCw size={17} /></button>
          {manager ? <Button type="button" onClick={() => setShowCreate((value) => !value)}><Plus size={16} /> مهمة جديدة</Button> : null}
        </div>
      </div>

      {notice ? <p className="form-notice success" role="status">{notice}</p> : null}
      {error ? <p className="form-notice error" role="alert">{error}</p> : null}

      {showCreate && manager ? (
        <form className="panel task-create-form" onSubmit={createTask}>
          <div className="section-heading"><div><p className="overline">تعريف واضح قبل التنفيذ</p><h2>إنشاء مهمة حقيقية</h2></div><button className="text-button" type="button" onClick={() => setShowCreate(false)}>إغلاق</button></div>
          <div className="form-grid">
            <label><span>عنوان المهمة</span><input name="title" minLength={3} maxLength={180} required placeholder="مثال: مونتاج ريلز خطة التداول" /></label>
            <label><span>المسؤول المباشر</span><select name="owner_id" defaultValue={session.user.id} required>{workspace.people.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
            <label><span>الموعد النهائي</span><input name="due_at" type="datetime-local" defaultValue={defaultDue} required /></label>
            <label><span>الأولوية</span><select name="priority" defaultValue="normal">{(Object.keys(taskPriorityConfig) as TaskPriority[]).map((priority) => <option value={priority} key={priority}>{taskPriorityConfig[priority].label}</option>)}</select></label>
            <label className="full-field"><span>شرح مختصر</span><textarea name="description" maxLength={5000} rows={3} placeholder="السياق والملفات المطلوبة وأي ملاحظات مهمة" /></label>
            <label className="full-field"><span>معيار القبول — متى نقول إن المهمة تمت؟</span><textarea name="acceptance_criteria" minLength={5} maxLength={4000} rows={3} required placeholder="مثال: نسخة 1080×1920، بدون أخطاء لغوية، ومعتمدة من المسؤول" /></label>
          </div>
          <div className="form-actions"><Button type="submit" disabled={working}>{working ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />} حفظ المهمة</Button><small>ستبدأ في قائمة الانتظار، ولن تتحرك إلا بانتقال مسموح ومسجّل.</small></div>
        </form>
      ) : null}

      <div className="kanban-board" aria-label="بورد مهام الفريق">
        {visibleBoardStatuses.map((status) => {
          const statusTasks = filteredTasks.filter((task) => task.status === status);
          return (
            <section className="kanban-column" key={status} aria-labelledby={`column-${status}`}>
              <header><StatusBadge tone={taskStatusConfig[status].tone}>{taskStatusConfig[status].shortLabel}</StatusBadge><strong id={`column-${status}`}>{counts[status] ?? 0}</strong></header>
              <div className="kanban-stack">
                {statusTasks.map((task) => {
                  const owner = peopleById.get(task.owner_id);
                  const canMove = !task.crm_contact_id && (manager || task.owner_id === session.user.id);
                  const options = [task.status, ...allowedTaskTransitions[task.status]].filter((option) =>
                    !task.launch_deliverable_id || option !== "review" || task.status === "review"
                  );
                  return (
                    <article className={`task-card ${isOverdue(task, renderNow) ? "task-overdue" : ""}`} key={task.id}>
                      <div className="task-card-top"><span className={`priority priority-${task.priority}`}>{taskPriorityConfig[task.priority].mark} {taskPriorityConfig[task.priority].label}</span><small>v{task.version}</small></div>
                      {task.content_step ? <span className="workflow-task-label"><Film size={12} /> محتوى · {contentStepConfig[task.content_step].label}</span> : null}
                      {task.content_item_id ? <a className="task-production-link" href={`/content#content-${task.content_item_id}`}><FileText size={12} /> فتح Production Brief والملفات</a> : null}
                      {task.launch_gate ? <span className="workflow-task-label launch-task-label"><Route size={12} /> إطلاق · {launchGateConfig[task.launch_gate].label}</span> : null}
                      {task.launch_deliverable_id ? <span className="workflow-task-label launch-task-label"><Route size={12} /> إطلاق · بند تنفيذي</span> : null}
                      {task.launch_deliverable_id ? <a className="task-production-link" href={`/campaigns#deliverable-${task.launch_deliverable_id}`}><FileText size={12} /> فتح التفاصيل وتسليم النتيجة</a> : null}
                      {task.crm_contact_id ? <span className="workflow-task-label crm-task-label"><ContactRound size={12} /> CRM · متابعة عميل</span> : null}
                      {task.crm_contact_id ? <a className="task-production-link" href={`/crm#lead-${task.crm_contact_id}`}><ContactRound size={12} /> فتح ملف العميل وتسجيل النتيجة</a> : null}
                      <h3>{task.title}</h3>
                      {task.description ? <p>{task.description}</p> : null}
                      <div className="acceptance-note"><CheckCircle2 size={14} /><span><strong>معيار القبول</strong>{task.acceptance_criteria}</span></div>
                      <dl className="task-meta"><div><dt><CircleUserRound size={14} /> المسؤول</dt><dd>{owner?.name ?? "عضو فريق"}</dd></div><div><dt><CalendarClock size={14} /> الموعد</dt><dd>{formatDeadline(task.due_at)}</dd></div></dl>
                      {isOverdue(task, renderNow) ? <span className="overdue-label"><AlertTriangle size={14} /> متأخرة عن الموعد</span> : null}
                      {task.crm_contact_id
                        ? <p className="crm-task-guard"><ShieldCheck size={13} /> تتحرك هذه المهمة تلقائيًا عند تسجيل النتيجة من CRM.</p>
                        : <label className="status-select"><span>نقل إلى</span><select value={task.status} disabled={!canMove || working} onChange={(event) => void changeStatus(task, event.target.value as TaskStatus)}>{options.map((option) => <option key={option} value={option}>{taskStatusConfig[option].label}</option>)}</select></label>}
                    </article>
                  );
                })}
                {!statusTasks.length ? <div className="column-empty"><span>—</span><p>لا توجد مهام</p></div> : null}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}
