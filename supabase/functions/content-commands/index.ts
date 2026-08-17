import { createSupabaseContext } from "npm:@supabase/server@1.4.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2.112.3/cors";

const responseHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const contentSteps = new Set(["brief", "recording", "editing", "thumbnail", "caption", "approval", "publishing"]);
const revisionSteps = new Set(["recording", "editing", "thumbnail", "caption"]);
const assetKinds = new Set([
  "raw_video", "source", "b_roll", "image", "audio", "reference",
  "draft_video", "thumbnail", "caption", "final_export",
]);

type Context = Awaited<ReturnType<typeof createSupabaseContext>>["data"];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function commandError(error: { message: string } | null, fallback: string) {
  if (!error) return null;
  const userError = /Only |active organization|not found|invalid|cannot|must |required|allowed|unknown|workflow|reviewer|leadership|creator|owner|membership/i.test(error.message);
  return jsonResponse({ message: userError ? error.message : fallback }, userError ? 400 : 500);
}

async function updateBrief(body: Record<string, unknown>, context: Context) {
  const contentId = text(body.content_item_id);
  const script = text(body.content_script_outline);
  const editing = text(body.content_editing_brief);
  const thumbnail = text(body.content_thumbnail_brief);
  if (!contentId || script.length < 10 || editing.length < 10 || thumbnail.length < 10) {
    return jsonResponse({ message: "أكمل السكربت وتعليمات المونتاج والغلاف بتفاصيل واضحة." }, 400);
  }

  const { data, error } = await context!.supabaseAdmin.rpc("update_content_production_brief", {
    target_user_id: context!.userClaims!.id,
    target_content_item_id: contentId,
    content_script_outline: script,
    content_editing_brief: editing,
    content_thumbnail_brief: thumbnail,
    content_brand_notes: text(body.content_brand_notes),
  });
  return commandError(error, "تعذّر تحديث Production Brief.") ?? jsonResponse({ updated: data });
}

async function addAsset(body: Record<string, unknown>, context: Context) {
  const contentId = text(body.content_item_id);
  const stage = text(body.asset_stage);
  const kind = text(body.asset_kind);
  const title = text(body.asset_title);
  const url = text(body.asset_url);
  if (!contentId || !contentSteps.has(stage) || !assetKinds.has(kind) || title.length < 2 || !isHttpUrl(url)) {
    return jsonResponse({ message: "أكمل نوع الرابط ومرحلته واسمه، واستخدم رابط http أو https صالحًا." }, 400);
  }

  const { data, error } = await context!.supabaseAdmin.rpc("add_content_asset", {
    target_user_id: context!.userClaims!.id,
    target_content_item_id: contentId,
    asset_stage: stage,
    asset_kind: kind,
    asset_title: title,
    asset_url: url,
    asset_notes: text(body.asset_notes),
  });
  return commandError(error, "تعذّر إضافة رابط الملف.") ?? jsonResponse({ assetId: data }, 201);
}

async function removeAsset(body: Record<string, unknown>, context: Context) {
  const assetId = text(body.asset_id);
  if (!assetId) return jsonResponse({ message: "رابط الملف غير محدد." }, 400);
  const { data, error } = await context!.supabaseAdmin.rpc("remove_content_asset", {
    target_user_id: context!.userClaims!.id,
    target_asset_id: assetId,
  });
  return commandError(error, "تعذّرت إزالة الرابط.") ?? jsonResponse({ removed: data });
}

async function requestRevision(body: Record<string, unknown>, context: Context) {
  const contentId = text(body.content_item_id);
  const stage = text(body.target_stage);
  const instructions = text(body.revision_instructions);
  if (!contentId || !revisionSteps.has(stage) || instructions.length < 5) {
    return jsonResponse({ message: "اختر مرحلة واكتب تعديلًا واضحًا وقابلًا للتنفيذ." }, 400);
  }
  const { data, error } = await context!.supabaseAdmin.rpc("request_content_revision", {
    target_user_id: context!.userClaims!.id,
    target_content_item_id: contentId,
    target_stage: stage,
    revision_instructions: instructions,
  });
  return commandError(error, "تعذّر تسجيل طلب التعديل.") ?? jsonResponse({ revisionId: data }, 201);
}

async function changeRevision(body: Record<string, unknown>, context: Context, action: "start" | "resolve" | "cancel") {
  const revisionId = text(body.revision_id);
  if (!revisionId) return jsonResponse({ message: "طلب التعديل غير محدد." }, 400);
  const { data, error } = await context!.supabaseAdmin.rpc("change_content_revision", {
    target_user_id: context!.userClaims!.id,
    target_revision_id: revisionId,
    target_action: action,
  });
  return commandError(error, "تعذّر تحديث حالة التعديل.") ?? jsonResponse({ changed: data });
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

    if (body.action === "update_brief") return updateBrief(body, context);
    if (body.action === "add_asset") return addAsset(body, context);
    if (body.action === "remove_asset") return removeAsset(body, context);
    if (body.action === "request_revision") return requestRevision(body, context);
    if (body.action === "start_revision") return changeRevision(body, context, "start");
    if (body.action === "resolve_revision") return changeRevision(body, context, "resolve");
    if (body.action === "cancel_revision") return changeRevision(body, context, "cancel");
    return jsonResponse({ message: "أمر المحتوى غير معروف." }, 400);
  },
};
