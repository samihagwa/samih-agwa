import { createSupabaseContext } from "npm:@supabase/server@1.4.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2.112.3/cors";

const responseHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json",
};

const launchTypes = new Set(["webinar", "course", "service", "book", "indicator"]);
const launchGates = new Set(["strategy", "offer", "registration", "delivery", "promotion", "tracking", "go_no_go", "launch_day"]);
const documentStatuses = new Set(["draft", "submitted", "approved"]);
const deliverableKinds = new Set(["reel", "story", "design", "telegram_post", "social_post", "email", "ad", "landing_page", "webinar_asset", "other"]);
const budgetCategories = new Set(["production", "media_spend", "tools", "event", "other"]);
const publishingPlatforms = new Set(["instagram", "facebook", "tiktok", "youtube", "linkedin", "telegram", "email"]);

const ownerFields = [
  "strategy_owner_id",
  "offer_owner_id",
  "registration_owner_id",
  "delivery_owner_id",
  "promotion_owner_id",
  "tracking_owner_id",
  "go_no_go_owner_id",
  "launch_day_owner_id",
] as const;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

function isNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function validHttpUrl(value: string) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function nullableTarget(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return { valid: true, value: null };
  }

  const numericValue = typeof value === "number" ? value : Number(value);
  return {
    valid: Number.isFinite(numericValue) && numericValue >= 0,
    value: numericValue,
  };
}

async function createLaunch(
  body: Record<string, unknown>,
  context: Awaited<ReturnType<typeof createSupabaseContext>>["data"],
) {
  const requiredTextFields = [
    "target_organization_id",
    "launch_title",
    "launch_kind",
    "launch_objective",
    "launch_audience",
    "launch_offer",
    "launch_cta",
    "launch_starts_at",
    "launch_ends_at",
    "launch_currency",
    ...ownerFields,
  ];

  if (requiredTextFields.some((field) => !isNonEmptyString(body[field]))) {
    return jsonResponse({ message: "أكمل brief الإطلاق والمسؤولين قبل الحفظ." }, 400);
  }

  if (!launchTypes.has(String(body.launch_kind))) {
    return jsonResponse({ message: "نوع الإطلاق غير صالح." }, 400);
  }

  const leadTarget = nullableTarget(body.launch_lead_target);
  const salesTarget = nullableTarget(body.launch_sales_target);
  const revenueTarget = nullableTarget(body.launch_revenue_target);

  if (!leadTarget.valid || !salesTarget.valid || !revenueTarget.valid) {
    return jsonResponse({ message: "الأهداف الرقمية يجب أن تكون صفرًا أو أكبر." }, 400);
  }

  if (
    (leadTarget.value !== null && !Number.isInteger(leadTarget.value))
    || (salesTarget.value !== null && !Number.isInteger(salesTarget.value))
  ) {
    return jsonResponse({ message: "مستهدف العملاء والمبيعات يجب أن يكون عددًا صحيحًا." }, 400);
  }

  if (
    (leadTarget.value ?? 0) <= 0
    && (salesTarget.value ?? 0) <= 0
    && (revenueTarget.value ?? 0) <= 0
  ) {
    return jsonResponse({ message: "ضع مستهدفًا موجبًا واحدًا على الأقل للإطلاق." }, 400);
  }

  if (
    Number.isNaN(Date.parse(String(body.launch_starts_at)))
    || Number.isNaN(Date.parse(String(body.launch_ends_at)))
  ) {
    return jsonResponse({ message: "موعد الإطلاق غير صالح." }, 400);
  }

  if (!/^[A-Z]{3}$/.test(String(body.launch_currency).trim().toUpperCase())) {
    return jsonResponse({ message: "اكتب رمز عملة من 3 حروف، مثل EGP." }, 400);
  }

  const { data: launchId, error } = await context!.supabaseAdmin.rpc(
    "create_launch_workflow",
    {
      target_user_id: context!.userClaims!.id,
      target_organization_id: body.target_organization_id,
      launch_title: body.launch_title,
      launch_kind: body.launch_kind,
      launch_objective: body.launch_objective,
      launch_audience: body.launch_audience,
      launch_offer: body.launch_offer,
      launch_cta: body.launch_cta,
      launch_starts_at: body.launch_starts_at,
      launch_ends_at: body.launch_ends_at,
      launch_lead_target: leadTarget.value,
      launch_sales_target: salesTarget.value,
      launch_revenue_target: revenueTarget.value,
      launch_currency: String(body.launch_currency).trim().toUpperCase(),
      strategy_owner_id: body.strategy_owner_id,
      offer_owner_id: body.offer_owner_id,
      registration_owner_id: body.registration_owner_id,
      delivery_owner_id: body.delivery_owner_id,
      promotion_owner_id: body.promotion_owner_id,
      tracking_owner_id: body.tracking_owner_id,
      go_no_go_owner_id: body.go_no_go_owner_id,
      launch_day_owner_id: body.launch_day_owner_id,
    },
  );

  if (error) {
    const userError = /Only organization leadership|active organization member|Launch start|Launch end|brief fields|measurable launch target|cannot be negative|Currency/.test(error.message);
    return jsonResponse(
      {
        message: userError
          ? error.message
          : "تعذّر إنشاء الإطلاق. لم يتم حفظ أي جزء من العملية.",
      },
      userError ? 400 : 500,
    );
  }

  return jsonResponse({ launchId }, 201);
}

async function updateContentLink(
  body: Record<string, unknown>,
  context: Awaited<ReturnType<typeof createSupabaseContext>>["data"],
  action: "attach_content" | "detach_content",
) {
  if (!isNonEmptyString(body.launch_id) || !isNonEmptyString(body.content_item_id)) {
    return jsonResponse({ message: "اختر الإطلاق والمحتوى المراد ربطه." }, 400);
  }

  const rpcName = action === "attach_content"
    ? "attach_content_to_launch"
    : "detach_content_from_launch";
  const { data: changed, error } = await context!.supabaseAdmin.rpc(
    rpcName,
    {
      target_user_id: context!.userClaims!.id,
      target_launch_id: body.launch_id,
      target_content_item_id: body.content_item_id,
    },
  );

  if (error) {
    const userError = /Only organization leadership|not found|same organization/.test(error.message);
    return jsonResponse(
      {
        message: userError
          ? error.message
          : action === "attach_content"
            ? "تعذّر ربط المحتوى بالإطلاق."
            : "تعذّر إزالة ربط المحتوى.",
      },
      userError ? 400 : 500,
    );
  }

  return jsonResponse({ changed, unchanged: !changed });
}

async function saveGateDocument(
  body: Record<string, unknown>,
  context: Awaited<ReturnType<typeof createSupabaseContext>>["data"],
) {
  const gate = text(body.gate);
  const status = text(body.status) || "submitted";
  const title = text(body.title);
  const summary = text(body.summary);
  const documentUrl = text(body.document_url);
  if (!isNonEmptyString(body.launch_id) || !launchGates.has(gate) || !documentStatuses.has(status)
    || title.length < 3 || title.length > 180 || summary.length < 5 || summary.length > 10000) {
    return jsonResponse({ message: "اختر البوابة واكتب عنوانًا وملخصًا واضحين للمخرج." }, 400);
  }
  if (documentUrl.length > 2000 || !validHttpUrl(documentUrl)) {
    return jsonResponse({ message: "لينك مخرج البوابة غير صحيح." }, 400);
  }
  const { data, error } = await context!.supabaseAdmin.rpc("save_launch_gate_document", {
    target_user_id: context!.userClaims!.id,
    target_launch_id: body.launch_id,
    document_gate: gate,
    document_title: title,
    document_summary: summary,
    target_document_url: documentUrl || null,
    document_status: status,
  });
  if (error) {
    const userError = /Only |not found|incomplete|URL|approve/i.test(error.message);
    return jsonResponse({ message: userError ? error.message : "تعذّر حفظ مخرج بوابة الإطلاق." }, userError ? 400 : 500);
  }
  return jsonResponse({ documentId: data }, 201);
}

async function createDeliverable(
  body: Record<string, unknown>,
  context: Awaited<ReturnType<typeof createSupabaseContext>>["data"],
) {
  const kind = text(body.kind);
  const budgetCategory = text(body.budget_category);
  const quantity = Number(body.planned_quantity);
  const budget = Number(body.budget_amount ?? 0);
  const dueAt = text(body.due_at);
  const currency = text(body.currency).toUpperCase();
  const isSocialPostWorkflow = kind === "social_post";
  if (!isNonEmptyString(body.launch_id) || !isNonEmptyString(body.owner_id)
    || !deliverableKinds.has(kind) || !budgetCategories.has(budgetCategory)
    || text(body.title).length < 3 || text(body.title).length > 180
    || text(body.brief).length < 5 || text(body.brief).length > 5000
    || !Number.isInteger(quantity) || quantity < 1 || quantity > (isSocialPostWorkflow ? 60 : 500)
    || !Number.isFinite(budget) || budget < 0 || Number.isNaN(Date.parse(dueAt))
    || !/^[A-Z]{3}$/.test(currency)) {
    return jsonResponse({ message: "أكمل نوع المخرج وكميته ومسؤوله وموعده وميزانيته بشكل صحيح." }, 400);
  }

  if (isSocialPostWorkflow) {
    const firstPublishAt = text(body.first_publish_at);
    const platforms = Array.isArray(body.platforms)
      ? [...new Set(body.platforms.map((platform) => text(platform)).filter(Boolean))]
      : [];
    const workflowOwnerFields = [
      "brief_owner_id", "caption_owner_id", "design_owner_id",
      "scheduling_owner_id", "publishing_owner_id",
    ];
    const requestId = text(body.creation_request_id);
    if (Number.isNaN(Date.parse(firstPublishAt)) || Date.parse(firstPublishAt) > Date.parse(dueAt)
      || platforms.length < 1 || platforms.some((platform) => !publishingPlatforms.has(platform))
      || workflowOwnerFields.some((field) => !isNonEmptyString(body[field]))
      || !validUuid(requestId)
      || text(body.goal).length < 5 || text(body.goal).length > 1000
      || text(body.hook).length < 3 || text(body.hook).length > 1000
      || text(body.cta).length < 2 || text(body.cta).length > 500
      || text(body.copy_brief).length < 10 || text(body.copy_brief).length > 8000
      || text(body.design_brief).length < 10 || text(body.design_brief).length > 8000) {
      return jsonResponse({ message: "أكمل خطة البوستات، مواعيد النشر، المنصات ومسؤولي مراحل التنفيذ." }, 400);
    }

    const { data, error } = await context!.supabaseAdmin.rpc("create_social_post_deliverable", {
      target_user_id: context!.userClaims!.id,
      target_launch_id: body.launch_id,
      deliverable_title: text(body.title),
      deliverable_brief: text(body.brief),
      deliverable_destination: text(body.destination) || null,
      deliverable_quantity: quantity,
      deliverable_owner_id: body.owner_id,
      first_publish_at: firstPublishAt,
      deliverable_due_at: dueAt,
      deliverable_budget_category: budgetCategory,
      deliverable_budget_amount: budget,
      deliverable_currency: currency,
      depends_on_deliverable_id: text(body.depends_on_deliverable_id) || null,
      content_goal: text(body.goal),
      content_hook: text(body.hook),
      content_cta: text(body.cta),
      content_copy_brief: text(body.copy_brief),
      content_design_brief: text(body.design_brief),
      content_platforms: platforms,
      brief_owner_id: body.brief_owner_id,
      caption_owner_id: body.caption_owner_id,
      design_owner_id: body.design_owner_id,
      // Legacy RPC parameter only; the database removes this blocking gate.
      approval_owner_id: body.scheduling_owner_id,
      scheduling_owner_id: body.scheduling_owner_id,
      publishing_owner_id: body.publishing_owner_id,
      target_creation_request_id: requestId,
    });
    if (error) {
      const userError = /Only |not found|active working member|incomplete|batch|dates|budget|Currency|dependency|platform|identity/i.test(error.message);
      return jsonResponse({ message: userError ? error.message : "تعذّر إنشاء مصنع البوستات. لم يتم حفظ أي جزء." }, userError ? 400 : 500);
    }
    return jsonResponse({ deliverableId: data, contentItemsCreated: quantity, tasksCreated: quantity * 6 }, 201);
  }

  const { data, error } = await context!.supabaseAdmin.rpc("create_launch_deliverable", {
    target_user_id: context!.userClaims!.id,
    target_launch_id: body.launch_id,
    deliverable_kind: kind,
    deliverable_title: text(body.title),
    deliverable_brief: text(body.brief),
    deliverable_channel: text(body.channel) || null,
    deliverable_destination: text(body.destination) || null,
    deliverable_quantity: quantity,
    deliverable_owner_id: body.owner_id,
    deliverable_due_at: dueAt,
    deliverable_budget_category: budgetCategory,
    deliverable_budget_amount: budget,
    deliverable_currency: currency,
    depends_on_deliverable_id: text(body.depends_on_deliverable_id) || null,
  });
  if (error) {
    const userError = /Only |not found|active working member|incomplete|quantity|deadline|budget|Currency|dependency/i.test(error.message);
    return jsonResponse({ message: userError ? error.message : "تعذّر إنشاء مخرج الإطلاق ومهمته." }, userError ? 400 : 500);
  }
  return jsonResponse({ deliverableId: data }, 201);
}

async function submitDeliverable(
  body: Record<string, unknown>,
  context: Awaited<ReturnType<typeof createSupabaseContext>>["data"],
) {
  const note = text(body.result_note);
  const resultUrl = text(body.result_url);
  if (!isNonEmptyString(body.deliverable_id) || (!note && !resultUrl)
    || note.length > 5000 || resultUrl.length > 2000 || !validHttpUrl(resultUrl)) {
    return jsonResponse({ message: "أضف ملاحظة نتيجة أو لينك تسليم صحيحًا." }, 400);
  }
  const { data, error } = await context!.supabaseAdmin.rpc("submit_launch_deliverable", {
    target_user_id: context!.userClaims!.id,
    target_deliverable_id: body.deliverable_id,
    deliverable_result_note: note || null,
    deliverable_result_url: resultUrl || null,
  });
  if (error) {
    const userError = /Only |not found|result|dependency|Resolve|reopen/i.test(error.message);
    return jsonResponse({ message: userError ? error.message : "تعذّر تسليم مخرج الإطلاق." }, userError ? 400 : 500);
  }
  return jsonResponse({ changed: data });
}

async function updateLaunch(
  body: Record<string, unknown>,
  context: Awaited<ReturnType<typeof createSupabaseContext>>["data"],
) {
  const launchId = text(body.launch_id);
  const expectedVersion = Number(body.expected_version);
  const startsAt = text(body.launch_starts_at);
  const endsAt = text(body.launch_ends_at);
  const kind = text(body.launch_kind);
  const currency = text(body.launch_currency).toUpperCase();
  const leadTarget = nullableTarget(body.launch_lead_target);
  const salesTarget = nullableTarget(body.launch_sales_target);
  const revenueTarget = nullableTarget(body.launch_revenue_target);
  if (!validUuid(launchId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1
    || !launchTypes.has(kind) || Number.isNaN(Date.parse(startsAt)) || Number.isNaN(Date.parse(endsAt))
    || !leadTarget.valid || !salesTarget.valid || !revenueTarget.valid
    || (leadTarget.value !== null && !Number.isInteger(leadTarget.value))
    || (salesTarget.value !== null && !Number.isInteger(salesTarget.value))
    || !/^[A-Z]{3}$/.test(currency)
    || text(body.launch_title).length < 3 || text(body.launch_title).length > 180
    || text(body.launch_objective).length < 5 || text(body.launch_objective).length > 1500
    || text(body.launch_audience).length < 3 || text(body.launch_audience).length > 1000
    || text(body.launch_offer).length < 3 || text(body.launch_offer).length > 1500
    || text(body.launch_cta).length < 2 || text(body.launch_cta).length > 500) {
    return jsonResponse({ message: "راجع بيانات الإطلاق والمواعيد والأهداف قبل حفظ التعديل." }, 400);
  }
  if ((leadTarget.value ?? 0) <= 0 && (salesTarget.value ?? 0) <= 0 && (revenueTarget.value ?? 0) <= 0) {
    return jsonResponse({ message: "ضع مستهدفًا موجبًا واحدًا على الأقل للإطلاق." }, 400);
  }
  const { data, error } = await context!.supabaseAdmin.rpc("update_launch", {
    target_user_id: context!.userClaims!.id,
    target_launch_id: launchId,
    expected_version: expectedVersion,
    launch_title: text(body.launch_title),
    launch_kind: kind,
    launch_objective: text(body.launch_objective),
    launch_audience: text(body.launch_audience),
    launch_offer: text(body.launch_offer),
    launch_cta: text(body.launch_cta),
    launch_starts_at: startsAt,
    launch_ends_at: endsAt,
    launch_lead_target: leadTarget.value,
    launch_sales_target: salesTarget.value,
    launch_revenue_target: revenueTarget.value,
    launch_currency: currency,
  });
  if (error) {
    const userError = /Only |not found|read-only|changed|brief|end|dates|target|Currency|deliverable/i.test(error.message);
    return jsonResponse({ message: userError ? error.message : "تعذّر تعديل الإطلاق." }, userError ? 400 : 500);
  }
  return jsonResponse({ version: data });
}

async function cancelLaunch(
  body: Record<string, unknown>,
  context: Awaited<ReturnType<typeof createSupabaseContext>>["data"],
) {
  const launchId = text(body.launch_id);
  const expectedVersion = Number(body.expected_version);
  const reason = text(body.cancellation_reason);
  if (!validUuid(launchId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1
    || reason.length < 3 || reason.length > 1000) {
    return jsonResponse({ message: "اكتب سبب إلغاء واضحًا قبل إغلاق الإطلاق." }, 400);
  }
  const { data, error } = await context!.supabaseAdmin.rpc("cancel_launch", {
    target_user_id: context!.userClaims!.id,
    target_launch_id: launchId,
    expected_version: expectedVersion,
    cancellation_reason: reason,
  });
  if (error) {
    const userError = /Only |not found|changed|completed|reason/i.test(error.message);
    return jsonResponse({ message: userError ? error.message : "تعذّر إلغاء الإطلاق." }, userError ? 400 : 500);
  }
  return jsonResponse({ version: data });
}

export default {
  async fetch(request: Request) {
    if (request.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return jsonResponse({ message: "Method not allowed" }, 405);
    }

    const { data: context, error: authError } = await createSupabaseContext(
      request,
      { auth: "user" },
    );

    if (authError || !context?.userClaims?.id) {
      return jsonResponse({ message: "يجب تسجيل الدخول أولًا." }, 401);
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ message: "بيانات الطلب غير صالحة." }, 400);
    }

    if (body.action === "create") {
      return createLaunch(body, context);
    }

    if (body.action === "attach_content") {
      return updateContentLink(body, context, "attach_content");
    }

    if (body.action === "detach_content") {
      return updateContentLink(body, context, "detach_content");
    }

    if (body.action === "save_gate_document") {
      return saveGateDocument(body, context);
    }

    if (body.action === "create_deliverable") {
      return createDeliverable(body, context);
    }

    if (body.action === "submit_deliverable") {
      return submitDeliverable(body, context);
    }

    if (body.action === "update_launch") {
      return updateLaunch(body, context);
    }

    if (body.action === "cancel_launch") {
      return cancelLaunch(body, context);
    }

    return jsonResponse({ message: "أمر الإطلاق غير معروف." }, 400);
  },
};
