export type ReportRecipient = { user_id: string; scope: "team" | "self"; telegram: boolean };
export type ReportSettings = {
  daily_enabled: boolean; weekly_enabled: boolean; delivery_hour: number; weekly_day: number;
  included_users: string[]; recipients: ReportRecipient[]; revision: number; scheduler_available?: boolean;
};
export type ReportMember = {
  user_id: string; name: string; metrics: Record<string, number>; presence_days: number;
  first_seen: string | null; last_seen: string | null; last_activity: string | null; overdue_now: number; auto_published: number;
};
export type TeamActivityReport = {
  start: string; end: string; generated_at: string; presence_since: string; partial: boolean; members: ReportMember[];
};
export type SavedTeamReport = { id: string; scope: "team" | "self"; cadence: "daily" | "weekly"; period_start: string; period_end: string; created_at: string };
export const reportMetrics: Record<string, string> = {
  tasks_created: "مهام أنشأها", deliveries: "مهام سلّمها", completed: "مهامه التي اكتملت",
  publishing_deliveries: "تسليمات نشر مسجّلة", content_created: "طلبات محتوى أنشأها", scripts_created: "سكريبتات جديدة",
  scripts_edited: "سكريبتات عدّلها", crm_added: "عملاء أضافهم", followups: "عملاء تابعهم",
  purchases_recorded: "عملاء سجّل مشترياتهم", comments: "تعليقات ورسائل", scheduled: "جداول نشر أعدّها",
  revisions: "طلبات تعديل", rescheduled: "مواعيد محتوى عدّلها",
};
export function cairoReportDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function shiftReportDay(day: string, amount: number) {
  const date = new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10);
}
export function reportTime(value: string | null) {
  return value ? new Intl.DateTimeFormat("ar-EG", { timeZone: "Africa/Cairo", dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "لا يوجد سجل";
}
export function attendanceLabel(member: ReportMember, report: TeamActivityReport) {
  if (member.presence_days) return `ظهر على المنصة في ${member.presence_days} يوم`;
  if (report.start <= cairoReportDay(new Date(report.presence_since))) return "سجل الحضور لا يغطي الفترة كاملة";
  return "لا يوجد ظهور مسجّل في الفترة";
}
