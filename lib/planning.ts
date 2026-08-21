import type { Enums } from "./supabase/database.types";

export type ContentPlanStatus = Enums<"content_plan_status">;
export type ContentPlanItemKind = Enums<"content_plan_item_kind">;
export type ContentPlanItemStatus = Enums<"content_plan_item_status">;

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export const contentPlanStatusConfig: Record<ContentPlanStatus, { label: string; tone: Tone }> = {
  draft: { label: "مسودة", tone: "neutral" },
  active: { label: "الخطة الفعّالة", tone: "success" },
  completed: { label: "مكتملة", tone: "info" },
  archived: { label: "مؤرشفة", tone: "neutral" },
};

export const contentPlanItemStatusConfig: Record<ContentPlanItemStatus, { label: string; tone: Tone }> = {
  idea: { label: "فكرة", tone: "neutral" },
  planned: { label: "مخطط", tone: "info" },
  in_production: { label: "قيد الإنتاج", tone: "warning" },
  scheduled: { label: "مجدول", tone: "success" },
  published: { label: "منشور", tone: "success" },
  cancelled: { label: "ملغي", tone: "danger" },
};

export const contentPlanItemKindConfig: Record<ContentPlanItemKind, { label: string }> = {
  reel: { label: "ريلز" },
  social_post: { label: "بوست سوشيال" },
  story: { label: "ستوري" },
  telegram_post: { label: "بوست Telegram" },
  email: { label: "رسالة بريد" },
  ad: { label: "إعلان" },
  live: { label: "بث مباشر" },
  webinar: { label: "ويبنار" },
  other: { label: "محتوى آخر" },
};

export const contentPlanItemKinds = Object.keys(contentPlanItemKindConfig) as ContentPlanItemKind[];
