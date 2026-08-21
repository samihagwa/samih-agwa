import { createSupabaseContext } from "npm:@supabase/server@1.4.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2.112.3/cors";

const responseHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const inputModes = new Set(["idea", "reference", "manual"]);
const platforms = new Set(["instagram", "facebook", "tiktok", "youtube", "telegram", "other"]);
const statuses = new Set(["draft", "ready_to_record", "archived"]);
const researchKinds = new Set(["idea", "reference", "competitor"]);

type Context = Awaited<ReturnType<typeof createSupabaseContext>>["data"];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function textArray(value: unknown, limit: number) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))].slice(0, limit);
}

function optionalScore(value: unknown) {
  if (value === "" || value === null || value === undefined) return null;
  const score = Number(value);
  return Number.isInteger(score) && score >= 0 && score <= 100 ? score : Number.NaN;
}

function isOptionalHttpUrl(value: string) {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function commandError(error: { message: string } | null, fallback: string) {
  if (!error) return null;
  const translations: Array<[RegExp, string]> = [
    [/Only the organization owner can assign scripts/i, "المالك فقط يقدر يسند اسكريبت لعضو آخر."],
    [/Only the organization owner can assign research/i, "المالك فقط يقدر يسند فكرة لعضو آخر."],
    [/Only the organization owner can edit the writing voice/i, "تعديل بصمة الكتابة متاح للمالك فقط."],
    [/Only the organization owner can approve writing voice samples/i, "المالك فقط يقدر يعتمد نصًا كعينة لصوت سميح."],
    [/Save a manual edit before approving a writing voice sample/i, "عدّل النص بطريقتك واحفظه يدويًا أولًا، وبعدها اعتمده كعينة لصوتك."],
    [/Script already approved as a writing voice sample/i, "الاسكريبت ده معتمد بالفعل كعينة لصوتك."],
    [/Writing voice examples are full/i, "مساحة أمثلة الصوت امتلأت؛ احذف عينة قديمة من «بصمتي» ثم حاول تاني."],
    [/Only the organization owner can hand off scripts/i, "تسليم الاسكريبت لمصنع المحتوى متاح للمالك فقط."],
    [/changed in another session/i, "الاسكريبت اتعدل من جلسة أخرى. حدّث الصفحة قبل الحفظ."],
    [/Handed-off or archived scripts are read-only/i, "الاسكريبت المُسلّم أو المؤرشف للقراءة فقط."],
    [/Mark the script ready to record/i, "حوّل الاسكريبت إلى «جاهز للتسجيل» قبل تسليمه للمصنع."],
    [/Complete the spoken script and CTA/i, "أكمل نص الكلام والدعوة للإجراء قبل التسليم."],
    [/Publish time must be in the future/i, "موعد النشر لازم يكون في المستقبل."],
    [/private script|private research/i, "ليس لديك صلاحية للوصول لهذا العنصر الخاص."],
  ];
  const friendly = translations.find(([pattern]) => pattern.test(error.message))?.[1];
  if (friendly) return jsonResponse({ message: friendly }, 400);
  const safe = /Script|Research|organization|member|assignee|status|Writing voice|Publish time|Complete|ready|closed/i.test(error.message);
  return jsonResponse({ message: safe ? error.message : fallback }, safe ? 400 : 500);
}

function parseScript(body: Record<string, unknown>) {
  const title = text(body.title);
  const inputMode = text(body.input_mode);
  const sourceUrl = text(body.source_url);
  const sourceText = text(body.source_text);
  const objective = text(body.objective);
  const audience = text(body.audience) || "متداولون عرب";
  const platform = text(body.platform) || "instagram";
  const duration = Number(body.duration_seconds);
  const contentPillar = text(body.content_pillar);

  if (title.length < 3 || title.length > 180 || objective.length < 5 || objective.length > 1000) {
    return { error: "اكتب عنوانًا وهدفًا واضحين للاسكريبت." };
  }
  if (!inputModes.has(inputMode) || !platforms.has(platform) || !Number.isInteger(duration) || duration < 10 || duration > 1800) {
    return { error: "راجع طريقة الإدخال والمنصة ومدة الفيديو." };
  }
  if (!isOptionalHttpUrl(sourceUrl) || sourceText.length > 30000) {
    return { error: "رابط المصدر غير صالح أو نص المصدر أطول من المسموح." };
  }
  return { data: { title, inputMode, sourceUrl, sourceText, objective, audience, platform, duration, contentPillar } };
}

async function createScript(body: Record<string, unknown>, context: Context) {
  const organizationId = text(body.organization_id);
  const assignedTo = text(body.assigned_to);
  const parsed = parseScript(body);
  if (!organizationId || !assignedTo || parsed.error || !parsed.data) {
    return jsonResponse({ message: parsed.error ?? "مساحة العمل أو مسؤول الاسكريبت غير محدد." }, 400);
  }
  const { data, error } = await context!.supabaseAdmin.rpc("create_script_draft", {
    target_user_id: context!.userClaims!.id,
    target_organization_id: organizationId,
    target_assigned_to: assignedTo,
    script_title: parsed.data.title,
    script_input_mode: parsed.data.inputMode,
    script_source_url: parsed.data.sourceUrl,
    script_source_text: parsed.data.sourceText,
    script_objective: parsed.data.objective,
    script_audience: parsed.data.audience,
    script_platform: parsed.data.platform,
    script_duration_seconds: parsed.data.duration,
    script_content_pillar: parsed.data.contentPillar,
  });
  return commandError(error, "تعذّر إنشاء الاسكريبت.") ?? jsonResponse({ scriptId: data }, 201);
}

async function saveScript(body: Record<string, unknown>, context: Context) {
  const scriptId = text(body.script_id);
  const expectedVersion = Number(body.expected_edit_version);
  const parsed = parseScript(body);
  const fields = ["spoken_script", "cta", "caption", "recording_notes", "editing_notes", "thumbnail_notes", "on_screen_text", "b_roll_notes", "claims_notes"];
  if (!scriptId || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || parsed.error || !parsed.data) {
    return jsonResponse({ message: parsed.error ?? "الاسكريبت أو رقم نسخته غير صالح." }, 400);
  }
  if (fields.some((field) => text(body[field]).length > (field === "spoken_script" ? 30000 : field === "editing_notes" ? 10000 : field === "caption" ? 5000 : 5000))) {
    return jsonResponse({ message: "أحد أقسام الاسكريبت أطول من الحد المسموح." }, 400);
  }
  const { data, error } = await context!.supabaseAdmin.rpc("save_script_draft", {
    target_user_id: context!.userClaims!.id,
    target_script_id: scriptId,
    expected_edit_version: expectedVersion,
    script_title: parsed.data.title,
    script_input_mode: parsed.data.inputMode,
    script_source_url: parsed.data.sourceUrl,
    script_source_text: parsed.data.sourceText,
    script_objective: parsed.data.objective,
    script_audience: parsed.data.audience,
    script_platform: parsed.data.platform,
    script_duration_seconds: parsed.data.duration,
    script_content_pillar: parsed.data.contentPillar,
    script_hook_variants: textArray(body.hook_variants, 8),
    script_spoken_script: text(body.spoken_script),
    script_cta: text(body.cta),
    script_caption: text(body.caption),
    script_hashtags: textArray(body.hashtags, 30),
    script_recording_notes: text(body.recording_notes),
    script_editing_notes: text(body.editing_notes),
    script_thumbnail_notes: text(body.thumbnail_notes),
    script_on_screen_text: text(body.on_screen_text),
    script_b_roll_notes: text(body.b_roll_notes),
    script_claims_notes: text(body.claims_notes),
    version_note: text(body.version_note) || "حفظ يدوي",
  });
  return commandError(error, "تعذّر حفظ الاسكريبت.") ?? jsonResponse({ editVersion: data });
}

async function changeStatus(body: Record<string, unknown>, context: Context) {
  const scriptId = text(body.script_id);
  const status = text(body.status);
  const expectedVersion = Number(body.expected_edit_version);
  if (!scriptId || !statuses.has(status) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    return jsonResponse({ message: "حالة الاسكريبت أو رقم النسخة غير صالح." }, 400);
  }
  const { data, error } = await context!.supabaseAdmin.rpc("change_script_status", {
    target_user_id: context!.userClaims!.id,
    target_script_id: scriptId,
    next_status: status,
    expected_edit_version: expectedVersion,
  });
  return commandError(error, "تعذّر تغيير حالة الاسكريبت.") ?? jsonResponse({ editVersion: data });
}

async function createResearch(body: Record<string, unknown>, context: Context) {
  const organizationId = text(body.organization_id);
  const assignedTo = text(body.assigned_to);
  const kind = text(body.kind);
  const title = text(body.title);
  const sourceUrl = text(body.source_url);
  const scores = [optionalScore(body.performance_signal), optionalScore(body.brand_fit), optionalScore(body.freshness)];
  if (!organizationId || !assignedTo || !researchKinds.has(kind) || title.length < 3 || title.length > 180) {
    return jsonResponse({ message: "أكمل عنوان الفكرة ونوعها ومسؤولها." }, 400);
  }
  if (!isOptionalHttpUrl(sourceUrl) || scores.some(Number.isNaN)) {
    return jsonResponse({ message: "راجع رابط المصدر والتقييمات من 0 إلى 100." }, 400);
  }
  const { data, error } = await context!.supabaseAdmin.rpc("create_script_research_item", {
    target_user_id: context!.userClaims!.id,
    target_organization_id: organizationId,
    target_assigned_to: assignedTo,
    research_kind: kind,
    research_title: title,
    research_source_url: sourceUrl,
    research_raw_notes: text(body.raw_notes),
    research_transcript: text(body.transcript),
    research_hook: text(body.hook),
    research_transferable_principle: text(body.transferable_principle),
    research_why_it_works: text(body.why_it_works),
    research_original_angles: textArray(body.original_angles, 10),
    research_performance_signal: scores[0],
    research_brand_fit: scores[1],
    research_freshness: scores[2],
  });
  return commandError(error, "تعذّر حفظ الفكرة في الرادار.") ?? jsonResponse({ researchId: data }, 201);
}

async function researchToScript(body: Record<string, unknown>, context: Context) {
  const researchId = text(body.research_id);
  if (!researchId) return jsonResponse({ message: "الفكرة غير محددة." }, 400);
  const { data, error } = await context!.supabaseAdmin.rpc("create_script_from_research", {
    target_user_id: context!.userClaims!.id,
    target_research_id: researchId,
  });
  return commandError(error, "تعذّر تحويل الفكرة إلى اسكريبت.") ?? jsonResponse({ scriptId: data }, 201);
}

async function saveVoice(body: Record<string, unknown>, context: Context) {
  const organizationId = text(body.organization_id);
  const expectedVersion = Number(body.expected_edit_version);
  if (!organizationId || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    return jsonResponse({ message: "ملف بصمة الكتابة أو رقم نسخته غير صالح." }, 400);
  }
  const { data, error } = await context!.supabaseAdmin.rpc("save_script_voice_profile", {
    target_user_id: context!.userClaims!.id,
    target_organization_id: organizationId,
    expected_edit_version: expectedVersion,
    profile_voice_summary: text(body.voice_summary),
    profile_writing_rules: textArray(body.writing_rules, 50),
    profile_banned_phrases: textArray(body.banned_phrases, 50),
    profile_story_bank: textArray(body.story_bank, 100),
    profile_approved_examples: text(body.approved_examples),
    profile_source_notes: text(body.source_notes),
  });
  return commandError(error, "تعذّر حفظ بصمة الكتابة.") ?? jsonResponse({ editVersion: data });
}

async function approveVoiceSample(body: Record<string, unknown>, context: Context) {
  const scriptId = text(body.script_id);
  const expectedVersion = Number(body.expected_edit_version);
  if (!scriptId || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    return jsonResponse({ message: "الاسكريبت أو رقم نسخته غير صالح." }, 400);
  }
  const { data, error } = await context!.supabaseAdmin.rpc("approve_script_as_voice_sample", {
    target_user_id: context!.userClaims!.id,
    target_script_id: scriptId,
    expected_script_version: expectedVersion,
  });
  return commandError(error, "تعذّر اعتماد الاسكريبت كعينة لصوتك.") ?? jsonResponse({ voiceProfileEditVersion: data });
}

async function handoff(body: Record<string, unknown>, context: Context) {
  const scriptId = text(body.script_id);
  const expectedVersion = Number(body.expected_edit_version);
  const publishAt = text(body.publish_at);
  const people = ["content_creator_id", "editing_owner_id", "thumbnail_owner_id", "publishing_owner_id"].map((field) => text(body[field]));
  if (!scriptId || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || !publishAt || Number.isNaN(new Date(publishAt).getTime()) || people.some((id) => !id)) {
    return jsonResponse({ message: "أكمل موعد النشر ومسؤولي التسجيل والمونتاج والغلاف والنشر." }, 400);
  }
  const { data, error } = await context!.supabaseAdmin.rpc("handoff_script_to_content", {
    target_user_id: context!.userClaims!.id,
    target_script_id: scriptId,
    expected_edit_version: expectedVersion,
    target_publish_at: new Date(publishAt).toISOString(),
    content_creator_id: people[0],
    editing_owner_id: people[1],
    thumbnail_owner_id: people[2],
    publishing_owner_id: people[3],
  });
  return commandError(error, "تعذّر تسليم الاسكريبت لمصنع المحتوى. لم يتم حفظ أي جزء ناقص.") ?? jsonResponse({ contentId: data }, 201);
}

export default {
  async fetch(request: Request) {
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (request.method !== "POST") return jsonResponse({ message: "Method not allowed" }, 405);

    const { data: context, error: authError } = await createSupabaseContext(request, { auth: "user" });
    if (authError || !context?.userClaims?.id) return jsonResponse({ message: "يجب تسجيل الدخول أولًا." }, 401);

    let body: Record<string, unknown>;
    try { body = await request.json(); } catch { return jsonResponse({ message: "بيانات الطلب غير صالحة." }, 400); }

    if (body.action === "create_script") return createScript(body, context);
    if (body.action === "save_script") return saveScript(body, context);
    if (body.action === "change_status") return changeStatus(body, context);
    if (body.action === "create_research") return createResearch(body, context);
    if (body.action === "research_to_script") return researchToScript(body, context);
    if (body.action === "save_voice") return saveVoice(body, context);
    if (body.action === "approve_voice_sample") return approveVoiceSample(body, context);
    if (body.action === "handoff") return handoff(body, context);
    return jsonResponse({ message: "أمر قسم الاسكريبتات غير معروف." }, 400);
  },
};
