import { createSupabaseContext } from "npm:@supabase/server@1.4.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2.112.3/cors";

const responseHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json",
};

const ownerFields = [
  "brief_owner_id",
  "recording_owner_id",
  "editing_owner_id",
  "thumbnail_owner_id",
  "caption_owner_id",
  "approval_owner_id",
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
      "target_publish_at",
      ...ownerFields,
    ];

    if (requiredTextFields.some((field) => !isNonEmptyString(body[field]))) {
      return jsonResponse({ message: "أكمل بيانات المحتوى والمسؤولين قبل الحفظ." }, 400);
    }

    const { data: contentId, error } = await context.supabaseAdmin.rpc(
      "create_reel_workflow",
      {
        target_user_id: context.userClaims.id,
        target_organization_id: body.target_organization_id,
        content_title: body.content_title,
        content_goal: body.content_goal,
        content_hook: body.content_hook,
        content_cta: body.content_cta,
        target_publish_at: body.target_publish_at,
        brief_owner_id: body.brief_owner_id,
        recording_owner_id: body.recording_owner_id,
        editing_owner_id: body.editing_owner_id,
        thumbnail_owner_id: body.thumbnail_owner_id,
        caption_owner_id: body.caption_owner_id,
        approval_owner_id: body.approval_owner_id,
        publishing_owner_id: body.publishing_owner_id,
      },
    );

    if (error) {
      const userError = /Only organization leadership|active organization member|Publish time|fields are incomplete/.test(error.message);
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

