import { createSupabaseContext } from "npm:@supabase/server@1.4.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2.112.3/cors";

const responseHeaders = { ...corsHeaders, "Content-Type": "application/json" };
function jsonResponse(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: responseHeaders }); }
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function integer(value: unknown) { const number = Number(value); return Number.isSafeInteger(number) && number > 0 ? number : null; }
function safeError(message: string) {
  const known = [
    "Chat section access is required", "Message must contain", "Chat room is unavailable",
    "Reply target is unavailable", "Only the message author", "Message was not found",
    "Only the author or workspace leadership", "Only workspace leadership",
    "duplicate key", "team_chat_rooms_name_length", "team_chat_rooms_slug_format",
  ];
  return known.some((part) => message.includes(part)) ? message : "تعذّر تنفيذ أمر الدردشة.";
}

export default {
  async fetch(request: Request) {
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (request.method !== "POST") return jsonResponse({ message: "Method not allowed" }, 405);
    const { data: context, error: authError } = await createSupabaseContext(request, { auth: "user" });
    const actorId = text(context?.userClaims?.id);
    if (authError || !actorId) return jsonResponse({ message: "يجب تسجيل الدخول أولًا." }, 401);
    let body: Record<string, unknown>;
    try { body = await request.json(); } catch { return jsonResponse({ message: "بيانات الأمر غير صالحة." }, 400); }
    const action = text(body.action);

    if (action === "send") {
      const organizationId = text(body.organization_id); const roomId = text(body.room_id); const messageBody = text(body.message_body);
      const replyToId = body.reply_to_id == null ? null : integer(body.reply_to_id);
      if (!organizationId || !roomId || !messageBody || (body.reply_to_id != null && replyToId === null)) return jsonResponse({ message: "أكمل الرسالة والغرفة بشكل صحيح." }, 400);
      const { data, error } = await context.supabaseAdmin.rpc("send_team_chat_message_v2", {
        target_actor_id: actorId, target_organization_id: organizationId, target_room_id: roomId,
        message_body: messageBody, target_reply_to_id: replyToId,
      });
      if (error) return jsonResponse({ message: safeError(error.message) }, 400);
      return jsonResponse({ message_id: data }, 201);
    }
    if (action === "edit") {
      const messageId = integer(body.message_id); const messageBody = text(body.message_body);
      if (!messageId || !messageBody) return jsonResponse({ message: "حدد الرسالة والنص الجديد." }, 400);
      const { data, error } = await context.supabaseAdmin.rpc("edit_team_chat_message_v2", {
        target_actor_id: actorId, target_message_id: messageId, message_body: messageBody,
      });
      if (error) return jsonResponse({ message: safeError(error.message) }, 400);
      return jsonResponse({ updated: data });
    }
    if (action === "delete") {
      const messageId = integer(body.message_id);
      if (!messageId) return jsonResponse({ message: "حدد الرسالة المطلوب حذفها." }, 400);
      const { data, error } = await context.supabaseAdmin.rpc("delete_team_chat_message_v2", {
        target_actor_id: actorId, target_message_id: messageId,
      });
      if (error) return jsonResponse({ message: safeError(error.message) }, 400);
      return jsonResponse({ deleted: data });
    }
    if (action === "create_room") {
      const organizationId = text(body.organization_id); const name = text(body.name); const slug = text(body.slug); const description = text(body.description);
      if (!organizationId || !name || !slug) return jsonResponse({ message: "اكتب اسم المساحة بشكل صحيح." }, 400);
      const { data, error } = await context.supabaseAdmin.rpc("create_team_chat_room_v2", {
        target_actor_id: actorId, target_organization_id: organizationId,
        room_name: name, room_slug: slug, room_description: description,
      });
      if (error) return jsonResponse({ message: safeError(error.message) }, 400);
      return jsonResponse({ room_id: data }, 201);
    }
    return jsonResponse({ message: "أمر الدردشة غير معروف." }, 400);
  },
};
