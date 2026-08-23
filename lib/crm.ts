import type { Database } from "./supabase/database.types";

export type CrmLeadStage = Database["public"]["Enums"]["crm_lead_stage"];
export type CrmSource = Database["public"]["Enums"]["crm_source"];
export type CrmInterest = Database["public"]["Enums"]["crm_interest"];
export type CrmIdentityKind = Database["public"]["Enums"]["crm_identity_kind"];
export type CrmConversationChannel = Database["public"]["Enums"]["crm_conversation_channel"];
export type CrmConsentStatus = Database["public"]["Enums"]["crm_consent_status"];
export type CrmActivityKind = Database["public"]["Enums"]["crm_activity_kind"];

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export const crmLeadStageConfig: Record<CrmLeadStage, { label: string; shortLabel: string; tone: Tone; order: number; active: boolean }> = {
  new: { label: "عميل جديد", shortLabel: "جديد", tone: "info", order: 1, active: true },
  contacted: { label: "تم التواصل", shortLabel: "تواصل", tone: "info", order: 2, active: true },
  qualified: { label: "مؤهل للشراء", shortLabel: "مؤهل", tone: "warning", order: 3, active: true },
  follow_up: { label: "متابعة لاحقة", shortLabel: "متابعة", tone: "warning", order: 4, active: true },
  won: { label: "تم التحويل لعميل", shortLabel: "تم البيع", tone: "success", order: 5, active: false },
  lost: { label: "لم تتم الصفقة", shortLabel: "خسارة", tone: "neutral", order: 6, active: false },
  do_not_contact: { label: "عدم تواصل", shortLabel: "ممنوع تواصل", tone: "danger", order: 7, active: false },
};

export const crmLeadStages = (Object.keys(crmLeadStageConfig) as CrmLeadStage[]).sort(
  (a, b) => crmLeadStageConfig[a].order - crmLeadStageConfig[b].order,
);

export const allowedCrmTransitions: Record<CrmLeadStage, CrmLeadStage[]> = {
  new: ["contacted", "qualified", "follow_up", "won", "lost", "do_not_contact"],
  contacted: ["qualified", "follow_up", "won", "lost", "do_not_contact"],
  qualified: ["follow_up", "won", "lost", "do_not_contact"],
  follow_up: ["contacted", "qualified", "won", "lost", "do_not_contact"],
  won: [],
  lost: ["follow_up"],
  do_not_contact: [],
};

export const crmSourceConfig: Record<CrmSource, { label: string }> = {
  manual: { label: "إدخال يدوي" },
  whales_zone: { label: "Whales Zone" },
  samihagwa_site: { label: "موقع samihagwa.com" },
  market_whales_dashboard: { label: "Market Wiz · لوحة الموقع" },
  harmonic_book: { label: "كتاب الهارمونيك" },
  telegram: { label: "Telegram" },
  meta: { label: "Meta" },
  facebook: { label: "Facebook" },
  whatsapp: { label: "WhatsApp" },
  email: { label: "Email" },
  market_whales_app: { label: "تطبيق Market Whales" },
  exness: { label: "Exness" },
  tickmill: { label: "Tickmill" },
  referral: { label: "ترشيح" },
  other: { label: "مصدر مخصص" },
};

export const crmInterestConfig: Record<CrmInterest, { label: string }> = {
  indicator: { label: "مؤشر التداول" },
  signals_gold: { label: "اشتراك توصيات الذهب" },
  signals_fx: { label: "اشتراك توصيات العملات" },
  course: { label: "كورس تعليمي" },
  brokerage: { label: "وكالة بروكر" },
  book: { label: "كتاب أو مادة تعليمية" },
  service: { label: "خدمة أخرى" },
  other: { label: "سبب آخر" },
};

export const crmConversationChannelConfig: Record<CrmConversationChannel, { label: string; placeholder: string }> = {
  telegram: { label: "Telegram", placeholder: "https://t.me/username" },
  whatsapp: { label: "WhatsApp", placeholder: "https://wa.me/2010…" },
  instagram: { label: "Instagram", placeholder: "https://instagram.com/username" },
  facebook: { label: "Facebook", placeholder: "https://facebook.com/username" },
  messenger: { label: "Messenger", placeholder: "https://m.me/username" },
  other: { label: "منصة أخرى", placeholder: "https://…" },
};

export const crmIdentityKindConfig: Record<CrmIdentityKind, { label: string; placeholder: string; inputType: "text" | "email" | "tel" }> = {
  phone: { label: "رقم الهاتف / WhatsApp", placeholder: "+2010…", inputType: "tel" },
  email: { label: "البريد الإلكتروني", placeholder: "name@example.com", inputType: "email" },
  telegram: { label: "اسم مستخدم Telegram", placeholder: "@username", inputType: "text" },
  tradingview: { label: "حساب TradingView", placeholder: "TradingView username", inputType: "text" },
};

export const crmIdentityKinds = Object.keys(crmIdentityKindConfig) as CrmIdentityKind[];

export const crmConsentConfig: Record<CrmConsentStatus, { label: string; tone: Tone }> = {
  unknown: { label: "الموافقة غير معروفة", tone: "neutral" },
  granted: { label: "وافق على التواصل", tone: "success" },
  denied: { label: "رفض التواصل", tone: "danger" },
};

export const crmActivityKindConfig: Record<Exclude<CrmActivityKind, "created">, { label: string }> = {
  call: { label: "مكالمة" },
  message: { label: "رسالة / محادثة" },
  email: { label: "بريد إلكتروني" },
  note: { label: "ملاحظة متابعة" },
};
