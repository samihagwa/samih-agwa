import { createSupabaseContext } from "npm:@supabase/server@1.4.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2.112.3/cors";

const headers = { ...corsHeaders, "Content-Type": "application/json" };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

async function telegram(method: string, body: Record<string, unknown>) {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("Telegram bot token is unavailable");
  const result = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return await result.json() as Record<string, unknown>;
}

export default {
  async fetch(request: Request) {
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (request.method !== "POST") return response({ message: "Method not allowed" }, 405);

    const { data: context, error: authError } = await createSupabaseContext(request, { auth: "user" });
    if (authError || !context?.userClaims?.id) return response({ message: "يجب تسجيل الدخول أولًا." }, 401);

    try {
      const body = await request.json() as Record<string, unknown>;
      if (body.action !== "verify_channel") return response({ message: "أمر غير معروف." }, 400);
      const organizationId = String(body.organization_id ?? "");
      let chatRef = String(body.channel_reference ?? "").trim();
      if (!organizationId || !chatRef) return response({ message: "أضف رابط القناة أو @username أو Channel ID." }, 400);
      try {
        const parsed = new URL(chatRef);
        if (["t.me", "telegram.me"].includes(parsed.hostname.toLowerCase())) {
          chatRef = `@${parsed.pathname.split("/").filter(Boolean)[0] ?? ""}`;
        }
      } catch { /* A username or numeric ID is also valid. */ }
      if (!/^@[A-Za-z0-9_]{5,32}$/.test(chatRef) && !/^-100\d{6,}$/.test(chatRef)) {
        return response({ message: "استخدم @username للقناة العامة أو Channel ID يبدأ بـ -100." }, 400);
      }

      const [botResult, chatResult] = await Promise.all([
        telegram("getMe", {}), telegram("getChat", { chat_id: chatRef }),
      ]);
      if (botResult.ok !== true) throw new Error(String(botResult.description ?? "تعذر التحقق من البوت."));
      if (chatResult.ok !== true) throw new Error(String(chatResult.description ?? "تعذر الوصول إلى القناة."));
      const bot = botResult.result as Record<string, unknown>;
      const chat = chatResult.result as Record<string, unknown>;
      if (chat.type !== "channel") return response({ message: "هذا ليس Channel على Telegram." }, 400);

      const membership = await telegram("getChatMember", { chat_id: chat.id, user_id: bot.id });
      const member = membership.result as Record<string, unknown> | undefined;
      const canPost = membership.ok === true && (
        member?.status === "creator" || (member?.status === "administrator" && member?.can_post_messages === true)
      );
      const verificationError = canPost ? null : String(membership.description ?? "أضف البوت كأدمن وفعّل صلاحية نشر الرسائل.");
      const username = chat.username ? `@${String(chat.username).replace(/^@/, "")}` : null;

      const { data: channelId, error } = await context.supabaseAdmin.rpc("upsert_verified_publishing_channel", {
        target_user_id: context.userClaims.id,
        target_organization_id: organizationId,
        target_chat_id: Number(chat.id),
        target_username: username,
        target_title: String(chat.title ?? username ?? "Telegram channel"),
        verified_bot_username: String(bot.username ?? ""),
        verified_bot_user_id: Number(bot.id),
        verified_can_post: canPost,
        verification_error: verificationError,
      });
      if (error) throw error;
      if (!canPost) return response({ ok: false, channel_id: channelId, message: verificationError }, 422);
      return response({ ok: true, channel_id: channelId, message: "تم التحقق من القناة وصلاحية النشر." });
    } catch (error) {
      return response({ message: error instanceof Error ? error.message : "تعذر التحقق من القناة." }, 400);
    }
  },
};

