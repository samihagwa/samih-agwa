"use client";

import type { Session } from "@supabase/supabase-js";
import {
  Archive,
  BookOpenCheck,
  CheckCircle2,
  CircleUserRound,
  ExternalLink,
  FileClock,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
  Route,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  brandArticleStatusConfig,
  brandAudienceConfig,
  brandCategoryConfig,
  textLines,
  type BrandArticleStatus,
  type BrandAudience,
  type BrandCategory,
} from "../../lib/brand";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Tables } from "../../lib/supabase/database.types";
import { getSupabaseFunctionErrorMessage } from "../../lib/supabase/function-errors";
import { useWorkspaceAuth } from "../../lib/supabase/use-workspace-auth";
import { canManageTasks } from "../../lib/tasks";
import { Button } from "../ui/Button";
import { StatusBadge } from "../ui/StatusBadge";

type Article = Tables<"brand_articles">;
type Membership = Tables<"memberships">;
type Organization = Tables<"organizations">;
type TeamPerson = { id: string; name: string; role: Membership["role"] };
type Workspace = { organization: Organization; membership: Membership; people: TeamPerson[] };
type StatusFilter = "current" | BrandArticleStatus;

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) return String(error.message);
  return "حدث خطأ غير متوقع.";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formText(form: FormData, name: string) {
  return String(form.get(name) ?? "").trim();
}

function articlePayload(form: FormData) {
  return {
    title: formText(form, "title"),
    category: formText(form, "category"),
    audiences: form.getAll("audiences").map(String),
    summary: formText(form, "summary"),
    guidelines: formText(form, "guidelines"),
    do_list: textLines(formText(form, "do_list")),
    dont_list: textLines(formText(form, "dont_list")),
    examples: formText(form, "examples"),
    reference_urls: textLines(formText(form, "reference_urls")),
    change_note: formText(form, "change_note"),
  };
}

function ArticleFields({ article }: { article?: Article }) {
  const selectedAudiences = new Set<BrandAudience>(article?.audiences ?? ["all"]);
  return <div className="brand-article-fields">
    <div className="form-grid">
      <label><span>عنوان المرجع</span><input name="title" minLength={3} maxLength={180} required defaultValue={article?.title} placeholder="مثال: قواعد أغلفة الريلز" /></label>
      <label><span>القسم</span><select name="category" required defaultValue={article?.category ?? "foundation"}>{(Object.keys(brandCategoryConfig) as BrandCategory[]).map((category) => <option value={category} key={category}>{brandCategoryConfig[category].label}</option>)}</select></label>
      <label className="full-field"><span>ملخص سريع</span><textarea name="summary" minLength={10} maxLength={800} rows={2} required defaultValue={article?.summary} placeholder="متى يستخدم الفريق هذا المرجع وما القرار الذي يحسمه؟" /></label>
      <fieldset className="full-field brand-audience-fieldset"><legend>من يحتاج هذا المرجع؟</legend><div>{(Object.keys(brandAudienceConfig) as BrandAudience[]).map((audience) => <label key={audience}><input type="checkbox" name="audiences" value={audience} defaultChecked={selectedAudiences.has(audience)} /><span>{brandAudienceConfig[audience].label}</span></label>)}</div></fieldset>
      <label className="full-field"><span>القواعد والتفاصيل</span><textarea name="guidelines" minLength={20} maxLength={12000} rows={7} required defaultValue={article?.guidelines} placeholder="اكتب المرجع كما يجب أن يقرأه عضو جديد من غير شرح شفهي." /></label>
      <label><span>اعمل — قاعدة في كل سطر</span><textarea name="do_list" maxLength={10000} rows={5} defaultValue={article?.do_list.join("\n")} placeholder={"استخدم العنوان القصير\nأظهر المخاطرة بوضوح"} /></label>
      <label><span>ممنوع — قاعدة في كل سطر</span><textarea name="dont_list" maxLength={10000} rows={5} defaultValue={article?.dont_list.join("\n")} placeholder={"لا تعد بأرباح مضمونة\nلا تستخدم ألوانًا خارج الهوية"} /></label>
      <label className="full-field"><span>أمثلة صحيحة أو خاطئة — اختياري</span><textarea name="examples" maxLength={5000} rows={4} defaultValue={article?.examples ?? ""} placeholder="مثال صحيح: ...\nمثال ممنوع: ..." /></label>
      <label className="full-field"><span>روابط مرجعية — رابط كامل في كل سطر</span><textarea name="reference_urls" dir="ltr" maxLength={20000} rows={3} defaultValue={article?.reference_urls.join("\n")} placeholder={"https://drive.google.com/...\nhttps://..."} /></label>
      <label className="full-field"><span>سبب إنشاء أو تعديل هذه النسخة</span><input name="change_note" minLength={3} maxLength={500} required defaultValue={article?.change_note} placeholder="مثال: توحيد تعليمات المصمم والمونتير قبل إدخال الفريق" /></label>
    </div>
  </div>;
}

export function BrandWorkspace() {
  const configured = isSupabaseConfigured();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(configured);
  const [working, setWorking] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [revisionId, setRevisionId] = useState<string | null>(null);
  const [archiveId, setArchiveId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("current");
  const [categoryFilter, setCategoryFilter] = useState<BrandCategory | "all">("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(configured ? null : "لم يتم إعداد اتصال Supabase لهذه النسخة.");
  const [notice, setNotice] = useState<string | null>(null);

  const clearData = useCallback(() => {
    setArticles([]);
    setEditingId(null);
    setRevisionId(null);
    setArchiveId(null);
  }, []);

  const clearWorkspace = useCallback(() => {
    setWorkspace(null);
    clearData();
  }, [clearData]);

  const clearTransientState = useCallback(() => setNotice(null), []);

  const refreshBrand = useCallback(async (organizationId: string) => {
    const { data, error: articlesError } = await getSupabaseBrowserClient()
      .from("brand_articles")
      .select("*")
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false });
    if (articlesError) throw articlesError;
    setArticles(data ?? []);
  }, []);

  const loadWorkspace = useCallback(async (activeSession: Session) => {
    const supabase = getSupabaseBrowserClient();
    setLoading(true);
    setError(null);
    try {
      const { data: membership, error: membershipError } = await supabase.from("memberships").select("*").eq("user_id", activeSession.user.id).eq("status", "active").limit(1).maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) {
        setWorkspace(null);
        clearData();
        return;
      }

      const [organizationResult, membersResult] = await Promise.all([
        supabase.from("organizations").select("*").eq("id", membership.organization_id).single(),
        supabase.from("memberships").select("user_id, role").eq("organization_id", membership.organization_id).eq("status", "active"),
      ]);
      if (organizationResult.error) throw organizationResult.error;
      if (membersResult.error) throw membersResult.error;
      const memberIds = (membersResult.data ?? []).map((member) => member.user_id);
      const profilesResult = memberIds.length ? await supabase.from("profiles").select("id, full_name").in("id", memberIds) : { data: [], error: null };
      if (profilesResult.error) throw profilesResult.error;
      const people = (membersResult.data ?? []).map((member) => ({
        id: member.user_id,
        role: member.role,
        name: profilesResult.data?.find((profile) => profile.id === member.user_id)?.full_name ?? (member.user_id === activeSession.user.id ? activeSession.user.email : null) ?? "عضو فريق",
      }));
      setWorkspace({ organization: organizationResult.data, membership, people });
      await refreshBrand(membership.organization_id);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [clearData, refreshBrand]);

  const session = useWorkspaceAuth({
    configured,
    loadWorkspace,
    clearWorkspace,
    setLoading,
    clearTransientState,
  });

  useEffect(() => {
    if (!workspace) return;
    const supabase = getSupabaseBrowserClient();
    const channel = supabase.channel(`brand:${workspace.organization.id}`).on("postgres_changes", {
      event: "*", schema: "public", table: "brand_articles", filter: `organization_id=eq.${workspace.organization.id}`,
    }, () => void refreshBrand(workspace.organization.id)).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refreshBrand, workspace]);

  const filteredArticles = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("ar");
    return articles.filter((article) => {
      const statusMatches = statusFilter === "current" ? article.status !== "archived" : article.status === statusFilter;
      const categoryMatches = categoryFilter === "all" || article.category === categoryFilter;
      const textMatches = !needle || `${article.title} ${article.summary} ${article.guidelines}`.toLocaleLowerCase("ar").includes(needle);
      return statusMatches && categoryMatches && textMatches;
    });
  }, [articles, categoryFilter, search, statusFilter]);

  async function invokeBrand(body: Record<string, unknown>, successMessage: string) {
    if (!workspace) return false;
    setWorking(true);
    setError(null);
    setNotice(null);
    const { error: commandError } = await getSupabaseBrowserClient().functions.invoke("brand-commands", { body });
    setWorking(false);
    if (commandError) {
      setError(await getSupabaseFunctionErrorMessage(commandError, "تعذّر تنفيذ أمر مركز البراند."));
      return false;
    }
    setNotice(successMessage);
    await refreshBrand(workspace.organization.id);
    return true;
  }

  async function createDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace) return;
    const formElement = event.currentTarget;
    const created = await invokeBrand({ action: "create_draft", organization_id: workspace.organization.id, ...articlePayload(new FormData(formElement)) }, "تم حفظ المسودة. لن تُستخدم في المحتوى قبل اعتماد المالك.");
    if (created) { formElement.reset(); setShowCreate(false); }
  }

  async function updateDraft(event: FormEvent<HTMLFormElement>, article: Article) {
    event.preventDefault();
    const updated = await invokeBrand({ action: "update_draft", article_id: article.id, expected_edit_version: article.edit_version, ...articlePayload(new FormData(event.currentTarget)) }, "تم تحديث المسودة وتسجيل التغيير.");
    if (updated) setEditingId(null);
  }

  async function startRevision(event: FormEvent<HTMLFormElement>, articleId: string) {
    event.preventDefault();
    const revised = await invokeBrand({ action: "revise", article_id: articleId, change_note: formText(new FormData(event.currentTarget), "change_note") }, "تم فتح نسخة تعديل جديدة، والنسخة المعتمدة ما زالت فعالة.");
    if (revised) setRevisionId(null);
  }

  if (loading) return <section className="workspace-state" aria-live="polite"><LoaderCircle className="spin" size={24} /><div><h2>جارٍ تحميل مركز البراند</h2><p>نتحقق من الصلاحيات والنسخ المعتمدة والمسودات.</p></div></section>;
  if (!session) return <section className="workspace-state workspace-onboarding"><LockKeyhole size={27} /><div><p className="overline">دخول موحد</p><h2>سجّل الدخول أولًا من قسم المهام</h2><p>مراجع البراند الداخلية لا تظهر دون جلسة موثقة وصلاحية داخل الشركة.</p></div><Button href="/tasks"><Link2 size={16} /> الانتقال لتسجيل الدخول</Button></section>;
  if (!workspace) return <section className="workspace-state workspace-onboarding"><Route size={27} /><div><p className="overline">مساحة العمل مطلوبة</p><h2>أنشئ مساحة الشركة مرة واحدة</h2><p>ابدأ من قسم المهام، ثم ارجع لبناء مراجع البراند.</p></div><Button href="/tasks"><Link2 size={16} /> فتح قسم المهام</Button></section>;

  const manager = canManageTasks(workspace.membership.role);
  const owner = workspace.membership.role === "owner";
  const peopleById = new Map(workspace.people.map((person) => [person.id, person]));
  const approvedCount = articles.filter((article) => article.status === "approved").length;
  const draftCount = articles.filter((article) => article.status === "draft").length;

  return <section className="brand-workspace">
    <div className="workspace-toolbar">
      <div><p className="overline">{workspace.organization.name}</p><h2>المصدر المعتمد للبراند</h2><p>{approvedCount ? `${approvedCount} مرجع معتمد متاح للتنفيذ` : "لا توجد مراجع معتمدة بعد — ابدأ بمسودة حقيقية ثم اعتمدها."}</p></div>
      <div className="toolbar-actions"><button className="icon-button" type="button" aria-label="تحديث مركز البراند" onClick={() => void refreshBrand(workspace.organization.id)}><RefreshCw size={17} /></button><Button href="/content" variant="secondary"><Route size={16} /> طلبات التنفيذ</Button>{manager ? <Button type="button" onClick={() => setShowCreate((value) => !value)}><Plus size={16} /> مرجع جديد</Button> : null}</div>
    </div>

    {notice ? <p className="form-notice success" role="status">{notice}</p> : null}
    {error ? <p className="form-notice error" role="alert">{error}</p> : null}

    <div className="brand-kpi-strip"><div><BookOpenCheck size={17} /><span>معتمد</span><strong>{approvedCount}</strong></div><div className={draftCount ? "attention" : ""}><FileClock size={17} /><span>ينتظر المراجعة</span><strong>{draftCount}</strong></div><div><ShieldCheck size={17} /><span>الاعتماد النهائي</span><strong>المالك</strong></div></div>

    {showCreate && manager ? <form className="panel brand-editor" onSubmit={(event) => void createDraft(event)}><div className="section-heading"><div><p className="overline">مسودة أولًا</p><h2>إنشاء مرجع براند</h2></div><button className="text-button" type="button" onClick={() => setShowCreate(false)}>إغلاق</button></div><div className="brand-safety-note"><ShieldCheck size={18} /><div><strong>المسودة لا تؤثر على الشغل الحالي</strong><p>لن تظهر كمرجع عند إعداد طلبات التنفيذ قبل اعتماد المالك، وأي تعديل بعد الاعتماد يبدأ نسخة جديدة.</p></div></div><ArticleFields /><div className="form-actions"><Button type="submit" disabled={working}>{working ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />} حفظ كمسودة</Button></div></form> : null}

    <div className="brand-filter-bar"><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث في العنوان أو القواعد…" aria-label="البحث في مراجع البراند" /><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as BrandCategory | "all")} aria-label="تصفية حسب القسم"><option value="all">كل الأقسام</option>{(Object.keys(brandCategoryConfig) as BrandCategory[]).map((category) => <option value={category} key={category}>{brandCategoryConfig[category].label}</option>)}</select><div role="group" aria-label="تصفية حسب الحالة">{(["current", "approved", "draft", "archived"] as StatusFilter[]).map((status) => <button className={statusFilter === status ? "active" : ""} type="button" key={status} onClick={() => setStatusFilter(status)}>{status === "current" ? "الحالي" : brandArticleStatusConfig[status].label}</button>)}</div></div>

    {filteredArticles.length ? <div className="brand-article-list workflow-entity-list">{filteredArticles.map((article) => <article className={`panel brand-article-card workflow-entity-card ${article.status}`} data-card-state={article.status} id={`article-${article.id}`} key={article.id}>
      <header><div><p className="overline">{brandCategoryConfig[article.category].label} · v{article.version}</p><h3 className="workflow-card-heading">{article.title}</h3><p>{article.summary}</p></div><StatusBadge tone={brandArticleStatusConfig[article.status].tone}>{brandArticleStatusConfig[article.status].label}</StatusBadge></header>
      <div className="brand-audience-tags">{article.audiences.map((audience) => <span key={audience}>{brandAudienceConfig[audience].label}</span>)}</div>
      <div className="brand-guidelines"><h4>القواعد الأساسية</h4><p>{article.guidelines}</p></div>
      {(article.do_list.length || article.dont_list.length) ? <div className="brand-rules-grid">{article.do_list.length ? <section><h4><CheckCircle2 size={14} /> اعمل</h4><ul>{article.do_list.map((rule) => <li key={rule}>{rule}</li>)}</ul></section> : null}{article.dont_list.length ? <section className="dont"><h4><Archive size={14} /> ممنوع</h4><ul>{article.dont_list.map((rule) => <li key={rule}>{rule}</li>)}</ul></section> : null}</div> : null}
      {article.examples ? <details className="brand-examples"><summary>أمثلة وتطبيقات</summary><p>{article.examples}</p></details> : null}
      {article.reference_urls.length ? <div className="brand-reference-links">{article.reference_urls.map((url, index) => <a href={url} target="_blank" rel="noreferrer" key={url}>مرجع {index + 1} <ExternalLink size={11} /></a>)}</div> : null}
      <footer><span><CircleUserRound size={12} /> أنشأها {peopleById.get(article.created_by)?.name ?? "عضو فريق"} · {formatDate(article.created_at)}</span>{article.approved_at ? <span><BookOpenCheck size={12} /> اعتمدها {peopleById.get(article.approved_by ?? "")?.name ?? "المالك"} · {formatDate(article.approved_at)}</span> : <span>سبب النسخة: {article.change_note}</span>}</footer>

      {editingId === article.id && article.status === "draft" ? <form className="brand-inline-editor" onSubmit={(event) => void updateDraft(event, article)}><ArticleFields article={article} /><div className="form-actions"><Button type="submit" disabled={working}>حفظ المسودة</Button><button className="text-button" type="button" onClick={() => setEditingId(null)}>إلغاء</button></div></form> : null}
      {revisionId === article.id && article.status === "approved" ? <form className="brand-compact-action" onSubmit={(event) => void startRevision(event, article.id)}><label><span>لماذا نحتاج نسخة جديدة؟</span><input name="change_note" minLength={3} maxLength={500} required placeholder="التغيير المطلوب وسببه" /></label><div className="form-actions"><Button type="submit" disabled={working}>فتح نسخة تعديل</Button><button className="text-button" type="button" onClick={() => setRevisionId(null)}>إلغاء</button></div></form> : null}
      {archiveId === article.id && article.status === "approved" ? <div className="brand-archive-confirm"><p>الأرشفة تمنع استخدام المرجع في محتوى جديد، لكنها تحفظه لأي محتوى قديم مرتبط به.</p><div><Button type="button" variant="secondary" disabled={working} onClick={() => void invokeBrand({ action: "archive", article_id: article.id }, "تمت أرشفة المرجع مع الحفاظ على تاريخ استخدامه.").then((changed) => { if (changed) setArchiveId(null); })}>تأكيد الأرشفة</Button><button className="text-button" type="button" onClick={() => setArchiveId(null)}>رجوع</button></div></div> : null}
      <div className="brand-card-actions">{article.status === "draft" && manager ? <Button type="button" variant="secondary" onClick={() => setEditingId(editingId === article.id ? null : article.id)}><Pencil size={14} /> تعديل المسودة</Button> : null}{article.status === "draft" && owner ? <Button type="button" disabled={working} onClick={() => void invokeBrand({ action: "approve", article_id: article.id }, "تم اعتماد المرجع وأصبح متاحًا عند إعداد طلبات التنفيذ.")}><BookOpenCheck size={14} /> اعتماد نهائي</Button> : null}{article.status === "approved" && manager ? <Button type="button" variant="secondary" onClick={() => setRevisionId(revisionId === article.id ? null : article.id)}><Pencil size={14} /> نسخة تعديل</Button> : null}{article.status === "approved" && owner ? <button className="text-button danger-text" type="button" onClick={() => setArchiveId(archiveId === article.id ? null : article.id)}><Archive size={13} /> أرشفة</button> : null}</div>
    </article>)}</div> : <section className="workspace-empty brand-empty"><BookOpenCheck size={28} /><h3>{articles.length ? "لا توجد نتائج بهذه التصفية" : "ابدأ بأول مرجع حقيقي"}</h3><p>{articles.length ? "غيّر البحث أو القسم أو الحالة." : "ابدأ بـ«من نحن والرسالة»، ثم الهوية البصرية، قواعد المونتاج، الصوت والكتابة، والالتزام."}</p>{manager && !articles.length ? <Button type="button" onClick={() => setShowCreate(true)}><Plus size={15} /> إنشاء أول مسودة</Button> : null}</section>}
  </section>;
}
