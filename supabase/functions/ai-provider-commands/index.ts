import { createSupabaseContext } from "npm:@supabase/server@1.4.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2.112.3/cors";
import {
  fetchProviderJson,
  normalizePublicHttpsBaseUrl,
  parseProviderRuntime,
  safeProviderFailure,
  type AiProtocol,
} from "../_shared/ai-provider.ts";

const responseHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const protocols = new Set<AiProtocol>(["openai_chat_completions", "openai_responses"]);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function testBody(protocol: AiProtocol, model: string) {
  if (protocol === "openai_responses") {
    return { model, input: "Reply with READY only.", max_output_tokens: 16, store: false };
  }
  return {
    model,
    messages: [{ role: "user", content: "Reply with READY only." }],
    max_tokens: 16,
    stream: false,
  };
}

export default {
  async fetch(request: Request) {
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (request.method !== "POST") return jsonResponse({ message: "Method not allowed" }, 405);

    const { data: context, error: authError } = await createSupabaseContext(request, { auth: "user" });
    const userId = context?.userClaims?.id;
    if (authError || !userId) return jsonResponse({ message: "يجب تسجيل الدخول أولًا." }, 401);

    let body: Record<string, unknown>;
    try { body = await request.json(); } catch { return jsonResponse({ message: "بيانات الطلب غير صالحة." }, 400); }
    const action = text(body.action);

    try {
      if (action === "save_provider") {
        const organizationId = text(body.organization_id);
        const providerId = text(body.provider_id) || null;
        const name = text(body.name);
        const protocol = text(body.protocol) as AiProtocol;
        const baseUrl = normalizePublicHttpsBaseUrl(body.base_url);
        const model = text(body.model);
        const apiKey = text(body.api_key);
        if (!organizationId || name.length < 2 || !protocols.has(protocol) || !model || model.length > 200) {
          return jsonResponse({ message: "أكمل اسم المزوّد والبروتوكول والرابط والموديل." }, 400);
        }
        const { data, error } = await context.supabaseAdmin.rpc("save_ai_provider", {
          target_user_id: userId,
          target_organization_id: organizationId,
          target_provider_id: providerId,
          provider_name: name,
          provider_protocol: protocol,
          provider_base_url: baseUrl,
          provider_model: model,
          provider_api_key: apiKey,
          provider_is_default: Boolean(body.is_default),
        });
        if (error) {
          const duplicate = error.code === "23505";
          return jsonResponse({ message: duplicate ? "يوجد مزوّد بنفس الاسم بالفعل." : "تعذّر حفظ المزوّد. تأكد أنك مالك مساحة العمل." }, duplicate ? 409 : 400);
        }
        return jsonResponse({ providerId: data });
      }

      const providerId = text(body.provider_id);
      if (!providerId) return jsonResponse({ message: "اختر مزوّدًا أولًا." }, 400);

      if (action === "set_default") {
        const { error } = await context.supabaseAdmin.rpc("set_default_ai_provider", {
          target_user_id: userId, target_provider_id: providerId,
        });
        if (error) return jsonResponse({ message: "تعذّر تغيير المزوّد الافتراضي." }, 400);
        return jsonResponse({ ok: true });
      }

      if (action === "delete_provider") {
        const { error } = await context.supabaseAdmin.rpc("delete_ai_provider", {
          target_user_id: userId, target_provider_id: providerId,
        });
        if (error) return jsonResponse({ message: "تعذّر حذف المزوّد." }, 400);
        return jsonResponse({ ok: true });
      }

      if (action === "test_provider") {
        const { count } = await context.supabaseAdmin.from("audit_events")
          .select("id", { count: "exact", head: true })
          .eq("actor_id", userId)
          .eq("action", "ai_provider.tested")
          .gte("occurred_at", new Date(Date.now() - 60_000).toISOString());
        if ((count ?? 0) >= 5) return jsonResponse({ message: "استنى دقيقة قبل اختبار اتصال جديد." }, 429);

        const { data, error } = await context.supabaseAdmin.rpc("get_ai_provider_runtime_for_owner", {
          target_user_id: userId, target_provider_id: providerId,
        });
        const provider = parseProviderRuntime(data);
        if (error || !provider) return jsonResponse({ message: "تعذّر تحميل إعدادات المزوّد الآمنة." }, 403);

        let success = false;
        let message = "الاتصال ناجح والموديل استجاب.";
        let requestId: string | null = null;
        try {
          const result = await fetchProviderJson(provider, testBody(provider.protocol, provider.model), 20_000);
          requestId = result.requestId;
          success = result.response.ok;
          if (!success) {
            message = result.response.status === 401 || result.response.status === 403
              ? "المفتاح غير مقبول لدى المزوّد."
              : result.response.status === 404
                ? "الرابط أو اسم الموديل غير صحيح."
                : result.response.status === 429
                  ? "المزوّد رفض الاختبار بسبب الرصيد أو حد الاستخدام."
                  : `المزوّد أعاد حالة ${result.response.status}.`;
          }
        } catch (testError) {
          message = safeProviderFailure(testError);
        }
        await context.supabaseAdmin.rpc("record_ai_provider_test", {
          target_user_id: userId,
          target_provider_id: providerId,
          test_success: success,
          test_message: message,
        });
        return jsonResponse({ ok: success, message, requestId }, success ? 200 : 502);
      }

      return jsonResponse({ message: "أمر غير معروف." }, 400);
    } catch (error) {
      return jsonResponse({ message: error instanceof Error ? error.message : "تعذّر تنفيذ الطلب." }, 400);
    }
  },
};
