import type { Database } from "./supabase/database.types";

export type LaunchType = Database["public"]["Enums"]["launch_type"];
export type LaunchStatus = Database["public"]["Enums"]["launch_status"];
export type LaunchGate = Database["public"]["Enums"]["launch_gate"];

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export const launchTypeConfig: Record<LaunchType, { label: string }> = {
  webinar: { label: "ويبنار" },
  course: { label: "كورس" },
  service: { label: "خدمة" },
  book: { label: "كتاب" },
  indicator: { label: "مؤشر" },
};

export const launchStatusConfig: Record<LaunchStatus, { label: string; tone: Tone }> = {
  planning: { label: "تخطيط", tone: "neutral" },
  production: { label: "تجهيز", tone: "info" },
  review: { label: "قرار Go / No-Go", tone: "warning" },
  ready: { label: "جاهز للإطلاق", tone: "success" },
  live: { label: "الإطلاق مباشر", tone: "info" },
  completed: { label: "مكتمل", tone: "success" },
  cancelled: { label: "ملغي", tone: "danger" },
};

export const launchGateConfig: Record<
  LaunchGate,
  { label: string; shortLabel: string; order: number }
> = {
  strategy: { label: "الاستراتيجية", shortLabel: "استراتيجية", order: 1 },
  offer: { label: "العرض", shortLabel: "العرض", order: 2 },
  registration: { label: "التسجيل والشراء", shortLabel: "التسجيل", order: 3 },
  delivery: { label: "جاهزية التسليم", shortLabel: "التسليم", order: 4 },
  promotion: { label: "خطة الترويج", shortLabel: "الترويج", order: 5 },
  tracking: { label: "التتبع والأرقام", shortLabel: "التتبع", order: 6 },
  go_no_go: { label: "قرار Go / No-Go", shortLabel: "Go / No-Go", order: 7 },
  launch_day: { label: "تشغيل الإطلاق", shortLabel: "الإطلاق", order: 8 },
};

export const launchGates = (Object.keys(launchGateConfig) as LaunchGate[]).sort(
  (a, b) => launchGateConfig[a].order - launchGateConfig[b].order,
);
