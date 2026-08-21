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

function textList(value: unknown, limit = 100) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string")
    .map((item) => item.trim()).filter(Boolean).slice(0, limit);
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeArabic(value: string) {
  return value.toLocaleLowerCase("ar")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}.]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCalibratedSamples(value: unknown) {
  const examples = text(value);
  const matches = examples.match(/\[عينة معتمدة من سميح \| script:[^\]]+\][\s\S]*?\[نهاية العينة\]/g) ?? [];
  return matches.slice(-6).map((sample) => sample.slice(0, 5000));
}

function scriptInput(rawScript: Record<string, unknown>, mode: string) {
  const base = {
    id: rawScript.id,
    title: rawScript.title,
    input_mode: rawScript.input_mode,
    source_url: rawScript.source_url,
    source_text: rawScript.source_text,
    objective: rawScript.objective,
    audience: rawScript.audience,
    platform: rawScript.platform,
    duration_seconds: rawScript.duration_seconds,
    content_pillar: rawScript.content_pillar,
    edit_version: rawScript.edit_version,
  };
  if (mode !== "improve") return base;
  return {
    ...base,
    hook_variants: rawScript.hook_variants,
    spoken_script: rawScript.spoken_script,
    cta: rawScript.cta,
    caption: rawScript.caption,
    recording_notes: rawScript.recording_notes,
    editing_notes: rawScript.editing_notes,
    thumbnail_notes: rawScript.thumbnail_notes,
    on_screen_text: rawScript.on_screen_text,
    b_roll_notes: rawScript.b_roll_notes,
    claims_notes: rawScript.claims_notes,
  };
}

function prepareAiContext(rawContext: unknown, mode: string, selectedStory: string, generationDirection: string) {
  const context = record(rawContext);
  const rawProfile = record(context.voice_profile);
  const stories = textList(rawProfile.story_bank);
  if (selectedStory && !stories.includes(selectedStory)) {
    return { error: "القصة المختارة لم تعد موجودة في بصمتك. حدّث الصفحة واخترها من جديد." };
  }
  return {
    context: {
      script: scriptInput(record(context.script), mode),
      voice_profile: {
        voice_summary: text(rawProfile.voice_summary),
        writing_rules: textList(rawProfile.writing_rules, 50),
        banned_phrases: textList(rawProfile.banned_phrases, 50),
        source_notes: text(rawProfile.source_notes),
        calibrated_samples: extractCalibratedSamples(rawProfile.approved_examples),
      },
      story_use: selectedStory
        ? { allowed: true, selected_story: selectedStory }
        : { allowed: false, selected_story: null },
      generation_direction: generationDirection || null,
      brand_articles: Array.isArray(context.brand_articles) ? context.brand_articles : [],
    },
    guard: {
      bannedPhrases: textList(rawProfile.banned_phrases, 50),
      stories,
      selectedStory,
    },
  };
}

function generatedText(generated: GeneratedScript) {
  return [
    ...generated.hook_variants, generated.spoken_script, generated.cta, generated.caption,
    generated.recording_notes, generated.editing_notes, generated.thumbnail_notes,
    generated.on_screen_text, generated.b_roll_notes, generated.claims_notes,
  ].join("\n");
}

function storyFingerprintAppears(output: string, story: string) {
  const normalizedOutput = normalizeArabic(output);
  const normalizedStory = normalizeArabic(story);
  const label = normalizedStory.split(":")[0].replace(/^قصه\s+/, "").trim();
  if (label.length >= 8 && normalizedOutput.includes(label)) return true;
  const numbers = [...new Set(normalizedStory.match(/\b\d+(?:\.\d+)?(?:x)?\b/g) ?? [])];
  return numbers.filter((number) => normalizedOutput.includes(number)).length >= 2;
}

function generationIssues(
  generated: GeneratedScript,
  guard: { bannedPhrases: string[]; stories: string[]; selectedStory: string },
  mode: string,
) {
  const output = generatedText(generated);
  const normalizedOutput = normalizeArabic(output);
  const issues: string[] = [];
  for (const phrase of guard.bannedPhrases) {
    if (phrase.length >= 3 && normalizedOutput.includes(normalizeArabic(phrase))) {
      issues.push(`استخدم عبارة ممنوعة: «${phrase}»`);
    }
  }
  const artificialPatterns: Array<[RegExp, string]> = [
    [/السؤال (ده|دا) (بيوصلني|بيجيلي) كتير/, "افتتاح محفوظ من نوع «السؤال ده بيجيلي كتير»"],
    [/الدرس مش .{0,180}الدرس (ان|إن)/, "تركيب AI من نوع «الدرس مش... الدرس إن...»"],
    [/الدماغ بتتحول من وضع/, "تفسير نفسي مصطنع بدل وصف تصرف المتداول"],
    [/مش مجرد .{0,120} (ده|دي)/, "مقارنة مصطنعة من نوع «مش مجرد... دي...»"],
  ];
  for (const [pattern, issue] of artificialPatterns) if (pattern.test(normalizedOutput)) issues.push(issue);

  if (!guard.selectedStory && mode !== "improve") {
    if (/انا (الشخص ده|حصل معايا|مريت|خسرت|كسبت|ربحت)/.test(normalizedOutput)) {
      issues.push("اخترع أو أضاف قصة بصيغة المتكلم من غير اختيارك");
    }
    if (guard.stories.some((story) => storyFingerprintAppears(output, story))) {
      issues.push("استخدم واقعة أو أرقامًا من بنك القصص من غير اختيارك");
    }
  }
  return [...new Set(issues)].slice(0, 5);
}

function generatedScript(value: unknown): value is GeneratedScript {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const strings = ["spoken_script", "cta", "caption", "recording_notes", "editing_notes", "thumbnail_notes", "on_screen_text", "b_roll_notes", "claims_notes"];
  return strings.every((key) => typeof item[key] === "string")
    && Array.isArray(item.hook_variants) && item.hook_variants.every((hook) => typeof hook === "string")
    && Array.isArray(item.hashtags) && item.hashtags.every((tag) => typeof tag === "string");
}

function instructionsFor(mode: string) {
  const modeInstruction = mode === "reference"
    ? "استخرج المبدأ من المرجع ثم اكتب تنفيذًا أصليًا بالكامل؛ ممنوع نسخ الصياغة أو ترتيب المنافس."
    : mode === "improve"
      ? "حافظ على الفكرة والحقائق الموجودة، وحسّن الإيقاع والوضوح والهوك بدون تغيير المعنى."
      : "حوّل الفكرة إلى اسكريبت أصلي قابل للتسجيل والتنفيذ.";
  return `أنت كاتب محتوى داخل Market Whales. مهمتك إنتاج مسودة تبدو ككلام طبيعي أمام الكاميرا، لا استعراض أنك فهمت "أسلوبًا". اكتب بالعربية المصرية الطبيعية، مباشرة وعملية، بلا فصحى متكلفة وبلا تهويل. ${modeInstruction}

ترتيب الأولوية: توجيه سميح الحالي، ثم بيانات الفكرة، ثم قواعد بصمته، ثم العينات المعتمدة، ثم بقية مراجع البراند. العينات المعتمدة مرجع للإيقاع وترتيب الكلام فقط؛ ممنوع نقل جملة أو قصة أو رقم أو هوك منها.

قاعدة القصص حاسمة: اقرأ story_use. لو allowed=false ممنوع إضافة أي تجربة شخصية أو حكاية بصيغة المتكلم أو استخدام أي واقعة وأرقام من بنك القصص. لو allowed=true استخدم القصة المختارة وحدها وفقط إذا خدمت الفكرة، ولا تضف لها تفاصيل. في وضع improve لا تضف قصة جديدة؛ يمكنك فقط الحفاظ على قصة موجودة أصلًا في مسودة المستخدم.

لا تبدأ تلقائيًا بتكرار العنوان كسؤال. افتح بمشهد أو تصرف يراه المتداول. لا تستخدم «السؤال ده بيجيلي/بيوصلني كتير»، ولا «الدرس مش... الدرس إن...»، ولا تفسيرات نفسية متزوقة مثل «الدماغ تتحول من وضع إلى وضع». صف ما يفعله المتداول فعلًا بدل تشخيصه. لا تكتب مقدمة ثم شرحًا ثم حكمة ثم CTA بقالب واضح؛ خلّي الكلام يتحرك طبيعيًا من الموقف إلى الفكرة.

لو المدخل قليل، لا تخترع قصة أو حقيقة لملء الفراغ. اكتب نصًا أقصر ومحددًا اعتمادًا على العنوان والهدف، واستخدم generation_direction إن وُجدت باعتبارها أقرب كلام صادر من سميح. التزم بالمحتوى التعليمي في التداول: لا تعد بأرباح، لا تستخدم ضمانات، وافصل الرأي عن الحقيقة. لو توجد معلومة تحتاج تحققًا ضعها في claims_notes بدل اختراع مصدر.

اجعل spoken_script النص الكامل الذي سيقال أمام الكاميرا، واجعل cta نسخة مستقلة من الدعوة الموجودة في نهايته لخدمة خط الإنتاج. الكابشن مكمل لا نسخة مكررة. أعط تعليمات مونتاج وغلاف قابلة للتنفيذ. قبل إخراج JSON راجع النتيجة داخليًا وارفض أي جملة محفوظة أو قصة غير مختارة. أعد JSON فقط حسب المخطط.`;
}

function providerBody(provider: AiProviderRuntime, mode: string, aiContext: unknown) {
  const instructions = instructionsFor(mode);
  const input = `بيانات الاسكريبت والسياق المعتمد:\n${JSON.stringify(aiContext).slice(0, 70000)}`;
  if (provider.protocol === "openai_responses") {
    return {
      model: provider.model,
      store: false,
      instructions,
      input,
      text: {
        format: {
          type: "json_schema",
          name: "market_whales_script",
          strict: true,
          schema: outputSchema,
        },
      },
    };
  }
  return {
    model: provider.model,
    messages: [
      {
        role: "system",
        content: `${instructions}\nالمخطط المطلوب حرفيًا:\n${JSON.stringify(outputSchema)}`,
      },
      { role: "user", content: input },
    ],
    response_format: { type: "json_object" },
    max_tokens: 12000,
    stream: false,
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
    const scriptId = text(body.script_id);
    const mode = text(body.mode);
    const expectedVersion = Number(body.expected_edit_version);
    const selectedStory = text(body.selected_story);
    const generationDirection = text(body.generation_direction);
    if (!scriptId || !modes.has(mode) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      return jsonResponse({ message: "اختر نوع مساعدة AI وحدّث الاسكريبت قبل المحاولة." }, 400);
    }
    if (selectedStory.length > 2000 || generationDirection.length > 1500) {
      return jsonResponse({ message: "اختيار القصة أو توجيه الكتابة أطول من المسموح." }, 400);
    }

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

    const { data: providerData, error: providerError } = await context.supabaseAdmin.rpc("get_script_ai_provider_runtime", {
      target_user_id: context.userClaims.id,
      target_script_id: scriptId,
    });
    const provider = parseProviderRuntime(providerData);
    if (providerError || !provider) {
      return jsonResponse({ message: "أضف مزوّد AI من الإعدادات واجعله افتراضيًا قبل التوليد." }, 503);
    }

    const contextObject = aiContext as Record<string, unknown>;
    const contextScript = contextObject.script as Record<string, unknown> | undefined;
    if (Number(contextScript?.edit_version) !== expectedVersion) {
      return jsonResponse({ message: "الاسكريبت اتعدل. حدّث الصفحة قبل استخدام AI حتى لا نخسر تعديلاتك." }, 409);
    }

    const prepared = prepareAiContext(aiContext, mode, selectedStory, generationDirection);
    if ("error" in prepared) return jsonResponse({ message: prepared.error }, 400);

    let providerResult;
    try {
      providerResult = await fetchProviderJson(provider, providerBody(provider, mode, prepared.context), 90_000);
    } catch (providerRequestError) {
      return jsonResponse({ message: safeProviderFailure(providerRequestError) }, 502);
    }
    if (!providerResult.response.ok) {
      return jsonResponse(
        { message: providerResult.response.status === 429 ? "المزوّد رفض الطلب بسبب الرصيد أو حد الاستخدام." : "تعذّر توليد الاسكريبت من المزوّد الحالي.", requestId: providerResult.requestId },
        providerResult.response.status === 429 ? 429 : 502,
      );
    }

    let generated: unknown;
    try { generated = JSON.parse(stripJsonFence(extractProviderText(providerResult.json, provider.protocol))); } catch { generated = null; }
    if (!generatedScript(generated)) return jsonResponse({ message: "وصلت نتيجة غير مكتملة من AI ولم نغيّر الاسكريبت." }, 502);
    const issues = generationIssues(generated, prepared.guard, mode);
    if (issues.length) {
      return jsonResponse({
        message: `رفضنا المسودة ولم نحفظها لأنها خرجت عن بصمتك: ${issues.join("، ")}. عدّل توجيهك أو جرّب مرة تانية.`,
        issues,
      }, 422);
    }

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

    return jsonResponse({ generated, editVersion, provider: { name: provider.name, model: provider.model } });
  },
};
