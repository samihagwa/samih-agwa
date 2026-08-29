import { createClient } from "npm:@supabase/supabase-js@2.112.3";

type JsonRecord = Record<string, unknown>;

const PREVIEW_BUCKET = "publishing-media-previews";
const SITE_URL = "https://os.samihagwa.com";
const SITE_PUBLISHING_URL = `${SITE_URL}/publishing`;

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

async function telegramJson(method: string, body: JsonRecord) {
  const response = await telegram(method, body);
  const payload = await response.json().catch(() => null) as JsonRecord | null;
  if (!response.ok || payload?.ok !== true) {
    throw new Error(String(payload?.description ?? `Telegram ${method} failed`));
  }
  return (payload.result ?? {}) as JsonRecord;
}

function optionalNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function mediaFromMessage(message: JsonRecord) {
  const caption = String(message.caption ?? "").trim();
  const photos = Array.isArray(message.photo) ? message.photo as JsonRecord[] : [];
  if (photos.length) {
    const file = photos.at(-1) as JsonRecord;
    const preview = photos.find((photo) => Number(photo.width ?? 0) >= 320) ?? photos[0];
    return {
      mediaKind: "photo",
      fileId: String(file.file_id ?? ""),
      uniqueId: String(file.file_unique_id ?? ""),
      previewFileId: String(preview.file_id ?? ""),
      caption,
      fileName: null,
      mimeType: "image/jpeg",
      fileSize: optionalNumber(file.file_size),
      width: optionalNumber(file.width),
      height: optionalNumber(file.height),
      duration: null,
    };
  }

  const video = message.video as JsonRecord | undefined;
  if (video?.file_id) {
    const thumbnail = (video.thumbnail ?? video.thumb) as JsonRecord | undefined;
    return {
      mediaKind: "video",
      fileId: String(video.file_id),
      uniqueId: String(video.file_unique_id ?? ""),
      previewFileId: String(thumbnail?.file_id ?? ""),
      caption,
      fileName: String(video.file_name ?? "").trim() || null,
      mimeType: String(video.mime_type ?? "video/mp4"),
      fileSize: optionalNumber(video.file_size),
      width: optionalNumber(video.width),
      height: optionalNumber(video.height),
      duration: optionalNumber(video.duration),
    };
  }

  return null;
}

function assetName(mediaKind: string, caption: string, fileName: string | null) {
  const firstCaptionLine = caption.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (firstCaptionLine) return firstCaptionLine.slice(0, 180);
  if (fileName) return fileName.slice(0, 180);
  const label = mediaKind === "photo" ? "صورة" : "فيديو";
  return `${label} Telegram — ${new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "short", timeStyle: "short", timeZone: "Africa/Cairo",
  }).format(new Date())}`;
}

async function storePreview(
  supabase: ReturnType<typeof adminClient>,
  organizationId: string,
  assetId: string,
  previewFileId: string,
) {
  if (!previewFileId) return null;
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) return null;
  const telegramFile = await telegramJson("getFile", { file_id: previewFileId });
  const filePath = String(telegramFile.file_path ?? "");
  if (!filePath) return null;
  const response = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!response.ok) return null;
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > 5 * 1024 * 1024) return null;
  const suppliedType = String(response.headers.get("content-type") ?? "").split(";")[0];
  const contentType = ["image/jpeg", "image/png", "image/webp"].includes(suppliedType)
    ? suppliedType : "image/jpeg";
  const extension = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const objectPath = `${organizationId}/${assetId}/preview.${extension}`;
  const { error } = await supabase.storage.from(PREVIEW_BUCKET).upload(objectPath, bytes, {
    contentType, upsert: true, cacheControl: "3600",
  });
  if (error) return null;
  return objectPath;
}

async function saveTelegramMedia(
  supabase: ReturnType<typeof adminClient>,
  message: JsonRecord,
  media: NonNullable<ReturnType<typeof mediaFromMessage>>,
) {
  const chat = message.chat as JsonRecord;
  const from = message.from as JsonRecord;
  const chatId = Number(chat?.id);
  const telegramUserId = Number(from?.id);
  if (chat?.type !== "private" || !Number.isFinite(chatId) || !Number.isFinite(telegramUserId)) return;

  const { data: connections, error: connectionError } = await supabase
    .from("publishing_admin_connections")
    .select("organization_id,user_id,connected_at")
    .eq("telegram_chat_id", chatId)
    .eq("telegram_user_id", telegramUserId)
    .eq("notifications_enabled", true)
    .not("connected_at", "is", null)
    .order("connected_at", { ascending: false })
    .limit(1);
  if (connectionError) throw connectionError;
  const connection = connections?.[0] as JsonRecord | undefined;
  if (!connection) {
    await telegram("sendMessage", {
      chat_id: chatId,
      reply_to_message_id: message.message_id,
      text: "اربط حساب Telegram من صفحة النشر التلقائي أولًا، ثم أرسل الصورة أو الفيديو مرة أخرى.",
    });
    return;
  }

  if (!media.fileId || !media.uniqueId) throw new Error("Telegram media identifiers are missing");
  const organizationId = String(connection.organization_id);
  const userId = String(connection.user_id);
  const { data: existing, error: existingError } = await supabase
    .from("publishing_telegram_assets")
    .select("id,preview_object_path")
    .eq("organization_id", organizationId)
    .eq("telegram_file_unique_id", media.uniqueId)
    .maybeSingle();
  if (existingError) throw existingError;

  const assetId = String(existing?.id ?? crypto.randomUUID());
  const values = {
    organization_id: organizationId,
    received_by_user_id: userId,
    telegram_chat_id: chatId,
    telegram_user_id: telegramUserId,
    telegram_message_id: Number(message.message_id),
    telegram_file_id: media.fileId,
    telegram_file_unique_id: media.uniqueId,
    media_kind: media.mediaKind,
    display_name: assetName(media.mediaKind, media.caption, media.fileName),
    original_caption: media.caption || null,
    file_name: media.fileName,
    mime_type: media.mimeType,
    file_size: media.fileSize,
    width: media.width,
    height: media.height,
    duration_seconds: media.duration,
    archived_at: null,
    last_received_at: new Date().toISOString(),
  };
  if (existing) {
    const { error } = await supabase.from("publishing_telegram_assets").update(values).eq("id", assetId);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("publishing_telegram_assets").insert({ id: assetId, ...values });
    if (error) throw error;
  }

  let previewPath = String(existing?.preview_object_path ?? "") || null;
  if (!previewPath && media.previewFileId) {
    previewPath = await storePreview(supabase, organizationId, assetId, media.previewFileId).catch(() => null);
    if (previewPath) {
      await supabase.from("publishing_telegram_assets").update({ preview_object_path: previewPath }).eq("id", assetId);
    }
  }

  await telegram("sendMessage", {
    chat_id: chatId,
    reply_to_message_id: message.message_id,
    text: existing
      ? "✅ الملف كان محفوظًا بالفعل وتم تحديث نسخته في مكتبة النشر."
      : "✅ تم حفظ الملف في مكتبة النشر. افتح الموقع واختره أثناء جدولة المنشور.",
    reply_markup: { inline_keyboard: [[{ text: "افتح مكتبة النشر", url: SITE_PUBLISHING_URL }]] },
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
      const memberLinkMatch = text.match(/^\/start(?:@\w+)?\s+notify_([a-f0-9]{36})$/i);
      const publishingLinkMatch = text.match(/^\/start(?:@\w+)?\s+([a-f0-9]{36})$/i);
      const chat = message.chat as JsonRecord;
      const from = message.from as JsonRecord;
      if (memberLinkMatch && chat?.type === "private") {
        const { data, error } = await supabase.rpc("complete_member_telegram_link", {
          raw_link_code: memberLinkMatch[1],
          target_telegram_chat_id: Number(chat.id),
          target_telegram_user_id: Number(from.id),
          target_telegram_username: String(from.username ?? ""),
        });
        await telegram("sendMessage", {
          chat_id: chat.id,
          text: error || !data?.length
            ? "رابط الربط غير صالح أو انتهت مدته، أو حساب Telegram مربوط بعضو آخر. أنشئ رابطًا جديدًا من جرس الإشعارات في الموقع."
            : "✅ تم ربط إشعارات الشغل بحسابك. سيصلك هنا فقط ما يخص حسابك داخل المنصة، ومع كل إشعار زر يفتح التفاصيل مباشرة.",
          reply_markup: error || !data?.length ? undefined : {
            inline_keyboard: [[{ text: "فتح مهامي", url: `${SITE_URL}/tasks` }]],
          },
        });
      } else if (publishingLinkMatch && chat?.type === "private") {
        const { data, error } = await supabase.rpc("complete_publishing_admin_link", {
          raw_link_code: publishingLinkMatch[1],
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

      const media = mediaFromMessage(message);
      if (media) {
        await saveTelegramMedia(supabase, message, media);
      } else if (chat?.type === "private" && (message.document || message.audio || message.animation || message.voice)) {
        await telegram("sendMessage", {
          chat_id: chat.id,
          reply_to_message_id: message.message_id,
          text: "حاليًا مكتبة النشر تقبل الصور والفيديوهات المرسلة كصورة أو Video. المستندات والصوت سنضيفها كمرحلة مستقلة حتى تظهر على القناة بالشكل الصحيح.",
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
