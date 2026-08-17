import { createSupabaseContext } from "npm:@supabase/server@1.4.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2.112.3/cors";

const responseHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const sources = new Set(["manual", "whales_zone", "samihagwa_site", "telegram", "meta", "market_whales_app", "exness", "tickmill", "referral", "other"]);
const interests = new Set(["indicator", "signals_gold", "signals_fx", "course", "brokerage", "book", "service", "other"]);
const identityKinds = new Set(["phone", "email", "telegram"]);
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
  const userError = /Only |active |must |invalid|requires|cannot|already belongs|not found|future|identity|owner|follow-up|CRM/i.test(error.message);
  return jsonResponse({ message: userError ? error.message : fallback }, userError ? 400 : 500);
}

async function createLead(body: Record<string, unknown>, context: Context) {
  const fullName = text(body.full_name);
  const source = text(body.source);
  const interest = text(body.interest);
  const ownerId = text(body.owner_id);
  const consentStatus = text(body.consent_status) || "unknown";
  const identityKind = text(body.identity_kind);
  const identityValue = text(body.identity_value);
  const followUpAt = futureIso(body.follow_up_at);
  const organizationId = text(body.organization_id);

  if (!organizationId || fullName.length < 2 || fullName.length > 160 || !ownerId) {
    return jsonResponse({ message: "أكمل اسم العميل ومسؤول المتابعة." }, 400);
  }
  if (!sources.has(source) || !interests.has(interest) || !consentStatuses.has(consentStatus)) {
    return jsonResponse({ message: "مصدر العميل أو اهتمامه أو حالة الموافقة غير صالحة." }, 400);
  }
  if (!identityKinds.has(identityKind) || identityValue.length < 3 || identityValue.length > 320) {
    return jsonResponse({ message: "أضف وسيلة تواصل صحيحة: هاتف أو بريد أو Telegram." }, 400);
  }
  if (!followUpAt) return jsonResponse({ message: "حدد موعد متابعة صحيحًا في المستقبل." }, 400);
  if (text(body.notes).length > 5000) return jsonResponse({ message: "ملاحظات العميل أطول من الحد المسموح." }, 400);

  const { data, error } = await context!.supabaseAdmin.rpc("create_crm_lead", {
    target_user_id: context!.userClaims!.id,
    target_organization_id: organizationId,
    contact_full_name: fullName,
    contact_source: source,
    contact_interest: interest,
    contact_owner_id: ownerId,
    contact_consent_status: consentStatus,
    identity_kind: identityKind,
    identity_value: identityValue,
    initial_notes: text(body.notes),
    target_follow_up_at: followUpAt,
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
