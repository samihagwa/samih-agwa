import type { Enums } from "./supabase/database.types";

export type ScriptStatus = Enums<"script_status">;
export type ScriptInputMode = Enums<"script_input_mode">;
export type ScriptResearchKind = Enums<"script_research_kind">;

export const scriptStatusConfig: Record<ScriptStatus, { label: string; tone: "neutral" | "info" | "success" | "warning" }> = {
  draft: { label: "قيد الكتابة", tone: "neutral" },
  ready_to_record: { label: "جاهز للتصوير", tone: "warning" },
  handed_off: { label: "متابعة التنفيذ", tone: "success" },
  archived: { label: "مؤرشف", tone: "info" },
};

export const scriptInputModeConfig: Record<ScriptInputMode, string> = {
  idea: "فكرة من عندي",
  reference: "إعادة بناء مرجع بطريقتي",
  manual: "كتابة يدوية",
};

export const scriptResearchKindConfig: Record<ScriptResearchKind, string> = {
  idea: "فكرة",
  reference: "مرجع",
  competitor: "منافس",
};

export const scriptPlatformConfig: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
  telegram: "Telegram",
  other: "أخرى",
};

export function lines(value: string) {
  return [...new Set(value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))];
}

export function formatScriptDate(value: string) {
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Cairo",
  }).format(new Date(value));
}
