import type { Tables } from "./supabase/database.types";

export type TaskAttention = Tables<"task_attention">;
export type AttentionAction = "urgent" | "acknowledge" | "help" | "resolve_help";
export const helpReasons = {
  materials: "مادة خام ناقصة",
  clarification: "محتاج توضيح",
  approval: "بانتظار موافقة",
  other: "سبب آخر",
} as const;

export function attentionFields(value: TaskAttention["urgency"]): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

export function activeTaskAttention(task: Pick<Tables<"tasks">, "owner_id" | "status">, attention?: TaskAttention | null) {
  if (!attention || attention.assignee_id !== task.owner_id || ["done", "cancelled"].includes(task.status)) return null;
  return attention;
}

export function taskAttentionError(error: unknown) {
  const text = typeof error === "object" && error && "message" in error ? String(error.message) : String(error);
  if (/cooldown/.test(text)) return "التنبيه اتبعت بالفعل. ممكن تعيده بعد مرور 15 دقيقة على آخر إرسال.";
  if (/changed/.test(text)) return "في تحديث جديد للمهمة. حمّلنا آخر حالة؛ راجعها وجرب تاني.";
  if (/Only the task requester/.test(text)) return "التنبيه العاجل متاح لطالب المهمة، وللمهمة المسندة لشخص آخر فقط.";
  if (/Only the assignee/.test(text)) return "الرد وطلب المساعدة متاحان للمسؤول الحالي عن المهمة فقط.";
  if (/access denied|authentication/.test(text)) return "حسابك غير مصرح له بهذا الإجراء.";
  if (/task is closed/.test(text)) return "المهمة مكتملة أو ملغاة؛ لا تحتاج تنبيهًا جديدًا.";
  if (/expected time/.test(text)) return "اختار موعد إنجاز في المستقبل خلال سنة من الآن.";
  if (/requires reason/.test(text)) return "اختار سبب التعطيل واكتب المطلوب في 3 حروف على الأقل.";
  if (/already open/.test(text)) return "طلب المساعدة موجود بالفعل. تقدر تكمل التفاصيل من نقاش المهمة.";
  if (/unavailable in this state/.test(text)) return "طلب المساعدة متاح بعد إتاحة المهمة للتنفيذ وقبل تسليمها للمراجعة.";
  if (/No active/.test(text)) return "التنبيه أو طلب المساعدة لم يعد نشطًا. راجع آخر حالة للمهمة.";
  if (/too long/.test(text)) return "اكتب التفاصيل في 1000 حرف بحد أقصى.";
  return "تعذّر حفظ الإجراء. راجع الاتصال وحاول مرة أخرى.";
}
