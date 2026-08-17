import { createSupabaseContext } from "npm:@supabase/server@1.4.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2.112.3/cors";

const responseHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json",
};

const launchTypes = new Set(["webinar", "course", "service", "book", "indicator"]);

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

    return jsonResponse({ message: "أمر الإطلاق غير معروف." }, 400);
  },
};
