import { createSupabaseContext } from "npm:@supabase/server@1.4.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2.112.3/cors";

const responseHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const sources = new Set(["manual", "whales_zone", "samihagwa_site", "telegram", "meta", "market_whales_app", "exness", "tickmill", "referral", "other"]);
const interests = new Set(["indicator", "signals_gold", "signals_fx", "course", "brokerage", "book", "service", "other"]);
const identityKinds = new Set(["phone", "email", "telegram"]);
const conversationChannels = new Set(["telegram", "whatsapp", "instagram", "facebook", "messenger", "other"]);
const consentStatuses = new Set(["unknown", "granted", "denied"]);
const activityKinds = new Set(["call", "message", "email", "note"]);
const leadStages = new Set(["new", "contacted", "qualified", "follow_up", "won", "lost", "do_not_contact"]);
const activeStages = new Set(["new", "contacted", "qualified", "follow_up"]);

type Context = Awaited<ReturnType<typeof createSupabaseContext>>["data"];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function futureIso(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) || date.getTime() <= Date.now() ? null : date.toISOString();
}

function commandError(error: { message: string } | null, fallback: string) {
  if (!error) return null;
  const friendlyMessages: Array<[RegExp, string]> = [
    [/Phone identity is invalid/i, "رقم الهاتف غير صحيح. استخدم رقمًا من 7 إلى 16 رقمًا ويمكن أن يبدأ بعلامة +."],
    [/Email identity is invalid/i, "البريد الإلكتروني غير صحيح."],
    [/Telegram username is invalid/i, "اسم مستخدم Telegram غير صحيح. اكتب اسم المستخدم فقط مثل @username، وضع لينك الشات في خانته المنفصلة."],
    [/already belongs/i, "وسيلة التواصل هذه مسجلة بالفعل لعميل آخر."],
    [/owner must be an active/i, "مسؤول المتابعة يجب أن يكون عضوًا نشطًا في مساحة العمل."],
    [/Only an active working member/i, "حسابك لا يملك صلاحية إضافة عميل محتمل."],
    [/Team members can create CRM leads for themselves only/i, "عضو الفريق يمكنه إسناد العميل لنفسه فقط."],
  ];
  const translated = friendlyMessages.find(([pattern]) => pattern.test(error.message))?.[1];
  if (translated) return jsonResponse({ message: translated }, 400);
  const userError = /Only |active |must |invalid|requires|cannot|already belongs|not found|future|identity|owner|follow-up|CRM/i.test(error.message);
  return jsonResponse({ message: userError ? error.message : fallback }, userError ? 400 : 500);
}

function validIdentity(kind: string, value: string) {
  if (kind === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if (kind === "phone") return /^\+?[0-9]{7,16}$/.test(value.replace(/[^0-9+]/g, ""));
  if (kind === "telegram") return /^[a-z0-9_]{5,32}$/i.test(value.replace(/^@/, ""));
  return false;
}

function validHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !/\s/.test(value);
  } catch {
    return false;
  }
}

async function createLead(body: Record<string, unknown>, context: Context) {
  const fullName = text(body.full_name);
  const source = text(body.source);
  const sourceDetail = text(body.source_detail);
  const interest = text(body.interest);
  const interestDetail = text(body.interest_detail);
  const ownerId = text(body.owner_id);
  const consentStatus = text(body.consent_status) || "unknown";
  const identityKind = text(body.identity_kind);
  const identityValue = text(body.identity_value);
  const followUpAt = futureIso(body.follow_up_at);
  const organizationId = text(body.organization_id);
  const conversationChannel = text(body.conversation_channel);
  const conversationUrl = text(body.conversation_url);
  const conversationLabel = text(body.conversation_label);

  if (!organizationId || fullName.length < 2 || fullName.length > 160 || !ownerId) {
    return jsonResponse({ message: "أكمل اسم العميل ومسؤول المتابعة." }, 400);
  }
  if (!sources.has(source) || !interests.has(interest) || !consentStatuses.has(consentStatus)) {
    return jsonResponse({ message: "مصدر العميل أو اهتمامه أو حالة الموافقة غير صالحة." }, 400);
  }
  if (!identityKinds.has(identityKind) || identityValue.length < 3 || identityValue.length > 320) {
    return jsonResponse({ message: "أضف وسيلة تواصل صحيحة: هاتف أو بريد أو Telegram." }, 400);
  }
  if (!validIdentity(identityKind, identityValue)) {
    const message = identityKind === "telegram"
      ? "اكتب اسم مستخدم Telegram فقط مثل @username، وضع لينك الشات في خانته المنفصلة."
      : identityKind === "email"
        ? "البريد الإلكتروني غير صحيح."
        : "رقم الهاتف غير صحيح. استخدم رقمًا من 7 إلى 16 رقمًا ويمكن أن يبدأ بعلامة +.";
    return jsonResponse({ message }, 400);
  }
  if (source === "other" && (sourceDetail.length < 2 || sourceDetail.length > 160)) {
    return jsonResponse({ message: "اكتب اسم مصدر التسجيل المخصص من حرفين إلى 160 حرفًا." }, 400);
  }
  if (source !== "other" && sourceDetail) {
    return jsonResponse({ message: "استخدم تفاصيل المصدر فقط عند اختيار «مصدر مخصص»." }, 400);
  }
  if (interest === "other" && (interestDetail.length < 2 || interestDetail.length > 160)) {
    return jsonResponse({ message: "اكتب سبب التسجيل المخصص من حرفين إلى 160 حرفًا." }, 400);
  }
  if (interest !== "other" && interestDetail) {
    return jsonResponse({ message: "استخدم السبب المخصص فقط عند اختيار «سبب آخر»." }, 400);
  }
  if (Boolean(conversationChannel) !== Boolean(conversationUrl)) {
    return jsonResponse({ message: "اختر منصة المحادثة وأضف لينك الشات معها." }, 400);
  }
  if (conversationChannel && !conversationChannels.has(conversationChannel)) {
    return jsonResponse({ message: "منصة المحادثة غير صالحة." }, 400);
  }
  if (conversationUrl && (conversationUrl.length > 2000 || !validHttpUrl(conversationUrl))) {
    return jsonResponse({ message: "لينك الشات غير صحيح. الصق لينكًا كاملًا يبدأ بـ https://" }, 400);
  }
  if (conversationLabel && (!conversationUrl || conversationLabel.length < 2 || conversationLabel.length > 80)) {
    return jsonResponse({ message: "وصف لينك المحادثة يجب أن يكون بين حرفين و80 حرفًا." }, 400);
  }
  if (!followUpAt) return jsonResponse({ message: "حدد موعد متابعة صحيحًا في المستقبل." }, 400);
  if (text(body.notes).length > 5000) return jsonResponse({ message: "ملاحظات العميل أطول من الحد المسموح." }, 400);

  const { data, error } = await context!.supabaseAdmin.rpc("create_crm_lead_v2", {
    target_user_id: context!.userClaims!.id,
    target_organization_id: organizationId,
    contact_full_name: fullName,
    contact_source: source,
    contact_source_detail: source === "other" ? sourceDetail : null,
    contact_interest: interest,
    contact_interest_detail: interest === "other" ? interestDetail : null,
    contact_owner_id: ownerId,
    contact_consent_status: consentStatus,
    identity_kind: identityKind,
    identity_value: identityValue,
    initial_notes: text(body.notes),
    target_follow_up_at: followUpAt,
    target_conversation_channel: conversationChannel || null,
    target_conversation_url: conversationUrl || null,
    target_conversation_label: conversationLabel || null,
  });
  return commandError(error, "تعذّر إنشاء ملف العميل. لم يتم حفظ أي جزء من العملية.") ?? jsonResponse({ contactId: data }, 201);
}

async function recordActivity(body: Record<string, unknown>, context: Context) {
  const contactId = text(body.contact_id);
  const kind = text(body.kind);
  const nextStage = text(body.next_stage);
  const summary = text(body.summary);
  const nextFollowUpAt = futureIso(body.next_follow_up_at);

  if (!contactId || !activityKinds.has(kind) || !leadStages.has(nextStage) || summary.length < 3 || summary.length > 4000) {
    return jsonResponse({ message: "اختر نتيجة المتابعة واكتب ملخصًا واضحًا." }, 400);
  }
  if (activeStages.has(nextStage) && !nextFollowUpAt) {
    return jsonResponse({ message: "المرحلة النشطة تحتاج موعد متابعة جديدًا في المستقبل." }, 400);
  }
  if (!activeStages.has(nextStage) && text(body.next_follow_up_at)) {
    return jsonResponse({ message: "المرحلة المغلقة لا تحتاج موعد متابعة جديدًا." }, 400);
  }
  if (["lost", "do_not_contact"].includes(nextStage) && summary.length > 1000) {
    return jsonResponse({ message: "سبب الإغلاق يجب ألا يزيد عن 1000 حرف." }, 400);
  }

  const { data, error } = await context!.supabaseAdmin.rpc("record_crm_activity", {
    target_user_id: context!.userClaims!.id,
    target_contact_id: contactId,
    activity_kind: kind,
    next_stage: nextStage,
    activity_summary: summary,
    target_next_follow_up_at: activeStages.has(nextStage) ? nextFollowUpAt : null,
  });
  return commandError(error, "تعذّر تسجيل نتيجة المتابعة.") ?? jsonResponse({ changed: data });
}

export default {
  async fetch(request: Request) {
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (request.method !== "POST") return jsonResponse({ message: "Method not allowed" }, 405);

    const { data: context, error: authError } = await createSupabaseContext(request, { auth: "user" });
    if (authError || !context?.userClaims?.id) return jsonResponse({ message: "يجب تسجيل الدخول أولًا." }, 401);

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ message: "بيانات الطلب غير صالحة." }, 400);
    }

    if (body.action === "create_lead") return createLead(body, context);
    if (body.action === "record_activity") return recordActivity(body, context);
    return jsonResponse({ message: "أمر CRM غير معروف." }, 400);
  },
};
