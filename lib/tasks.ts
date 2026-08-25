import type { Database } from "./supabase/database.types";

export type TaskStatus = Database["public"]["Enums"]["task_status"];
export type TaskPriority = Database["public"]["Enums"]["task_priority"];
type ContentStep = Database["public"]["Enums"]["content_step"];

export const taskStatusConfig: Record<
  TaskStatus,
  { label: string; shortLabel: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }
> = {
  backlog: { label: "تنتظر خطوة سابقة", shortLabel: "تنتظر سابقًا", tone: "neutral" },
  ready: { label: "مطلوب تنفيذها", shortLabel: "مطلوب", tone: "info" },
  in_progress: { label: "جاري العمل عليها", shortLabel: "جاري", tone: "info" },
  review: { label: "قيد المراجعة", shortLabel: "مراجعة", tone: "warning" },
  blocked: { label: "متوقفة", shortLabel: "متوقفة", tone: "danger" },
  done: { label: "مكتملة", shortLabel: "تمت", tone: "success" },
  cancelled: { label: "ملغاة", shortLabel: "ملغاة", tone: "neutral" },
};

export const taskPriorityConfig: Record<TaskPriority, { label: string; mark: string }> = {
  low: { label: "منخفضة", mark: "↓" },
  normal: { label: "عادية", mark: "•" },
  high: { label: "مرتفعة", mark: "↑" },
  urgent: { label: "عاجلة", mark: "!!" },
};

const publishingStatusLabels: Record<TaskStatus, string> = {
  backlog: "ينتظر الاعتماد النهائي",
  ready: "جاهز للنشر",
  in_progress: "جاري النشر",
  review: "بانتظار تأكيد النشر",
  blocked: "النشر متوقف",
  done: "تم النشر",
  cancelled: "النشر ملغي",
};

export function taskStatusLabel(status: TaskStatus, contentStep?: ContentStep | null) {
  return contentStep === "publishing" ? publishingStatusLabels[status] : taskStatusConfig[status].label;
}

type TaskTransitionContext = {
  status: TaskStatus;
  requiresReview: boolean;
  isAssignee: boolean;
  isRequester: boolean;
  role: Database["public"]["Enums"]["app_role"] | null;
};

export function allowedTaskTransitionsForActor({
  status,
  requiresReview,
  isAssignee,
  isRequester,
  role,
}: TaskTransitionContext): TaskStatus[] {
  const platformAdmin = canManageAllTaskExecution(role);

  if (status === "review" && requiresReview) {
    if (isAssignee) return [];
    return isRequester || platformAdmin ? ["done", "in_progress"] : [];
  }

  if (!isAssignee && !platformAdmin) return [];

  if (status === "backlog") return platformAdmin ? ["ready", "cancelled"] : [];
  if (status === "ready") return platformAdmin ? ["in_progress", "cancelled"] : ["in_progress"];
  if (status === "in_progress") {
    const completion: TaskStatus = requiresReview ? "review" : "done";
    return platformAdmin ? [completion, "blocked", "cancelled"] : [completion, "blocked"];
  }
  if (status === "blocked") return platformAdmin ? ["in_progress", "cancelled"] : ["in_progress"];
  if (status === "review") return ["done", "in_progress"];
  if (status === "done") return platformAdmin ? ["in_progress"] : [];
  return platformAdmin ? ["backlog"] : [];
}

export function taskTransitionLabel(currentStatus: TaskStatus, nextStatus: TaskStatus) {
  if (nextStatus === "in_progress") {
    return currentStatus === "review" ? "إرجاع للتنفيذ" : currentStatus === "blocked" ? "استئناف التنفيذ" : "بدء التنفيذ";
  }
  if (nextStatus === "review") return "تم التنفيذ — إرسال للمراجعة";
  if (nextStatus === "done") return currentStatus === "review" ? "اعتماد وإغلاق المهمة" : "تم التنفيذ";
  if (nextStatus === "blocked") return "إيقاف مؤقت";
  if (nextStatus === "cancelled") return "إلغاء المهمة";
  if (nextStatus === "ready") return "إتاحة للتنفيذ";
  if (nextStatus === "backlog") return "إعادة للانتظار";
  return "تحديث الحالة";
}

export const visibleBoardStatuses: TaskStatus[] = [
  "backlog",
  "ready",
  "in_progress",
  "review",
  "blocked",
  "done",
  "cancelled",
];

export function canManageTasks(role: Database["public"]["Enums"]["app_role"] | null) {
  return role === "owner" || role === "admin" || role === "manager";
}

export function canManageAllTaskExecution(role: Database["public"]["Enums"]["app_role"] | null) {
  return role === "owner" || role === "admin";
}
