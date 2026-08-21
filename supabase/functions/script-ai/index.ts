import { createSupabaseContext } from "npm:@supabase/server@1.4.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2.112.3/cors";

const responseHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const modes = new Set(["idea", "reference", "improve"]);
const outputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "hook_variants", "spoken_script", "cta", "caption", "hashtags", "recording_notes",
    "editing_notes", "thumbnail_notes", "on_screen_text", "b_roll_notes", "claims_notes",
  ],
  properties: {
    hook_variants: { type: "array", minItems: 3, maxItems: 5, items: { type: "string", maxLength: 500 } },
    spoken_script: { type: "string", maxLength: 30000 },
    cta: { type: "string", maxLength: 1000 },
    caption: { type: "string", maxLength: 5000 },
    hashtags: { type: "array", maxItems: 20, items: { type: "string", maxLength: 100 } },
    recording_notes: { type: "string", maxLength: 5000 },
    editing_notes: { type: "string", maxLength: 10000 },
    thumbnail_notes: { type: "string", maxLength: 5000 },
    on_screen_text: { type: "string", maxLength: 5000 },
    b_roll_notes: { type: "string", maxLength: 5000 },
    claims_notes: { type: "string", maxLength: 5000 },
  },
} as const;

type GeneratedScript = {
  hook_variants: string[];
  spoken_script: string;
  cta: string;
  caption: string;
  hashtags: string[];
  recording_notes: string;
  editing_notes: string;
  thumbnail_notes: string;
  on_screen_text: string;
  b_roll_notes: string;
  claims_notes: string;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function generatedScript(value: unknown): value is GeneratedScript {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const strings = ["spoken_script", "cta", "caption", "recording_notes", "editing_notes", "thumbnail_notes", "on_screen_text", "b_roll_notes", "claims_notes"];
  return strings.every((key) => typeof item[key] === "string")
    && Array.isArray(item.hook_variants) && item.hook_variants.every((hook) => typeof hook === "string")
    && Array.isArray(item.hashtags) && item.hashtags.every((tag) => typeof tag === "string");
}

function extractOutputText(response: Record<string, unknown>) {
  if (typeof response.output_text === "string") return response.output_text;
  if (!Array.isArray(response.output)) return "";
  for (const output of response.output) {
    if (!output || typeof output !== "object") continue;
    const content = (output as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part && typeof part === "object" && (part as Record<string, unknown>).type === "output_text" && typeof (part as Record<string, unknown>).text === "string") {
        return String((part as Record<string, unknown>).text);
      }
    }
  }
  return "";
}

function instructionsFor(mode: string) {
  const modeInstruction = mode === "reference"
    ? "استخرج المبدأ من المرجع ثم اكتب تنفيذًا أصليًا بالكامل؛ ممنوع نسخ الصياغة أو ترتيب المنافس."
    : mode === "improve"
      ? "حافظ على الفكرة والحقائق الموجودة، وحسّن الإيقاع والوضوح والهوك بدون تغيير المعنى."
      : "حوّل الفكرة إلى اسكريبت أصلي قابل للتسجيل والتنفيذ.";
  return `أنت كاتب محتوى داخل Market Whales. اكتب بالعربية المصرية الطبيعية، مباشرة وعملية، بلا فصحى متكلفة وبلا تهويل. ${modeInstruction}
التزم ببصمة الكاتب وقواعد البراند المرفقة متى كانت موجودة. المحتوى تعليمي في التداول: لا تعد بأرباح، لا تستخدم ضمانات، وافصل الرأي عن الحقيقة. لو توجد معلومة تحتاج تحققًا ضعها في claims_notes بدل اختراع مصدر. اجعل spoken_script كلامًا يُقال أمام الكاميرا، والكابشن مكملًا لا نسخة مكررة. أعط تعليمات مونتاج وغلاف قابلة للتنفيذ. أعد JSON فقط حسب المخطط.`;
}

export default {
  async fetch(request: Request) {
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (request.method !== "POST") return jsonResponse({ message: "Method not allowed" }, 405);

    const { data: context, error: authError } = await createSupabaseContext(request, { auth: "user" });
    if (authError || !context?.userClaims?.id) return jsonResponse({ message: "يجب تسجيل الدخول أولًا." }, 401);

    let body: Record<string, unknown>;
    try { body = await request.json(); } catch { return jsonResponse({ message: "بيانات الطلب غير صالحة." }, 400); }
    const scriptId = text(body.script_id);
    const mode = text(body.mode);
    const expectedVersion = Number(body.expected_edit_version);
    if (!scriptId || !modes.has(mode) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      return jsonResponse({ message: "اختر نوع مساعدة AI وحدّث الاسكريبت قبل المحاولة." }, 400);
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return jsonResponse({ message: "ميزة AI جاهزة لكن مفتاح OpenAI غير مضبوط بعد." }, 503);

    const { count } = await context.supabaseAdmin.from("audit_events")
      .select("id", { count: "exact", head: true })
      .eq("actor_id", context.userClaims.id)
      .eq("action", "script.ai_generated")
      .gte("occurred_at", new Date(Date.now() - 60_000).toISOString());
    if ((count ?? 0) >= 5) return jsonResponse({ message: "استنى دقيقة قبل طلب توليد جديد لحماية الميزانية." }, 429);

    const { data: aiContext, error: contextError } = await context.supabaseAdmin.rpc("get_script_ai_context", {
      target_user_id: context.userClaims.id,
      target_script_id: scriptId,
    });
    if (contextError || !aiContext) return jsonResponse({ message: "ليس لديك صلاحية لتوليد هذا الاسكريبت أو أنه لم يعد قابلًا للتعديل." }, 403);

    const contextObject = aiContext as Record<string, unknown>;
    const contextScript = contextObject.script as Record<string, unknown> | undefined;
    if (Number(contextScript?.edit_version) !== expectedVersion) {
      return jsonResponse({ message: "الاسكريبت اتعدل. حدّث الصفحة قبل استخدام AI حتى لا نخسر تعديلاتك." }, 409);
    }

    const providerResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: Deno.env.get("OPENAI_SCRIPT_MODEL") ?? "gpt-5.4-mini",
        store: false,
        instructions: instructionsFor(mode),
        input: `بيانات الاسكريبت والسياق المعتمد:\n${JSON.stringify(aiContext).slice(0, 70000)}`,
        text: {
          format: {
            type: "json_schema",
            name: "market_whales_script",
            strict: true,
            schema: outputSchema,
          },
        },
      }),
    });

    if (!providerResponse.ok) {
      const requestId = providerResponse.headers.get("x-request-id");
      return jsonResponse({ message: "تعذّر توليد الاسكريبت الآن. حاول لاحقًا.", requestId }, providerResponse.status === 429 ? 429 : 502);
    }

    const providerJson = await providerResponse.json() as Record<string, unknown>;
    let generated: unknown;
    try { generated = JSON.parse(extractOutputText(providerJson)); } catch { generated = null; }
    if (!generatedScript(generated)) return jsonResponse({ message: "وصلت نتيجة غير مكتملة من AI ولم نغيّر الاسكريبت." }, 502);

    const { data: editVersion, error: saveError } = await context.supabaseAdmin.rpc("save_ai_script_generation", {
      target_user_id: context.userClaims.id,
      target_script_id: scriptId,
      expected_edit_version: expectedVersion,
      script_hook_variants: generated.hook_variants,
      script_spoken_script: generated.spoken_script,
      script_cta: generated.cta,
      script_caption: generated.caption,
      script_hashtags: generated.hashtags,
      script_recording_notes: generated.recording_notes,
      script_editing_notes: generated.editing_notes,
      script_thumbnail_notes: generated.thumbnail_notes,
      script_on_screen_text: generated.on_screen_text,
      script_b_roll_notes: generated.b_roll_notes,
      script_claims_notes: generated.claims_notes,
    });
    if (saveError) return jsonResponse({ message: "تغيّر الاسكريبت أثناء التوليد؛ حدّث الصفحة قبل إعادة المحاولة." }, 409);

    return jsonResponse({ generated, editVersion });
  },
};
