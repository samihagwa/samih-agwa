import type { Database } from "./supabase/database.types";

export type BrandArticleStatus = Database["public"]["Enums"]["brand_article_status"];
export type BrandAudience = Database["public"]["Enums"]["brand_audience"];
export type BrandCategory = Database["public"]["Enums"]["brand_category"];

type Tone = "neutral" | "info" | "success" | "warning";

export const brandArticleStatusConfig: Record<BrandArticleStatus, { label: string; tone: Tone }> = {
  draft: { label: "مسودة للمراجعة", tone: "warning" },
  approved: { label: "معتمد للتنفيذ", tone: "success" },
  archived: { label: "نسخة مؤرشفة", tone: "neutral" },
};

export const brandCategoryConfig: Record<BrandCategory, { label: string; description: string }> = {
  foundation: { label: "من نحن والرسالة", description: "القصة، الوعد، الجمهور، والقيمة التي لا تتغير." },
  visual_identity: { label: "الهوية البصرية", description: "الألوان والخطوط والصور والتكوينات المسموحة والممنوعة." },
  editing: { label: "قواعد المونتاج", description: "الإيقاع، النصوص، المؤثرات، الموسيقى، وما يجب تجنبه." },
  copy_voice: { label: "الصوت والكتابة", description: "النبرة، المصطلحات، الـCTA، وأمثلة الصياغة الصحيحة." },
  publishing: { label: "النشر والمنصات", description: "المقاسات، توقيت النشر، الحزمة المطلوبة، وقواعد كل قناة." },
  compliance: { label: "الالتزام والمخاطر", description: "تنبيهات التداول، الوعود الممنوعة، والادعاءات التي تحتاج إثباتًا." },
  offer_product: { label: "المنتجات والعروض", description: "تفاصيل المؤشر والكورسات والاشتراكات وما يصح قوله عنها." },
  workflow: { label: "طريقة العمل", description: "من يراجع، من يعتمد، تعريف الجاهزية، ومسار التسليم." },
};

export const brandAudienceConfig: Record<BrandAudience, { label: string }> = {
  all: { label: "كل الفريق" },
  management: { label: "الإدارة والمراجعة" },
  design: { label: "التصميم" },
  editing: { label: "المونتاج" },
  copy: { label: "الكتابة والمحتوى" },
  publishing: { label: "النشر" },
  sales: { label: "المبيعات وخدمة العملاء" },
};

export function textLines(value: string) {
  return [...new Set(value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
}
