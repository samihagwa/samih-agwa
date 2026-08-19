import { createClient } from "npm:@supabase/supabase-js@2.112.3";

type JsonRecord = Record<string, unknown>;

function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  let key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) {
    try {
      const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}") as Record<string, string>;
      key = keys.default ?? Object.values(keys)[0];
    } catch { key = undefined; }
  }
  if (!url || !key) throw new Error("Supabase service credentials are unavailable");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function telegram(method: string, body: JsonRecord) {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("Telegram bot token is unavailable");
  return fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const supplied = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  const expected = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
  if (!expected || supplied !== expected) return new Response("Unauthorized", { status: 401 });

  try {
    const update = await request.json() as JsonRecord;
    const supabase = adminClient();
    const message = update.message as JsonRecord | undefined;
    const callback = update.callback_query as JsonRecord | undefined;

    if (message) {
      const text = String(message.text ?? "").trim();
      const match = text.match(/^\/start(?:@\w+)?\s+([a-f0-9]{36})$/i);
      const chat = message.chat as JsonRecord;
      const from = message.from as JsonRecord;
      if (match && chat?.type === "private") {
        const { data, error } = await supabase.rpc("complete_publishing_admin_link", {
          raw_link_code: match[1],
          target_telegram_chat_id: Number(chat.id),
          target_telegram_user_id: Number(from.id),
          target_telegram_username: String(from.username ?? ""),
        });
        await telegram("sendMessage", {
          chat_id: chat.id,
          text: error || !data?.length
            ? "رابط الربط غير صالح أو انتهت مدته. أنشئ رابطًا جديدًا من صفحة النشر التلقائي."
            : "تم ربط حسابك بنجاح. ستصلك معاينات النشر والتنبيهات هنا.",
        });
      }
    }

    if (callback) {
      const data = String(callback.data ?? "");
      const match = data.match(/^pub:([a-f0-9]{18}):(approve|publish_now|delay_60|cancel)$/);
      const from = callback.from as JsonRecord;
      if (match) {
        const { data: result, error } = await supabase.rpc("handle_publishing_callback", {
          target_callback_token: match[1],
          target_action: match[2],
          target_telegram_user_id: Number(from.id),
        });
        const actionText: Record<string, string> = {
          approve: "تم الاعتماد",
          publish_now: "سيتم النشر الآن",
          delay_60: "تم التأجيل ساعة",
          cancel: "تم إلغاء النشر",
        };
        await telegram("answerCallbackQuery", {
          callback_query_id: callback.id,
          text: error || !result?.length ? "تعذر تنفيذ الأمر أو تم استخدامه من قبل." : actionText[match[2]],
          show_alert: Boolean(error || !result?.length),
        });
        if (!error && result?.length) {
          const callbackMessage = callback.message as JsonRecord | undefined;
          if (callbackMessage) {
            await telegram("editMessageReplyMarkup", {
              chat_id: (callbackMessage.chat as JsonRecord)?.id,
              message_id: callbackMessage.message_id,
              reply_markup: { inline_keyboard: [] },
            });
          }
        }
      }
    }
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : "Webhook failed" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});

