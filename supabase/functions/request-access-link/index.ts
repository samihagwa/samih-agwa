import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { corsHeaders } from "npm:@supabase/supabase-js@2.112.3/cors";

const responseHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const allowedOrigins = new Set([
  "https://os.samihagwa.com",
  "https://market-whales-os.samihsmaih1234.chatgpt.site",
]);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function requestOrigin(request: Request) {
  const supplied = request.headers.get("origin")?.trim();
  return supplied && allowedOrigins.has(supplied) ? supplied : "https://os.samihagwa.com";
}

function invitationDeliveryFailure(error: { code?: string; status?: number }) {
  const rateLimited = error.status === 429 || error.code === "over_email_send_rate_limit";
  return rateLimited
    ? {
      status: 429,
      body: {
        code: "email_delivery_rate_limited",
        message: "لم تُرسل الرسالة؛ وصل نظام البريد إلى الحد المؤقت للإرسال. جرّب لاحقًا أو اطلب من مالك المنصة تفعيل مزوّد البريد المخصص.",
      },
    }
    : {
      status: 503,
      body: {
        code: "email_delivery_unavailable",
        message: "لم تُرسل رسالة الدخول بسبب عطل في مزوّد البريد. اطلب من مالك المنصة مراجعة إعدادات البريد ثم أعد المحاولة.",
      },
    };
}

export default {
  async fetch(request: Request) {
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (request.method !== "POST") return jsonResponse({ message: "Method not allowed" }, 405);

    let body: Record<string, unknown>;
    try {
      const value = await request.json();
      body = typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
    } catch {
      return jsonResponse({ message: "بيانات الطلب غير صالحة." }, 400);
    }

    const email = cleanString(body.email).toLowerCase();
    const invitationToken = cleanString(body.invitation_token);
    if (!email || email.length > 254) {
      return jsonResponse({ accepted: true });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return jsonResponse({ message: "خدمة الدخول غير متاحة مؤقتًا." }, 503);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const tokenHash = invitationToken ? await sha256(invitationToken) : null;
    const { data: accessMode, error: accessError } = await admin.rpc("resolve_workspace_login", {
      target_email: email,
      target_token_hash: tokenHash,
    });

    if (accessError) {
      console.error("resolve_workspace_login failed", accessError.message);
      return jsonResponse({ message: "تعذّر التحقق من صلاحية البريد مؤقتًا." }, 503);
    }

    // Keep the public response identical for approved and unknown emails. This
    // prevents the login form from becoming a team-email enumeration endpoint.
    if (accessMode !== "existing" && accessMode !== "invitation") {
      return jsonResponse({ accepted: true });
    }

    const origin = requestOrigin(request);
    const redirectTo = accessMode === "invitation"
      ? `${origin}/join?code=${encodeURIComponent(invitationToken)}`
      : `${origin}/tasks`;
    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: otpError } = await authClient.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: accessMode === "invitation",
        emailRedirectTo: redirectTo,
      },
    });

    if (otpError) {
      console.error("invite-only OTP request failed", otpError.code, otpError.status, otpError.message);
      // A valid invitation token is a high-entropy secret and is already bound
      // to this exact email. Returning a delivery error here does not expose the
      // team directory, and prevents a false "email sent" confirmation.
      if (accessMode === "invitation") {
        const failure = invitationDeliveryFailure(otpError);
        return jsonResponse(failure.body, failure.status);
      }
    }
    return jsonResponse({ accepted: true });
  },
};
