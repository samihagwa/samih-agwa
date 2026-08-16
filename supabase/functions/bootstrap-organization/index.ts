import { createSupabaseContext } from "npm:@supabase/server@1.4.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2.112.3/cors";

const responseHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

export default {
  async fetch(request: Request) {
    if (request.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return jsonResponse({ message: "Method not allowed" }, 405);
    }

    const { data: context, error: authError } = await createSupabaseContext(
      request,
      { auth: "user" },
    );

    if (authError || !context?.userClaims?.id) {
      return jsonResponse({ message: "يجب تسجيل الدخول أولًا." }, 401);
    }

    const { data: organizationId, error } = await context.supabaseAdmin.rpc(
      "bootstrap_market_whales_organization",
      { target_user_id: context.userClaims.id },
    );

    if (error) {
      const alreadyInitialized = error.message.includes("already initialized");
      return jsonResponse(
        {
          message: alreadyInitialized
            ? "تم إنشاء مساحة ماركت ويلز بالفعل، ويجب دعوتك بواسطة المالك."
            : "تعذّر إنشاء مساحة العمل. حاول مرة أخرى أو راجع سجل النظام.",
        },
        alreadyInitialized ? 409 : 500,
      );
    }

    return jsonResponse({ organizationId }, 201);
  },
};
