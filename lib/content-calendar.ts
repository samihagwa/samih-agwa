import type { Tables } from "./supabase/database.types";

export const CALENDAR_ZONE = "Africa/Cairo";
export type CalendarSource = "content" | "plan";
export type CalendarSlot = {
  id: string; organization_id: string; content_item_id: string | null; plan_item_id: string | null;
  platform: string; scheduled_at: string | null; revision: number; updated_at: string;
  completed_at?: string | null; completed_by?: string | null;
};
export type CalendarEntry = {
  key: string; source: CalendarSource; sourceId: string; platform: string; scheduledAt: string | null;
  revision: number; title: string; kind: string; status: string; ownerId: string; product: string;
  contentId: string | null; planId: string | null; editable: boolean;
  brief?: string; members?: CalendarEntry[];
  completedAt?: string | null;
};
type Content = Tables<"content_items">;
type PlanItem = Tables<"content_plan_items">;
type Plan = Tables<"content_plans">;

export function calendarWall(value: string | Date) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: CALENDAR_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (key: string) => parts.find((part) => part.type === key)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

// Resolve Cairo wall time independently of the browser's timezone. Reject DST
// gaps instead of silently moving an event to a different hour.
export function calendarInstant(wall: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wall)) return null;
  const utc = Date.parse(`${wall}:00Z`);
  if (!Number.isFinite(utc)) return null;
  const candidates = [3, 2].map((offset) => new Date(utc - offset * 3_600_000));
  return candidates.find((candidate) => calendarWall(candidate) === wall)?.toISOString() ?? null;
}
export function calendarDay(value: string | Date) { return calendarWall(value).slice(0, 10); }
// The calendar is day-only. Keep existing clock metadata for compatibility with
// linked publishing records, but never ask the team to commit to an hour.
export function calendarDateInstant(day: string, previous: string | null = null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  if (previous && calendarDay(previous) === day) return new Date(previous).toISOString();
  const clock = previous ? calendarWall(previous).slice(11, 16) : "12:00";
  return calendarInstant(`${day}T${clock}`) ?? calendarInstant(`${day}T12:00`);
}
// Intake selects a Cairo calendar day, not a browser-local publish hour.
export function contentRequestDate(day: string, now = new Date()) {
  const instant = calendarDateInstant(day);
  if (!instant || day < calendarDay(now)) return null;
  return instant;
}
export function addCalendarDays(day: string, count: number) {
  const date = new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + count); return date.toISOString().slice(0, 10);
}
export function calendarWeek(day: string) { return addCalendarDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 1) % 7)); }
export function calendarMonthDays(day: string) {
  const first = `${day.slice(0, 7)}-01`;
  const start = calendarWeek(first);
  return Array.from({ length: 42 }, (_, index) => addCalendarDays(start, index));
}
export function calendarDateLabel(day: string, options: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" }) {
  return new Intl.DateTimeFormat("ar-EG", { ...options, timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
}
export function calendarEntries(contents: Content[], items: PlanItem[], plans: Plan[], slots: CalendarSlot[]): CalendarEntry[] {
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const linked = new Map(items.filter((item) => item.content_item_id).map((item) => [item.content_item_id!, item]));
  const slotByKey = new Map(slots.map((slot) => [`${slot.content_item_id ? "content" : "plan"}:${slot.content_item_id ?? slot.plan_item_id}:${slot.platform.toLowerCase()}`, slot]));
  const result: CalendarEntry[] = [];
  const append = (source: CalendarSource, item: Content | PlanItem, planItem?: PlanItem) => {
    const plan = planById.get(planItem?.plan_id ?? "");
    if (item.status === "cancelled" || plan?.status === "archived") return;
    const platforms = [...new Set(item.platforms.map((platform) => platform.trim().toLowerCase()).filter(Boolean))];
    for (const platform of platforms) {
      const key = `${source}:${item.id}:${platform}`;
      const slot = slotByKey.get(key);
      result.push({ key, source, sourceId: item.id, platform, scheduledAt: slot ? slot.scheduled_at : item.publish_at,
        revision: slot?.revision ?? 0, completedAt: slot?.completed_at ?? null, title: item.title, kind: "format" in item ? item.format : item.kind,
        status: item.status, ownerId: "owner_id" in item ? item.owner_id : item.created_by,
        product: plan?.offer?.trim() || plan?.name || "بدون خطة", contentId: source === "content" ? item.id : null,
        planId: plan?.id ?? null, editable: item.status !== "published",
        brief: "objective" in item ? item.objective : item.editing_brief || item.copy_brief });
    }
  };
  contents.forEach((content) => append("content", content, linked.get(content.id)));
  items.filter((item) => !item.content_item_id).forEach((item) => append("plan", item, item));
  return result.sort((a, b) => (a.scheduledAt ? calendarDay(a.scheduledAt) : "9999").localeCompare(b.scheduledAt ? calendarDay(b.scheduledAt) : "9999") || a.title.localeCompare(b.title, "ar") || a.key.localeCompare(b.key));
}
export function calendarIsComplete(entry: CalendarEntry): boolean {
  return (entry.members ?? [entry]).every(member => member.status === "published" || Boolean(member.completedAt));
}
export function calendarState(entry: CalendarEntry) {
  if (entry.status === "published") return { label: "منشور", tone: "success" as const };
  if (calendarIsComplete(entry)) return { label: "تم", tone: "success" as const };
  if (entry.status === "scheduled") return { label: "جاهز للنشر", tone: "success" as const };
  if (["production", "review", "in_production"].includes(entry.status)) return { label: "قيد التجهيز", tone: "warning" as const };
  return { label: "مخطط", tone: "neutral" as const };
}
// Group only the same source on the same Cairo day. Never merge unrelated
// content with matching titles or hide a platform scheduled on another day.
export function groupCalendarEntries(entries: CalendarEntry[]): CalendarEntry[] {
  const groups = new Map<string, CalendarEntry>();
  for (const entry of entries) {
    const key = `${entry.source}:${entry.sourceId}:${entry.scheduledAt ? calendarDay(entry.scheduledAt) : "unscheduled"}`;
    const group = groups.get(key);
    if (group) group.members!.push(entry);
    else groups.set(key, { ...entry, members: [entry] });
  }
  return [...groups.values()];
}
export function calendarError(error: unknown) {
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : "";
  if (/changed|revision/i.test(message)) return "الموعد اتغيّر بواسطة عضو آخر. حدّث التقويم قبل المحاولة مرة أخرى.";
  if (/period/i.test(message)) return "هذا الموعد خارج فترة الخطة. عدّل فترة الخطة أولًا من إدارة الخطط.";
  if (/published|closed/i.test(message)) return "المحتوى منشور أو مغلق؛ لا يمكن نقل موعده.";
  if (/permission|denied|authenticated|access/i.test(message)) return "حسابك غير مسموح له بتعديل مواعيد هذا المحتوى.";
  if (/time|date/i.test(message)) return "اختار يومًا صالحًا للنشر.";
  return "تعذّر حفظ الموعد. لم ننقل الكارت؛ جرّب تحديث التقويم.";
}
