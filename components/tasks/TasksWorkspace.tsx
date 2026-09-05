"use client";

import type { Session } from "@supabase/supabase-js";
import {
  AlertTriangle,
  Archive,
  Bot,
  CalendarClock,
  CheckCircle2,
  CirclePause,
  CircleUserRound,
  ContactRound,
  FileText,
  Film,
  LoaderCircle,
  MessageSquareText,
  Plus,
  RefreshCw,
  Repeat2,
  Route,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { contentStepConfig, type ContentStep } from "../../lib/content";
import { currentUuidDeepLink, taskDeepLink, taskDeliveryDeepLink, taskDomId, taskReference } from "../../lib/deep-links";
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
import { TaskScheduleCalendar } from "./TaskScheduleCalendar";
import { WeeklyContentRoutineForm } from "./WeeklyContentRoutineForm";

type Task = Tables<"tasks">;
type Membership = Tables<"memberships">;
type Organization = Tables<"organizations">;
type RecurringTaskTemplate = Tables<"recurring_task_templates">;

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

type TaskFilter = "active" | "mine" | "overdue" | "completed" | "archived" | "all";
type BoardEntry = { id: string; contentItemId: string | null; tasks: Task[]; sortTasks: Task[]; laneId: string };
type TaskDateRange = { from: string; to: string };
type TaskCreateMode = "once" | "weekly";
type TaskCreateStep = 1 | 2 | 3;
type TaskSection = "today" | "team" | "schedule" | "archive";
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

const contentStepsSupportingRevision = new Set<ContentStep>(["recording", "editing", "thumbnail", "caption", "design"]);

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

function taskIsCompleted(task: Task) {
  return task.status === "done";
}

function dateBoundary(value: string, endOfDay = false) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0).getTime();
}

const weekdayLabels: Record<number, string> = {
  1: "الاثنين",
  2: "الثلاثاء",
  3: "الأربعاء",
  4: "الخميس",
  5: "الجمعة",
  6: "السبت",
  7: "الأحد",
};

function isoWeekday(value: Date) {
  return value.getDay() === 0 ? 7 : value.getDay();
}

function localDatePart(value: string) {
  return value.slice(0, 10);
}

function localTimePart(value: string) {
  return `${value.slice(11, 16)}:00`;
}

function defaultTaskDue() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

function deriveTaskTitle(explicitTitle: string, description: string) {
  const providedTitle = explicitTitle.trim();
  if (providedTitle) return providedTitle.slice(0, 180);
  const firstLine = description.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
  if (firstLine.length >= 3) return firstLine.slice(0, 180);
  return description.replace(/\s+/g, " ").trim().slice(0, 180);
}

function taskFilterTimestamp(task: Task, filter: TaskFilter) {
  const value = ["completed", "archived"].includes(filter) ? task.completed_at ?? task.updated_at : task.due_at;
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
  return Math.max(...entry.sortTasks.map(taskCompletionTimestamp));
}

function boardEntryDeadlineTimestamp(entry: BoardEntry) {
  return Math.min(...entry.sortTasks.map((task) => new Date(task.due_at).getTime()));
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
    if (filter === "completed") return task.owner_id === currentUserId && taskIsCompleted(task);
    if (filter === "archived") return task.owner_id === currentUserId && taskIsClosed(task);
    return taskBelongsToViewer(task, currentUserId);
  }
  if (filter === "active") return !taskIsClosed(task);
  if (filter === "mine") {
    return !taskIsClosed(task)
      && (task.owner_id === currentUserId || (task.status === "review" && task.created_by === currentUserId));
  }
  if (filter === "overdue") return isOverdue(task, now);
  if (filter === "completed") return taskIsCompleted(task);
  if (filter === "archived") return taskIsClosed(task);
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
  if (filter === "completed") return tasks.every(taskIsCompleted);
  if (filter === "archived") return tasks.every(taskIsClosed);
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
  const [recurringTemplates, setRecurringTemplates] = useState<RecurringTaskTemplate[]>([]);
  const [loading, setLoading] = useState(configured);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(configured ? null : "لم يتم إعداد اتصال Supabase لهذه النسخة.");
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [taskCreateStep, setTaskCreateStep] = useState<TaskCreateStep>(1);
  const [taskCreateMode, setTaskCreateMode] = useState<TaskCreateMode>("once");
  const [newTaskDescription, setNewTaskDescription] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDueAt, setNewTaskDueAt] = useState(defaultTaskDue);
  const [newTaskOwnerId, setNewTaskOwnerId] = useState("");
  const [newTaskRequiresReview, setNewTaskRequiresReview] = useState(false);
  const [capacityWarning, setCapacityWarning] = useState<{ submission: TaskSubmission; snapshot: CapacitySnapshot } | null>(null);
  const [filter, setFilter] = useState<TaskFilter>("mine");
  const [taskSection, setTaskSection] = useState<TaskSection>("today");
  const [requesterFilter, setRequesterFilter] = useState("all");
  const [dateRange, setDateRange] = useState<TaskDateRange>({ from: "", to: "" });
  const [linkedTaskId] = useState(() => currentUuidDeepLink("task", "task"));
  const [renderNow, setRenderNow] = useState(() => Date.now());
  const taskCreateForm = useRef<HTMLFormElement | null>(null);
  const openedTaskLink = useRef<string | null>(null);

  const clearWorkspace = useCallback(() => {
    setWorkspace(null);
    setTasks([]);
    setRecurringTemplates([]);
    setCapacityWarning(null);
    setShowCreate(false);
    setTaskCreateStep(1);
    setTaskCreateMode("once");
    setNewTaskDescription("");
    setNewTaskTitle("");
    setNewTaskDueAt(defaultTaskDue());
    setNewTaskOwnerId("");
    setNewTaskRequiresReview(false);
    setTaskSection("today");
    setFilter("mine");
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

  const refreshRecurringTemplates = useCallback(async (organizationId: string, canManage: boolean) => {
    if (!canManage) {
      setRecurringTemplates([]);
      return;
    }
    const { data, error: routinesError } = await getSupabaseBrowserClient()
      .from("recurring_task_templates")
      .select("*")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .order("weekday", { ascending: true })
      .order("time_local", { ascending: true });
    if (routinesError) throw routinesError;
    setRecurringTemplates(data ?? []);
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
        setRecurringTemplates([]);
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
      setFilter("mine");
      await Promise.all([
        refreshTasks(membership.organization_id),
        refreshRecurringTemplates(membership.organization_id, canManageTasks(membership.role)),
      ]);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [refreshRecurringTemplates, refreshTasks]);

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
  const readOnly = workspace?.membership.role === "viewer";
  const personalView = !manager || taskSection === "today";

  const boardEntries = useMemo(() => {
    if (!session) return [];
    const grouped = new Map<string, Task[]>();
    for (const task of tasks) {
      const key = task.content_item_id ? `content:${task.content_item_id}` : `task:${task.id}`;
      grouped.set(key, [...(grouped.get(key) ?? []), task]);
    }
    const entries = [...grouped.entries()].flatMap(([id, entryTasks]): BoardEntry[] => {
      const contentItemId = entryTasks[0]?.content_item_id ?? null;
      const isContentWorkflow = Boolean(contentItemId);
      const orderedTasks = isContentWorkflow ? sortContentTasks(entryTasks) : entryTasks;
      const primaryTask = orderedTasks[0];
      if (!primaryTask) return [];
      const linkedEntry = Boolean(linkedTaskId && orderedTasks.some((task) => task.id === linkedTaskId));
      const viewerTasks = personalView
        ? orderedTasks.filter((task) => taskBelongsToViewer(task, session.user.id) || task.id === linkedTaskId)
        : orderedTasks;
      if (personalView && !viewerTasks.length && !linkedEntry) return [];
      const matches = linkedEntry || (isContentWorkflow
        ? contentWorkflowMatchesFilter(viewerTasks, filter, session.user.id, renderNow)
        : taskMatchesFilter(primaryTask, filter, session.user.id, renderNow, personalView));
      const matchesAdvancedFilters = personalView || orderedTasks.some((task) =>
        taskMatchesAdvancedFilters(task, filter, requesterFilter, dateRange));
      if (!matches || (!linkedEntry && !matchesAdvancedFilters)) return [];
      return [{
        id,
        contentItemId,
        tasks: orderedTasks,
        sortTasks: personalView ? viewerTasks : orderedTasks,
        laneId: personalView ? ["completed", "archived"].includes(filter) ? "closed" : "focus" : boardLaneForTasks(orderedTasks, isContentWorkflow),
      }];
    });
    return sortBoardEntries(entries);
  }, [dateRange, filter, linkedTaskId, personalView, renderNow, requesterFilter, session, tasks]);

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

  function resetTaskCreateDraft() {
    setTaskCreateStep(1);
    setTaskCreateMode("once");
    setNewTaskDescription("");
    setNewTaskTitle("");
    setNewTaskDueAt(defaultTaskDue());
    setNewTaskOwnerId("");
    setNewTaskRequiresReview(false);
    setCapacityWarning(null);
  }

  function closeTaskCreate() {
    resetTaskCreateDraft();
    setShowCreate(false);
  }

  function reportTaskCreateControl(name: string) {
    const control = taskCreateForm.current?.elements.namedItem(name);
    if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement) {
      return control.reportValidity();
    }
    return false;
  }

  function advanceTaskCreate() {
    setError(null);
    setCapacityWarning(null);
    if (taskCreateStep === 1) {
      if (!reportTaskCreateControl("description") || !reportTaskCreateControl("title")) return;
      if (deriveTaskTitle(newTaskTitle, newTaskDescription).length < 3) {
        setError("اكتب أول سطر واضح للمهمة، أو أضف عنوانًا مختصرًا من 3 حروف على الأقل.");
        return;
      }
      setTaskCreateStep(2);
      return;
    }
    if (taskCreateStep === 2) {
      if (!reportTaskCreateControl("owner_id") || !reportTaskCreateControl("due_at")) return;
      const dueDate = new Date(newTaskDueAt);
      if (Number.isNaN(dueDate.getTime()) || dueDate.getTime() <= Date.now()) {
        setError("اختر موعدًا نهائيًا صحيحًا في المستقبل.");
        return;
      }
      setTaskCreateStep(3);
    }
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
    resetTaskCreateDraft();
    setShowCreate(false);
    setNotice(allowCapacityOverride
      ? "تم إنشاء المهمة رغم تحذير الحمل، وسُجل الإسناد في النشاط."
      : "تم إنشاء المهمة داخل «شغل مطلوب تنفيذه» وإرسال إشعار للمسؤول.");
    await refreshTasks(workspace.organization.id);
    setWorking(false);
  }

  async function persistWeeklyTask(form: FormData, dueValue: string, dueDate: Date, ownerId: string, title: string, description: string) {
    if (!workspace || !session) return;
    const startsOn = localDatePart(dueValue);
    const endsOn = String(form.get("routine_ends_on") ?? "").trim();
    if (endsOn && endsOn < startsOn) {
      setError("تاريخ نهاية المهمة الأسبوعية لازم يكون بعد أول موعد.");
      return;
    }
    setWorking(true); setError(null); setNotice(null);
    const { error: insertError } = await getSupabaseBrowserClient().from("recurring_task_templates").insert({
      organization_id: workspace.organization.id,
      title,
      description,
      acceptance_criteria: String(form.get("acceptance_criteria") ?? "").trim(),
      owner_id: ownerId,
      created_by: session.user.id,
      priority: String(form.get("priority") ?? "normal") as TaskPriority,
      requires_review: newTaskRequiresReview,
      estimated_minutes: Number(form.get("estimated_minutes") ?? 60),
      weekday: isoWeekday(dueDate),
      time_local: localTimePart(dueValue),
      starts_on: startsOn,
      ends_on: endsOn || null,
    });
    if (insertError) {
      setWorking(false);
      setError(insertError.message);
      return;
    }

    const { data: materializedCount, error: materializeError } = await getSupabaseBrowserClient().rpc("materialize_recurring_tasks", {
      target_organization_id: workspace.organization.id,
    });
    resetTaskCreateDraft();
    setShowCreate(false);
    await Promise.all([
      refreshTasks(workspace.organization.id),
      refreshRecurringTemplates(workspace.organization.id, true),
    ]);
    setNotice(materializeError
      ? "تم حفظ المهمة الأسبوعية. سيُنشئ النظام موعدها القادم تلقائيًا خلال ساعة."
      : materializedCount && materializedCount > 0
        ? "تم حفظ المهمة الأسبوعية وإنشاء موعدها القادم داخل «مهامي» بدون تكرار."
        : "تم حفظ المهمة الأسبوعية، وستظهر أول نسخة داخل «مهامي» تلقائيًا خلال الأسبوع السابق لموعدها.");
    setWorking(false);
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace) return;
    if (taskCreateStep !== 3) {
      advanceTaskCreate();
      return;
    }
    const form = new FormData(event.currentTarget);
    const dueValue = String(form.get("due_at") ?? "");
    const dueDate = new Date(dueValue);
    const ownerId = String(form.get("owner_id") ?? "");
    const description = String(form.get("description") ?? "").trim();
    const title = deriveTaskTitle(String(form.get("title") ?? ""), description);

    if (description.length < 5 || title.length < 3) {
      setError("اكتب شرحًا واضحًا للمهمة؛ العنوان سيتولد تلقائيًا من أول سطر.");
      setTaskCreateStep(1);
      return;
    }

    if (!ownerId || !dueValue || Number.isNaN(dueDate.getTime()) || dueDate.getTime() <= Date.now()) {
      setError("اختر موعدًا نهائيًا صحيحًا في المستقبل.");
      setTaskCreateStep(2);
      return;
    }

    if (newTaskRequiresReview && ownerId === session?.user.id) {
      setError("لا يمكن طلب مراجعة مستقلة لمهمة أسندتها لنفسك. اختر عضوًا آخر أو اجعل الإغلاق مباشرًا.");
      return;
    }

    if (taskCreateMode === "weekly") {
      await persistWeeklyTask(form, dueValue, dueDate, ownerId, title, description);
      return;
    }

    const submission: TaskSubmission = {
      organization_id: workspace.organization.id,
      title,
      description,
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

  async function toggleRecurringTemplate(templates: RecurringTaskTemplate[]) {
    if (!workspace) return;
    const template = templates[0];
    if (!template) return;
    const paused = templates.every((item) => item.paused);
    setWorking(true); setError(null); setNotice(null);
    try {
      let query = getSupabaseBrowserClient()
        .from("recurring_task_templates")
        .update({ paused: !paused })
        .eq("organization_id", workspace.organization.id);
      query = template.content_bundle_id
        ? query.eq("content_bundle_id", template.content_bundle_id)
        : query.eq("id", template.id).eq("version", template.version);
      const { data: updatedTemplates, error: updateError } = await query.select("id");
      if (updateError) setError(updateError.message);
      else if (!updatedTemplates?.length) {
        setError("تم تعديل المسار الأسبوعي من جلسة أخرى. حمّلنا أحدث نسخة؛ راجعها وحاول مرة ثانية.");
        await refreshRecurringTemplates(workspace.organization.id, true);
      } else {
        setNotice(paused ? "تم تشغيل المسار الأسبوعي من الموعد القادم." : "تم إيقاف المسار الأسبوعي؛ المهام المنشأة سابقًا لم تتغير.");
        await refreshRecurringTemplates(workspace.organization.id, true);
      }
    } catch (refreshError) {
      setError(getErrorMessage(refreshError));
    } finally {
      setWorking(false);
    }
  }

  async function archiveRecurringTemplate(templates: RecurringTaskTemplate[]) {
    const template = templates[0];
    if (!workspace || !template) return;
    const label = template.content_bundle_title ?? template.title;
    if (!window.confirm(`أرشفة المهمة الأسبوعية «${label}»؟ المهام السابقة ستظل محفوظة.`)) return;
    setWorking(true); setError(null); setNotice(null);
    try {
      let query = getSupabaseBrowserClient()
        .from("recurring_task_templates")
        .update({ archived_at: new Date().toISOString(), paused: true })
        .eq("organization_id", workspace.organization.id);
      query = template.content_bundle_id
        ? query.eq("content_bundle_id", template.content_bundle_id)
        : query.eq("id", template.id).eq("version", template.version);
      const { data: archivedTemplates, error: updateError } = await query.select("id");
      if (updateError) setError(updateError.message);
      else if (!archivedTemplates?.length) {
        setError("تم تعديل المسار الأسبوعي من جلسة أخرى، لذلك لم نؤرشف نسخة قديمة. حمّلنا أحدث البيانات.");
        await refreshRecurringTemplates(workspace.organization.id, true);
      } else {
        setNotice("تمت أرشفة المسار الأسبوعي كاملًا، ولن تُنشأ منه مواعيد جديدة.");
        await refreshRecurringTemplates(workspace.organization.id, true);
      }
    } catch (refreshError) {
      setError(getErrorMessage(refreshError));
    } finally {
      setWorking(false);
    }
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
  const taskCreateOwnerId = newTaskOwnerId || session.user.id;
  const taskCreateOwner = peopleById.get(taskCreateOwnerId);
  const taskCreateTitle = deriveTaskTitle(newTaskTitle, newTaskDescription);
  const recurringTemplateGroups = [...recurringTemplates.reduce((groups, template) => {
    const key = template.content_bundle_id ? `bundle:${template.content_bundle_id}` : `task:${template.id}`;
    groups.set(key, [...(groups.get(key) ?? []), template]);
    return groups;
  }, new Map<string, RecurringTaskTemplate[]>()).entries()].map(([id, templates]) => ({ id, templates }));
  const linkedTask = linkedTaskId ? tasks.find((task) => task.id === linkedTaskId) ?? null : null;
  const linkedLaneId = linkedTaskId ? boardEntries.find((entry) => entry.tasks.some((task) => task.id === linkedTaskId))?.laneId : null;
  const advancedFiltersActive = requesterFilter !== "all" || Boolean(dateRange.from || dateRange.to);
  const personalLaneLabel = taskSection === "archive"
    ? "الأرشيف"
    : filter === "overdue"
      ? "المتأخر عندي"
      : "المطلوب مني الآن";
  const availableLanes = personalView
    ? [{ id: ["completed", "archived"].includes(filter) ? "closed" : "focus", label: personalLaneLabel }]
    : boardLanes;
  const visibleLanes = availableLanes.filter((lane) => {
    if (linkedLaneId === lane.id) return true;
    if (personalView) return boardEntries.some((entry) => entry.laneId === lane.id);
    if (filter === "all" && !advancedFiltersActive) return true;
    return boardEntries.some((entry) => entry.laneId === lane.id);
  });
  const filteredTaskCount = boardEntries.reduce((total, entry) => total + entry.tasks.length, 0);
  const myOpenTaskCount = tasks.filter((task) => taskNeedsViewerAction(task, session.user.id)).length;
  const quickFilters: TaskFilter[] = taskSection === "team" ? ["active", "overdue", "all"] : ["mine", "overdue"];

  function openTaskSection(section: TaskSection) {
    setTaskSection(section);
    setShowCreate(false);
    setRequesterFilter("all");
    setDateRange({ from: "", to: "" });
    if (section === "today") setFilter("mine");
    if (section === "team") setFilter("active");
    if (section === "archive") setFilter("archived");
  }
  return (
    <section className="tasks-workspace">
      <header className="task-command-bar">
        <nav className="task-section-tabs" aria-label="أقسام المهام">
          <button type="button" className={taskSection === "today" ? "active" : ""} aria-current={taskSection === "today" ? "page" : undefined} onClick={() => openTaskSection("today")}><CheckCircle2 size={15} /> اليوم <span>{myOpenTaskCount.toLocaleString("ar-EG")}</span></button>
          {manager ? <button type="button" className={taskSection === "team" ? "active" : ""} aria-current={taskSection === "team" ? "page" : undefined} onClick={() => openTaskSection("team")}><UserRoundCheck size={15} /> شغل الفريق</button> : null}
          <button type="button" className={taskSection === "schedule" ? "active" : ""} aria-current={taskSection === "schedule" ? "page" : undefined} onClick={() => openTaskSection("schedule")}><CalendarClock size={15} /> الجدول الأسبوعي</button>
          <button type="button" className={taskSection === "archive" ? "active" : ""} aria-current={taskSection === "archive" ? "page" : undefined} onClick={() => openTaskSection("archive")}><Archive size={15} /> الأرشيف</button>
        </nav>
        <div className="task-command-actions">
          <button className="icon-button" type="button" aria-label="تحديث المهام" onClick={() => void refreshTasks(workspace.organization.id)}><RefreshCw size={17} /></button>
          {manager && taskSection === "team" ? <Button href="/content?create=reel" variant="secondary"><Film size={15} /> طلب محتوى</Button> : null}
          {manager ? <Button type="button" onClick={() => { resetTaskCreateDraft(); setTaskCreateMode(taskSection === "schedule" ? "weekly" : "once"); setShowCreate(true); }}><Plus size={16} /> إضافة</Button> : null}
        </div>
      </header>

      {notice ? <p className="form-notice success" role="status">{notice}</p> : null}
      {error ? <p className="form-notice error" role="alert">{error}</p> : null}
      {linkedTask ? <p className="direct-link-notice" role="status"><Route size={15} /> تم فتح المهمة المطلوبة مباشرة: <strong>{taskReference(linkedTask.id)}</strong> — الكارت المحدد ظاهر بإطار واضح.</p> : linkedTaskId ? <p className="form-notice error" role="alert">المهمة المطلوبة غير موجودة أو ليست ضمن صلاحيات حسابك.</p> : null}

      {taskSection !== "schedule" && taskSection !== "archive" ? <div className="task-list-toolbar">
        <div className="segmented-control" aria-label="تصفية المهام">{quickFilters.map((value) => <button type="button" key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "mine" ? "المطلوب الآن" : value === "active" ? "المفتوح" : value === "overdue" ? "المتأخر" : "الكل"}</button>)}</div>
        <small role="status">{filteredTaskCount.toLocaleString("ar-EG")} مهمة ظاهرة</small>
      </div> : null}

      {manager && ["team", "archive"].includes(taskSection) ? <details className="panel task-filter-panel">
        <summary><CalendarClock size={16} /> فلترة بالتاريخ وطالب المهمة {advancedFiltersActive ? <StatusBadge tone="info">مفعّلة</StatusBadge> : null}</summary>
        <div className="task-filter-fields" aria-label="فلترة بورد المهام">
          <label className="task-filter-field"><span><UserRoundCheck size={13} aria-hidden="true" /> طالب المهمة</span><select value={requesterFilter} onChange={(event) => setRequesterFilter(event.target.value)}><option value="all">كل طالبي المهام</option>{workspace.people.map((person) => <option value={person.id} key={person.id}>{person.id === session.user.id ? `أنا — ${person.name}` : person.name}</option>)}</select></label>
          <label className="task-filter-field"><span>من تاريخ</span><input type="date" value={dateRange.from} max={dateRange.to || undefined} onChange={(event) => setDateRange((current) => ({ ...current, from: event.target.value }))} /></label>
          <label className="task-filter-field"><span>إلى تاريخ</span><input type="date" value={dateRange.to} min={dateRange.from || undefined} onChange={(event) => setDateRange((current) => ({ ...current, to: event.target.value }))} /></label>
          <button className="task-filter-reset" type="button" disabled={!advancedFiltersActive} onClick={() => { setRequesterFilter("all"); setDateRange({ from: "", to: "" }); }}>مسح الفلاتر</button>
        </div>
      </details> : null}

      {showCreate && manager ? (
        <form ref={taskCreateForm} className="panel task-create-form" onSubmit={createTask} onChange={() => setCapacityWarning(null)}>
          <div className="section-heading"><div><p className="overline">3 خطوات خفيفة</p><h2>إسناد مهمة</h2></div><div className="toolbar-actions"><Button type="button" variant="secondary" onClick={() => window.dispatchEvent(new CustomEvent("workspace-ai:ask", { detail: { question: "راجع تقويم الفريق والمهام المفتوحة، وساعدني أختار مسؤولًا وموعدًا واقعيين للمهمة الجديدة. وضّح أي حمل زائد، ولا تغيّر أي بيانات من نفسك." } }))}><Bot size={14} /> اسأل AI قبل الإسناد</Button><button className="text-button" type="button" onClick={closeTaskCreate}>إغلاق</button></div></div>

          <ol className="task-create-progress" aria-label="خطوات إنشاء المهمة">
            {([
              [1, "المطلوب"],
              [2, "المسؤول والموعد"],
              [3, "المراجعة والحفظ"],
            ] as const).map(([step, label]) => <li className={taskCreateStep === step ? "active" : taskCreateStep > step ? "completed" : ""} aria-current={taskCreateStep === step ? "step" : undefined} key={step}><span aria-hidden="true">{taskCreateStep > step ? "✓" : step}</span><strong>{label}</strong></li>)}
          </ol>

          <fieldset className="task-create-step" hidden={taskCreateStep !== 1}>
            <legend>1 — اكتب المطلوب مرة واحدة</legend>
            <p>الصق نفس الرسالة التي سترسلها في الجروب؛ الشرح والروابط والملفات تظل معًا داخل المهمة.</p>
            <label className="task-create-request"><span>كل المطلوب والروابط</span><textarea name="description" value={newTaskDescription} onChange={(event) => setNewTaskDescription(event.target.value)} required={taskCreateStep === 1} minLength={5} maxLength={5000} rows={9} placeholder="اكتب الطلب كاملًا هنا: المطلوب، التفاصيل، الروابط، وأي ملاحظات مهمة…" /><small>أول سطر سيتحول تلقائيًا إلى عنوان لو تركت الخانة التالية فارغة.</small></label>
            <label><span>عنوان مختصر — اختياري</span><input name="title" value={newTaskTitle} onChange={(event) => setNewTaskTitle(event.target.value)} minLength={3} maxLength={180} placeholder={taskCreateTitle || "يتولد تلقائيًا من أول سطر"} /><small>اكتبه فقط لو تريد اسمًا أقصر للكارت.</small></label>
            <div className="form-actions task-create-step-actions"><Button type="button" onClick={advanceTaskCreate}>التالي: المسؤول والموعد</Button></div>
          </fieldset>

          <fieldset className="task-create-step" hidden={taskCreateStep !== 2}>
            <legend>2 — اختر المسؤول والموعد</legend>
            <p>حدد الشخص ووقت التسليم فقط؛ النظام سيتحقق من حمله قبل الحفظ النهائي.</p>
            <div className="form-grid">
              <label><span>المسؤول المباشر</span><select name="owner_id" value={taskCreateOwnerId} required={taskCreateStep === 2} onChange={(event) => { setNewTaskOwnerId(event.target.value); if (event.target.value === session.user.id) setNewTaskRequiresReview(false); }}>{assignablePeople.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
              <label><span>{taskCreateMode === "weekly" ? "أول موعد أسبوعي" : "الموعد النهائي"}</span><input name="due_at" type="datetime-local" value={newTaskDueAt} required={taskCreateStep === 2} onChange={(event) => setNewTaskDueAt(event.target.value)} /></label>
            </div>
            <div className="task-create-mode" aria-label="نوع المهمة">
              <div className="segmented-control">
                <button type="button" className={taskCreateMode === "once" ? "active" : ""} aria-pressed={taskCreateMode === "once"} onClick={() => { setTaskCreateMode("once"); setCapacityWarning(null); }}>مرة واحدة</button>
                <button type="button" className={taskCreateMode === "weekly" ? "active" : ""} aria-pressed={taskCreateMode === "weekly"} onClick={() => { setTaskCreateMode("weekly"); setCapacityWarning(null); }}><Repeat2 size={13} /> أسبوعية ثابتة</button>
              </div>
              <small>{taskCreateMode === "weekly" ? "اختر أول موعد فقط؛ بعدها ينشئ النظام نسخة واحدة كل أسبوع تلقائيًا." : "مهمة بموعد واحد وتنتهي بعد التسليم."}</small>
            </div>
            <div className="form-actions task-create-step-actions"><Button type="button" variant="ghost" onClick={() => setTaskCreateStep(1)}>السابق</Button><Button type="button" onClick={advanceTaskCreate}>التالي: راجع واحفظ</Button></div>
          </fieldset>

          <fieldset className="task-create-step" hidden={taskCreateStep !== 3}>
            <legend>3 — راجع ثم أكّد الإسناد</legend>
            <p>لن تُحفظ أي بيانات قبل ضغط زر الإسناد النهائي.</p>
            <div className="task-create-review">
              <div><span>عنوان الكارت</span><strong>{taskCreateTitle || "—"}</strong></div>
              <div><span>المسؤول</span><strong>{taskCreateOwner?.name ?? "عضو فريق"}</strong></div>
              <div><span>الموعد</span><strong>{newTaskDueAt ? formatDeadline(newTaskDueAt) : "غير محدد"}</strong></div>
              <div><span>التكرار</span><strong>{taskCreateMode === "weekly" ? "أسبوعية ثابتة" : "مرة واحدة"}</strong></div>
              <div className="task-create-review-request"><span>ملخص المطلوب</span><CollapsibleText text={newTaskDescription} maxCharacters={260} /></div>
            </div>
            <details className="content-request-advanced">
              <summary>خيارات متقدمة — كلها اختيارية</summary>
              <div className="content-request-advanced-body form-grid">
                <label><span>الأولوية</span><select name="priority" defaultValue="normal">{(Object.keys(taskPriorityConfig) as TaskPriority[]).map((priority) => <option value={priority} key={priority}>{taskPriorityConfig[priority].label}</option>)}</select></label>
                <label><span>الوقت المتوقع</span><select name="estimated_minutes" defaultValue="60"><option value="30">30 دقيقة</option><option value="60">ساعة</option><option value="90">ساعة ونصف</option><option value="120">ساعتان</option><option value="180">3 ساعات</option><option value="240">4 ساعات</option><option value="360">6 ساعات</option></select></label>
                {taskCreateMode === "weekly" ? <label><span>تاريخ النهاية — اختياري</span><input name="routine_ends_on" type="date" min={localDatePart(newTaskDueAt)} /></label> : null}
                <label className="full-field"><span>معيار القبول — اختياري</span><textarea name="acceptance_criteria" maxLength={4000} rows={3} placeholder="اكتبه فقط لو النتيجة تحتاج شرطًا واضحًا، مثل المقاس أو صيغة التسليم" /></label>
                <fieldset className="full-field task-review-choice">
                  <legend>هل المهمة تحتاج مراجعة؟</legend>
                  <div className="task-review-option">
                    <input aria-label="تحتاج اعتماد طالب المهمة قبل الإغلاق" type="checkbox" checked={newTaskRequiresReview} disabled={taskCreateOwnerId === session.user.id} onChange={(event) => setNewTaskRequiresReview(event.target.checked)} />
                    <span><strong>تحتاج اعتماد طالب المهمة قبل الإغلاق</strong><small>{taskCreateOwnerId === session.user.id ? "غير متاح عند إسناد المهمة لنفسك." : "العضو يرسلها للمراجعة، وأنت توافق أو تعيدها للتنفيذ."}</small></span>
                  </div>
                  <small>لو لم تفعّل هذا الاختيار، يقدر المسؤول الضغط على «تم التنفيذ» وإغلاق المهمة مباشرة.</small>
                </fieldset>
              </div>
            </details>
            {capacityWarning ? <div className="capacity-decision" role="alert"><AlertTriangle size={18} /><div><strong>المسؤول عليه حمل زائد في هذا اليوم</strong><p>بعد الإسناد سيصبح الحمل {capacityWarning.snapshot.projected_minutes.toLocaleString("ar-EG")} من {capacityWarning.snapshot.daily_capacity_minutes.toLocaleString("ar-EG")} دقيقة، وعدد البنود {capacityWarning.snapshot.projected_count.toLocaleString("ar-EG")} من {capacityWarning.snapshot.max_parallel_tasks.toLocaleString("ar-EG")}.</p><small>غيّر الموعد أو المسؤول، أو أكمل عن قصد.</small></div><div><button className="text-button" type="button" onClick={() => { setCapacityWarning(null); setTaskCreateStep(2); }}>تعديل الإسناد</button><Button type="button" variant="secondary" disabled={working} onClick={() => void persistTask(capacityWarning.submission, true)}>إسناد رغم الضغط</Button></div></div> : null}
            <div className="form-actions task-create-step-actions"><Button type="button" variant="ghost" disabled={working} onClick={() => { setCapacityWarning(null); setTaskCreateStep(2); }}>السابق</Button><Button type="submit" disabled={working}>{working ? <LoaderCircle className="spin" size={16} /> : taskCreateMode === "weekly" ? <Repeat2 size={16} /> : <CheckCircle2 size={16} />} {taskCreateMode === "weekly" ? "حفظ المهمة الأسبوعية" : "إسناد المهمة"}</Button><small>{taskCreateMode === "weekly" ? "سيظهر للعضو موعد حقيقي واحد فقط، وليس قالبًا دائمًا يزحم البورد." : "ستظهر فورًا للمسؤول داخل «مهامي»، وكل تغيير بعدها محفوظ في السجل."}</small></div>
          </fieldset>
        </form>
      ) : null}

      {taskSection === "schedule" && manager ? <WeeklyContentRoutineForm
        organizationId={workspace.organization.id}
        currentUserId={session.user.id}
        people={assignablePeople.map((person) => ({ id: person.id, name: person.name }))}
        onSaved={async () => {
          await Promise.all([
            refreshTasks(workspace.organization.id),
            refreshRecurringTemplates(workspace.organization.id, true),
          ]);
        }}
      /> : null}

      {taskSection === "schedule" && manager ? <details className="panel recurring-task-rules">
        <summary><span><Repeat2 size={16} /><strong>المهام الأسبوعية الثابتة</strong><small>{recurringTemplateGroups.length.toLocaleString("ar-EG")} مسار يعمل من داخل «مهامي»</small></span><span>إدارة</span></summary>
        <div className="recurring-task-rule-list">
          {recurringTemplateGroups.map((group) => {
            const template = group.templates[0];
            if (!template) return null;
            const paused = group.templates.every((item) => item.paused);
            const owners = [...new Set(group.templates.map((item) => peopleById.get(item.owner_id)?.name ?? "عضو فريق"))];
            const errors = [...new Set(group.templates.flatMap((item) => item.last_error ? [item.last_error] : []))];
            return <article key={group.id} data-paused={paused || undefined}>
              <div><strong>{template.content_bundle_title ?? template.title}</strong><small>{template.content_bundle_id ? `${group.templates.length.toLocaleString("ar-EG")} مراحل · ${owners.join("، ")} · النشر كل ${weekdayLabels[template.bundle_anchor_weekday ?? template.weekday]} الساعة ${(template.bundle_anchor_time ?? template.time_local).slice(0, 5)}` : `${owners[0]} · كل ${weekdayLabels[template.weekday]} الساعة ${template.time_local.slice(0, 5)}`}{template.ends_on ? ` · حتى ${template.ends_on}` : ""}</small></div>
              <StatusBadge tone={paused ? "neutral" : "success"}>{paused ? "متوقف" : "يعمل"}</StatusBadge>
              <div className="recurring-task-rule-actions"><button className="text-button" type="button" disabled={working} onClick={() => void toggleRecurringTemplate(group.templates)}>{paused ? <Repeat2 size={12} /> : <CirclePause size={12} />} {paused ? "تشغيل" : "إيقاف"}</button><button className="text-button danger-text" type="button" disabled={working} onClick={() => void archiveRecurringTemplate(group.templates)}>أرشفة</button></div>
              {errors.map((message) => <small className="recurring-task-error" key={message}>تحتاج مراجعة: {message}</small>)}
            </article>;
          })}
          {!recurringTemplateGroups.length ? <div className="task-filter-empty"><Repeat2 size={22} /><div><strong>لا توجد مهام أسبوعية بعد</strong><p>مثل: لايف أيمن كل أربعاء، أو تسليم ريل ثابت كل سبت. أنشئها مرة واحدة وستظهر تلقائيًا في موعدها.</p></div><button className="text-button" type="button" onClick={() => { resetTaskCreateDraft(); setTaskCreateMode("weekly"); setShowCreate(true); }}>إنشاء أول مهمة أسبوعية</button></div> : null}
        </div>
      </details> : null}

      {taskSection === "schedule" ? <TaskScheduleCalendar organizationId={workspace.organization.id} currentUserId={session.user.id} manager={manager} people={assignablePeople.map((person) => ({ id: person.id, name: person.name }))} tasks={tasks} /> : visibleLanes.length ? <div className={`kanban-board task-${taskSection}-board`} aria-label={personalView ? "مهامي" : "بورد مهام الفريق"}>
        {visibleLanes.map((lane) => {
          const laneEntries = boardEntries.filter((entry) => entry.laneId === lane.id);
          const laneTone = lane.id === "blocked" ? "danger" : lane.id === "review" ? "warning" : lane.id === "closed" ? "success" : "info";
          return (
            <section className="kanban-column" key={lane.id} aria-labelledby={`column-${lane.id}`}>
              <header><StatusBadge tone={laneTone}>{lane.label}</StatusBadge><strong id={`column-${lane.id}`}>{laneEntries.length}</strong></header>
              <div className="kanban-stack">
                {laneEntries.map((entry) => {
                  if (entry.contentItemId) {
                    const overdueTasks = entry.tasks.filter((task) => isOverdue(task, renderNow));
                    const completedTasks = entry.tasks.filter(taskIsCompleted).length;
                    const progress = Math.round((completedTasks / entry.tasks.length) * 100);
                    return <article className={`task-card content-workflow-group ${overdueTasks.length ? "task-overdue" : ""} ${completedTasks === entry.tasks.length ? "task-closed" : ""}`} data-state={lane.id} key={entry.id}>
                      <div className="task-card-top"><span className="workflow-task-label"><Film size={12} /> طلب محتوى · {entry.tasks.length} مراحل</span><StatusBadge tone={lane.id === "blocked" ? "danger" : lane.id === "review" ? "warning" : completedTasks === entry.tasks.length ? "success" : "info"}>{completedTasks === entry.tasks.length ? "اكتمل" : lane.label}</StatusBadge></div>
                      <div className="content-workflow-heading"><h3>{contentGroupTitle(entry.tasks[0])}</h3>{!personalView ? <a className="task-production-link" href={`/content?content=${entry.contentItemId}#content-${entry.contentItemId}`}><FileText size={12} /> ملف الطلب الكامل</a> : null}</div>
                      <div className="content-workflow-progress">
                        <div><span>التقدم</span><strong>{progress}%</strong></div>
                        <span className="content-workflow-progress-track" role="progressbar" aria-label="نسبة تقدم ملف المحتوى" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></span>
                      </div>
                      {overdueTasks.length ? <span className="overdue-label"><AlertTriangle size={14} /> {overdueTasks.length} خطوة متأخرة — الأقدم منذ {formatOverdueDuration(overdueTasks.sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime())[0], renderNow)}</span> : null}
                      <div className="content-workflow-subtasks">{entry.tasks.map((task, index) => {
                        const owner = peopleById.get(task.owner_id);
                        const completed = taskIsCompleted(task);
                        const closed = taskIsClosed(task);
                        const isAssignedToViewer = task.owner_id === session.user.id;
                        const isMine = isAssignedToViewer && !closed;
                        const isRequester = task.created_by === session.user.id;
                        const canOpenAction = task.status === "review"
                          ? isRequester || platformAdmin
                          : isAssignedToViewer;
                        const canOpenDetails = isAssignedToViewer || isRequester || platformAdmin;
                        const canRequestRevisionShortcut = !isAssignedToViewer
                          && !readOnly
                          && (isRequester || platformAdmin)
                          && Boolean(task.content_step && contentStepsSupportingRevision.has(task.content_step))
                          && ["review", "done"].includes(task.status);
                        const actionLabel = task.status === "review"
                          ? canOpenAction ? "فتح للمراجعة والاعتماد" : "بانتظار مراجعة طالب المهمة"
                          : task.status === "cancelled"
                            ? "فتح المهمة الملغاة"
                            : task.content_step === "publishing"
                            ? "فتح وتأكيد النشر"
                            : completed ? "فتح التسليم" : "فتح وتنفيذ مرحلتي";
                        const actionHref = isAssignedToViewer && task.status === "in_progress"
                          ? taskDeliveryDeepLink(task.id)
                          : taskDeepLink(task.id);
                        const className = [isOverdue(task, renderNow) ? "overdue" : "", task.status === "blocked" ? "blocked" : "", completed ? "completed" : "", isMine ? "mine" : ""].filter(Boolean).join(" ");
                        const directTarget = linkedTaskId === task.id;
                        return <section className={className} data-direct-target={directTarget || undefined} id={taskDomId(task.id)} tabIndex={directTarget ? -1 : undefined} key={task.id}>
                          <div className="content-subtask-copy">
                            <span className="content-subtask-marker" aria-label={completed ? "مكتملة" : `الخطوة ${index + 1}`}>{completed ? <CheckCircle2 size={16} /> : index + 1}</span>
                            <div><strong>{task.content_step ? contentStepConfig[task.content_step].label : task.title}</strong><small>{owner?.name ?? "عضو فريق"} · {formatDeadline(task.due_at)}{isMine ? <b> · مهمتك الآن</b> : null}</small>{directTarget ? <span className="direct-target-label"><Route size={11} /> دي المهمة المطلوبة</span> : null}</div>
                          </div>
                          <div className="content-subtask-action">
                            <StatusBadge tone={taskStatusConfig[task.status].tone}>{taskStatusLabel(task.status, task.content_step)}</StatusBadge>
                            {canOpenDetails && task.status !== "backlog"
                              ? <a href={actionHref}><FileText size={12} /> {actionLabel}</a>
                              : !completed ? <small>{task.status === "backlog" ? "تفتح تلقائيًا بعد الخطوة السابقة" : "هذه المرحلة عند صاحبها"}</small> : null}
                            {canRequestRevisionShortcut ? <a className="content-subtask-revision" href={`${taskDeepLink(task.id)}?action=revise#revision`}><MessageSquareText size={12} /> طلب تعديل</a> : null}
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
                  const directOptions = options.filter((option) => !["review", "done"].includes(option));
                  const primaryDirectOption = directOptions.find((option) => option !== "blocked") ?? directOptions[0];
                  const approvalOptions = task.status === "review"
                    ? options.filter((option) => option === "done")
                    : [];
                  const canMove = !task.crm_contact_id && (directOptions.length > 0 || approvalOptions.length > 0);
                  const canDeliverFromTask = isAssignee
                    && task.status === "in_progress"
                    && !task.crm_contact_id
                    && !task.launch_id
                    && !task.launch_deliverable_id;
                  const requester = peopleById.get(task.created_by);
                  const canRequestRevisionShortcut = !isAssignee
                    && (isRequester || platformAdmin)
                    && !task.launch_id
                    && !task.launch_deliverable_id
                    && !task.crm_contact_id
                    && task.status !== "cancelled"
                    && task.status !== "backlog";
                  return (
                    <article className={`task-card ${isOverdue(task, renderNow) ? "task-overdue" : ""} ${taskIsCompleted(task) ? "task-closed" : ""}`} data-priority={task.priority} data-status={task.status} data-direct-target={linkedTaskId === task.id || undefined} id={taskDomId(task.id)} tabIndex={linkedTaskId === task.id ? -1 : undefined} key={task.id}>
                      <div className="task-card-top">{!personalView || ["high", "urgent"].includes(task.priority) ? <span className={`priority priority-${task.priority}`}>{taskPriorityConfig[task.priority].mark} {taskPriorityConfig[task.priority].label}</span> : null}<StatusBadge tone={taskStatusConfig[task.status].tone}>{taskStatusLabel(task.status, task.content_step)}</StatusBadge><small className="task-reference">{taskReference(task.id)}</small></div>
                      {linkedTaskId === task.id ? <span className="direct-target-label"><Route size={11} /> دي المهمة المطلوبة</span> : null}
                      {task.content_step ? <span className="workflow-task-label"><Film size={12} /> محتوى · {contentStepConfig[task.content_step].label}</span> : null}
                      {task.launch_gate ? <span className="workflow-task-label launch-task-label"><Route size={12} /> إطلاق · {launchGateConfig[task.launch_gate].label}</span> : null}
                      {task.launch_deliverable_id ? <span className="workflow-task-label launch-task-label"><Route size={12} /> إطلاق · بند تنفيذي</span> : null}
                      {task.recurring_template_id ? <span className="workflow-task-label recurring-task-label"><Repeat2 size={12} /> أسبوعية ثابتة</span> : null}
                      {task.launch_deliverable_id ? <a className="task-production-link" href={`/campaigns?deliverable=${task.launch_deliverable_id}#deliverable-${task.launch_deliverable_id}`}><FileText size={12} /> فتح التفاصيل وتسليم النتيجة</a> : null}
                      {task.crm_contact_id ? <span className="workflow-task-label crm-task-label"><ContactRound size={12} /> CRM · متابعة عميل</span> : null}
                      <h3>{task.title}</h3>
                      <div className="task-card-summary"><span><CircleUserRound size={13} /> {!personalView ? owner?.name ?? "عضو فريق" : `طلبها ${requester?.name ?? "عضو فريق"}`}</span><span><CalendarClock size={13} /> {formatDeadline(task.due_at)}</span>{task.requires_review ? <span><ShieldCheck size={13} /> بمراجعة</span> : null}</div>
                      {isOverdue(task, renderNow) ? <span className="overdue-label"><AlertTriangle size={14} /> متأخرة منذ {formatOverdueDuration(task, renderNow)}</span> : null}
                      {task.crm_contact_id
                        ? <Button href={`/crm/${task.crm_contact_id}`}><ContactRound size={14} /> فتح العميل وتسجيل النتيجة</Button>
                        : <>
                          {canDeliverFromTask ? <div className="form-actions task-completion-actions task-card-actions" aria-label="إنهاء المهمة">
                            <Button href={taskDeliveryDeepLink(task.id)}>
                              <CheckCircle2 size={16} /> {task.content_step === "publishing" ? "تم النشر — أضف الرابط" : "تم تنفيذ المهمة — أضف التسليم"}
                            </Button>
                            <Button href={taskDeepLink(task.id)} variant="secondary"><FileText size={14} /> فتح التفاصيل</Button>
                          </div> : canMove ? <div className="form-actions task-card-actions" aria-label="الإجراء التالي">
                            {approvalOptions.length ? <Button href={taskDeepLink(task.id)}><FileText size={14} /> مراجعة التسليم</Button> : primaryDirectOption ? <Button type="button" disabled={working} onClick={() => void changeStatus(task, primaryDirectOption)}>{personalActionLabel(task, primaryDirectOption)}</Button> : null}
                            <Button href={taskDeepLink(task.id)} variant="secondary"><FileText size={14} /> فتح التفاصيل</Button>
                          </div> : <a className="task-open-link" href={taskDeepLink(task.id)}><FileText size={13} /> فتح تفاصيل المهمة</a>}
                          {canRequestRevisionShortcut ? <a className="task-revision-shortcut" href={`${taskDeepLink(task.id)}?action=revise#revision`}><MessageSquareText size={13} /> طلب تعديل</a> : null}
                        </>}
                    </article>
                  );
                })}
                {!laneEntries.length ? <div className="column-empty"><span>—</span><p>لا توجد مهام</p></div> : null}
              </div>
            </section>
          );
        })}
      </div> : <div className="task-filter-empty" role="status"><CalendarClock size={24} /><div><strong>{taskSection === "archive" ? "الأرشيف فارغ" : personalView ? "لا يوجد شيء مطلوب منك الآن" : "لا توجد مهام مطابقة"}</strong><p>{taskSection === "archive" ? "المهام المكتملة والملغاة ستظهر هنا تلقائيًا." : personalView ? "عندما تُسند إليك مهمة ستظهر هنا مع موعدها وزر الإجراء التالي." : "غيّر الحالة أو الفترة الزمنية أو طالب المهمة لعرض نتائج أخرى."}</p></div>{taskSection !== "today" ? <button className="text-button" type="button" onClick={() => openTaskSection("today")}>العودة إلى اليوم</button> : manager ? <button className="text-button" type="button" onClick={() => openTaskSection("team")}>فتح شغل الفريق</button> : null}</div>}
    </section>
  );
}
