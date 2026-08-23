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
  Plus,
  RefreshCw,
  Route,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { contentStepConfig } from "../../lib/content";
import { currentUuidDeepLink, taskDomId, taskReference } from "../../lib/deep-links";
import { launchGateConfig } from "../../lib/launches";
import {
  allowedTaskTransitions,
  canManageAllTaskExecution,
  canManageTasks,
  taskPriorityConfig,
  taskStatusConfig,
  taskStatusLabel,
  type TaskPriority,
  type TaskStatus,
} from "../../lib/tasks";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Tables } from "../../lib/supabase/database.types";
import { getSupabaseFunctionErrorMessage } from "../../lib/supabase/function-errors";
import { useWorkspaceAuth } from "../../lib/supabase/use-workspace-auth";
import { Button } from "../ui/Button";
import { CollapsibleText } from "../ui/CollapsibleText";
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

type TaskFilter = "active" | "mine" | "overdue" | "completed" | "all";
type BoardEntry = { id: string; contentItemId: string | null; tasks: Task[]; laneId: string };

const boardLanes: Array<{ id: string; label: string }> = [
  { id: "work", label: "شغل مطلوب تنفيذه" },
  { id: "review", label: "مطلوب مراجعته" },
  { id: "blocked", label: "متوقف ويحتاج تدخل" },
  { id: "closed", label: "المكتمل والأرشيف" },
];

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
  return !taskIsClosed(task) && new Date(task.due_at).getTime() < now;
}

function formatOverdueDuration(task: Task, now: number) {
  const milliseconds = Math.max(0, now - new Date(task.due_at).getTime());
  const totalMinutes = Math.floor(milliseconds / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days) return `${days} يوم${hours ? ` و${hours} ساعة` : ""}`;
  if (hours) return `${hours} ساعة${minutes ? ` و${minutes} دقيقة` : ""}`;
  return `${Math.max(1, minutes)} دقيقة`;
}

function taskIsClosed(task: Task) {
  return ["done", "cancelled"].includes(task.status);
}

function boardLaneForTasks(tasks: Task[], isContentWorkflow: boolean) {
  if (isContentWorkflow) return tasks.every(taskIsClosed) ? "closed" : "work";
  if (tasks.some((task) => task.status === "blocked")) return "blocked";
  if (tasks.some((task) => task.status === "review")) return "review";
  if (tasks.some((task) => ["backlog", "ready", "in_progress"].includes(task.status))) return "work";
  return "closed";
}

function taskMatchesFilter(task: Task, filter: TaskFilter, currentUserId: string, now: number) {
  if (filter === "active") return !taskIsClosed(task);
  if (filter === "mine") return task.owner_id === currentUserId && !taskIsClosed(task);
  if (filter === "overdue") return isOverdue(task, now);
  if (filter === "completed") return taskIsClosed(task);
  return true;
}

function contentWorkflowMatchesFilter(tasks: Task[], filter: TaskFilter, currentUserId: string, now: number) {
  if (filter === "active") return tasks.some((task) => !taskIsClosed(task));
  if (filter === "mine") return tasks.some((task) => task.owner_id === currentUserId && !taskIsClosed(task));
  if (filter === "overdue") return tasks.some((task) => isOverdue(task, now));
  if (filter === "completed") return tasks.every(taskIsClosed);
  return true;
}

function sortContentTasks(tasks: Task[]) {
  return [...tasks].sort((left, right) => {
    const leftOrder = left.content_step ? contentStepConfig[left.content_step].order : Number.MAX_SAFE_INTEGER;
    const rightOrder = right.content_step ? contentStepConfig[right.content_step].order : Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || new Date(left.due_at).getTime() - new Date(right.due_at).getTime();
  });
}

function contentGroupTitle(task: Task) {
  const separatorIndex = task.title.indexOf(":");
  return separatorIndex >= 0 ? task.title.slice(separatorIndex + 1).trim() : task.title;
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
  const [filter, setFilter] = useState<TaskFilter>("active");
  const [linkedTaskId] = useState(() => currentUuidDeepLink("task", "task"));
  const [renderNow, setRenderNow] = useState(() => Date.now());
  const [defaultDue] = useState(() => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const openedTaskLink = useRef<string | null>(null);

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
      .eq("is_work_item", true)
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

  useEffect(() => {
    const interval = window.setInterval(() => setRenderNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const boardEntries = useMemo(() => {
    if (!session) return [];
    const grouped = new Map<string, Task[]>();
    for (const task of tasks) {
      const key = task.content_item_id ? `content:${task.content_item_id}` : `task:${task.id}`;
      grouped.set(key, [...(grouped.get(key) ?? []), task]);
    }
    return [...grouped.entries()].flatMap(([id, entryTasks]): BoardEntry[] => {
      const contentItemId = entryTasks[0]?.content_item_id ?? null;
      const isContentWorkflow = Boolean(contentItemId);
      const orderedTasks = isContentWorkflow ? sortContentTasks(entryTasks) : entryTasks;
      const primaryTask = orderedTasks[0];
      if (!primaryTask) return [];
      const linkedEntry = Boolean(linkedTaskId && orderedTasks.some((task) => task.id === linkedTaskId));
      const matches = linkedEntry || (isContentWorkflow
        ? contentWorkflowMatchesFilter(orderedTasks, filter, session.user.id, renderNow)
        : taskMatchesFilter(primaryTask, filter, session.user.id, renderNow));
      if (!matches) return [];
      return [{
        id,
        contentItemId,
        tasks: orderedTasks,
        laneId: boardLaneForTasks(orderedTasks, isContentWorkflow),
      }];
    });
  }, [filter, linkedTaskId, renderNow, session, tasks]);

  useEffect(() => {
    if (!linkedTaskId || openedTaskLink.current === linkedTaskId || !tasks.some((task) => task.id === linkedTaskId)) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(taskDomId(linkedTaskId));
      if (!target) return;
      openedTaskLink.current = linkedTaskId;
      target.scrollIntoView({ block: "center" });
      target.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [boardEntries, linkedTaskId, tasks]);

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
      status: "ready",
      due_at: dueDate.toISOString(),
    });

    setWorking(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }

    formElement.reset();
    setShowCreate(false);
    setNotice("تم إنشاء المهمة داخل «شغل مطلوب تنفيذه» وتسجيلها في سجل النشاط.");
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
      setNotice(`انتقلت المهمة إلى «${taskStatusLabel(nextStatus, task.content_step)}».`);
    }
    await refreshTasks(workspace.organization.id);
  }

  if (loading) {
    return <section className="workspace-state" aria-live="polite"><LoaderCircle className="spin" size={24} /><div><h2>جارٍ تحميل مساحة العمل</h2><p>نتحقق من الجلسة والصلاحيات والمهام المتاحة لك.</p></div></section>;
  }

  if (!configured) {
    return <section className="workspace-state workspace-onboarding" role="alert"><AlertTriangle size={27} /><div><h2>اتصال تسجيل الدخول غير متاح مؤقتًا</h2><p>إعدادات الاتصال لم تصل إلى هذه النسخة. حدّث الصفحة بعد إصلاح النشر بدلًا من محاولة إرسال الرابط مرة أخرى.</p></div></section>;
  }

  if (!session) {
    return <section className="workspace-state workspace-onboarding"><UserRoundCheck size={27} /><div><h2>سجّل الدخول من البوابة الآمنة</h2><p>لن يظهر بورد المهام قبل اعتماد البريد وعضوية الفريق.</p></div><Button href="/login">فتح تسجيل الدخول</Button></section>;
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
  const platformAdmin = canManageAllTaskExecution(workspace.membership.role);
  const peopleById = new Map(workspace.people.map((person) => [person.id, person]));
  const linkedTask = linkedTaskId ? tasks.find((task) => task.id === linkedTaskId) ?? null : null;
  const linkedLaneId = linkedTaskId ? boardEntries.find((entry) => entry.tasks.some((task) => task.id === linkedTaskId))?.laneId : null;
  const visibleLanes = boardLanes.filter((lane) => lane.id !== "closed" || filter === "completed" || filter === "all" || linkedLaneId === "closed");
  return (
    <section className="tasks-workspace">
      <div className="workspace-toolbar">
        <div><p className="overline">{workspace.organization.name}</p><h2>بورد التنفيذ</h2><p>{tasks.length ? `${tasks.length} مهمة تنفيذ فعلية — بوابات الـBrief والكابشن والاعتماد لا تُحسب هنا` : "لا توجد مهام تنفيذ فعلية الآن."}</p></div>
        <div className="toolbar-actions">
          <div className="segmented-control" aria-label="تصفية المهام">
            {(["active", "mine", "overdue", "completed", "all"] as TaskFilter[]).map((value) => <button type="button" key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "active" ? "الجاري" : value === "mine" ? "مهامي" : value === "overdue" ? "متأخرة" : value === "completed" ? "المكتمل" : "الكل"}</button>)}
          </div>
          <button className="icon-button" type="button" aria-label="تحديث المهام" onClick={() => void refreshTasks(workspace.organization.id)}><RefreshCw size={17} /></button>
          {manager ? <Button type="button" onClick={() => setShowCreate((value) => !value)}><Plus size={16} /> مهمة جديدة</Button> : null}
        </div>
      </div>

      {notice ? <p className="form-notice success" role="status">{notice}</p> : null}
      {error ? <p className="form-notice error" role="alert">{error}</p> : null}
      {linkedTask ? <p className="direct-link-notice" role="status"><Route size={15} /> تم فتح المهمة المطلوبة مباشرة: <strong>{taskReference(linkedTask.id)}</strong> — الكارت المحدد ظاهر بإطار واضح.</p> : linkedTaskId ? <p className="form-notice error" role="alert">المهمة المطلوبة غير موجودة أو ليست ضمن صلاحيات حسابك.</p> : null}

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
          <div className="form-actions"><Button type="submit" disabled={working}>{working ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />} حفظ المهمة</Button><small>ستظهر مباشرة داخل «شغل مطلوب تنفيذه»، وكل تغيير بعدها مسموح ومسجّل.</small></div>
        </form>
      ) : null}

      <div className="kanban-board" aria-label="بورد مهام الفريق">
        {visibleLanes.map((lane) => {
          const laneEntries = boardEntries.filter((entry) => entry.laneId === lane.id);
          return (
            <section className="kanban-column" key={lane.id} aria-labelledby={`column-${lane.id}`}>
              <header><StatusBadge tone={lane.id === "blocked" ? "danger" : lane.id === "review" ? "warning" : lane.id === "closed" ? "success" : "info"}>{lane.label}</StatusBadge><strong id={`column-${lane.id}`}>{laneEntries.length}</strong></header>
              <div className="kanban-stack">
                {laneEntries.map((entry) => {
                  if (entry.contentItemId) {
                    const overdueTasks = entry.tasks.filter((task) => isOverdue(task, renderNow));
                    const completedTasks = entry.tasks.filter(taskIsClosed).length;
                    const progress = Math.round((completedTasks / entry.tasks.length) * 100);
                    return <article className={`task-card content-workflow-group ${overdueTasks.length ? "task-overdue" : ""}`} data-state={lane.id} key={entry.id}>
                      <div className="task-card-top"><span className="workflow-task-label"><Film size={12} /> محتوى · {entry.tasks.length} خطوات تنفيذ</span><StatusBadge tone={lane.id === "blocked" ? "danger" : lane.id === "review" ? "warning" : lane.id === "closed" ? "success" : "info"}>{lane.label}</StatusBadge></div>
                      <h3>{contentGroupTitle(entry.tasks[0])}</h3>
                      <a className="task-production-link" href={`/content?content=${entry.contentItemId}#content-${entry.contentItemId}`}><FileText size={12} /> فتح ملف المحتوى ونتائج التنفيذ</a>
                      <div className="content-workflow-progress">
                        <div><span>تقدم التنفيذ</span><strong>{progress}%</strong></div>
                        <span className="content-workflow-progress-track" role="progressbar" aria-label="نسبة تقدم ملف المحتوى" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></span>
                        <small>{completedTasks} من {entry.tasks.length} خطوات مكتملة</small>
                      </div>
                      {overdueTasks.length ? <span className="overdue-label"><AlertTriangle size={14} /> {overdueTasks.length} خطوة متأخرة — الأقدم منذ {formatOverdueDuration(overdueTasks.sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime())[0], renderNow)}</span> : null}
                      <div className="content-workflow-subtasks">{entry.tasks.map((task, index) => {
                        const owner = peopleById.get(task.owner_id);
                        const completed = taskIsClosed(task);
                        const isMine = task.owner_id === session.user.id && !completed;
                        const canOpenAction = platformAdmin || task.owner_id === session.user.id;
                        const actionLabel = task.status === "review"
                          ? platformAdmin ? "فتح للمراجعة والاعتماد" : "بانتظار اعتماد الإدارة"
                          : task.content_step === "publishing"
                            ? "فتح وتأكيد النشر"
                            : "فتح وتسليم المهمة";
                        const className = [isOverdue(task, renderNow) ? "overdue" : "", task.status === "blocked" ? "blocked" : "", completed ? "completed" : "", isMine ? "mine" : ""].filter(Boolean).join(" ");
                        const directTarget = linkedTaskId === task.id;
                        return <section className={className} data-direct-target={directTarget || undefined} id={taskDomId(task.id)} tabIndex={directTarget ? -1 : undefined} key={task.id}>
                          <div className="content-subtask-copy">
                            <span className="content-subtask-marker" aria-label={completed ? "مكتملة" : `الخطوة ${index + 1}`}>{completed ? <CheckCircle2 size={16} /> : index + 1}</span>
                            <div><strong>{task.content_step ? contentStepConfig[task.content_step].label : task.title}</strong><small><span className="task-reference">{taskReference(task.id)}</span> · {owner?.name ?? "عضو فريق"} · {formatDeadline(task.due_at)}{isMine ? <b> · مهمتك الآن</b> : null}</small>{directTarget ? <span className="direct-target-label"><Route size={11} /> دي المهمة المطلوبة</span> : null}</div>
                          </div>
                          <div className="content-subtask-action">
                            <StatusBadge tone={taskStatusConfig[task.status].tone}>{taskStatusLabel(task.status, task.content_step)}</StatusBadge>
                            {!completed && task.status !== "backlog" && canOpenAction && !(task.status === "review" && !platformAdmin)
                              ? <a href={`/content?content=${entry.contentItemId}#content-${entry.contentItemId}`}><FileText size={12} /> {actionLabel}</a>
                              : !completed ? <small>{task.status === "backlog" ? "تفتح تلقائيًا بعد الخطوة السابقة" : actionLabel}</small> : null}
                          </div>
                        </section>;
                      })}</div>
                    </article>;
                  }
                  const task = entry.tasks[0];
                  const owner = peopleById.get(task.owner_id);
                  const canMove = !task.crm_contact_id && (platformAdmin || task.owner_id === session.user.id);
                  const options = [task.status, ...allowedTaskTransitions[task.status]].filter((option) =>
                    (!task.launch_deliverable_id || option !== "review" || task.status === "review")
                    && (!task.content_step || !["caption", "design", "scheduling", "publishing"].includes(task.content_step)
                      || option !== "review" || task.status === "review")
                  );
                  return (
                    <article className={`task-card ${isOverdue(task, renderNow) ? "task-overdue" : ""}`} data-priority={task.priority} data-status={task.status} data-direct-target={linkedTaskId === task.id || undefined} id={taskDomId(task.id)} tabIndex={linkedTaskId === task.id ? -1 : undefined} key={task.id}>
                      <div className="task-card-top"><span className={`priority priority-${task.priority}`}>{taskPriorityConfig[task.priority].mark} {taskPriorityConfig[task.priority].label}</span><StatusBadge tone={taskStatusConfig[task.status].tone}>{taskStatusLabel(task.status, task.content_step)}</StatusBadge><small className="task-reference">{taskReference(task.id)}</small><small>v{task.version}</small></div>
                      {linkedTaskId === task.id ? <span className="direct-target-label"><Route size={11} /> دي المهمة المطلوبة</span> : null}
                      {task.content_step ? <span className="workflow-task-label"><Film size={12} /> محتوى · {contentStepConfig[task.content_step].label}</span> : null}
                      {task.content_item_id ? <a className="task-production-link" href={`/content?content=${task.content_item_id}#content-${task.content_item_id}`}><FileText size={12} /> فتح ملف المحتوى وتسليم النتيجة</a> : null}
                      {task.launch_gate ? <span className="workflow-task-label launch-task-label"><Route size={12} /> إطلاق · {launchGateConfig[task.launch_gate].label}</span> : null}
                      {task.launch_deliverable_id ? <span className="workflow-task-label launch-task-label"><Route size={12} /> إطلاق · بند تنفيذي</span> : null}
                      {task.launch_deliverable_id ? <a className="task-production-link" href={`/campaigns?deliverable=${task.launch_deliverable_id}#deliverable-${task.launch_deliverable_id}`}><FileText size={12} /> فتح التفاصيل وتسليم النتيجة</a> : null}
                      {task.crm_contact_id ? <span className="workflow-task-label crm-task-label"><ContactRound size={12} /> CRM · متابعة عميل</span> : null}
                      {task.crm_contact_id ? <a className="task-production-link" href={`/crm?contact=${task.crm_contact_id}#crm-${task.crm_contact_id}`}><ContactRound size={12} /> فتح ملف العميل وتسجيل النتيجة</a> : null}
                      <h3>{task.title}</h3>
                      {task.description ? <CollapsibleText text={task.description} maxCharacters={170} className="task-description" /> : null}
                      <div className="acceptance-note"><CheckCircle2 size={14} /><span><strong>معيار القبول</strong><CollapsibleText text={task.acceptance_criteria} maxCharacters={130} /></span></div>
                      <dl className="task-meta"><div><dt><CircleUserRound size={14} /> المسؤول</dt><dd>{owner?.name ?? "عضو فريق"}</dd></div><div><dt><CalendarClock size={14} /> الموعد</dt><dd>{formatDeadline(task.due_at)}</dd></div></dl>
                      {isOverdue(task, renderNow) ? <span className="overdue-label"><AlertTriangle size={14} /> متأخرة منذ {formatOverdueDuration(task, renderNow)}</span> : null}
                      {task.crm_contact_id
                        ? <p className="crm-task-guard"><ShieldCheck size={13} /> تتحرك هذه المهمة تلقائيًا عند تسجيل النتيجة من CRM.</p>
                        : <label className="status-select"><span>نقل إلى</span><select value={task.status} disabled={!canMove || working} onChange={(event) => void changeStatus(task, event.target.value as TaskStatus)}>{options.map((option) => <option key={option} value={option}>{taskStatusLabel(option, task.content_step)}</option>)}</select></label>}
                    </article>
                  );
                })}
                {!laneEntries.length ? <div className="column-empty"><span>—</span><p>لا توجد مهام</p></div> : null}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}
