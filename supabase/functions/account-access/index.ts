import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { corsHeaders } from "npm:@supabase/supabase-js@2.112.3/cors";

const responseHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const allowedOrigins = new Set([
  "https://os.samihagwa.com",
  "https://market-whales-os.samihsmaih1234.chatgpt.site",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:4173",
  "http://localhost:3000",
  "http://localhost:4173",
]);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function requestFingerprint(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const agent = request.headers.get("user-agent")?.slice(0, 180) ?? "unknown";
  return `${forwarded}|${agent}`;
}

export default {
  async fetch(request: Request) {
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (request.method !== "POST") return jsonResponse({ message: "Method not allowed" }, 405);

    const origin = request.headers.get("origin")?.trim();
    if (origin && !allowedOrigins.has(origin)) return jsonResponse({ message: "Origin is not allowed" }, 403);

    let body: Record<string, unknown>;
    try {
      const value = await request.json();
      body = typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
    } catch {
      return jsonResponse({ message: "بيانات الطلب غير صالحة." }, 400);
    }

    const action = cleanString(body.action);
    const email = cleanString(body.email).toLowerCase();
    if (!emailPattern.test(email) || email.length > 254) {
      return jsonResponse({ message: "اكتب بريدًا إلكترونيًا صحيحًا." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ message: "خدمة الحسابات غير متاحة مؤقتًا." }, 503);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const scope = action === "register" ? "register" : action === "request_password_recovery" ? "recover" : "";
    if (!scope) return jsonResponse({ message: "طلب الحساب غير معروف." }, 400);

    const [fingerprintHash, emailHash] = await Promise.all([
      sha256(requestFingerprint(request)),
      sha256(email),
    ]);
    const { data: rateAllowed, error: rateError } = await admin.rpc("consume_workspace_auth_rate_limit", {
      target_scope: scope,
      target_fingerprint_hash: fingerprintHash,
      target_email_hash: emailHash,
    });
    if (rateError) {
      console.error("workspace auth rate limit failed", rateError.message);
      return jsonResponse({ message: "تعذّر تجهيز الطلب مؤقتًا." }, 503);
    }
    if (!rateAllowed) return jsonResponse({ message: "محاولات كثيرة. انتظر قليلًا ثم حاول مرة أخرى." }, 429);

    if (action === "register") {
      const fullName = cleanString(body.full_name);
      const password = cleanString(body.password);
      if (fullName.length < 2 || fullName.length > 120) {
        return jsonResponse({ message: "اكتب اسمك كما سيظهر للفريق." }, 400);
      }
      if (password.length < 8 || password.length > 128) {
        return jsonResponse({ message: "كلمة المرور يجب أن تكون 8 أحرف على الأقل." }, 400);
      }

      const { error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
        app_metadata: { registration_flow: "owner_approval_request" },
      });
      if (createError) {
        const duplicate = /already|registered|exists/i.test(createError.message);
        return jsonResponse({
          code: duplicate ? "account_exists" : "registration_failed",
          message: duplicate
            ? "يوجد حساب بهذا البريد بالفعل. استخدم تسجيل الدخول أو اطلب استعادة كلمة المرور."
            : "تعذّر إنشاء طلب الانضمام مؤقتًا.",
        }, duplicate ? 409 : 503);
      }
      return jsonResponse({ created: true, message: "تم إنشاء الحساب وإرسال طلبك للمالك." }, 201);
    }

    const { error: recoveryError } = await admin.rpc("request_workspace_password_recovery", {
      target_email: email,
    });
    if (recoveryError) {
      console.error("workspace password recovery request failed", recoveryError.message);
      return jsonResponse({ message: "تعذّر تسجيل طلب الاستعادة مؤقتًا." }, 503);
    }
    // Keep the public response identical whether the account exists or not.
    return jsonResponse({ accepted: true, message: "لو الحساب عضوًا فعّالًا، وصل طلب الاستعادة للمالك." }, 202);
  },
};
