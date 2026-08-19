import { createSupabaseContext } from "npm:@supabase/server@1.4.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2.112.3/cors";

const responseHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json",
};

const ownerFields = [
  "content_creator_id",
  "editing_owner_id",
  "thumbnail_owner_id",
  "publishing_owner_id",
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

function approvedBrandArticleIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))];
}

function isOptionalHttpUrl(value: unknown) {
  if (value === undefined || value === null || value === "") return true;
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isTelegramUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && ["t.me", "telegram.me"].includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isTimelineCue(value: unknown) {
  if (typeof value !== "object" || !value) return false;
  const cue = value as Record<string, unknown>;
  return Number.isInteger(cue.start_seconds)
    && Number(cue.start_seconds) >= 0
    && Number(cue.start_seconds) < 86400
    && (cue.end_seconds === null || (Number.isInteger(cue.end_seconds) && Number(cue.end_seconds) >= Number(cue.start_seconds) && Number(cue.end_seconds) < 86400))
    && ["cut", "visual", "text", "audio", "review", "note"].includes(String(cue.kind))
    && isNonEmptyString(cue.action)
    && String(cue.action).trim().length <= 2000
    && isOptionalHttpUrl(cue.source_url);
}

function isExtractedAsset(value: unknown) {
  if (typeof value !== "object" || !value) return false;
  const asset = value as Record<string, unknown>;
  return ["brief", "recording", "editing", "thumbnail", "caption", "approval", "publishing"].includes(String(asset.stage))
    && ["raw_video", "source", "b_roll", "image", "audio", "reference", "draft_video", "thumbnail", "caption", "final_export"].includes(String(asset.kind))
    && isNonEmptyString(asset.title)
    && String(asset.title).trim().length <= 160
    && isOptionalHttpUrl(asset.url)
    && isNonEmptyString(asset.url)
    && (asset.notes === undefined || String(asset.notes).length <= 2000);
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

    const requiredTextFields = [
      "target_organization_id",
      "content_title",
      "content_goal",
      "content_hook",
      "content_cta",
      "content_script_outline",
      "content_editing_brief",
      "content_thumbnail_brief",
      "target_publish_at",
      ...ownerFields,
    ];

    if (requiredTextFields.some((field) => !isNonEmptyString(body[field]))) {
      return jsonResponse({ message: "أكمل بيانات المحتوى والمسؤولين قبل الحفظ." }, 400);
    }

    if (["initial_raw_url", "initial_source_url", "initial_reference_url"].some((field) => !isOptionalHttpUrl(body[field]))) {
      return jsonResponse({ message: "روابط الملفات والمصادر يجب أن تبدأ بـ http أو https." }, 400);
    }

    const intakeRequest = typeof body.intake_request_text === "string" ? body.intake_request_text.trim() : "";
    const telegramSource = typeof body.telegram_source_url === "string" ? body.telegram_source_url.trim() : "";
    const timeline = Array.isArray(body.parsed_timeline) ? body.parsed_timeline : [];
    const extractedAssets = Array.isArray(body.parsed_assets) ? body.parsed_assets : [];
    const isTelegramIntake = intakeRequest.length > 0 || telegramSource.length > 0;
    const brandArticleIds = approvedBrandArticleIds(body.brand_article_ids);

    if (brandArticleIds.length > 8 || brandArticleIds.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
      return jsonResponse({ message: "اختر بحد أقصى 8 مراجع براند معتمدة وصحيحة." }, 400);
    }

    if (isTelegramIntake) {
      if (intakeRequest.length < 20 || intakeRequest.length > 30000 || !isTelegramUrl(telegramSource)) {
        return jsonResponse({ message: "ألصق طلب Telegram وأضف رابط رسالة المادة الخام قبل التحليل والتوزيع." }, 400);
      }
      if (timeline.length > 120 || !timeline.every(isTimelineCue)) {
        return jsonResponse({ message: "راجع تعليمات الـTimeline؛ يوجد توقيت أو إجراء غير صالح." }, 400);
      }
      if (extractedAssets.length > 60 || !extractedAssets.every(isExtractedAsset)) {
        return jsonResponse({ message: "راجع روابط المصادر المستخرجة قبل التوزيع." }, 400);
      }
    }

    const { data: contentId, error } = await context.supabaseAdmin.rpc(
      isTelegramIntake ? "create_reel_from_intake_v3" : "create_reel_production_workflow_v3",
      {
        target_user_id: context.userClaims.id,
        target_organization_id: body.target_organization_id,
        content_title: body.content_title,
        content_goal: body.content_goal,
        content_hook: body.content_hook,
        content_cta: body.content_cta,
        content_script_outline: body.content_script_outline,
        content_editing_brief: body.content_editing_brief,
        content_thumbnail_brief: body.content_thumbnail_brief,
        content_brand_notes: typeof body.content_brand_notes === "string" ? body.content_brand_notes : "",
        target_brand_article_ids: brandArticleIds,
        ...(isTelegramIntake ? {
          intake_request_text: intakeRequest,
          telegram_source_url: telegramSource,
          parsed_timeline: timeline,
          parsed_assets: extractedAssets,
        } : {}),
        target_publish_at: body.target_publish_at,
        content_creator_id: body.content_creator_id,
        editing_owner_id: body.editing_owner_id,
        thumbnail_owner_id: body.thumbnail_owner_id,
        // Kept only for the legacy atomic RPC signature. The database cancels
        // this internal gate and never waits for it.
        approval_owner_id: body.publishing_owner_id,
        publishing_owner_id: body.publishing_owner_id,
        ...(!isTelegramIntake ? {
          initial_raw_url: typeof body.initial_raw_url === "string" ? body.initial_raw_url.trim() : "",
          initial_source_url: typeof body.initial_source_url === "string" ? body.initial_source_url.trim() : "",
          initial_reference_url: typeof body.initial_reference_url === "string" ? body.initial_reference_url.trim() : "",
        } : {}),
      },
    );

    if (error) {
      const userError = /Only organization leadership|active organization member|Publish time|fields are incomplete|asset link|valid HTTP|Telegram|timeline|extracted links|Parsed intake|brand reference|approved brand/i.test(error.message);
      return jsonResponse(
        {
          message: userError
            ? error.message
            : "تعذّر إنشاء خط المحتوى. لم يتم حفظ أي جزء من العملية.",
        },
        userError ? 400 : 500,
      );
    }

    return jsonResponse({ contentId }, 201);
  },
};
