import { createSupabaseContext } from "npm:@supabase/server@1.4.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2.112.3/cors";
import { writingChatInput, writingChatInstructions } from "../_shared/script-writing-chat.ts";
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
const scopes = new Set(["writing_chat", "script_variants", "hooks", "angles", "single_draft", "rewrite_excerpt", "production_pack", "recording", "editing", "thumbnail", "caption"]);
const writingScopes = new Set(["script_variants", "hooks"]);
const rewriteActions = new Set(["my_voice", "shorten", "simplify", "chart_example", "stronger_hook", "target_duration"]);
const productionScopes = new Set(["production_pack", "recording", "editing", "thumbnail", "caption"]);
const selectableProductionScopes = new Set(["thumbnail", "caption"]);

type ScriptVariant = { label: string; hook: string; spoken_script: string; cta: string };
type WritingOutput = { variants?: ScriptVariant[]; hook_variants: string[] };
type CaptionOption = { label: string; caption: string; hashtags: string[] };
type ThumbnailOption = { label: string; cover_text: string; visual_direction: string; script_connection: string };
type GenerationQuality = { removed_variants: number; removed_hooks: number; removed_options: number; reasons: string[] };
type ProductionOutput = {
  cta?: string; caption?: string; hashtags?: string[]; recording_notes?: string;
  editing_notes?: string; thumbnail_notes?: string; on_screen_text?: string;
  b_roll_notes?: string; claims_notes?: string;
  caption_options?: CaptionOption[]; thumbnail_options?: ThumbnailOption[];
};

const schemas: Record<string, Record<string, unknown>> = {
  writing_chat: {
    type: "object", additionalProperties: false, required: ["reply", "suggested_script"],
    properties: { reply: { type: "string", minLength: 1, maxLength: 6000 }, suggested_script: { type: "string", maxLength: 30000 } },
  },
  angles: {
    type: "object", additionalProperties: false, required: ["angles"],
    properties: { angles: { type: "array", minItems: 3, maxItems: 3, items: {
      type: "object", additionalProperties: false, required: ["title", "hook", "core_idea"],
      properties: { title: { type: "string", maxLength: 80 }, hook: { type: "string", maxLength: 500 }, core_idea: { type: "string", maxLength: 1000 } },
    } } },
  },
  single_draft: {
    type: "object", additionalProperties: false, required: ["draft"],
    properties: { draft: { type: "object", additionalProperties: false, required: ["spoken_script", "hook"],
      properties: { spoken_script: { type: "string", maxLength: 30000 }, hook: { type: "string", maxLength: 500 } } } },
  },
  rewrite_excerpt: {
    type: "object", additionalProperties: false, required: ["rewritten_text"],
    properties: { rewritten_text: { type: "string", minLength: 1, maxLength: 30000 } },
  },
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
    required: ["cta", "caption_options", "thumbnail_options", "recording_notes", "editing_notes", "on_screen_text", "b_roll_notes", "claims_notes"],
    properties: {
      cta: { type: "string", maxLength: 1000 },
      caption_options: {
        type: "array", minItems: 3, maxItems: 3,
        items: {
          type: "object", additionalProperties: false, required: ["label", "caption", "hashtags"],
          properties: {
            label: { type: "string", maxLength: 80 }, caption: { type: "string", maxLength: 5000 },
            hashtags: { type: "array", maxItems: 20, items: { type: "string", maxLength: 100 } },
          },
        },
      },
      thumbnail_options: {
        type: "array", minItems: 3, maxItems: 3,
        items: {
          type: "object", additionalProperties: false, required: ["label", "cover_text", "visual_direction", "script_connection"],
          properties: {
            label: { type: "string", maxLength: 80 }, cover_text: { type: "string", maxLength: 300 },
            visual_direction: { type: "string", maxLength: 3000 }, script_connection: { type: "string", maxLength: 1500 },
          },
        },
      },
      recording_notes: { type: "string", maxLength: 5000 }, editing_notes: { type: "string", maxLength: 10000 },
      on_screen_text: { type: "string", maxLength: 5000 },
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
    type: "object", additionalProperties: false, required: ["thumbnail_options"],
    properties: {
      thumbnail_options: {
        type: "array", minItems: 3, maxItems: 3,
        items: {
          type: "object", additionalProperties: false, required: ["label", "cover_text", "visual_direction", "script_connection"],
          properties: {
            label: { type: "string", maxLength: 80 }, cover_text: { type: "string", maxLength: 300 },
            visual_direction: { type: "string", maxLength: 3000 }, script_connection: { type: "string", maxLength: 1500 },
          },
        },
      },
    },
  },
  caption: {
    type: "object", additionalProperties: false, required: ["caption_options"],
    properties: {
      caption_options: {
        type: "array", minItems: 3, maxItems: 3,
        items: {
          type: "object", additionalProperties: false, required: ["label", "caption", "hashtags"],
          properties: {
            label: { type: "string", maxLength: 80 }, caption: { type: "string", maxLength: 5000 },
            hashtags: { type: "array", maxItems: 20, items: { type: "string", maxLength: 100 } },
          },
        },
      },
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

function scriptInput(rawScript: Record<string, unknown>, mode: string, scope: string) {
  const base = {
    id: rawScript.id, title: rawScript.title, input_mode: rawScript.input_mode,
    source_url: rawScript.source_url, source_text: rawScript.source_text, objective: rawScript.objective,
    audience: rawScript.audience, platform: rawScript.platform, duration_seconds: rawScript.duration_seconds,
    content_kind: rawScript.content_kind,
    content_pillar: rawScript.content_pillar, edit_version: rawScript.edit_version,
  };
  if (productionScopes.has(scope) || mode === "improve") {
    return {
      ...base,
      hook_variants: rawScript.hook_variants,
      spoken_script: rawScript.spoken_script,
      cta: rawScript.cta,
      caption: rawScript.caption,
      hashtags: rawScript.hashtags,
      thumbnail_notes: rawScript.thumbnail_notes,
      brand_notes: rawScript.brand_notes,
    };
  }
  return base;
}

function prepareAiContext(rawContext: unknown, mode: string, scope: string, selectedStory: string, generationDirection: string, relevantSamples: string[]) {
  const context = record(rawContext); const rawProfile = record(context.voice_profile); const stories = textList(rawProfile.story_bank);
  if (selectedStory && !stories.includes(selectedStory)) return { error: "القصة المختارة لم تعد موجودة في بصمتك. حدّث الصفحة واخترها من جديد." };
  const excerptOnly = scope === "rewrite_excerpt";
  const rules = textList(rawProfile.writing_rules, 50);
  const banned = textList(rawProfile.banned_phrases, 50);
  return {
    context: {
      script: scriptInput(record(context.script), mode, scope),
      voice_profile: {
        voice_summary: text(rawProfile.voice_summary).slice(0, excerptOnly ? 600 : 1200),
        writing_rules: excerptOnly ? rules.slice(-12) : rules,
        banned_phrases: excerptOnly ? banned.slice(0, 25) : banned,
        source_notes: excerptOnly ? "" : text(rawProfile.source_notes).slice(0, 1200),
        calibrated_samples: excerptOnly ? relevantSamples.slice(0, 1) : relevantSamples,
      },
      story_use: selectedStory ? { allowed: true, selected_story: selectedStory } : { allowed: false, selected_story: null },
      generation_direction: generationDirection || null,
      brand_articles: Array.isArray(context.brand_articles) ? context.brand_articles : [],
    },
    guard: { bannedPhrases: banned, stories, selectedStory },
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

function filterWritingOutput(
  generated: WritingOutput,
  guard: { bannedPhrases: string[]; stories: string[]; selectedStory: string },
  mode: string,
  scope: string,
) {
  const rejectedReasons: string[] = [];
  let removedVariants = 0;
  let removedHooks = 0;

  const cleanVariants = (generated.variants ?? []).filter((variant) => {
    const issues = generationIssues({ variants: [variant], hook_variants: [] }, guard, mode);
    if (!issues.length) return true;
    removedVariants += 1;
    rejectedReasons.push(...issues);
    return false;
  });
  const standaloneHooks = textList(generated.hook_variants, 5).filter((hook) => {
    const issues = generationIssues({ hook_variants: [hook] }, guard, mode);
    if (!issues.length) return true;
    removedHooks += 1;
    rejectedReasons.push(...issues);
    return false;
  });
  const hookCandidates = scope === "script_variants"
    ? [...cleanVariants.map((variant) => variant.hook), ...standaloneHooks]
    : standaloneHooks;
  const cleanHooks = [...new Set(hookCandidates.map((hook) => hook.trim()).filter(Boolean))].slice(0, 5);

  return {
    generated: scope === "script_variants"
      ? { variants: cleanVariants, hook_variants: cleanHooks }
      : { hook_variants: cleanHooks },
    quality: {
      removed_variants: removedVariants,
      removed_hooks: removedHooks,
      removed_options: 0,
      reasons: [...new Set(rejectedReasons)].slice(0, 5),
    } satisfies GenerationQuality,
  };
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
    production_pack: ["cta", "recording_notes", "editing_notes", "on_screen_text", "b_roll_notes", "claims_notes"],
    recording: ["recording_notes"], editing: ["editing_notes", "on_screen_text", "b_roll_notes", "claims_notes"],
    thumbnail: [], caption: [],
  };
  if (!(stringFields[scope] ?? []).every((key) => typeof item[key] === "string")) return false;
  const validCaptionOptions = () => Array.isArray(item.caption_options) && item.caption_options.length === 3
    && item.caption_options.every((raw) => {
      const option = record(raw);
      return text(option.label).length > 0 && text(option.caption).length > 0
        && Array.isArray(option.hashtags) && option.hashtags.every((tag) => typeof tag === "string");
    });
  const validThumbnailOptions = () => Array.isArray(item.thumbnail_options) && item.thumbnail_options.length === 3
    && item.thumbnail_options.every((raw) => {
      const option = record(raw);
      return text(option.label).length > 0 && text(option.cover_text).length > 0
        && text(option.visual_direction).length > 0 && text(option.script_connection).length > 0;
    });
  if (scope === "caption") return validCaptionOptions();
  if (scope === "thumbnail") return validThumbnailOptions();
  return scope !== "production_pack" || validCaptionOptions() && validThumbnailOptions();
}

function filterProductionOptions(
  generated: ProductionOutput,
  guard: { bannedPhrases: string[]; stories: string[]; selectedStory: string },
  mode: string,
  scope: string,
) {
  const reasons: string[] = [];
  let removedOptions = 0;
  const captionOptions = (generated.caption_options ?? []).filter((option) => {
    const issues = generationIssues({
      variants: [{ label: option.label, hook: "", spoken_script: option.caption, cta: "" }], hook_variants: [],
    }, guard, mode);
    if (!issues.length) return true;
    removedOptions += 1; reasons.push(...issues); return false;
  });
  const thumbnailOptions = (generated.thumbnail_options ?? []).filter((option) => {
    const issues = generationIssues({
      variants: [{ label: option.label, hook: option.cover_text, spoken_script: `${option.visual_direction}\n${option.script_connection}`, cta: "" }],
      hook_variants: [],
    }, guard, mode);
    if (!issues.length) return true;
    removedOptions += 1; reasons.push(...issues); return false;
  });
  const needsCaptions = scope === "caption" || scope === "production_pack";
  const needsThumbnails = scope === "thumbnail" || scope === "production_pack";
  return {
    generated: { ...generated,
      ...(needsCaptions ? { caption_options: captionOptions } : {}),
      ...(needsThumbnails ? { thumbnail_options: thumbnailOptions } : {}),
    },
    usable: (!needsCaptions || captionOptions.length > 0) && (!needsThumbnails || thumbnailOptions.length > 0),
    quality: { removed_variants: 0, removed_hooks: 0, removed_options: removedOptions,
      reasons: [...new Set(reasons)].slice(0, 5) } satisfies GenerationQuality,
  };
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

ممنوعات غير قابلة للتفاوض: لا تستخدم «مش مجرد... ده/دي...»، ولا «السؤال ده بيجيلي كتير»، ولا «الدرس مش... الدرس إن...»، ولا أي مقارنة مصطنعة متناظرة، ولا تشخيصات نفسية متزوقة. لا تبدأ تلقائيًا بتكرار العنوان كسؤال. افتح بمشهد أو تصرف يراه المتداول. لا تعد بأرباح ولا تستخدم ضمانات. لو المدخل قليل اكتب أقصر ولا تخترع معلومات.

بوابة إلزامية قبل إخراج JSON: افحص كل هوك وكل نسخة وكل CTA منفردًا. لو أي واحد يحتوي صيغة ممنوعة أو عبارة من banned_phrases احذفه وأعد كتابته من الصفر قبل الرد؛ لا ترسل صيغة مخالفة على أمل أن النظام سيصلحها. CTA موجود داخل نهاية كل نسخة كاملة، ومعه cta منفصل كبيانات تقنية فقط؛ المستخدم لن يكتبه مرتين. أعد JSON فقط حسب المخطط.`;
}
function productionInstructions(scope: string) {
  const target = scope === "production_pack" ? "حزمة التنفيذ كاملة، ومعها 3 بدائل كابشن و3 بدائل غلاف"
    : scope === "recording" ? "تعليمات التسجيل فقط"
      : scope === "editing" ? "تعليمات المونتاج والنصوص البصرية فقط"
        : scope === "thumbnail" ? "3 بدائل مختلفة للغلاف فقط" : "3 بدائل مختلفة للكابشن والهاشتاجات فقط";
  return `أنت مدير إنتاج محتوى داخل Market Whales. أنشئ ${target} من spoken_script المعتمد حرفيًا.

النص المعتمد والفكرة العامة هما مصدر الحقيقة الوحيد: ممنوع إعادة كتابة الاسكريبت أو إضافة فقرة أو إعطاء تعليمات لمشهد غير موجود فيه. اربط أي توقيت أو زوم أو B-roll بجملة موجودة فعلًا، واكتب اقتباسًا قصيرًا منها بدل افتراض الثواني إن لم يوجد تسجيل بعد. لو معلومة بصرية أو مصدر غير متاح، اكتب أنها مطلوبة ولا تخترع رابطًا.

بدائل الغلاف لازم تختلف في الزاوية البصرية والنص، وكل بديل يشرح صلته بجملة أو فكرة حقيقية من الاسكريبت. بدائل الكابشن لازم تكون جاهزة للنشر، بصوت البراند، ومن غير اختراع ادعاءات أو أرقام. ممنوع «مش مجرد... ده/دي...» وكل banned_phrases. المستخدم سيختار بديلًا بعلامة صح؛ لا تعتبر أي بديل معتمدًا. التعليمات عملية ومختصرة وواضحة لصاحب التسجيل والمونتير والمصمم. CTA المنفصل بيانات تقنية مستخرجة من نهاية النص، وليس نصًا ثانيًا على المستخدم مراجعته. أعد JSON فقط حسب المخطط.`;
}
function providerBody(provider: AiProviderRuntime, mode: string, scope: string, aiContext: unknown) {
  const instructions = scope === "writing_chat" ? writingChatInstructions : scope === "rewrite_excerpt"
    ? "أنت مساعد كتابة للاسكريبتات العربية. أعد صياغة النص المحدد وحده حسب rewrite_action، مع إبقاء المعنى والحقائق وروح الكاتب. إن كان الإجراء chart_example ولا يوجد مثال موثّق في المدخل، قدم مثالًا افتراضيًا واضحًا بلا رقم أو نتيجة تداول، ولا تقدمه كواقعة حقيقية. لا تضف قصة شخصية أو نتائج أو أرقامًا أو وعودًا. لا تكتب الاسكريبت كاملًا إن كان المدخل فقرة. لا تعتمد النص أو تحفظه؛ أعِد rewritten_text فقط. قواعد البصمة الصريحة تتقدم على العينات. أعد JSON فقط."
    : scope === "angles" ? "من الفكرة فقط اقترح ثلاث زوايا مختلفة فعلًا: عنوان قصير، هوك، والفكرة الأساسية لكل واحدة. لا تكتب مسودة كاملة أو كابشنًا أو مشهدًا. ممنوع اختراع قصص شخصية أو أرقام تداول أو نتائج. راع قواعد صوت الكاتب، وأعد JSON حسب المخطط."
      : scope === "single_draft" ? "اكتب مسودة واحدة فقط باللهجة المصرية الطبيعية وفق الزاوية المختارة selected_angle. الكلام قابل للتعديل أمام الكاميرا، بلا نتائج أو قصص أو أرقام مختلقة. لا تنتج ثلاث بدائل ولا تحفظ أو تعتمد أي شيء. لا تنسخ النص من مرجع خارجي، وأعد JSON حسب المخطط."
    : writingScopes.has(scope) ? writingInstructions(mode, scope) : productionInstructions(scope);
  const schema = schemas[scope]; const input = `سياق الطلب وبياناته:\n${scope === "writing_chat" ? JSON.stringify(aiContext) : JSON.stringify(aiContext).slice(0, 70000)}`;
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
    const scriptId = text(body.script_id); const researchId = text(body.research_id); const contentId = text(body.content_id);
    const mode = text(body.mode) || "idea"; const scope = text(body.scope) || "script_variants";
    const selectedStory = text(body.selected_story); const generationDirection = text(body.generation_direction);
    const selectedText = text(body.selected_text); const rewriteAction = text(body.rewrite_action);
    const selectedAngle = text(body.selected_angle);
    const expectedVersion = Number(body.expected_edit_version);
    const targetCount = [scriptId, researchId, contentId].filter(Boolean).length;
    if (targetCount !== 1 || !modes.has(mode) || !scopes.has(scope)) return jsonResponse({ message: "حدد الفكرة ونوع مساعدة AI المطلوب." }, 400);
    const chat = scope === "writing_chat" ? writingChatInput(body) : null;
    if (scope === "writing_chat" && (!scriptId || !chat)) return jsonResponse({ message: "اكتب طلبًا أقصر أو ابدأ محادثة جديدة؛ لم يتغير النص." }, 400);
    if (scope === "rewrite_excerpt" && (!scriptId || !rewriteActions.has(rewriteAction) || selectedText.length < 2 || selectedText.length > 30000)) return jsonResponse({ message: "حدد نصًا وإجراءً مناسبين لمساعد الكتابة." }, 400);
    if (scope === "single_draft" && (!scriptId || selectedAngle.length < 5 || selectedAngle.length > 1700)) return jsonResponse({ message: "اختر زاوية كتابة أولًا." }, 400);
    if (scope === "angles" && !scriptId) return jsonResponse({ message: "احفظ فكرتك أولًا لتختار زاوية الكتابة." }, 400);
    if (researchId && !writingScopes.has(scope)) return jsonResponse({ message: "تعليمات التنفيذ لا تبدأ إلا بعد حفظ واعتماد الاسكريبت." }, 400);
    if (contentId && !selectableProductionScopes.has(scope)) return jsonResponse({ message: "داخل مصنع المحتوى يتاح توليد بدائل الكابشن أو الغلاف فقط." }, 400);
    if ((scriptId || contentId) && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)) return jsonResponse({ message: "حدّث العنصر قبل استخدام AI." }, 400);
    if (selectedStory.length > 2000 || generationDirection.length > 1500) return jsonResponse({ message: "اختيار القصة أو توجيه الكتابة أطول من المسموح." }, 400);

    const { count } = await context.supabaseAdmin.from("audit_events").select("id", { count: "exact", head: true })
      .eq("actor_id", context.userClaims.id).eq("action", "script.ai_request_started")
      .gte("occurred_at", new Date(Date.now() - 60_000).toISOString());
    if ((count ?? 0) >= 5) return jsonResponse({ message: "استنى دقيقة قبل طلب توليد جديد لحماية الميزانية." }, 429);

    const contextRpc = researchId ? "get_script_research_ai_context" : contentId ? "get_content_ai_context" : "get_script_ai_context";
    const contextArgs = researchId ? { target_user_id: context.userClaims.id, target_research_id: researchId }
      : contentId ? { target_user_id: context.userClaims.id, target_content_item_id: contentId, target_scope: scope }
        : { target_user_id: context.userClaims.id, target_script_id: scriptId };
    const { data: aiContext, error: contextError } = await context.supabaseAdmin.rpc(contextRpc, contextArgs);
    if (contextError || !aiContext) return jsonResponse({ message: "ليس لديك صلاحية للتوليد أو العنصر لم يعد قابلًا للتعديل." }, 403);

    const contextObject = aiContext as Record<string, unknown>; const contextScript = record(contextObject.script);
    // Chat is preview-only against an explicit draft snapshot, so autosave cannot invalidate it.
    // All server writes and legacy scopes retain their version check.
    if (scope !== "writing_chat" && (scriptId || contentId) && Number(contextScript.edit_version) !== expectedVersion) return jsonResponse({ message: `${contentId ? "ملف المحتوى" : "الاسكريبت"} اتعدل. حدّث الصفحة قبل استخدام AI.` }, 409);
    if (!contentId && productionScopes.has(scope) && contextScript.status !== "ready_to_record") return jsonResponse({ message: "اعتمد النص النهائي «جاهز للتصوير» أولًا، وبعدها أنشئ تعليمات التنفيذ." }, 400);

    const providerRpc = researchId ? "get_script_research_ai_provider_runtime" : contentId ? "get_content_ai_provider_runtime" : "get_script_ai_provider_runtime";
    const { data: providerData, error: providerError } = await context.supabaseAdmin.rpc(providerRpc, contextArgs);
    const provider = parseProviderRuntime(providerData);
    if (providerError || !provider) return jsonResponse({ message: "أضف مزوّد AI من الإعدادات واجعله افتراضيًا قبل التوليد." }, 503);

    let relevantSamples: string[] = [];
    if (scriptId) {
      const { data: samples, error: samplesError } = await context.supabaseAdmin.from("script_voice_samples")
        .select("sample_text").eq("organization_id", text(contextScript.organization_id))
        .eq("owner_id", context.userClaims.id).eq("content_kind", text(contextScript.content_kind))
        .eq("active", true).order("updated_at", { ascending: false }).limit(scope === "writing_chat" ? 5 : 2);
      if (samplesError) return jsonResponse({ message: "تعذّر تحميل أمثلة صوتك الخاصة؛ لم نرسل الطلب إلى AI." }, 503);
      relevantSamples = (samples ?? []).map((sample) => text(sample.sample_text));
    }
    const prepared = prepareAiContext(aiContext, mode, scope, selectedStory, generationDirection, relevantSamples);
    if ("error" in prepared) return jsonResponse({ message: prepared.error }, 400);
    if (chat) {
      prepared.context.script = { ...prepared.context.script, ...chat.draft };
      prepared.context.brand_articles = [];
      prepared.context.voice_profile.calibrated_samples = relevantSamples.map((sample) => sample.slice(0, 4000));
      prepared.context.voice_profile.writing_rules = prepared.context.voice_profile.writing_rules.map((rule) => rule.slice(0, 500));
      prepared.context.voice_profile.banned_phrases = prepared.context.voice_profile.banned_phrases.map((phrase) => phrase.slice(0, 300));
      Object.assign(prepared.context, { conversation: chat.messages });
    }
    if (scope === "single_draft") Object.assign(prepared.context, { selected_angle: selectedAngle });
    if (scope === "rewrite_excerpt") {
      prepared.context.script = {
        id: contextScript.id, title: contextScript.title, objective: contextScript.objective,
        duration_seconds: contextScript.duration_seconds,
      };
      prepared.context.generation_direction = null;
      Object.assign(prepared.context, { selected_text: selectedText, rewrite_action: rewriteAction });
      prepared.context.voice_profile.calibrated_samples = prepared.context.voice_profile.calibrated_samples.slice(-2);
    }
    const { error: requestAuditError } = await context.supabaseAdmin.from("audit_events").insert({
      organization_id: text(contextScript.organization_id), actor_id: context.userClaims.id,
      action: "script.ai_request_started", entity_type: researchId ? "script_research" : contentId ? "content_item" : "script",
      entity_id: researchId || contentId || scriptId, after_data: { scope, mode, provider_id: provider.id },
    });
    if (requestAuditError) return jsonResponse({ message: "تعذّر تسجيل طلب التوليد، لذلك أوقفناه قبل استهلاك الرصيد." }, 503);
    let providerResult;
    try { providerResult = await fetchProviderJson(provider, providerBody(provider, mode, scope, prepared.context), 90_000); }
    catch (providerRequestError) { return jsonResponse({ message: safeProviderFailure(providerRequestError) }, 502); }
    if (!providerResult.response.ok) {
      return jsonResponse({ message: providerResult.response.status === 429 ? "المزوّد رفض الطلب بسبب الرصيد أو حد الاستخدام." : "تعذّر التوليد من المزوّد الحالي.", requestId: providerResult.requestId }, providerResult.response.status === 429 ? 429 : 502);
    }

    let generated: unknown;
    try { generated = JSON.parse(stripJsonFence(extractProviderText(providerResult.json, provider.protocol))); } catch { generated = null; }
    let quality: GenerationQuality | null = null;
    if (scope === "writing_chat") {
      const output = record(generated);
      const reply = text(output.reply);
      const candidate = typeof output.suggested_script === "string" ? output.suggested_script.trim() : null;
      if (!reply || reply.length > 6000 || candidate === null || candidate.length > 30000) return jsonResponse({ message: "رد المساعد غير مكتمل؛ نصك لم يتغير." }, 502);
      const issues = candidate ? generationIssues({ variants: [{ label: "", hook: "", spoken_script: candidate, cta: "" }], hook_variants: [] }, prepared.guard, "improve") : [];
      if (issues.length) return jsonResponse({ message: "الاقتراح خالف قواعد بصمتك؛ لم نغير نصك. وضّح للمساعد الصياغة المطلوبة." }, 422);
      generated = { reply, suggested_script: candidate };
    } else if (scope === "angles") {
      const angles = record(generated).angles;
      if (!Array.isArray(angles) || angles.length !== 3 || angles.some((raw) => {
        const angle = record(raw);
        return !text(angle.title) || !text(angle.hook) || !text(angle.core_idea);
      })) return jsonResponse({ message: "الزوايا وصلت ناقصة؛ لم يتغير الاسكريبت." }, 502);
      const clean = angles.filter((raw) => {
        const angle = record(raw);
        return !generationIssues({ hook_variants: [text(angle.hook)], variants: [
          { label: text(angle.title), hook: "", spoken_script: text(angle.core_idea), cta: "" },
        ] }, prepared.guard, mode).length;
      });
      if (clean.length !== 3) return jsonResponse({ message: "واحدة أو أكثر من الزوايا لم تطابق ضوابط الكتابة؛ حاول مرة أخرى." }, 422);
      generated = { angles: clean };
    } else if (scope === "single_draft") {
      const draft = record(record(generated).draft);
      const script = text(draft.spoken_script); const hook = text(draft.hook);
      if (script.length < 20 || script.length > 30000 || !hook || generationIssues({
        hook_variants: [hook], variants: [{ label: "", hook: "", spoken_script: script, cta: "" }],
      }, prepared.guard, mode).length) return jsonResponse({ message: "المسودة لم تطابق ضوابط الكتابة؛ لم نغيّر نصك." }, 422);
      generated = { draft: { spoken_script: script, hook } };
    } else if (scope === "rewrite_excerpt") {
      const candidate = text(record(generated).rewritten_text);
      const originalNumbers = new Set(selectedText.match(/\d+(?:[.,]\d+)?/g) ?? []);
      const introducedNumber = (candidate.match(/\d+(?:[.,]\d+)?/g) ?? []).some((value) => !originalNumbers.has(value));
      const issues = generationIssues({ variants: [{ label: "", hook: "", spoken_script: candidate, cta: "" }], hook_variants: [] }, prepared.guard, "improve");
      const introducesStory = /انا (الشخص ده|حصل معايا|مريت|خسرت|كسبت|ربحت)/.test(normalizeArabic(candidate))
        && !/انا (الشخص ده|حصل معايا|مريت|خسرت|كسبت|ربحت)/.test(normalizeArabic(selectedText));
      if (!candidate || candidate.length > 30000 || introducedNumber || introducesStory || issues.length) {
        return jsonResponse({ message: "اقتراح التعديل أضاف رقمًا أو صياغة غير مطابقة، لذلك لم نعتمد شيئًا. جرّب مرة أخرى." }, 422);
      }
      generated = { rewritten_text: candidate };
    } else if (writingScopes.has(scope)) {
      if (!validWritingOutput(generated, scope)) return jsonResponse({ message: "وصلت نتيجة كتابة غير مكتملة ولم نحفظ شيئًا." }, 502);
      const filtered = filterWritingOutput(generated, prepared.guard, mode, scope);
      generated = filtered.generated;
      quality = filtered.quality;
      const cleanWriting = filtered.generated as WritingOutput;
      const hasCleanWriting = scope === "script_variants"
        ? (cleanWriting.variants?.length ?? 0) > 0
        : cleanWriting.hook_variants.length > 0;
      if (!hasCleanWriting) return jsonResponse({
        message: `النموذج خالف بصمتك في كل البدائل، فالحارس أخفاها كلها ولم يحفظ شيئًا أو يرسل طلبًا ثانيًا: ${quality.reasons.join("، ")}.`,
        quality,
      }, 422);
    } else {
      if (!validProductionOutput(generated, scope)) return jsonResponse({ message: "وصلت حزمة تنفيذ غير مكتملة ولم نغيّر الاسكريبت." }, 502);
      if (scope === "production_pack" || selectableProductionScopes.has(scope)) {
        const filtered = filterProductionOptions(generated as ProductionOutput, prepared.guard, mode, scope);
        generated = filtered.generated; quality = filtered.quality;
        if (!filtered.usable) return jsonResponse({
          message: `الحارس استبعد كل اقتراحات ${scope === "caption" ? "الكابشن" : scope === "thumbnail" ? "الغلاف" : "الكابشن أو الغلاف"}، فلم يعتمد شيئًا أو يرسل طلبًا ثانيًا: ${quality.reasons.join("، ")}.`,
          quality,
        }, 422);
      }
    }

    let editVersion: number | null = null;
    const savesProduction = productionScopes.has(scope) && !selectableProductionScopes.has(scope);
    if (savesProduction) {
      const production = generated as ProductionOutput;
      const preservesSelectableFields = scope === "production_pack";
      const { data, error: saveError } = await context.supabaseAdmin.rpc("save_ai_script_production", {
        target_user_id: context.userClaims.id, target_script_id: scriptId, expected_edit_version: expectedVersion,
        generation_scope: scope, generated_cta: text(production.cta),
        generated_caption: preservesSelectableFields ? text(contextScript.caption) : text(production.caption),
        generated_hashtags: preservesSelectableFields ? textList(contextScript.hashtags, 20) : textList(production.hashtags, 20),
        generated_recording_notes: text(production.recording_notes), generated_editing_notes: text(production.editing_notes),
        generated_thumbnail_notes: preservesSelectableFields ? text(contextScript.thumbnail_notes) : text(production.thumbnail_notes),
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
        action: "script.ai_preview_generated", entity_type: researchId ? "script_research" : contentId ? "content_item" : "script",
        entity_id: researchId || contentId || scriptId, after_data: { scope, mode, provider_id: provider.id },
      });
    }
    return jsonResponse({ generated, editVersion, saved: savesProduction,
      ...(chat ? { voice_context: { sample_count: relevantSamples.length, rules_count: prepared.context.voice_profile.writing_rules.length } } : {}),
      ...(quality ? { quality } : {}), provider: { name: provider.name, model: provider.model } });
  },
};
