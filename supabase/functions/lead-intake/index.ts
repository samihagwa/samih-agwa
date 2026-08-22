import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const allowedOrigins = new Set([
  "https://samihagwa.com",
  "https://www.samihagwa.com",
  "http://127.0.0.1:3000",
  "http://localhost:3000",
]);

const sheetMirrorUrl = "https://script.google.com/macros/s/AKfycbykNPobf2loiMmXREpxgbgrN8XD3yZ2lGkTbn51481bpXV_U4n6ojuMOa9VyLkORKx9/exec";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^\+?[0-9]{7,16}$/;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePhone(value: string) {
  const trimmed = value.trim();
  const hasPlus = trimmed.startsWith("+");
  return `${hasPlus ? "+" : ""}${trimmed.replace(/\D/g, "")}`;
}

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin) ? origin : "https://samihagwa.com",
    "Access-Control-Allow-Headers": "content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
  };
}

function jsonResponse(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function clientAddress(request: Request) {
  return text(request.headers.get("cf-connecting-ip"))
    || text(request.headers.get("x-real-ip"))
    || text(request.headers.get("x-forwarded-for")).split(",")[0]?.trim()
    || "unknown";
}

async function updateMirrorStatus(
  supabaseAdmin: ReturnType<typeof createClient>,
  eventId: string,
  succeeded: boolean,
  error: string | null,
) {
  const { error: updateError } = await supabaseAdmin.rpc("complete_whales_zone_sheet_mirror", {
    target_event_id: eventId,
    mirror_succeeded: succeeded,
    mirror_error: error,
  });
  if (updateError) console.error("whales-zone mirror audit update failed", updateError.message);
}

export default {
  async fetch(request: Request) {
    const origin = request.headers.get("origin");
    if (request.method === "OPTIONS") {
      if (!origin || !allowedOrigins.has(origin)) return jsonResponse({ message: "Origin not allowed" }, 403, origin);
      return new Response("ok", { headers: corsHeaders(origin) });
    }
    if (request.method !== "POST") return jsonResponse({ message: "Method not allowed" }, 405, origin);
    if (!origin || !allowedOrigins.has(origin)) return jsonResponse({ message: "Origin not allowed" }, 403, origin);

    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 16_384) {
      return jsonResponse({ message: "الطلب أكبر من الحد المسموح." }, 413, origin);
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ message: "بيانات التسجيل غير صالحة." }, 400, origin);
    }

    // A filled honeypot is acknowledged without touching customer systems.
    if (text(body.company)) return jsonResponse({ accepted: true }, 202, origin);

    const externalId = text(body.request_id);
    const fullName = text(body.name).replace(/\s+/g, " ");
    const email = text(body.email).toLocaleLowerCase("en-US");
    const tradingview = text(body.tv_username).replace(/^@/, "");
    const whatsapp = normalizePhone(text(body.whatsapp));
    const openedAt = Number(body.opened_at);
    const elapsed = Date.now() - openedAt;

    if (!uuidPattern.test(externalId)) return jsonResponse({ message: "تعذّر تأكيد محاولة التسجيل. حدّث الصفحة وجرّب مرة أخرى." }, 400, origin);
    if (fullName.length < 2 || fullName.length > 160) return jsonResponse({ message: "اكتب اسمًا صحيحًا." }, 400, origin);
    if (!emailPattern.test(email) || email.length > 320) return jsonResponse({ message: "اكتب بريدًا إلكترونيًا صحيحًا." }, 400, origin);
    if (tradingview.length < 3 || tradingview.length > 100
      || Array.from(tradingview).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
      return jsonResponse({ message: "اكتب اسم مستخدم TradingView صحيحًا." }, 400, origin);
    }
    if (!phonePattern.test(whatsapp)) return jsonResponse({ message: "اكتب رقم واتساب صحيحًا مع كود الدولة." }, 400, origin);
    if (!Number.isFinite(openedAt) || elapsed < 2_000 || elapsed > 2 * 60 * 60 * 1_000) {
      return jsonResponse({ message: "انتهت جلسة النموذج. حدّث الصفحة وجرّب مرة أخرى." }, 400, origin);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ message: "خدمة التسجيل غير متاحة مؤقتًا." }, 503, origin);

    const registeredAt = new Date().toISOString();
    const payloadHash = await sha256([fullName.toLocaleLowerCase("ar-EG"), email, tradingview.toLocaleLowerCase("en-US"), whatsapp].join("|"));
    const fingerprint = await sha256(`${clientAddress(request)}|${text(request.headers.get("user-agent"))}`);
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data, error } = await supabaseAdmin.rpc("ingest_whales_zone_lead", {
      intake_source_system: "whales_zone_form",
      intake_external_id: externalId,
      contact_full_name: fullName,
      contact_email: email,
      contact_tradingview: tradingview,
      contact_whatsapp: whatsapp,
      intake_owner_id: null,
      intake_registered_at: registeredAt,
      intake_payload_hash: payloadHash,
      intake_request_fingerprint: fingerprint,
    });

    if (error) {
      const isRateLimit = /rate limit/i.test(error.message);
      console.error("whales-zone intake failed", error.message);
      return jsonResponse({ message: isRateLimit ? "محاولات كثيرة في وقت قصير. انتظر قليلًا ثم جرّب مرة أخرى." : "تعذّر حفظ التسجيل حاليًا. جرّب مرة أخرى بدون إعادة تحميل الصفحة." }, isRateLimit ? 429 : 500, origin);
    }

    const intake = Array.isArray(data) ? data[0] : data;
    if (!intake || intake.outcome === "conflict" || !intake.contact_id) {
      return jsonResponse({ message: "البيانات مرتبطة بأكثر من ملف سابق. تواصل مع الدعم لتأكيد الحساب بدون إنشاء نسخة مكررة." }, 409, origin);
    }

    let mirrorStatus = intake.sheet_mirror_status as string;
    if (intake.should_mirror) {
      const mirrorParams = new URLSearchParams({
        name: fullName,
        email,
        tv_username: tradingview,
        whatsapp,
        date: registeredAt,
        source: "whales-zone-v2",
      });
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), 6_000);
      try {
        const mirrorResponse = await fetch(`${sheetMirrorUrl}?${mirrorParams.toString()}`, {
          method: "GET",
          redirect: "follow",
          signal: abortController.signal,
        });
        if (!mirrorResponse.ok) throw new Error(`Google Script returned ${mirrorResponse.status}`);
        mirrorStatus = "succeeded";
        await updateMirrorStatus(supabaseAdmin, intake.event_id, true, null);
      } catch (mirrorError) {
        mirrorStatus = "failed";
        const message = mirrorError instanceof Error ? mirrorError.message : "Unknown mirror error";
        console.error("whales-zone sheet mirror failed", message);
        await updateMirrorStatus(supabaseAdmin, intake.event_id, false, message);
      } finally {
        clearTimeout(timeout);
      }
    }

    return jsonResponse({
      accepted: true,
      contact_status: intake.outcome,
      sheet_mirror_status: mirrorStatus,
    }, 201, origin);
  },
};
