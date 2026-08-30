"use client";

import type { Session } from "@supabase/supabase-js";
import {
  AlertTriangle,
  Bot,
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
import { currentUuidDeepLink, taskDeepLink, taskDomId, taskReference } from "../../lib/deep-links";
import { launchGateConfig } from "../../lib/launches";
import {
  allowedTaskTransitionsForActor,
  canManageAllTaskExecution,
  canManageTasks,
  taskPriorityConfig,
  taskStatusConfig,
  taskStatusLabel,
  taskTransitionLabel,
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
  allowedSections: string[];
};

type Workspace = {
  organization: Organization;
  membership: Membership;
  people: TeamPerson[];
};

type TaskFilter = "active" | "mine" | "overdue" | "completed" | "all";
type BoardEntry = { id: string; contentItemId: string | null; tasks: Task[]; laneId: string };
type TaskDateRange = { from: string; to: string };
type TaskSubmission = {
  organization_id: string;
  title: string;
  description: string | null;
  acceptance_criteria: string;
  owner_id: string;
  priority: TaskPriority;
  status: "ready";
  requires_review: boolean;
  due_at: string;
  estimated_minutes: number;
};
type CapacitySnapshot = {
  user_id: string;
  daily_capacity_minutes: number;
  allocated_minutes: number;
  projected_minutes: number;
  projected_count: number;
  max_parallel_tasks: number;
  overloaded: boolean;
};

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

function dateBoundary(value: string, endOfDay = false) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0).getTime();
}

function taskFilterTimestamp(task: Task, filter: TaskFilter) {
  const value = filter === "completed" ? task.completed_at ?? task.updated_at : task.due_at;
  return new Date(value).getTime();
}

function taskMatchesAdvancedFilters(task: Task, filter: TaskFilter, requesterId: string, range: TaskDateRange) {
  if (requesterId !== "all" && task.created_by !== requesterId) return false;
  const timestamp = taskFilterTimestamp(task, filter);
  const from = dateBoundary(range.from);
  const to = dateBoundary(range.to, true);
  if (from !== null && timestamp < from) return false;
  if (to !== null && timestamp > to) return false;
  return true;
}

function taskBelongsToViewer(task: Task, currentUserId: string) {
  return task.owner_id === currentUserId
    || (task.status === "review" && task.created_by === currentUserId);
}

function taskNeedsViewerAction(task: Task, currentUserId: string) {
  if (task.status === "review") return task.created_by === currentUserId;
  return task.owner_id === currentUserId
    && ["ready", "in_progress", "blocked"].includes(task.status);
}

function taskCompletionTimestamp(task: Task) {
  return new Date(task.completed_at ?? task.updated_at).getTime();
}

function boardEntryCompletionTimestamp(entry: BoardEntry) {
  return Math.max(...entry.tasks.map(taskCompletionTimestamp));
}

function boardEntryDeadlineTimestamp(entry: BoardEntry) {
  return Math.min(...entry.tasks.map((task) => new Date(task.due_at).getTime()));
}

function sortBoardEntries(entries: BoardEntry[]) {
  return [...entries].sort((left, right) => {
    if (left.laneId === "closed" && right.laneId === "closed") {
      return boardEntryCompletionTimestamp(right) - boardEntryCompletionTimestamp(left)
        || right.id.localeCompare(left.id);
    }
    return boardEntryDeadlineTimestamp(left) - boardEntryDeadlineTimestamp(right)
      || left.id.localeCompare(right.id);
  });
}

function boardLaneForTasks(tasks: Task[], isContentWorkflow: boolean) {
  if (isContentWorkflow) return tasks.every(taskIsClosed) ? "closed" : "work";
  if (tasks.some((task) => task.status === "blocked")) return "blocked";
  if (tasks.some((task) => task.status === "review")) return "review";
  if (tasks.some((task) => ["backlog", "ready", "in_progress"].includes(task.status))) return "work";
  return "closed";
}

function taskMatchesFilter(task: Task, filter: TaskFilter, currentUserId: string, now: number, personalOnly = false) {
  if (personalOnly) {
    if (filter === "mine" || filter === "active") return taskNeedsViewerAction(task, currentUserId);
    if (filter === "overdue") return taskNeedsViewerAction(task, currentUserId) && isOverdue(task, now);
    if (filter === "completed") return task.owner_id === currentUserId && taskIsClosed(task);
    return taskBelongsToViewer(task, currentUserId);
  }
  if (filter === "active") return !taskIsClosed(task);
  if (filter === "mine") {
    return !taskIsClosed(task)
      && (task.owner_id === currentUserId || (task.status === "review" && task.created_by === currentUserId));
  }
  if (filter === "overdue") return isOverdue(task, now);
  if (filter === "completed") return taskIsClosed(task);
  return true;
}

function personalActionLabel(task: Task, nextStatus: TaskStatus) {
  if (nextStatus === "in_progress") {
    return task.status === "blocked" ? "تم حل العائق — أكمل" : "استلمت وبدأت";
  }
  if (nextStatus === "review") return "تم التسليم للمراجعة";
  if (nextStatus === "done") {
    if (task.status === "review") return "اعتماد النتيجة";
    return task.content_step === "publishing" ? "تم النشر" : "تم التسليم";
  }
  if (nextStatus === "blocked") return "عندي عائق";
  return taskTransitionLabel(task.status, nextStatus);
}

function contentWorkflowMatchesFilter(tasks: Task[], filter: TaskFilter, currentUserId: string, now: number) {
  if (filter === "active") return tasks.some((task) => !taskIsClosed(task));
  if (filter === "mine") {
    return tasks.some((task) => !taskIsClosed(task)
      && (task.owner_id === currentUserId || (task.status === "review" && task.created_by === currentUserId)));
  }
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
  const [contentRequests, setContentRequests] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(configured);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(configured ? null : "لم يتم إعداد اتصال Supabase لهذه النسخة.");
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newTaskOwnerId, setNewTaskOwnerId] = useState("");
  const [newTaskRequiresReview, setNewTaskRequiresReview] = useState(false);
  const [capacityWarning, setCapacityWarning] = useState<{ submission: TaskSubmission; snapshot: CapacitySnapshot } | null>(null);
  const [filter, setFilter] = useState<TaskFilter>("mine");
  const [requesterFilter, setRequesterFilter] = useState("all");
  const [dateRange, setDateRange] = useState<TaskDateRange>({ from: "", to: "" });
  const [linkedTaskId] = useState(() => currentUuidDeepLink("task", "task"));
  const [renderNow, setRenderNow] = useState(() => Date.now());
  const [defaultDue] = useState(() => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const openedTaskLink = useRef<string | null>(null);
  const visibleContentIdsRef = useRef<Set<string>>(new Set());

  const clearWorkspace = useCallback(() => {
    setWorkspace(null);
    setTasks([]);
    setContentRequests({});
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

  const fetchContentRequests = useCallback(async (organizationId: string, contentItemIds: string[]) => {
    if (!contentItemIds.length) return null;
    const { data, error: contentError } = await getSupabaseBrowserClient()
      .from("content_items")
      .select("id, intake_request")
      .eq("organization_id", organizationId)
      .in("id", contentItemIds);

    if (contentError) return null;
    const rowsById = new Map((data ?? []).map((item) => [item.id, item.intake_request?.trim() || null]));
    return Object.fromEntries(contentItemIds.map((contentItemId) => [contentItemId, rowsById.get(contentItemId) ?? null]));
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
        setContentRequests({});
        return;
      }

      const [{ data: organization, error: organizationError }, { data: memberRows, error: membersError }] = await Promise.all([
        supabase.from("organizations").select("*").eq("id", membership.organization_id).single(),
        supabase
          .from("memberships")
          .select("user_id, role, allowed_sections")
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
        allowedSections: member.allowed_sections,
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

  const manager = canManageTasks(workspace?.membership.role ?? null);
  const platformAdmin = canManageAllTaskExecution(workspace?.membership.role ?? null);
  const personalView = !manager || filter === "mine";

  const boardEntries = useMemo(() => {
    if (!session) return [];
    const grouped = new Map<string, Task[]>();
    for (const task of tasks) {
      if (personalView && !taskBelongsToViewer(task, session.user.id) && task.id !== linkedTaskId) continue;
      const key = !personalView && task.content_item_id ? `content:${task.content_item_id}` : `task:${task.id}`;
      grouped.set(key, [...(grouped.get(key) ?? []), task]);
    }
    const entries = [...grouped.entries()].flatMap(([id, entryTasks]): BoardEntry[] => {
      const contentItemId = entryTasks[0]?.content_item_id ?? null;
      const isContentWorkflow = Boolean(contentItemId) && !personalView;
      const orderedTasks = isContentWorkflow ? sortContentTasks(entryTasks) : entryTasks;
      const primaryTask = orderedTasks[0];
      if (!primaryTask) return [];
      const linkedEntry = Boolean(linkedTaskId && orderedTasks.some((task) => task.id === linkedTaskId));
      const matches = linkedEntry || (isContentWorkflow
        ? contentWorkflowMatchesFilter(orderedTasks, filter, session.user.id, renderNow)
        : taskMatchesFilter(primaryTask, filter, session.user.id, renderNow, personalView));
      const matchesAdvancedFilters = personalView || orderedTasks.some((task) =>
        taskMatchesAdvancedFilters(task, filter, requesterFilter, dateRange));
      if (!matches || (!linkedEntry && !matchesAdvancedFilters)) return [];
      return [{
        id,
        contentItemId,
        tasks: orderedTasks,
        laneId: personalView ? filter === "completed" ? "closed" : "focus" : boardLaneForTasks(orderedTasks, isContentWorkflow),
      }];
    });
    return sortBoardEntries(entries);
  }, [dateRange, filter, linkedTaskId, personalView, renderNow, requesterFilter, session, tasks]);

  const visibleContentItemIds = useMemo(() => [...new Set(boardEntries
    .map((entry) => entry.contentItemId)
    .filter((contentItemId): contentItemId is string => Boolean(contentItemId)))], [boardEntries]);
  const visibleContentItemKey = visibleContentItemIds.join(",");

  useEffect(() => {
    visibleContentIdsRef.current = new Set(visibleContentItemKey ? visibleContentItemKey.split(",") : []);
  }, [visibleContentItemKey]);

  useEffect(() => {
    if (!workspace || !visibleContentItemKey) return;
    let active = true;
    void fetchContentRequests(workspace.organization.id, visibleContentItemKey.split(",")).then((requests) => {
      if (active && requests) setContentRequests((current) => ({ ...current, ...requests }));
    });
    return () => {
      active = false;
    };
  }, [fetchContentRequests, visibleContentItemKey, workspace]);

  useEffect(() => {
    if (!workspace) return;
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`task-content-requests:${workspace.organization.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "content_items",
          filter: `organization_id=eq.${workspace.organization.id}`,
        },
        (payload) => {
          const nextRecord = payload.new as { id?: string };
          const previousRecord = payload.old as { id?: string };
          const changedId = nextRecord.id ?? previousRecord.id;
          if (!changedId || !visibleContentIdsRef.current.has(changedId)) return;
          void fetchContentRequests(workspace.organization.id, [changedId]).then((requests) => {
            if (requests) setContentRequests((current) => ({ ...current, ...requests }));
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [fetchContentRequests, workspace]);

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

  async function persistTask(submission: TaskSubmission, allowCapacityOverride = false) {
    if (!workspace) return;
    setWorking(true); setError(null); setNotice(null);
    if (!allowCapacityOverride) {
      const { data, error: capacityError } = await getSupabaseBrowserClient().rpc("check_team_member_capacity", {
        target_organization_id: workspace.organization.id,
        target_member_id: submission.owner_id,
        target_due_at: submission.due_at,
        requested_minutes: submission.estimated_minutes,
      });
      if (capacityError) { setWorking(false); setError(capacityError.message); return; }
      const snapshot = data as unknown as CapacitySnapshot;
      if (snapshot.overloaded) {
        setCapacityWarning({ submission, snapshot }); setWorking(false); return;
      }
    }
    const { error: insertError } = await getSupabaseBrowserClient().from("tasks").insert(submission);
    if (insertError) { setWorking(false); setError(insertError.message); return; }
    setCapacityWarning(null); setNewTaskOwnerId(""); setNewTaskRequiresReview(false); setShowCreate(false);
    setNotice(allowCapacityOverride
      ? "تم إنشاء المهمة رغم تحذير الحمل، وسُجل الإسناد في النشاط."
      : "تم إنشاء المهمة داخل «شغل مطلوب تنفيذه» وإرسال إشعار للمسؤول.");
    await refreshTasks(workspace.organization.id);
    setWorking(false);
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace) return;
    const form = new FormData(event.currentTarget);
    const dueValue = String(form.get("due_at") ?? "");
    const dueDate = new Date(dueValue);
    const ownerId = String(form.get("owner_id") ?? "");

    if (!dueValue || Number.isNaN(dueDate.getTime()) || dueDate.getTime() <= Date.now()) {
      setError("اختر موعدًا نهائيًا صحيحًا في المستقبل.");
      return;
    }

    if (newTaskRequiresReview && ownerId === session?.user.id) {
      setError("لا يمكن طلب مراجعة مستقلة لمهمة أسندتها لنفسك. اختر عضوًا آخر أو اجعل الإغلاق مباشرًا.");
      return;
    }

    const submission: TaskSubmission = {
      organization_id: workspace.organization.id,
      title: String(form.get("title") ?? "").trim(),
      description: String(form.get("description") ?? "").trim() || null,
      acceptance_criteria: String(form.get("acceptance_criteria") ?? "").trim(),
      owner_id: ownerId,
      priority: String(form.get("priority") ?? "normal") as TaskPriority,
      status: "ready",
      requires_review: newTaskRequiresReview,
      due_at: dueDate.toISOString(),
      estimated_minutes: Number(form.get("estimated_minutes") ?? 60),
    };
    setCapacityWarning(null);
    await persistTask(submission);
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

  const peopleById = new Map(workspace.people.map((person) => [person.id, person]));
  const assignablePeople = workspace.people.filter((person) => person.role !== "viewer"
    && (person.role === "owner" || person.allowedSections.includes("tasks")));
  const linkedTask = linkedTaskId ? tasks.find((task) => task.id === linkedTaskId) ?? null : null;
  const linkedLaneId = linkedTaskId ? boardEntries.find((entry) => entry.tasks.some((task) => task.id === linkedTaskId))?.laneId : null;
  const advancedFiltersActive = requesterFilter !== "all" || Boolean(dateRange.from || dateRange.to);
  const personalLaneLabel = filter === "completed"
    ? "اللي خلصته"
    : filter === "overdue"
      ? "المتأخر عندي"
      : "المطلوب مني الآن";
  const availableLanes = personalView
    ? [{ id: filter === "completed" ? "closed" : "focus", label: personalLaneLabel }]
    : boardLanes;
  const visibleLanes = availableLanes.filter((lane) => {
    if (linkedLaneId === lane.id) return true;
    if (personalView) return boardEntries.some((entry) => entry.laneId === lane.id);
    if (filter === "all" && !advancedFiltersActive) return true;
    return boardEntries.some((entry) => entry.laneId === lane.id);
  });
  const filteredTaskCount = boardEntries.reduce((total, entry) => total + entry.tasks.length, 0);
  const myOpenTaskCount = tasks.filter((task) => taskNeedsViewerAction(task, session.user.id)).length;
  const quickFilters: TaskFilter[] = manager
    ? ["mine", "active", "overdue", "completed", "all"]
    : ["mine", "overdue", "completed"];
  return (
    <section className="tasks-workspace">
      <div className="workspace-toolbar">
        <div><p className="overline">{workspace.organization.name}</p><h2>{manager ? "مهامي والفريق" : "مهامي"}</h2><p>{manager ? `عندك ${myOpenTaskCount.toLocaleString("ar-EG")} مهمة تحتاج إجراء منك. افتح عرض الفريق فقط عند المتابعة.` : myOpenTaskCount ? `عندك ${myOpenTaskCount.toLocaleString("ar-EG")} مهمة مطلوبة منك الآن. افتح المهمة ونفّذ الإجراء التالي فقط.` : "لا يوجد شيء مطلوب منك الآن."}</p></div>
        <div className="toolbar-actions">
          <div className="segmented-control" aria-label="تصفية المهام">
            {quickFilters.map((value) => <button type="button" key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "mine" ? "المطلوب مني" : value === "active" ? "شغل الفريق" : value === "overdue" ? manager ? "متأخر عند الفريق" : "المتأخر عندي" : value === "completed" ? manager ? "مكتمل الفريق" : "اللي خلصته" : "كل الفريق"}</button>)}
          </div>
          <button className="icon-button" type="button" aria-label="تحديث المهام" onClick={() => void refreshTasks(workspace.organization.id)}><RefreshCw size={17} /></button>
          {manager ? <Button type="button" onClick={() => setShowCreate((value) => !value)}><Plus size={16} /> مهمة جديدة</Button> : null}
        </div>
      </div>

      {notice ? <p className="form-notice success" role="status">{notice}</p> : null}
      {error ? <p className="form-notice error" role="alert">{error}</p> : null}
      {linkedTask ? <p className="direct-link-notice" role="status"><Route size={15} /> تم فتح المهمة المطلوبة مباشرة: <strong>{taskReference(linkedTask.id)}</strong> — الكارت المحدد ظاهر بإطار واضح.</p> : linkedTaskId ? <p className="form-notice error" role="alert">المهمة المطلوبة غير موجودة أو ليست ضمن صلاحيات حسابك.</p> : null}

      {manager && !personalView ? <div className="panel task-filter-panel" aria-label="فلترة بورد المهام">
        <div className="task-filter-heading">
          <CalendarClock size={19} aria-hidden="true" />
          <div><strong>فلترة أدق</strong><small role="status">ظاهر الآن {filteredTaskCount.toLocaleString("ar-EG")} مهمة</small></div>
        </div>
        <label className="task-filter-field">
          <span><UserRoundCheck size={13} aria-hidden="true" /> طالب المهمة</span>
          <select value={requesterFilter} onChange={(event) => setRequesterFilter(event.target.value)}>
            <option value="all">كل طالبي المهام</option>
            {workspace.people.map((person) => <option value={person.id} key={person.id}>{person.id === session.user.id ? `أنا — ${person.name}` : person.name}</option>)}
          </select>
        </label>
        <label className="task-filter-field">
          <span>من تاريخ</span>
          <input type="date" value={dateRange.from} max={dateRange.to || undefined} onChange={(event) => setDateRange((current) => ({ ...current, from: event.target.value }))} />
        </label>
        <label className="task-filter-field">
          <span>إلى تاريخ</span>
          <input type="date" value={dateRange.to} min={dateRange.from || undefined} onChange={(event) => setDateRange((current) => ({ ...current, to: event.target.value }))} />
        </label>
        <button className="task-filter-reset" type="button" disabled={!advancedFiltersActive} onClick={() => { setRequesterFilter("all"); setDateRange({ from: "", to: "" }); }}>مسح الفلاتر الإضافية</button>
        <small className="task-filter-note">الفترة تعتمد على موعد التسليم، وعند اختيار «المكتمل» تعتمد على تاريخ إكمال المهمة.</small>
      </div> : null}

      {showCreate && manager ? (
        <form className="panel task-create-form" onSubmit={createTask} onChange={() => setCapacityWarning(null)}>
          <div className="section-heading"><div><p className="overline">طلب مباشر</p><h2>إسناد مهمة</h2></div><div className="toolbar-actions"><Button type="button" variant="secondary" onClick={() => window.dispatchEvent(new CustomEvent("workspace-ai:ask", { detail: { question: "راجع تقويم الفريق والمهام المفتوحة، وساعدني أختار مسؤولًا وموعدًا واقعيين للمهمة الجديدة. وضّح أي حمل زائد، ولا تغيّر أي بيانات من نفسك." } }))}><Bot size={14} /> اسأل AI قبل الإسناد</Button><button className="text-button" type="button" onClick={() => setShowCreate(false)}>إغلاق</button></div></div>
          <div className="form-grid">
            <label><span>عنوان المهمة</span><input name="title" minLength={3} maxLength={180} required placeholder="مثال: مونتاج ريلز خطة التداول" /></label>
            <label><span>المسؤول المباشر</span><select name="owner_id" value={newTaskOwnerId || session.user.id} required onChange={(event) => { setNewTaskOwnerId(event.target.value); if (event.target.value === session.user.id) setNewTaskRequiresReview(false); }}>{assignablePeople.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
            <label><span>الموعد النهائي</span><input name="due_at" type="datetime-local" defaultValue={defaultDue} required /></label>
            <label className="full-field"><span>كل المطلوب والروابط</span><textarea name="description" required minLength={5} maxLength={5000} rows={7} placeholder="اكتب الطلب كما سترسله في الجروب: الشرح، الملفات، الروابط، وأي ملاحظات في نفس الخانة" /><small>سيظهر النص نفسه للمنفذ داخل صفحة المهمة، وتبقى الروابط في موضعها وقابلة للفتح.</small></label>
            <details className="content-request-advanced full-field">
              <summary>الأولوية والوقت والمراجعة — اختياري</summary>
              <div className="content-request-advanced-body form-grid">
                <label><span>الأولوية</span><select name="priority" defaultValue="normal">{(Object.keys(taskPriorityConfig) as TaskPriority[]).map((priority) => <option value={priority} key={priority}>{taskPriorityConfig[priority].label}</option>)}</select></label>
                <label><span>الوقت المتوقع</span><select name="estimated_minutes" defaultValue="60"><option value="30">30 دقيقة</option><option value="60">ساعة</option><option value="90">ساعة ونصف</option><option value="120">ساعتان</option><option value="180">3 ساعات</option><option value="240">4 ساعات</option><option value="360">6 ساعات</option></select></label>
                <label className="full-field"><span>معيار القبول — اختياري</span><textarea name="acceptance_criteria" maxLength={4000} rows={3} placeholder="اكتبه فقط لو النتيجة المطلوبة تحتاج شروطًا واضحة، مثل المقاس أو صيغة التسليم" /></label>
                <fieldset className="full-field task-review-choice">
                  <legend>هل المهمة تحتاج مراجعة؟</legend>
                  <div className="task-review-option">
                    <input aria-label="تحتاج اعتماد طالب المهمة قبل الإغلاق" type="checkbox" checked={newTaskRequiresReview} disabled={(newTaskOwnerId || session.user.id) === session.user.id} onChange={(event) => setNewTaskRequiresReview(event.target.checked)} />
                    <span><strong>تحتاج اعتماد طالب المهمة قبل الإغلاق</strong><small>{(newTaskOwnerId || session.user.id) === session.user.id ? "غير متاح عند إسناد المهمة لنفسك." : "العضو يرسلها للمراجعة، وأنت توافق أو تعيدها للتنفيذ."}</small></span>
                  </div>
                  <small>لو لم تفعّل هذا الاختيار، يقدر المسؤول الضغط على «تم التنفيذ» وإغلاق المهمة مباشرة.</small>
                </fieldset>
              </div>
            </details>
          </div>
          {capacityWarning ? <div className="capacity-decision" role="alert"><AlertTriangle size={18} /><div><strong>المسؤول عليه حمل زائد في هذا اليوم</strong><p>بعد الإسناد سيصبح الحمل {capacityWarning.snapshot.projected_minutes.toLocaleString("ar-EG")} من {capacityWarning.snapshot.daily_capacity_minutes.toLocaleString("ar-EG")} دقيقة، وعدد البنود {capacityWarning.snapshot.projected_count.toLocaleString("ar-EG")} من {capacityWarning.snapshot.max_parallel_tasks.toLocaleString("ar-EG")}.</p><small>غيّر الموعد أو المسؤول من الأعلى، أو أكمل عن قصد.</small></div><div><button className="text-button" type="button" onClick={() => setCapacityWarning(null)}>تعديل الإسناد</button><Button type="button" variant="secondary" disabled={working} onClick={() => void persistTask(capacityWarning.submission, true)}>إسناد رغم الضغط</Button></div></div> : null}
          <div className="form-actions"><Button type="submit" disabled={working}>{working ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />} إسناد المهمة</Button><small>ستظهر فورًا للمسؤول داخل «مهامي»، وكل تغيير بعدها محفوظ في السجل.</small></div>
        </form>
      ) : null}

      {visibleLanes.length ? <div className="kanban-board" aria-label={personalView ? "مهامي" : "بورد مهام الفريق"}>
        {visibleLanes.map((lane) => {
          const laneEntries = boardEntries.filter((entry) => entry.laneId === lane.id);
          const laneTone = lane.id === "blocked" ? "danger" : lane.id === "review" ? "warning" : lane.id === "closed" ? "success" : "info";
          return (
            <section className="kanban-column" key={lane.id} aria-labelledby={`column-${lane.id}`}>
              <header><StatusBadge tone={laneTone}>{lane.label}</StatusBadge><strong id={`column-${lane.id}`}>{laneEntries.length}</strong></header>
              <div className="kanban-stack">
                {laneEntries.map((entry) => {
                  if (entry.contentItemId && !personalView) {
                    const overdueTasks = entry.tasks.filter((task) => isOverdue(task, renderNow));
                    const completedTasks = entry.tasks.filter(taskIsClosed).length;
                    const progress = Math.round((completedTasks / entry.tasks.length) * 100);
                    const contentRequest = contentRequests[entry.contentItemId]?.trim()
                      || entry.tasks.find((task) => task.description?.trim())?.description?.trim()
                      || "";
                    return <article className={`task-card content-workflow-group ${overdueTasks.length ? "task-overdue" : ""}`} data-state={lane.id} key={entry.id}>
                      <div className="task-card-top"><span className="workflow-task-label"><Film size={12} /> محتوى · {entry.tasks.length} خطوات تنفيذ</span><StatusBadge tone={lane.id === "blocked" ? "danger" : lane.id === "review" ? "warning" : lane.id === "closed" ? "success" : "info"}>{lane.label}</StatusBadge></div>
                      <h3>{contentGroupTitle(entry.tasks[0])}</h3>
                      <a className="task-production-link" href={`/content?content=${entry.contentItemId}#content-${entry.contentItemId}`}><FileText size={12} /> فتح ملف المحتوى ونتائج التنفيذ</a>
                      {contentRequest ? <CollapsibleText text={contentRequest} maxCharacters={220} className="task-description" /> : null}
                      <div className="content-workflow-progress">
                        <div><span>تقدم التنفيذ</span><strong>{progress}%</strong></div>
                        <span className="content-workflow-progress-track" role="progressbar" aria-label="نسبة تقدم ملف المحتوى" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></span>
                        <small>{completedTasks} من {entry.tasks.length} خطوات مكتملة</small>
                      </div>
                      {overdueTasks.length ? <span className="overdue-label"><AlertTriangle size={14} /> {overdueTasks.length} خطوة متأخرة — الأقدم منذ {formatOverdueDuration(overdueTasks.sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime())[0], renderNow)}</span> : null}
                      <div className="content-workflow-subtasks">{entry.tasks.map((task, index) => {
                        const owner = peopleById.get(task.owner_id);
                        const requester = peopleById.get(task.created_by);
                        const completed = taskIsClosed(task);
                        const isMine = task.owner_id === session.user.id && !completed;
                        const isRequester = task.created_by === session.user.id;
                        const canOpenAction = task.status === "review"
                          ? isRequester || platformAdmin
                          : task.owner_id === session.user.id;
                        const actionLabel = task.status === "review"
                          ? canOpenAction ? "فتح للمراجعة والاعتماد" : "بانتظار مراجعة طالب المهمة"
                          : task.content_step === "publishing"
                            ? "فتح وتأكيد النشر"
                            : "فتح وتسليم المهمة";
                        const className = [isOverdue(task, renderNow) ? "overdue" : "", task.status === "blocked" ? "blocked" : "", completed ? "completed" : "", isMine ? "mine" : ""].filter(Boolean).join(" ");
                        const directTarget = linkedTaskId === task.id;
                        return <section className={className} data-direct-target={directTarget || undefined} id={taskDomId(task.id)} tabIndex={directTarget ? -1 : undefined} key={task.id}>
                          <div className="content-subtask-copy">
                            <span className="content-subtask-marker" aria-label={completed ? "مكتملة" : `الخطوة ${index + 1}`}>{completed ? <CheckCircle2 size={16} /> : index + 1}</span>
                            <div><strong>{task.content_step ? contentStepConfig[task.content_step].label : task.title}</strong><small>{owner?.name ?? "عضو فريق"} · طلبها {requester?.name ?? "عضو فريق"} · {formatDeadline(task.due_at)}{isMine ? <b> · مهمتك الآن</b> : null}</small><a className="task-open-link" href={taskDeepLink(task.id)}><FileText size={12} /> فتح المهمة {taskReference(task.id)}</a>{directTarget ? <span className="direct-target-label"><Route size={11} /> دي المهمة المطلوبة</span> : null}</div>
                          </div>
                          <div className="content-subtask-action">
                            <StatusBadge tone={taskStatusConfig[task.status].tone}>{taskStatusLabel(task.status, task.content_step)}</StatusBadge>
                            {!completed && task.status !== "backlog" && canOpenAction
                              ? <a href={taskDeepLink(task.id)}><FileText size={12} /> {actionLabel}</a>
                              : !completed ? <small>{task.status === "backlog" ? "تفتح تلقائيًا بعد الخطوة السابقة" : actionLabel}</small> : null}
                          </div>
                        </section>;
                      })}</div>
                    </article>;
                  }
                  const task = entry.tasks[0];
                  const owner = peopleById.get(task.owner_id);
                  const isAssignee = task.owner_id === session.user.id;
                  const isRequester = task.created_by === session.user.id;
                  const transitions = allowedTaskTransitionsForActor({
                    status: task.status,
                    requiresReview: task.requires_review,
                    isAssignee,
                    isRequester,
                    role: workspace.membership.role,
                  });
                  const options = task.content_item_id
                    ? transitions.filter((option) => ["in_progress", "blocked"].includes(option))
                    : transitions.filter((option) =>
                      (!task.launch_deliverable_id || option !== "review" || task.status === "review")
                      && (!task.content_step || !["caption", "design", "scheduling", "publishing"].includes(task.content_step)
                        || option !== "review" || task.status === "review")
                    );
                  const canMove = !task.crm_contact_id && options.length > 0;
                  const requester = peopleById.get(task.created_by);
                  const taskDescription = task.content_item_id
                    ? contentRequests[task.content_item_id]?.trim() || task.description?.trim() || ""
                    : task.description?.trim() || "";
                  return (
                    <article className={`task-card ${isOverdue(task, renderNow) ? "task-overdue" : ""}`} data-priority={task.priority} data-status={task.status} data-direct-target={linkedTaskId === task.id || undefined} id={taskDomId(task.id)} tabIndex={linkedTaskId === task.id ? -1 : undefined} key={task.id}>
                      <div className="task-card-top">{!personalView || ["high", "urgent"].includes(task.priority) ? <span className={`priority priority-${task.priority}`}>{taskPriorityConfig[task.priority].mark} {taskPriorityConfig[task.priority].label}</span> : null}<StatusBadge tone={taskStatusConfig[task.status].tone}>{taskStatusLabel(task.status, task.content_step)}</StatusBadge><small className="task-reference">{taskReference(task.id)}</small>{!personalView ? <small>v{task.version}</small> : null}</div>
                      {linkedTaskId === task.id ? <span className="direct-target-label"><Route size={11} /> دي المهمة المطلوبة</span> : null}
                      {task.content_step ? <span className="workflow-task-label"><Film size={12} /> محتوى · {contentStepConfig[task.content_step].label}</span> : null}
                      {task.launch_gate ? <span className="workflow-task-label launch-task-label"><Route size={12} /> إطلاق · {launchGateConfig[task.launch_gate].label}</span> : null}
                      {task.launch_deliverable_id ? <span className="workflow-task-label launch-task-label"><Route size={12} /> إطلاق · بند تنفيذي</span> : null}
                      {task.launch_deliverable_id ? <a className="task-production-link" href={`/campaigns?deliverable=${task.launch_deliverable_id}#deliverable-${task.launch_deliverable_id}`}><FileText size={12} /> فتح التفاصيل وتسليم النتيجة</a> : null}
                      {task.crm_contact_id ? <span className="workflow-task-label crm-task-label"><ContactRound size={12} /> CRM · متابعة عميل</span> : null}
                      {task.crm_contact_id ? <a className="task-production-link" href={`/crm/${task.crm_contact_id}`}><ContactRound size={12} /> فتح ملف العميل وتسجيل النتيجة</a> : null}
                      <h3>{task.title}</h3>
                      <a className="task-open-link" href={taskDeepLink(task.id)}><FileText size={13} /> {task.content_item_id ? "فتح وتسليم المهمة" : "فتح صفحة المهمة"} {taskReference(task.id)}</a>
                      {taskDescription ? <CollapsibleText text={taskDescription} maxCharacters={170} className="task-description" /> : null}
                      {task.acceptance_criteria.trim() ? <div className="acceptance-note"><CheckCircle2 size={14} /><span><strong>معيار القبول</strong><CollapsibleText text={task.acceptance_criteria} maxCharacters={130} /></span></div> : null}
                      {task.requires_review ? <p className="task-review-rule"><ShieldCheck size={13} /> بعد التسليم يراجعها {requester?.name ?? "طالب المهمة"}.</p> : null}
                      <dl className="task-meta">{!personalView ? <div><dt><CircleUserRound size={14} /> المسؤول</dt><dd>{owner?.name ?? "عضو فريق"}</dd></div> : null}<div><dt><UserRoundCheck size={14} /> طلبها</dt><dd>{requester?.name ?? "عضو فريق"}</dd></div><div><dt><CalendarClock size={14} /> موعد التسليم</dt><dd>{formatDeadline(task.due_at)}</dd></div></dl>
                      {isOverdue(task, renderNow) ? <span className="overdue-label"><AlertTriangle size={14} /> متأخرة منذ {formatOverdueDuration(task, renderNow)}</span> : null}
                      {task.crm_contact_id
                        ? <p className="crm-task-guard"><ShieldCheck size={13} /> سجّل نتيجة التواصل من ملف العميل، والمهمة ستتحدث تلقائيًا.</p>
                        : <>{canMove ? personalView ? <div className="form-actions" aria-label="الإجراء التالي">{options.map((option) => <Button type="button" variant={option === "blocked" ? "secondary" : "primary"} disabled={working} onClick={() => void changeStatus(task, option)} key={option}>{personalActionLabel(task, option)}</Button>)}</div> : <label className="status-select"><span>الإجراء التالي</span><select value={task.status} disabled={working} onChange={(event) => void changeStatus(task, event.target.value as TaskStatus)}><option value={task.status}>{taskStatusLabel(task.status, task.content_step)} — الحالة الحالية</option>{options.map((option) => <option key={option} value={option}>{taskTransitionLabel(task.status, option)}</option>)}</select></label> : null}{task.requires_review && task.status === "review" && isAssignee ? <small className="task-review-waiting">تم التسليم. لا يوجد إجراء آخر عليك الآن، ولا يمكنك اعتمادها بنفسك.</small> : task.requires_review && task.status === "review" && canMove ? <small className="task-review-waiting reviewer">النتيجة جاهزة لك: اعتمدها من الزر، أو افتح صفحة المهمة واكتب التعديل المطلوب.</small> : !isAssignee && !canMove && !taskIsClosed(task) ? <small className="task-review-waiting">هذه المهمة ليست مسندة إليك. يمكنك متابعتها أو طلب تعديل من صفحتها.</small> : null}</>}
                    </article>
                  );
                })}
                {!laneEntries.length ? <div className="column-empty"><span>—</span><p>لا توجد مهام</p></div> : null}
              </div>
            </section>
          );
        })}
      </div> : <div className="task-filter-empty" role="status"><CalendarClock size={24} /><div><strong>{personalView ? "لا يوجد شيء مطلوب منك هنا" : "لا توجد مهام مطابقة"}</strong><p>{personalView ? "عندما تُسند إليك مهمة ستظهر هنا ومعها المطلوب والموعد وزر الإجراء التالي." : "غيّر الحالة أو الفترة الزمنية أو طالب المهمة لعرض نتائج أخرى."}</p></div>{filter !== "mine" ? <button className="text-button" type="button" onClick={() => { setFilter("mine"); setRequesterFilter("all"); setDateRange({ from: "", to: "" }); }}>العودة إلى مهامي</button> : manager ? <button className="text-button" type="button" onClick={() => setFilter("active")}>فتح شغل الفريق</button> : null}</div>}
    </section>
  );
}
