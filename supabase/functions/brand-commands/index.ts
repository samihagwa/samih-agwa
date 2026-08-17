import { createSupabaseContext } from "npm:@supabase/server@1.4.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2.112.3/cors";

const responseHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const categories = new Set(["foundation", "visual_identity", "editing", "copy_voice", "publishing", "compliance", "offer_product", "workflow"]);
const audiences = new Set(["all", "management", "design", "editing", "copy", "publishing", "sales"]);

type Context = Awaited<ReturnType<typeof createSupabaseContext>>["data"];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function textArray(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
    : [];
}

function isHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && !/\s/.test(value);
  } catch {
    return false;
  }
}

function commandError(error: { message: string } | null, fallback: string) {
  if (!error) return null;
  const friendlyMessages: Array<[RegExp, string]> = [
    [/Only organization leadership can create brand drafts/i, "إنشاء مسودات البراند متاح للإدارة فقط."],
    [/Only organization leadership can edit brand drafts/i, "تعديل مسودات البراند متاح للإدارة فقط."],
    [/Only the organization owner can approve brand rules/i, "اعتماد قواعد البراند النهائي متاح للمالك فقط."],
    [/Only the organization owner can archive brand rules/i, "أرشفة قواعد البراند متاحة للمالك فقط."],
    [/Approved brand articles are immutable/i, "النسخة المعتمدة لا تُعدّل مباشرة. أنشئ نسخة تعديل جديدة أولًا."],
    [/changed in another session/i, "المسودة اتعدلت من جلسة أخرى. حدّث الصفحة قبل الحفظ."],
    [/already has an open draft revision/i, "يوجد بالفعل مسودة تعديل مفتوحة لهذا المرجع."],
  ];
  const translated = friendlyMessages.find(([pattern]) => pattern.test(error.message))?.[1];
  if (translated) return jsonResponse({ message: translated }, 400);
  const userError = /Only |Brand |brand |approved|draft|revision|article|audience|reference|organization|refresh|incomplete|valid/i.test(error.message);
  return jsonResponse({ message: userError ? error.message : fallback }, userError ? 400 : 500);
}

function parseArticle(body: Record<string, unknown>) {
  const title = text(body.title);
  const category = text(body.category);
  const articleAudiences = textArray(body.audiences);
  const summary = text(body.summary);
  const guidelines = text(body.guidelines);
  const doList = textArray(body.do_list);
  const dontList = textArray(body.dont_list);
  const examples = text(body.examples);
  const referenceUrls = textArray(body.reference_urls);
  const changeNote = text(body.change_note);

  if (title.length < 3 || title.length > 180 || !categories.has(category)) {
    return { error: "أضف عنوانًا واضحًا واختر قسم المرجع." };
  }
  if (!articleAudiences.length || articleAudiences.length > 7 || articleAudiences.some((audience) => !audiences.has(audience))) {
    return { error: "اختر شخصًا أو قسمًا واحدًا على الأقل سيستخدم المرجع." };
  }
  if (summary.length < 10 || summary.length > 800 || guidelines.length < 20 || guidelines.length > 12000) {
    return { error: "اكتب ملخصًا وتعليمات واضحة للبراند ضمن الحدود الموضحة." };
  }
  if (doList.length > 20 || dontList.length > 20 || [...doList, ...dontList].some((item) => item.length < 2 || item.length > 500)) {
    return { error: "قوائم المطلوب والممنوع تقبل حتى 20 قاعدة واضحة في كل قائمة." };
  }
  if (examples.length > 5000 || changeNote.length < 3 || changeNote.length > 500) {
    return { error: "أضف سببًا واضحًا لهذه النسخة وراجع طول الأمثلة." };
  }
  if (referenceUrls.length > 10 || referenceUrls.some((url) => url.length > 2000 || !isHttpUrl(url))) {
    return { error: "روابط المراجع يجب أن تكون روابط http أو https صحيحة، بحد أقصى 10 روابط." };
  }

  return {
    data: {
      article_title: title,
      article_category: category,
      article_audiences: articleAudiences,
      article_summary: summary,
      article_guidelines: guidelines,
      article_do_list: doList,
      article_dont_list: dontList,
      article_examples: examples,
      article_reference_urls: referenceUrls,
      article_change_note: changeNote,
    },
  };
}

async function createDraft(body: Record<string, unknown>, context: Context) {
  const organizationId = text(body.organization_id);
  const parsed = parseArticle(body);
  if (!organizationId || parsed.error || !parsed.data) {
    return jsonResponse({ message: parsed.error ?? "مساحة العمل غير محددة." }, 400);
  }

  const { data, error } = await context!.supabaseAdmin.rpc("create_brand_article_draft", {
    target_user_id: context!.userClaims!.id,
    target_organization_id: organizationId,
    ...parsed.data,
  });
  return commandError(error, "تعذّر إنشاء مسودة البراند.") ?? jsonResponse({ articleId: data }, 201);
}

async function updateDraft(body: Record<string, unknown>, context: Context) {
  const articleId = text(body.article_id);
  const expectedEditVersion = Number(body.expected_edit_version);
  const parsed = parseArticle(body);
  if (!articleId || !Number.isSafeInteger(expectedEditVersion) || expectedEditVersion < 1 || parsed.error || !parsed.data) {
    return jsonResponse({ message: parsed.error ?? "المسودة أو رقم نسختها غير صالح." }, 400);
  }

  const { data, error } = await context!.supabaseAdmin.rpc("update_brand_article_draft", {
    target_user_id: context!.userClaims!.id,
    target_article_id: articleId,
    expected_edit_version: expectedEditVersion,
    ...parsed.data,
  });
  return commandError(error, "تعذّر حفظ مسودة البراند.") ?? jsonResponse({ updated: data });
}

async function reviseArticle(body: Record<string, unknown>, context: Context) {
  const articleId = text(body.article_id);
  const changeNote = text(body.change_note);
  if (!articleId || changeNote.length < 3 || changeNote.length > 500) {
    return jsonResponse({ message: "اكتب سببًا واضحًا لفتح نسخة تعديل جديدة." }, 400);
  }

  const { data, error } = await context!.supabaseAdmin.rpc("revise_brand_article", {
    target_user_id: context!.userClaims!.id,
    target_article_id: articleId,
    revision_change_note: changeNote,
  });
  return commandError(error, "تعذّر فتح نسخة تعديل جديدة.") ?? jsonResponse({ articleId: data }, 201);
}

async function changeApproval(body: Record<string, unknown>, context: Context, action: "approve" | "archive") {
  const articleId = text(body.article_id);
  if (!articleId) return jsonResponse({ message: "مرجع البراند غير محدد." }, 400);

  const { data, error } = await context!.supabaseAdmin.rpc(
    action === "approve" ? "approve_brand_article" : "archive_brand_article",
    { target_user_id: context!.userClaims!.id, target_article_id: articleId },
  );
  return commandError(error, action === "approve" ? "تعذّر اعتماد المرجع." : "تعذّرت أرشفة المرجع.")
    ?? jsonResponse({ changed: data });
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

    if (body.action === "create_draft") return createDraft(body, context);
    if (body.action === "update_draft") return updateDraft(body, context);
    if (body.action === "revise") return reviseArticle(body, context);
    if (body.action === "approve") return changeApproval(body, context, "approve");
    if (body.action === "archive") return changeApproval(body, context, "archive");
    return jsonResponse({ message: "أمر مركز البراند غير معروف." }, 400);
  },
};
