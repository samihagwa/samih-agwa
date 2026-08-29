import { createClient } from "npm:@supabase/supabase-js@2.112.3";

type JsonRecord = Record<string, unknown>;

const jsonHeaders = { "Content-Type": "application/json" };
const siteUrl = "https://os.samihagwa.com";

function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  let key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) {
    try {
      const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}") as Record<string, string>;
      key = keys.default ?? Object.values(keys)[0];
    } catch {
      key = undefined;
    }
  }
  if (!url || !key) throw new Error("Supabase service credentials are unavailable");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function telegramUrl(method: string) {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("Telegram bot token is unavailable");
  return `https://api.telegram.org/bot${token}/${method}`;
}

async function telegram(method: string, body: JsonRecord) {
  const response = await fetch(telegramUrl(method), {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null) as JsonRecord | null;
  return { response, result };
}

function fullText(row: JsonRecord) {
  const text = String(row.post_text ?? "").trim();
  const link = String(row.link_url ?? "").trim();
  return [text, link && !text.includes(link) ? link : ""].filter(Boolean).join("\n\n");
}

function messageUrl(username: unknown, chatId: unknown, messageId: number) {
  const publicName = String(username ?? "").replace(/^@/, "");
  if (publicName) return `https://t.me/${publicName}/${messageId}`;
  const privateId = String(chatId).replace(/^-100/, "").replace(/^-/, "");
  return `https://t.me/c/${privateId}/${messageId}`;
}

function previewText(row: JsonRecord) {
  const payload = (row.snapshot_payload ?? {}) as JsonRecord;
  const channels = Array.isArray(payload.channels) ? payload.channels as JsonRecord[] : [];
  const names = channels.map((channel) => String(channel.title ?? channel.username ?? "قناة")).join("، ");
  const policy = row.preview_policy === "approval_required" ? "موافقة إلزامية" : "معاينة غير معطِّلة";
  const date = new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Cairo",
  }).format(new Date(String(row.scheduled_at)));
  const content = [String(payload.post_text ?? "").trim(), String(payload.link_url ?? "").trim()]
    .filter(Boolean).join("\n\n").slice(0, 2800);
  return [
    "معاينة نشر مجدول",
    `الاسم: ${String(payload.name ?? "منشور")}`,
    `القنوات: ${names || "—"}`,
    `الموعد: ${date} (القاهرة)`,
    `السياسة: ${policy}`,
    "",
    content,
  ].join("\n").slice(0, 4000);
}

async function sendPreviews(supabase: ReturnType<typeof adminClient>) {
  const { data, error } = await supabase.rpc("claim_publishing_preview_batch", { target_batch_size: 10 });
  if (error) throw error;
  let sent = 0;
  for (const row of (data ?? []) as JsonRecord[]) {
    const occurrenceId = String(row.occurrence_id);
    const claimToken = String(row.claim_token);
    const chatId = row.admin_chat_id as number | null;
    if (!chatId) {
      await supabase.rpc("complete_publishing_preview", {
        target_occurrence_id: occurrenceId,
        target_claim_token: claimToken,
        target_preview_chat_id: null,
        target_preview_message_id: null,
        target_error: "No connected Telegram administrator",
      });
      continue;
    }
    try {
      const callback = String(row.callback_token);
      const buttons = row.preview_policy === "approval_required"
        ? [[{ text: "اعتماد", callback_data: `pub:${callback}:approve` }, { text: "انشر الآن", callback_data: `pub:${callback}:publish_now` }],
          [{ text: "أجّل ساعة", callback_data: `pub:${callback}:delay_60` }, { text: "إلغاء", callback_data: `pub:${callback}:cancel` }]]
        : [[{ text: "انشر الآن", callback_data: `pub:${callback}:publish_now` }, { text: "أجّل ساعة", callback_data: `pub:${callback}:delay_60` }],
          [{ text: "إلغاء", callback_data: `pub:${callback}:cancel` }]];
      const payload = (row.snapshot_payload ?? {}) as JsonRecord;
      const mediaKind = String(payload.media_kind ?? "none");
      const mediaSource = String(payload.media_source ?? "");
      const hasMedia = (mediaKind === "photo" || mediaKind === "video") && Boolean(mediaSource);
      const previewMethod = hasMedia ? (mediaKind === "photo" ? "sendPhoto" : "sendVideo") : "sendMessage";
      const previewBody: JsonRecord = hasMedia
        ? {
          chat_id: chatId,
          [mediaKind]: mediaSource,
          caption: previewText(row).slice(0, 1024),
          reply_markup: { inline_keyboard: buttons },
        }
        : {
          chat_id: chatId,
          text: previewText(row),
          reply_markup: { inline_keyboard: buttons },
          disable_web_page_preview: false,
        };
      const { result } = await telegram(previewMethod, previewBody);
      const ok = result?.ok === true;
      const telegramMessage = result?.result as JsonRecord | undefined;
      await supabase.rpc("complete_publishing_preview", {
        target_occurrence_id: occurrenceId,
        target_claim_token: claimToken,
        target_preview_chat_id: chatId,
        target_preview_message_id: ok ? telegramMessage?.message_id : null,
        target_error: ok ? null : String(result?.description ?? "Telegram preview failed"),
      });
      if (ok) sent += 1;
    } catch (error) {
      await supabase.rpc("complete_publishing_preview", {
        target_occurrence_id: occurrenceId,
        target_claim_token: claimToken,
        target_preview_chat_id: chatId,
        target_preview_message_id: null,
        target_error: error instanceof Error ? error.message : "Telegram preview failed",
      });
    }
  }
  return sent;
}

async function publishClaims(supabase: ReturnType<typeof adminClient>) {
  const { data, error } = await supabase.rpc("claim_publication_batch", { target_batch_size: 20 });
  if (error) throw error;
  let published = 0;
  let failed = 0;
  let unknown = 0;

  for (const row of (data ?? []) as JsonRecord[]) {
    const logId = String(row.log_id);
    const claimToken = String(row.claim_token);
    const { data: maySend, error: gateError } = await supabase.rpc("mark_publication_network_started", {
      target_log_id: logId,
      target_claim_token: claimToken,
      target_claim_generation: Number(row.claim_generation),
    });
    if (gateError || !maySend) continue;

    try {
      const text = fullText(row);
      const mediaKind = String(row.media_kind ?? "none");
      let method = "sendMessage";
      let body: JsonRecord = {
        chat_id: row.telegram_chat_id,
        text,
        link_preview_options: { is_disabled: Boolean(row.disable_link_preview) },
      };
      if (mediaKind === "photo" || mediaKind === "video") {
        if (text.length > 1024) {
          await supabase.rpc("complete_publication_failure", {
            target_log_id: logId,
            target_claim_token: claimToken,
            target_terminal_status: "failed",
            target_telegram_error_code: 400,
            target_error: "Telegram media captions cannot exceed 1024 characters",
          });
          failed += 1;
          continue;
        }
        method = mediaKind === "photo" ? "sendPhoto" : "sendVideo";
        body = {
          chat_id: row.telegram_chat_id,
          [mediaKind]: row.media_source,
          caption: text || undefined,
        };
      }

      let telegramResult: { response: Response; result: JsonRecord | null };
      try {
        telegramResult = await telegram(method, body);
      } catch (error) {
        await supabase.rpc("complete_publication_failure", {
          target_log_id: logId,
          target_claim_token: claimToken,
          target_terminal_status: "unknown",
          target_telegram_error_code: null,
          target_error: error instanceof Error ? error.message : "Telegram request result is unknown",
        });
        unknown += 1;
        continue;
      }

      const { response, result } = telegramResult;
      if (!response.ok || result?.ok !== true) {
        const terminal = response.status >= 500 || !result ? "unknown" : "failed";
        await supabase.rpc("complete_publication_failure", {
          target_log_id: logId,
          target_claim_token: claimToken,
          target_terminal_status: terminal,
          target_telegram_error_code: Number(result?.error_code ?? response.status),
          target_error: String(result?.description ?? `Telegram HTTP ${response.status}`),
        });
        if (terminal === "unknown") unknown += 1;
        else failed += 1;
        continue;
      }

      const telegramMessage = result.result as JsonRecord;
      const messageId = Number(telegramMessage.message_id);
      await supabase.rpc("complete_publication_success", {
        target_log_id: logId,
        target_claim_token: claimToken,
        target_message_id: messageId,
        target_message_url: messageUrl(row.telegram_username, row.telegram_chat_id, messageId),
      });
      published += 1;
    } catch (error) {
      await supabase.rpc("complete_publication_failure", {
        target_log_id: logId,
        target_claim_token: claimToken,
        target_terminal_status: "unknown",
        target_telegram_error_code: null,
        target_error: error instanceof Error ? error.message : "Publication completion is uncertain",
      });
      unknown += 1;
    }
  }
  return { published, failed, unknown };
}

function workflowNotificationText(row: JsonRecord) {
  const title = String(row.notification_title ?? "تنبيه جديد").trim();
  const body = String(row.notification_body ?? "افتح المنصة لمراجعة التفاصيل.").trim();
  return [`🔔 ${title}`, "", body].join("\n").slice(0, 4096);
}

function workflowNotificationButton(row: JsonRecord) {
  const url = String(row.notification_url ?? "");
  if (url.startsWith("/tasks/")) return "فتح المهمة";
  if (url.startsWith("/crm")) return "فتح العميل";
  if (url.startsWith("/scripts")) return "فتح الاسكريبت";
  if (url.startsWith("/content")) return "فتح المحتوى";
  if (url.startsWith("/campaigns")) return "فتح الإطلاق";
  if (url.startsWith("/chat")) return "فتح الدردشة";
  return "فتح التفاصيل";
}

async function sendWorkflowNotifications(supabase: ReturnType<typeof adminClient>) {
  const { data, error } = await supabase.rpc("claim_telegram_notification_batch", { target_batch_size: 25 });
  if (error) throw error;
  let sent = 0;
  let failed = 0;
  let unknown = 0;
  let deferred = 0;

  for (const row of (data ?? []) as JsonRecord[]) {
    const notificationId = Number(row.notification_id);
    const claimToken = String(row.claim_token);
    const { data: maySend, error: gateError } = await supabase.rpc("mark_telegram_notification_network_started", {
      target_notification_id: notificationId,
      target_claim_token: claimToken,
    });
    if (gateError || !maySend) continue;

    const notificationPath = String(row.notification_url ?? "");
    const targetUrl = notificationPath.startsWith("/") ? `${siteUrl}${notificationPath}` : `${siteUrl}/tasks`;
    try {
      let telegramResult: { response: Response; result: JsonRecord | null };
      try {
        telegramResult = await telegram("sendMessage", {
          chat_id: row.telegram_chat_id,
          text: workflowNotificationText(row),
          link_preview_options: { is_disabled: true },
          reply_markup: {
            inline_keyboard: [[{ text: workflowNotificationButton(row), url: targetUrl }]],
          },
        });
      } catch (networkError) {
        await supabase.rpc("complete_telegram_notification_delivery", {
          target_notification_id: notificationId,
          target_claim_token: claimToken,
          target_terminal_status: "unknown",
          target_message_id: null,
          target_telegram_error_code: null,
          target_error: networkError instanceof Error ? networkError.message : "Telegram request result is unknown",
        });
        unknown += 1;
        continue;
      }

      const { response, result } = telegramResult;
      if (response.status === 429) {
        const parameters = result?.parameters as JsonRecord | undefined;
        const retryAfter = Number(parameters?.retry_after ?? 60);
        await supabase.rpc("defer_telegram_notification_delivery", {
          target_notification_id: notificationId,
          target_claim_token: claimToken,
          target_retry_after_seconds: Number.isFinite(retryAfter) ? retryAfter : 60,
          target_error: String(result?.description ?? "Telegram rate limit"),
        });
        deferred += 1;
        continue;
      }

      if (!response.ok || result?.ok !== true) {
        const terminal = response.status >= 500 || !result ? "unknown" : "failed";
        await supabase.rpc("complete_telegram_notification_delivery", {
          target_notification_id: notificationId,
          target_claim_token: claimToken,
          target_terminal_status: terminal,
          target_message_id: null,
          target_telegram_error_code: Number(result?.error_code ?? response.status),
          target_error: String(result?.description ?? `Telegram HTTP ${response.status}`),
        });
        if (terminal === "unknown") unknown += 1;
        else failed += 1;
        continue;
      }

      const message = result.result as JsonRecord | undefined;
      const messageId = Number(message?.message_id);
      if (!Number.isFinite(messageId) || messageId <= 0) {
        await supabase.rpc("complete_telegram_notification_delivery", {
          target_notification_id: notificationId,
          target_claim_token: claimToken,
          target_terminal_status: "unknown",
          target_message_id: null,
          target_telegram_error_code: null,
          target_error: "Telegram response did not contain a message id",
        });
        unknown += 1;
        continue;
      }

      await supabase.rpc("complete_telegram_notification_delivery", {
        target_notification_id: notificationId,
        target_claim_token: claimToken,
        target_terminal_status: "sent",
        target_message_id: messageId,
        target_telegram_error_code: null,
        target_error: null,
      });
      sent += 1;
    } catch (completionError) {
      await supabase.rpc("complete_telegram_notification_delivery", {
        target_notification_id: notificationId,
        target_claim_token: claimToken,
        target_terminal_status: "unknown",
        target_message_id: null,
        target_telegram_error_code: null,
        target_error: completionError instanceof Error ? completionError.message : "Telegram notification completion is uncertain",
      });
      unknown += 1;
    }
  }

  return { sent, failed, unknown, deferred };
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const suppliedSecret = request.headers.get("x-whales-worker-secret") ?? "";
  const expectedSecret = Deno.env.get("PUBLISHING_WORKER_SECRET") ?? "";
  if (!expectedSecret || suppliedSecret !== expectedSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const supabase = adminClient();
    const previews = await sendPreviews(supabase);
    const publications = await publishClaims(supabase);
    const workflowNotifications = await sendWorkflowNotifications(supabase);
    return new Response(JSON.stringify({ ok: true, previews, ...publications, workflow_notifications: workflowNotifications }), { headers: jsonHeaders });
  } catch (error) {
    return new Response(JSON.stringify({
      ok: false,
      message: error instanceof Error ? error.message : "Publishing worker failed",
    }), { status: 500, headers: jsonHeaders });
  }
});
