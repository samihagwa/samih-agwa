import { createSupabaseContext } from "npm:@supabase/server@1.4.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2.112.3/cors";

const responseHeaders = { ...corsHeaders, "Content-Type": "application/json" };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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

    if (body.action !== "lookup_exness_account") return jsonResponse({ message: "أمر تكامل غير معروف." }, 400);
    const organizationId = text(body.organization_id);
    const lookupValue = text(body.lookup_value);
    if (!organizationId || !/^[A-Za-z0-9._-]{3,160}$/.test(lookupValue)) {
      return jsonResponse({ message: "اكتب رقم حساب أو معرّف عميل صحيحًا." }, 400);
    }

    const { data, error } = await context.supabaseAdmin.rpc("lookup_exness_account", {
      target_user_id: context.userClaims.id,
      target_organization_id: organizationId,
      lookup_value: lookupValue,
    });
    if (error) {
      if (/CRM access is required/i.test(error.message)) return jsonResponse({ message: "حسابك غير مصرح له ببحث الوكالة." }, 403);
      if (/valid brokerage account/i.test(error.message)) return jsonResponse({ message: "اكتب رقم حساب أو معرّف عميل صحيحًا." }, 400);
      return jsonResponse({ message: "تعذّر فحص حساب الوكالة الآن." }, 500);
    }
    return jsonResponse(data?.[0] ?? { integration_ready: false, under_agency: false, is_active: false, last_synced_at: null });
  },
};

