import { createSupabaseContext } from "npm:@supabase/server@1.4.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2.112.3/cors";
import {
  extractProviderText,
  fetchProviderJson,
  parseProviderRuntime,
  safeProviderFailure,
  stripJsonFence,
  type AiProviderRuntime,
} from "../_shared/ai-provider.ts";

const responseHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const modes = new Set(["idea", "reference", "improve"]);
const scopes = new Set(["script_variants", "hooks", "production_pack", "recording", "editing", "thumbnail", "caption"]);
const writingScopes = new Set(["script_variants", "hooks"]);
const productionScopes = new Set(["production_pack", "recording", "editing", "thumbnail", "caption"]);

type ScriptVariant = { label: string; hook: string; spoken_script: string; cta: string };
type WritingOutput = { variants?: ScriptVariant[]; hook_variants: string[] };
type ProductionOutput = {
  cta?: string; caption?: string; hashtags?: string[]; recording_notes?: string;
  editing_notes?: string; thumbnail_notes?: string; on_screen_text?: string;
  b_roll_notes?: string; claims_notes?: string;
};

const schemas: Record<string, Record<string, unknown>> = {
  script_variants: {
    type: "object", additionalProperties: false, required: ["variants", "hook_variants"],
    properties: {
      variants: {
        type: "array", minItems: 3, maxItems: 3,
        items: {
          type: "object", additionalProperties: false, required: ["label", "hook", "spoken_script", "cta"],
          properties: {
            label: { type: "string", maxLength: 80 }, hook: { type: "string", maxLength: 500 },
            spoken_script: { type: "string", maxLength: 30000 }, cta: { type: "string", maxLength: 1000 },
          },
        },
      },
      hook_variants: { type: "array", minItems: 3, maxItems: 5, items: { type: "string", maxLength: 500 } },
    },
  },
  hooks: {
    type: "object", additionalProperties: false, required: ["hook_variants"],
    properties: { hook_variants: { type: "array", minItems: 5, maxItems: 5, items: { type: "string", maxLength: 500 } } },
  },
  production_pack: {
    type: "object", additionalProperties: false,
    required: ["cta", "caption", "hashtags", "recording_notes", "editing_notes", "thumbnail_notes", "on_screen_text", "b_roll_notes", "claims_notes"],
    properties: {
      cta: { type: "string", maxLength: 1000 }, caption: { type: "string", maxLength: 5000 },
      hashtags: { type: "array", maxItems: 20, items: { type: "string", maxLength: 100 } },
      recording_notes: { type: "string", maxLength: 5000 }, editing_notes: { type: "string", maxLength: 10000 },
      thumbnail_notes: { type: "string", maxLength: 5000 }, on_screen_text: { type: "string", maxLength: 5000 },
      b_roll_notes: { type: "string", maxLength: 5000 }, claims_notes: { type: "string", maxLength: 5000 },
    },
  },
  recording: {
    type: "object", additionalProperties: false, required: ["recording_notes"],
    properties: { recording_notes: { type: "string", maxLength: 5000 } },
  },
  editing: {
    type: "object", additionalProperties: false,
    required: ["editing_notes", "on_screen_text", "b_roll_notes", "claims_notes"],
    properties: {
      editing_notes: { type: "string", maxLength: 10000 }, on_screen_text: { type: "string", maxLength: 5000 },
      b_roll_notes: { type: "string", maxLength: 5000 }, claims_notes: { type: "string", maxLength: 5000 },
    },
  },
  thumbnail: {
    type: "object", additionalProperties: false, required: ["thumbnail_notes"],
    properties: { thumbnail_notes: { type: "string", maxLength: 5000 } },
  },
  caption: {
    type: "object", additionalProperties: false, required: ["cta", "caption", "hashtags"],
    properties: {
      cta: { type: "string", maxLength: 1000 }, caption: { type: "string", maxLength: 5000 },
      hashtags: { type: "array", maxItems: 20, items: { type: "string", maxLength: 100 } },
    },
  },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function textList(value: unknown, limit = 100) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, limit);
}
function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function normalizeArabic(value: string) {
  return value.toLocaleLowerCase("ar").replace(/[\u064B-\u065F\u0670]/g, "").replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[^\p{L}\p{N}.]+/gu, " ").replace(/\s+/g, " ").trim();
}
function extractCalibratedSamples(value: unknown) {
  const examples = text(value);
  const matches = examples.match(/\[عينة معتمدة من سميح \| script:[^\]]+\][\s\S]*?\[نهاية العينة\]/g) ?? [];
  return matches.slice(-6).map((sample) => sample.slice(0, 5000));
}

function scriptInput(rawScript: Record<string, unknown>, mode: string, scope: string) {
  const base = {
    id: rawScript.id, title: rawScript.title, input_mode: rawScript.input_mode,
    source_url: rawScript.source_url, source_text: rawScript.source_text, objective: rawScript.objective,
    audience: rawScript.audience, platform: rawScript.platform, duration_seconds: rawScript.duration_seconds,
    content_pillar: rawScript.content_pillar, edit_version: rawScript.edit_version,
  };
  if (productionScopes.has(scope) || mode === "improve") {
    return { ...base, hook_variants: rawScript.hook_variants, spoken_script: rawScript.spoken_script };
  }
  return base;
}

function prepareAiContext(rawContext: unknown, mode: string, scope: string, selectedStory: string, generationDirection: string) {
  const context = record(rawContext); const rawProfile = record(context.voice_profile); const stories = textList(rawProfile.story_bank);
  if (selectedStory && !stories.includes(selectedStory)) return { error: "القصة المختارة لم تعد موجودة في بصمتك. حدّث الصفحة واخترها من جديد." };
  return {
    context: {
      script: scriptInput(record(context.script), mode, scope),
      voice_profile: {
        voice_summary: text(rawProfile.voice_summary), writing_rules: textList(rawProfile.writing_rules, 50),
        banned_phrases: textList(rawProfile.banned_phrases, 50), source_notes: text(rawProfile.source_notes),
        calibrated_samples: extractCalibratedSamples(rawProfile.approved_examples),
      },
      story_use: selectedStory ? { allowed: true, selected_story: selectedStory } : { allowed: false, selected_story: null },
      generation_direction: generationDirection || null,
      brand_articles: Array.isArray(context.brand_articles) ? context.brand_articles : [],
    },
    guard: { bannedPhrases: textList(rawProfile.banned_phrases, 50), stories, selectedStory },
  };
}

function storyFingerprintAppears(output: string, story: string) {
  const normalizedOutput = normalizeArabic(output); const normalizedStory = normalizeArabic(story);
  const label = normalizedStory.split(":")[0].replace(/^قصه\s+/, "").trim();
  if (label.length >= 8 && normalizedOutput.includes(label)) return true;
  const numbers = [...new Set(normalizedStory.match(/\b\d+(?:\.\d+)?(?:x)?\b/g) ?? [])];
  return numbers.filter((number) => normalizedOutput.includes(number)).length >= 2;
}
function writingText(generated: WritingOutput) {
  return [...generated.hook_variants, ...(generated.variants ?? []).flatMap((variant) => [variant.hook, variant.spoken_script, variant.cta])].join("\n");
}
function generationIssues(generated: WritingOutput, guard: { bannedPhrases: string[]; stories: string[]; selectedStory: string }, mode: string) {
  const output = writingText(generated); const normalizedOutput = normalizeArabic(output); const issues: string[] = [];
  for (const phrase of guard.bannedPhrases) if (phrase.length >= 3 && normalizedOutput.includes(normalizeArabic(phrase))) issues.push(`استخدم عبارة ممنوعة: «${phrase}»`);
  const artificialPatterns: Array<[RegExp, string]> = [
    [/السؤال (ده|دا) (بيوصلني|بيجيلي) كتير/, "افتتاح محفوظ من نوع «السؤال ده بيجيلي كتير»"],
    [/الدرس مش .{0,180}الدرس (ان|إن)/, "تركيب AI من نوع «الدرس مش... الدرس إن...»"],
    [/الدماغ بتتحول من وضع/, "تفسير نفسي مصطنع بدل وصف تصرف المتداول"],
    [/مش مجرد .{0,120} (ده|دي)/, "مقارنة مصطنعة من نوع «مش مجرد... دي...»"],
  ];
  for (const [pattern, issue] of artificialPatterns) if (pattern.test(normalizedOutput)) issues.push(issue);
  if (!guard.selectedStory && mode !== "improve") {
    if (/انا (الشخص ده|حصل معايا|مريت|خسرت|كسبت|ربحت)/.test(normalizedOutput)) issues.push("اخترع أو أضاف قصة بصيغة المتكلم من غير اختيارك");
    if (guard.stories.some((story) => storyFingerprintAppears(output, story))) issues.push("استخدم واقعة أو أرقامًا من بنك القصص من غير اختيارك");
  }
  return [...new Set(issues)].slice(0, 5);
}

function validWritingOutput(value: unknown, scope: string): value is WritingOutput {
  const item = record(value); const hooks = textList(item.hook_variants, 5);
  if (scope === "hooks") return hooks.length === 5;
  if (!Array.isArray(item.variants) || item.variants.length !== 3 || hooks.length < 3) return false;
  return item.variants.every((raw) => {
    const variant = record(raw);
    return text(variant.label).length > 0 && text(variant.hook).length > 0
      && text(variant.spoken_script).length >= 20 && typeof variant.cta === "string";
  });
}
function validProductionOutput(value: unknown, scope: string): value is ProductionOutput {
  const item = record(value);
  const stringFields: Record<string, string[]> = {
    production_pack: ["cta", "caption", "recording_notes", "editing_notes", "thumbnail_notes", "on_screen_text", "b_roll_notes", "claims_notes"],
    recording: ["recording_notes"], editing: ["editing_notes", "on_screen_text", "b_roll_notes", "claims_notes"],
    thumbnail: ["thumbnail_notes"], caption: ["cta", "caption"],
  };
  if (!(stringFields[scope] ?? []).every((key) => typeof item[key] === "string")) return false;
  return !["production_pack", "caption"].includes(scope) || Array.isArray(item.hashtags) && item.hashtags.every((tag) => typeof tag === "string");
}

function writingInstructions(mode: string, scope: string) {
  const modeInstruction = mode === "reference" ? "استخرج المبدأ من المرجع ثم اكتب تنفيذًا أصليًا بالكامل؛ ممنوع نسخ الصياغة أو ترتيب المنافس."
    : mode === "improve" ? "حافظ على الفكرة والحقائق الموجودة، وقدّم بدائل محسنة بدون تغيير المعنى."
      : "حوّل الفكرة إلى كلام طبيعي قابل للتسجيل.";
  const deliverable = scope === "hooks" ? "أنت تولد 5 بدائل هوك فقط. لا تكتب اسكريبتًا ولا كابشنًا ولا أي تعليمات تنفيذ."
    : "قدّم 3 نسخ كاملة مختلفة بوضوح في الزاوية أو الإيقاع، لا نفس النص بتبديل كلمات. وقدّم 3 إلى 5 بدائل هوك. ممنوع تمامًا توليد مونتاج أو غلاف أو كابشن أو أي خطوة إنتاج.";
  return `أنت كاتب محتوى داخل Market Whales. ${deliverable} ${modeInstruction}

اكتب بالمصري الطبيعي المباشر، لا كمقال ولا كنص AI محفوظ. ترتيب الأولوية: توجيه سميح الحالي، بيانات الفكرة، قواعد بصمته، العينات المعتمدة، ثم مراجع البراند. العينات مرجع للإيقاع فقط؛ ممنوع نسخ جملة أو قصة أو رقم منها.

قاعدة القصص حاسمة: لو story_use.allowed=false ممنوع إضافة تجربة شخصية أو حكاية بصيغة المتكلم أو أرقام من بنك القصص. لو allowed=true استخدم القصة المختارة وحدها وفقط إذا خدمت الفكرة. في وضع improve لا تضف قصة جديدة.

لا تبدأ تلقائيًا بتكرار العنوان كسؤال. افتح بمشهد أو تصرف يراه المتداول. لا تستخدم «السؤال ده بيجيلي كتير»، ولا «الدرس مش... الدرس إن...»، ولا تشخيصات نفسية متزوقة. لا تعد بأرباح ولا تستخدم ضمانات. لو المدخل قليل اكتب أقصر ولا تخترع معلومات. CTA موجود داخل نهاية كل نسخة كاملة، ومعه cta منفصل كبيانات تقنية فقط؛ المستخدم لن يكتبه مرتين. أعد JSON فقط حسب المخطط.`;
}
function productionInstructions(scope: string) {
  const target = scope === "production_pack" ? "حزمة التنفيذ كاملة" : scope === "recording" ? "تعليمات التسجيل فقط"
    : scope === "editing" ? "تعليمات المونتاج والنصوص البصرية فقط" : scope === "thumbnail" ? "تعليمات الغلاف فقط" : "الكابشن والهاشتاجات فقط";
  return `أنت مدير إنتاج محتوى داخل Market Whales. أنشئ ${target} من spoken_script المعتمد حرفيًا.

النص المعتمد هو مصدر الحقيقة الوحيد: ممنوع إعادة كتابته أو إضافة فقرة أو إعطاء تعليمات لمشهد غير موجود فيه. اربط أي توقيت أو زوم أو B-roll بجملة موجودة فعلًا، واكتب اقتباسًا قصيرًا منها بدل افتراض الثواني إن لم يوجد تسجيل بعد. لو معلومة بصرية أو مصدر غير متاح، اكتب أنها مطلوبة ولا تخترع رابطًا. التعليمات عملية ومختصرة وواضحة لصاحب التسجيل والمونتير والمصمم. CTA المنفصل بيانات تقنية مستخرجة من نهاية النص، وليس نصًا ثانيًا على المستخدم مراجعته. أعد JSON فقط حسب المخطط.`;
}
function providerBody(provider: AiProviderRuntime, mode: string, scope: string, aiContext: unknown) {
  const instructions = writingScopes.has(scope) ? writingInstructions(mode, scope) : productionInstructions(scope);
  const schema = schemas[scope]; const input = `السياق المعتمد:\n${JSON.stringify(aiContext).slice(0, 70000)}`;
  if (provider.protocol === "openai_responses") {
    return { model: provider.model, store: false, instructions, input, text: { format: { type: "json_schema", name: `market_whales_${scope}`, strict: true, schema } } };
  }
  return {
    model: provider.model,
    messages: [{ role: "system", content: `${instructions}\nالمخطط المطلوب حرفيًا:\n${JSON.stringify(schema)}` }, { role: "user", content: input }],
    response_format: { type: "json_object" }, max_tokens: scope === "production_pack" ? 12000 : 8000, stream: false,
  };
}

export default {
  async fetch(request: Request) {
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (request.method !== "POST") return jsonResponse({ message: "Method not allowed" }, 405);
    const { data: context, error: authError } = await createSupabaseContext(request, { auth: "user" });
    if (authError || !context?.userClaims?.id) return jsonResponse({ message: "يجب تسجيل الدخول أولًا." }, 401);

    let body: Record<string, unknown>;
    try { body = await request.json(); } catch { return jsonResponse({ message: "بيانات الطلب غير صالحة." }, 400); }
    const scriptId = text(body.script_id); const researchId = text(body.research_id);
    const mode = text(body.mode) || "idea"; const scope = text(body.scope) || "script_variants";
    const selectedStory = text(body.selected_story); const generationDirection = text(body.generation_direction);
    const expectedVersion = Number(body.expected_edit_version);
    if ((!scriptId && !researchId) || (scriptId && researchId) || !modes.has(mode) || !scopes.has(scope)) return jsonResponse({ message: "حدد الفكرة ونوع مساعدة AI المطلوب." }, 400);
    if (researchId && !writingScopes.has(scope)) return jsonResponse({ message: "تعليمات التنفيذ لا تبدأ إلا بعد حفظ واعتماد الاسكريبت." }, 400);
    if (scriptId && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)) return jsonResponse({ message: "حدّث الاسكريبت قبل استخدام AI." }, 400);
    if (selectedStory.length > 2000 || generationDirection.length > 1500) return jsonResponse({ message: "اختيار القصة أو توجيه الكتابة أطول من المسموح." }, 400);

    const { count } = await context.supabaseAdmin.from("audit_events").select("id", { count: "exact", head: true })
      .eq("actor_id", context.userClaims.id).in("action", ["script.ai_preview_generated", "script.ai_production_generated"])
      .gte("occurred_at", new Date(Date.now() - 60_000).toISOString());
    if ((count ?? 0) >= 5) return jsonResponse({ message: "استنى دقيقة قبل طلب توليد جديد لحماية الميزانية." }, 429);

    const contextRpc = researchId ? "get_script_research_ai_context" : "get_script_ai_context";
    const contextArgs = researchId ? { target_user_id: context.userClaims.id, target_research_id: researchId }
      : { target_user_id: context.userClaims.id, target_script_id: scriptId };
    const { data: aiContext, error: contextError } = await context.supabaseAdmin.rpc(contextRpc, contextArgs);
    if (contextError || !aiContext) return jsonResponse({ message: "ليس لديك صلاحية للتوليد أو العنصر لم يعد قابلًا للتعديل." }, 403);

    const contextObject = aiContext as Record<string, unknown>; const contextScript = record(contextObject.script);
    if (scriptId && Number(contextScript.edit_version) !== expectedVersion) return jsonResponse({ message: "الاسكريبت اتعدل. حدّث الصفحة قبل استخدام AI." }, 409);
    if (productionScopes.has(scope) && contextScript.status !== "ready_to_record") return jsonResponse({ message: "اعتمد النص النهائي «جاهز للتصوير» أولًا، وبعدها أنشئ تعليمات التنفيذ." }, 400);

    const providerRpc = researchId ? "get_script_research_ai_provider_runtime" : "get_script_ai_provider_runtime";
    const { data: providerData, error: providerError } = await context.supabaseAdmin.rpc(providerRpc, contextArgs);
    const provider = parseProviderRuntime(providerData);
    if (providerError || !provider) return jsonResponse({ message: "أضف مزوّد AI من الإعدادات واجعله افتراضيًا قبل التوليد." }, 503);

    const prepared = prepareAiContext(aiContext, mode, scope, selectedStory, generationDirection);
    if ("error" in prepared) return jsonResponse({ message: prepared.error }, 400);
    let providerResult;
    try { providerResult = await fetchProviderJson(provider, providerBody(provider, mode, scope, prepared.context), 90_000); }
    catch (providerRequestError) { return jsonResponse({ message: safeProviderFailure(providerRequestError) }, 502); }
    if (!providerResult.response.ok) {
      return jsonResponse({ message: providerResult.response.status === 429 ? "المزوّد رفض الطلب بسبب الرصيد أو حد الاستخدام." : "تعذّر التوليد من المزوّد الحالي.", requestId: providerResult.requestId }, providerResult.response.status === 429 ? 429 : 502);
    }

    let generated: unknown;
    try { generated = JSON.parse(stripJsonFence(extractProviderText(providerResult.json, provider.protocol))); } catch { generated = null; }
    if (writingScopes.has(scope)) {
      if (!validWritingOutput(generated, scope)) return jsonResponse({ message: "وصلت نتيجة كتابة غير مكتملة ولم نحفظ شيئًا." }, 502);
      const issues = generationIssues(generated, prepared.guard, mode);
      if (issues.length) return jsonResponse({ message: `رفضنا المسودة لأنها خرجت عن بصمتك: ${issues.join("، ")}.`, issues }, 422);
    } else if (!validProductionOutput(generated, scope)) return jsonResponse({ message: "وصلت حزمة تنفيذ غير مكتملة ولم نغيّر الاسكريبت." }, 502);

    let editVersion: number | null = null;
    if (productionScopes.has(scope)) {
      const production = generated as ProductionOutput;
      const { data, error: saveError } = await context.supabaseAdmin.rpc("save_ai_script_production", {
        target_user_id: context.userClaims.id, target_script_id: scriptId, expected_edit_version: expectedVersion,
        generation_scope: scope, generated_cta: text(production.cta), generated_caption: text(production.caption),
        generated_hashtags: textList(production.hashtags, 20), generated_recording_notes: text(production.recording_notes),
        generated_editing_notes: text(production.editing_notes), generated_thumbnail_notes: text(production.thumbnail_notes),
        generated_on_screen_text: text(production.on_screen_text), generated_b_roll_notes: text(production.b_roll_notes),
        generated_claims_notes: text(production.claims_notes),
      });
      if (saveError) return jsonResponse({ message: saveError.message.includes("full production pack")
        ? "النص اتعدل بعد آخر حزمة. أعد إنشاء حزمة التنفيذ كاملة أولًا."
        : "تغيّر الاسكريبت أثناء التوليد؛ حدّث الصفحة قبل إعادة المحاولة." }, 409);
      editVersion = Number(data);
    } else {
      await context.supabaseAdmin.from("audit_events").insert({
        organization_id: text(contextScript.organization_id), actor_id: context.userClaims.id,
        action: "script.ai_preview_generated", entity_type: researchId ? "script_research" : "script",
        entity_id: researchId || scriptId, after_data: { scope, mode, provider_id: provider.id },
      });
    }
    return jsonResponse({ generated, editVersion, saved: productionScopes.has(scope), provider: { name: provider.name, model: provider.model } });
  },
};
