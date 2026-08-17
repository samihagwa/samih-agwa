import type { Database } from "./supabase/database.types";

export type ContentStatus = Database["public"]["Enums"]["content_status"];
export type ContentStep = Database["public"]["Enums"]["content_step"];
export type ContentAssetKind = Database["public"]["Enums"]["content_asset_kind"];
export type ContentRevisionStatus = Database["public"]["Enums"]["content_revision_status"];

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
  recording: { label: "تسجيل", order: 2 },
  editing: { label: "مونتاج", order: 3 },
  thumbnail: { label: "غلاف", order: 4 },
  caption: { label: "كابشن", order: 5 },
  approval: { label: "اعتماد", order: 6 },
  publishing: { label: "نشر", order: 7 },
};

export const contentSteps = (Object.keys(contentStepConfig) as ContentStep[]).sort(
  (a, b) => contentStepConfig[a].order - contentStepConfig[b].order,
);

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
