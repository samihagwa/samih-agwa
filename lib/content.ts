import type { Database } from "./supabase/database.types";

export type ContentStatus = Database["public"]["Enums"]["content_status"];
export type ContentFormat = Database["public"]["Enums"]["content_format"];
export type ContentStep = Database["public"]["Enums"]["content_step"];
export type ContentAssetKind = Database["public"]["Enums"]["content_asset_kind"];
export type ContentRevisionStatus = Database["public"]["Enums"]["content_revision_status"];
export type ContentCueKind = Database["public"]["Enums"]["content_cue_kind"];

export const contentStatusConfig: Record<
  ContentStatus,
  { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }
> = {
  planned: { label: "مخطط", tone: "neutral" },
  production: { label: "قيد الإنتاج", tone: "info" },
  review: { label: "مراجعة نهائية", tone: "warning" },
  scheduled: { label: "جاهز للنشر", tone: "success" },
  published: { label: "منشور", tone: "success" },
  cancelled: { label: "ملغي", tone: "danger" },
};

export const contentStepConfig: Record<ContentStep, { label: string; order: number }> = {
  brief: { label: "Brief", order: 1 },
  recording: { label: "مادة خام / تسجيل", order: 2 },
  editing: { label: "مونتاج", order: 3 },
  thumbnail: { label: "غلاف", order: 4 },
  caption: { label: "كابشن", order: 5 },
  design: { label: "تصميم", order: 6 },
  approval: { label: "اعتماد", order: 7 },
  scheduling: { label: "جدولة", order: 8 },
  publishing: { label: "نشر", order: 9 },
};

export const contentSteps = (Object.keys(contentStepConfig) as ContentStep[]).sort(
  (a, b) => contentStepConfig[a].order - contentStepConfig[b].order,
);

export const reelContentSteps: ContentStep[] = [
  "recording", "editing", "thumbnail", "publishing",
];

export const socialPostContentSteps: ContentStep[] = [
  "caption", "design", "publishing",
];

export function contentWorkflowSteps(format: ContentFormat) {
  return format === "post" ? socialPostContentSteps : reelContentSteps;
}

export function contentRevisionSteps(format: ContentFormat) {
  return format === "post"
    ? (["caption", "design"] as ContentStep[])
    : (["recording", "editing", "thumbnail", "caption"] as ContentStep[]);
}

export const contentAssignmentFields: Array<{ step: ContentStep; name: string; label: string }> = [
  { step: "recording", name: "content_creator_id", label: "صانع المحتوى + الكابشن" },
  { step: "editing", name: "editing_owner_id", label: "المونتاج" },
  { step: "thumbnail", name: "thumbnail_owner_id", label: "تصميم الغلاف" },
  { step: "publishing", name: "publishing_owner_id", label: "النشر" },
];

export const contentAssetKindConfig: Record<ContentAssetKind, { label: string }> = {
  raw_video: { label: "المادة الخام" },
  source: { label: "المصدر الأساسي" },
  b_roll: { label: "B-roll" },
  image: { label: "صورة مستخدمة" },
  audio: { label: "موسيقى أو صوت" },
  reference: { label: "مرجع بصري" },
  draft_video: { label: "نسخة مونتاج للمراجعة" },
  thumbnail: { label: "تصميم الغلاف" },
  caption: { label: "الكابشن" },
  final_export: { label: "النسخة النهائية" },
};

export const contentRevisionStatusConfig: Record<
  ContentRevisionStatus,
  { label: string; tone: "neutral" | "info" | "success" | "warning" }
> = {
  requested: { label: "مطلوب تنفيذها", tone: "warning" },
  in_progress: { label: "قيد التعديل", tone: "info" },
  resolved: { label: "تم تنفيذها", tone: "success" },
  cancelled: { label: "ملغاة", tone: "neutral" },
};

export const contentCueKindConfig: Record<ContentCueKind, { label: string }> = {
  cut: { label: "حذف وقص" },
  visual: { label: "حركة بصرية" },
  text: { label: "كتابة على الشاشة" },
  audio: { label: "صوت وموسيقى" },
  review: { label: "مراجعة" },
  note: { label: "ملاحظة تنفيذ" },
};
