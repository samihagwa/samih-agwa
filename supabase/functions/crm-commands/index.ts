import { createSupabaseContext } from "npm:@supabase/server@1.4.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2.112.3/cors";

const responseHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const sources = new Set(["manual", "whales_zone", "samihagwa_site", "telegram", "meta", "market_whales_app", "exness", "tickmill", "referral", "other"]);
const interests = new Set(["indicator", "signals_gold", "signals_fx", "course", "brokerage", "book", "service", "other"]);
const identityKinds = new Set(["phone", "email", "telegram", "tradingview"]);
const conversationChannels = new Set(["telegram", "whatsapp", "instagram", "facebook", "messenger", "other"]);
const consentStatuses = new Set(["unknown", "granted", "denied"]);
const activityKinds = new Set(["call", "message", "email", "note"]);
const leadStages = new Set(["new", "contacted", "qualified", "follow_up", "won", "lost", "do_not_contact"]);
const activeStages = new Set(["new", "contacted", "qualified", "follow_up"]);

type Context = Awaited<ReturnType<typeof createSupabaseContext>>["data"];
type ContactIdentity = { kind: string; value: string; is_primary: boolean };

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
    [/TradingView identity is invalid/i, "اسم حساب TradingView غير صحيح."],
    [/already belongs/i, "وسيلة التواصل هذه مسجلة بالفعل لعميل آخر."],
    [/owner must be an active/i, "مسؤول المتابعة يجب أن يكون عضوًا نشطًا في مساحة العمل."],
    [/Only an active working member/i, "حسابك لا يملك صلاحية إضافة عميل محتمل."],
    [/Team members can create CRM leads for themselves only/i, "عضو الفريق يمكنه إسناد العميل لنفسه فقط."],
    [/between one and four CRM contact identities/i, "أضف وسيلة واحدة على الأقل، وبحد أقصى هاتف وبريد وTelegram وTradingView."],
    [/each CRM identity kind only once/i, "يمكن إضافة هاتف واحد وبريد واحد واسم Telegram واحد عند إنشاء الملف."],
    [/exactly one primary CRM identity/i, "اختر وسيلة تواصل أساسية واحدة."],
    [/Only the CRM owner or organization leadership/i, "إضافة وسيلة تواصل متاحة لمسؤول العميل أو إدارة الشركة فقط."],
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
  if (kind === "tradingview") return value.trim().length >= 3 && value.trim().length <= 100
    && !Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
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

function parseIdentities(body: Record<string, unknown>): ContactIdentity[] | null {
  const requested = Array.isArray(body.identities)
    ? body.identities
    : [{ kind: body.identity_kind, value: body.identity_value }];
  const parsed = requested.map((entry) => {
    const item = typeof entry === "object" && entry ? entry as Record<string, unknown> : {};
    return { kind: text(item.kind), value: text(item.value), is_primary: false };
  }).filter((identity) => identity.kind || identity.value);
  const primaryKind = text(body.primary_identity_kind) || parsed[0]?.kind;
  for (const identity of parsed) identity.is_primary = identity.kind === primaryKind;
  if (parsed.length < 1 || parsed.length > 4 || new Set(parsed.map((identity) => identity.kind)).size !== parsed.length) return null;
  if (parsed.filter((identity) => identity.is_primary).length !== 1) return null;
  return parsed;
}

async function createLead(body: Record<string, unknown>, context: Context) {
  const fullName = text(body.full_name);
  const source = text(body.source);
  const sourceDetail = text(body.source_detail);
  const interest = text(body.interest);
  const interestDetail = text(body.interest_detail);
  const ownerId = text(body.owner_id);
  const consentStatus = text(body.consent_status) || "unknown";
  const identities = parseIdentities(body);
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
  if (!identities || identities.some((identity) => !identityKinds.has(identity.kind) || identity.value.length < 3 || identity.value.length > 320)) {
    return jsonResponse({ message: "أضف وسيلة تواصل واحدة على الأقل: هاتف أو بريد أو Telegram أو TradingView، بدون تكرار النوع." }, 400);
  }
  const invalidIdentity = identities.find((identity) => !validIdentity(identity.kind, identity.value));
  if (invalidIdentity) {
    const message = invalidIdentity.kind === "telegram"
      ? "اكتب اسم مستخدم Telegram فقط مثل @username، وضع لينك الشات في خانته المنفصلة."
      : invalidIdentity.kind === "email"
        ? "البريد الإلكتروني غير صحيح."
        : invalidIdentity.kind === "tradingview"
          ? "اسم حساب TradingView غير صحيح."
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

  const { data, error } = await context!.supabaseAdmin.rpc("create_crm_lead_v3", {
    target_user_id: context!.userClaims!.id,
    target_organization_id: organizationId,
    contact_full_name: fullName,
    contact_source: source,
    contact_source_detail: source === "other" ? sourceDetail : null,
    contact_interest: interest,
    contact_interest_detail: interest === "other" ? interestDetail : null,
    contact_owner_id: ownerId,
    contact_consent_status: consentStatus,
    contact_identities: identities,
    initial_notes: text(body.notes),
    target_follow_up_at: followUpAt,
    target_conversation_channel: conversationChannel || null,
    target_conversation_url: conversationUrl || null,
    target_conversation_label: conversationLabel || null,
  });
  return commandError(error, "تعذّر إنشاء ملف العميل. لم يتم حفظ أي جزء من العملية.") ?? jsonResponse({ contactId: data }, 201);
}

async function addIdentity(body: Record<string, unknown>, context: Context) {
  const contactId = text(body.contact_id);
  const identityKind = text(body.identity_kind);
  const identityValue = text(body.identity_value);
  if (!contactId || !identityKinds.has(identityKind) || !validIdentity(identityKind, identityValue)) {
    return jsonResponse({ message: "اختر نوع وسيلة التواصل وأدخل قيمة صحيحة." }, 400);
  }

  const { data, error } = await context!.supabaseAdmin.rpc("add_crm_identity", {
    target_user_id: context!.userClaims!.id,
    target_contact_id: contactId,
    identity_kind: identityKind,
    identity_value: identityValue,
    make_primary: body.make_primary === true,
  });
  return commandError(error, "تعذّرت إضافة وسيلة التواصل.") ?? jsonResponse({ identityId: data }, 201);
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

async function importTelegramBatch(body: Record<string, unknown>, context: Context) {
  const organizationId = text(body.organization_id);
  const defaultOwnerId = text(body.default_owner_id);
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const signals = new Set(["pending", "contacted", "activated", "needs_account_correction"]);

  if (!organizationId || !defaultOwnerId || rows.length < 1 || rows.length > 500) {
    return jsonResponse({ message: "دفعة Telegram يجب أن تحتوي من عميل واحد إلى 500 عميل مع مسؤول افتراضي." }, 400);
  }

  for (const rawRow of rows) {
    const row = typeof rawRow === "object" && rawRow ? rawRow as Record<string, unknown> : {};
    const registeredAt = text(row.registered_at);
    if (
      !text(row.message_id)
      || text(row.full_name).length < 2
      || !validIdentity("phone", text(row.phone))
      || !validIdentity("email", text(row.email))
      || !validIdentity("tradingview", text(row.tradingview))
      || !signals.has(text(row.signal) || "pending")
      || (registeredAt && Number.isNaN(new Date(registeredAt).getTime()))
    ) {
      return jsonResponse({ message: "توجد صفوف ناقصة أو غير صالحة في معاينة استيراد Telegram." }, 400);
    }
  }

  const { data, error } = await context!.supabaseAdmin.rpc("import_telegram_indicator_batch", {
    target_user_id: context!.userClaims!.id,
    target_organization_id: organizationId,
    default_owner_id: defaultOwnerId,
    import_rows: rows,
  });
  return commandError(error, "تعذّر استيراد دفعة Telegram. لم يتم اعتماد الدفعة.") ?? jsonResponse({ batchId: data }, 201);
}

async function importWhalesZoneSheetBatch(body: Record<string, unknown>, context: Context) {
  const organizationId = text(body.organization_id);
  const defaultOwnerId = text(body.default_owner_id);
  const rows = Array.isArray(body.rows) ? body.rows : [];

  if (!organizationId || !defaultOwnerId || rows.length < 1 || rows.length > 500) {
    return jsonResponse({ message: "دفعة Whales Zone يجب أن تحتوي من عميل واحد إلى 500 عميل مع مسؤول افتراضي." }, 400);
  }

  for (const rawRow of rows) {
    const row = typeof rawRow === "object" && rawRow ? rawRow as Record<string, unknown> : {};
    const registeredAt = text(row.registered_at);
    if (
      text(row.external_id).length < 3
      || text(row.full_name).length < 2
      || !validIdentity("phone", text(row.phone))
      || !validIdentity("email", text(row.email))
      || !validIdentity("tradingview", text(row.tradingview))
      || !registeredAt
      || Number.isNaN(new Date(registeredAt).getTime())
    ) {
      return jsonResponse({ message: "توجد صفوف ناقصة أو غير صالحة في ملف Whales Zone." }, 400);
    }
  }

  const { data, error } = await context!.supabaseAdmin.rpc("import_whales_zone_sheet_batch", {
    target_user_id: context!.userClaims!.id,
    target_organization_id: organizationId,
    default_owner_id: defaultOwnerId,
    import_rows: rows,
  });
  return commandError(error, "تعذّر استيراد سجل Whales Zone. لم يتم اعتماد الدفعة.") ?? jsonResponse({ batchId: data }, 201);
}

async function rollbackImportBatch(body: Record<string, unknown>, context: Context) {
  const batchId = text(body.batch_id);
  if (!batchId) return jsonResponse({ message: "اختر دفعة استيراد صحيحة." }, 400);
  const { data, error } = await context!.supabaseAdmin.rpc("rollback_crm_import_batch", {
    target_user_id: context!.userClaims!.id,
    target_batch_id: batchId,
  });
  return commandError(error, "تعذّر التراجع عن دفعة الاستيراد.") ?? jsonResponse({ result: data });
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
    if (body.action === "add_identity") return addIdentity(body, context);
    if (body.action === "record_activity") return recordActivity(body, context);
    if (body.action === "import_telegram_batch") return importTelegramBatch(body, context);
    if (body.action === "import_whales_zone_sheet_batch") return importWhalesZoneSheetBatch(body, context);
    if (body.action === "rollback_import_batch") return rollbackImportBatch(body, context);
    return jsonResponse({ message: "أمر CRM غير معروف." }, 400);
  },
};
