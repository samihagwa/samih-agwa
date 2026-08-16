import type { Database } from "./supabase/database.types";

export type TaskStatus = Database["public"]["Enums"]["task_status"];
export type TaskPriority = Database["public"]["Enums"]["task_priority"];

export const taskStatusConfig: Record<
  TaskStatus,
  { label: string; shortLabel: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }
> = {
  backlog: { label: "قائمة الانتظار", shortLabel: "انتظار", tone: "neutral" },
  ready: { label: "جاهزة للبدء", shortLabel: "جاهزة", tone: "info" },
  in_progress: { label: "قيد التنفيذ", shortLabel: "تنفيذ", tone: "info" },
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

export const allowedTaskTransitions: Record<TaskStatus, TaskStatus[]> = {
  backlog: ["ready", "cancelled"],
  ready: ["backlog", "in_progress", "cancelled"],
  in_progress: ["ready", "review", "blocked", "cancelled"],
  blocked: ["ready", "in_progress", "cancelled"],
  review: ["in_progress", "blocked", "done"],
  done: ["in_progress"],
  cancelled: ["backlog"],
};

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
