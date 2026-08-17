"use client";

import type { Session } from "@supabase/supabase-js";
import {
  CalendarClock,
  BookOpenCheck,
  CheckCircle2,
  CircleUserRound,
  ExternalLink,
  FileText,
  Film,
  Link2,
  LoaderCircle,
  LockKeyhole,
  MessageSquareText,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Route,
  Sparkles,
  TimerReset,
  Trash2,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  contentAssetKindConfig,
  contentAssignmentFields,
  contentCueKindConfig,
  contentRevisionStatusConfig,
  contentStatusConfig,
  contentStepConfig,
  contentSteps,
  type ContentAssetKind,
} from "../../lib/content";
import { formatTimelineSeconds } from "../../lib/content-intake";
import { brandCategoryConfig } from "../../lib/brand";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Tables } from "../../lib/supabase/database.types";
import { getSupabaseFunctionErrorMessage } from "../../lib/supabase/function-errors";
import { canManageTasks } from "../../lib/tasks";
import { Button } from "../ui/Button";
import { StatusBadge } from "../ui/StatusBadge";
import { QuickIntakeForm, type QuickIntakePayload } from "./QuickIntakeForm";

type ContentItem = Tables<"content_items">;
type ContentAsset = Tables<"content_assets">;
type ContentRevision = Tables<"content_revision_requests">;
type ContentTimelineCue = Tables<"content_timeline_cues">;
type BrandArticle = Tables<"brand_articles">;
type ContentBrandReference = Tables<"content_brand_references">;
type Task = Tables<"tasks">;
type Membership = Tables<"memberships">;
type Organization = Tables<"organizations">;

type TeamPerson = { id: string; name: string; role: Membership["role"] };
type Workspace = { organization: Organization; membership: Membership; people: TeamPerson[] };

const revisionSteps = ["recording", "editing", "thumbnail", "caption"] as const;
const assetKinds = Object.keys(contentAssetKindConfig) as ContentAssetKind[];

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) return String(error.message);
  return "حدث خطأ غير متوقع.";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function toLocalDateTimeInput(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formText(form: FormData, name: string) {
  return String(form.get(name) ?? "").trim();
}

function BrandReferenceSelector({ articles }: { articles: BrandArticle[] }) {
  return <section className="brand-reference-selector">
    <div><p className="overline">قواعد التنفيذ</p><h3>مراجع البراند المعتمدة</h3><p>اربط النسخ التي يجب أن يعتمد عليها المصمم والمونتير والكاتب في هذا الطلب.</p></div>
    {articles.length ? <div>{articles.map((article) => <label key={article.id}><input type="checkbox" name="brand_reference_ids" value={article.id} aria-label={`ربط مرجع ${article.title}`} /><span><strong>{article.title}</strong><small>{brandCategoryConfig[article.category].label} · النسخة {article.version}</small></span></label>)}</div> : <p className="brand-reference-empty">لا يوجد مرجع معتمد بعد. يمكنك إنشاء الطلب الآن، أو اعتماد أول مرجع من <a href="/brand">مركز البراند</a>.</p>}
  </section>;
}

export function ContentWorkspace() {
  const configured = isSupabaseConfigured();
  const [session, setSession] = useState<Session | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [items, setItems] = useState<ContentItem[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [assets, setAssets] = useState<ContentAsset[]>([]);
  const [revisions, setRevisions] = useState<ContentRevision[]>([]);
  const [timelineCues, setTimelineCues] = useState<ContentTimelineCue[]>([]);
  const [brandArticles, setBrandArticles] = useState<BrandArticle[]>([]);
  const [brandReferences, setBrandReferences] = useState<ContentBrandReference[]>([]);
  const [loading, setLoading] = useState(configured);
  const [working, setWorking] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showQuickIntake, setShowQuickIntake] = useState(false);
  const [editingBriefId, setEditingBriefId] = useState<string | null>(null);
  const [assetFormId, setAssetFormId] = useState<string | null>(null);
  const [revisionFormId, setRevisionFormId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(configured ? null : "لم يتم إعداد اتصال Supabase لهذه النسخة.");
  const [notice, setNotice] = useState<string | null>(null);
  const [defaultPublish] = useState(() => toLocalDateTimeInput(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)));

  const clearData = useCallback(() => {
    setItems([]);
    setTasks([]);
    setAssets([]);
    setRevisions([]);
    setTimelineCues([]);
    setBrandArticles([]);
    setBrandReferences([]);
    setEditingBriefId(null);
    setAssetFormId(null);
    setRevisionFormId(null);
  }, []);

  const refreshContent = useCallback(async (organizationId: string) => {
    const supabase = getSupabaseBrowserClient();
    const [contentResult, taskResult, assetResult, revisionResult, timelineResult, brandResult, brandReferenceResult] = await Promise.all([
      supabase.from("content_items").select("*").eq("organization_id", organizationId).order("publish_at", { ascending: true }),
      supabase.from("tasks").select("*").eq("organization_id", organizationId).not("content_item_id", "is", null).order("due_at", { ascending: true }),
      supabase.from("content_assets").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }),
      supabase.from("content_revision_requests").select("*").eq("organization_id", organizationId).order("round", { ascending: false }),
      supabase.from("content_timeline_cues").select("*").eq("organization_id", organizationId).order("sort_order", { ascending: true }),
      supabase.from("brand_articles").select("*").eq("organization_id", organizationId).order("title", { ascending: true }),
      supabase.from("content_brand_references").select("*").eq("organization_id", organizationId),
    ]);

    if (contentResult.error) throw contentResult.error;
    if (taskResult.error) throw taskResult.error;
    if (assetResult.error) throw assetResult.error;
    if (revisionResult.error) throw revisionResult.error;
    if (timelineResult.error) throw timelineResult.error;
    if (brandResult.error) throw brandResult.error;
    if (brandReferenceResult.error) throw brandReferenceResult.error;
    setItems(contentResult.data ?? []);
    setTasks(taskResult.data ?? []);
    setAssets(assetResult.data ?? []);
    setRevisions(revisionResult.data ?? []);
    setTimelineCues(timelineResult.data ?? []);
    setBrandArticles(brandResult.data ?? []);
    setBrandReferences(brandReferenceResult.data ?? []);
  }, []);

  const loadWorkspace = useCallback(async (activeSession: Session) => {
    const supabase = getSupabaseBrowserClient();
    setLoading(true);
    setError(null);
    try {
      const { data: membership, error: membershipError } = await supabase
        .from("memberships").select("*").eq("user_id", activeSession.user.id).eq("status", "active").limit(1).maybeSingle();
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
      const profilesResult = memberIds.length
        ? await supabase.from("profiles").select("id, full_name").in("id", memberIds)
        : { data: [], error: null };
      if (profilesResult.error) throw profilesResult.error;

      const people = (membersResult.data ?? []).map((member) => ({
        id: member.user_id,
        role: member.role,
        name: profilesResult.data?.find((profile) => profile.id === member.user_id)?.full_name
          ?? (member.user_id === activeSession.user.id ? activeSession.user.email : null)
          ?? "عضو فريق",
      }));
      setWorkspace({ organization: organizationResult.data, membership, people });
      await refreshContent(membership.organization_id);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [clearData, refreshContent]);

  useEffect(() => {
    if (!configured) return;
    const supabase = getSupabaseBrowserClient();
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) void loadWorkspace(data.session);
      else setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setNotice(null);
      if (nextSession) void loadWorkspace(nextSession);
      else {
        setWorkspace(null);
        clearData();
        setLoading(false);
      }
    });
    return () => data.subscription.unsubscribe();
  }, [clearData, configured, loadWorkspace]);

  useEffect(() => {
    if (!workspace) return;
    const supabase = getSupabaseBrowserClient();
    const refresh = () => void refreshContent(workspace.organization.id);
    let channel = supabase.channel(`content:${workspace.organization.id}`);
    for (const table of ["content_items", "tasks", "content_assets", "content_revision_requests", "content_timeline_cues", "brand_articles", "content_brand_references"] as const) {
      channel = channel.on("postgres_changes", {
        event: "*", schema: "public", table, filter: `organization_id=eq.${workspace.organization.id}`,
      }, refresh);
    }
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refreshContent, workspace]);

  const tasksByContent = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    for (const task of tasks) {
      if (!task.content_item_id) continue;
      grouped.set(task.content_item_id, [...(grouped.get(task.content_item_id) ?? []), task]);
    }
    return grouped;
  }, [tasks]);

  const assetsByContent = useMemo(() => {
    const grouped = new Map<string, ContentAsset[]>();
    for (const asset of assets) grouped.set(asset.content_item_id, [...(grouped.get(asset.content_item_id) ?? []), asset]);
    return grouped;
  }, [assets]);

  const revisionsByContent = useMemo(() => {
    const grouped = new Map<string, ContentRevision[]>();
    for (const revision of revisions) grouped.set(revision.content_item_id, [...(grouped.get(revision.content_item_id) ?? []), revision]);
    return grouped;
  }, [revisions]);

  const timelineByContent = useMemo(() => {
    const grouped = new Map<string, ContentTimelineCue[]>();
    for (const cue of timelineCues) grouped.set(cue.content_item_id, [...(grouped.get(cue.content_item_id) ?? []), cue]);
    return grouped;
  }, [timelineCues]);

  const brandReferencesByContent = useMemo(() => {
    const grouped = new Map<string, ContentBrandReference[]>();
    for (const reference of brandReferences) grouped.set(reference.content_item_id, [...(grouped.get(reference.content_item_id) ?? []), reference]);
    return grouped;
  }, [brandReferences]);

  const brandArticlesById = useMemo(() => new Map(brandArticles.map((article) => [article.id, article])), [brandArticles]);
  const approvedBrandArticles = useMemo(() => brandArticles.filter((article) => article.status === "approved"), [brandArticles]);

  async function runCommand(body: Record<string, unknown>, successMessage: string) {
    if (!workspace) return false;
    setWorking(true);
    setError(null);
    setNotice(null);
    const { error: commandError } = await getSupabaseBrowserClient().functions.invoke("content-commands", { body });
    setWorking(false);
    if (commandError) {
      setError(await getSupabaseFunctionErrorMessage(commandError, "تعذّر تحديث المحتوى."));
      return false;
    }
    setNotice(successMessage);
    await refreshContent(workspace.organization.id);
    return true;
  }

  async function createWorkflow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const publishValue = formText(form, "publish_at");
    const publishDate = new Date(publishValue);
    if (!publishValue || Number.isNaN(publishDate.getTime()) || publishDate.getTime() <= Date.now() + 60 * 60 * 1000) {
      setError("موعد النشر يجب أن يكون بعد ساعة على الأقل من الآن.");
      return;
    }

    setWorking(true);
    setError(null);
    setNotice(null);
    const { error: workflowError } = await getSupabaseBrowserClient().functions.invoke("create-content-workflow", {
      body: {
        target_organization_id: workspace.organization.id,
        content_title: formText(form, "title"),
        content_goal: formText(form, "goal"),
        content_hook: formText(form, "hook"),
        content_cta: formText(form, "cta"),
        content_script_outline: formText(form, "script_outline"),
        content_editing_brief: formText(form, "editing_brief"),
        content_thumbnail_brief: formText(form, "thumbnail_brief"),
        content_brand_notes: formText(form, "brand_notes"),
        brand_article_ids: form.getAll("brand_reference_ids").map(String),
        initial_raw_url: formText(form, "initial_raw_url"),
        initial_source_url: formText(form, "initial_source_url"),
        initial_reference_url: formText(form, "initial_reference_url"),
        target_publish_at: publishDate.toISOString(),
        ...Object.fromEntries(contentAssignmentFields.map(({ name }) => [name, formText(form, name)])),
      },
    });
    setWorking(false);
    if (workflowError) {
      setError(await getSupabaseFunctionErrorMessage(workflowError, "تعذّر إنشاء مسار إنتاج المحتوى. لم يتم حفظ أي جزء من العملية."));
      return;
    }
    formElement.reset();
    setShowCreate(false);
    setNotice("تم إنشاء Production Brief و7 مهام مترابطة. أول مهمة فقط جاهزة الآن.");
    await refreshContent(workspace.organization.id);
  }

  async function createQuickWorkflow(payload: QuickIntakePayload) {
    if (!workspace) return false;
    setWorking(true);
    setError(null);
    setNotice(null);
    const { error: workflowError } = await getSupabaseBrowserClient().functions.invoke("create-content-workflow", {
      body: { target_organization_id: workspace.organization.id, ...payload },
    });
    setWorking(false);
    if (workflowError) {
      setError(await getSupabaseFunctionErrorMessage(workflowError, "تعذّر تحويل الطلب السريع إلى مسار إنتاج."));
      return false;
    }
    setShowQuickIntake(false);
    setNotice("تم تحويل طلب Telegram إلى Brief وTimeline و7 مهام مترابطة بعد مراجعتك.");
    await refreshContent(workspace.organization.id);
    return true;
  }

  async function updateBrief(event: FormEvent<HTMLFormElement>, contentId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const updated = await runCommand({
      action: "update_brief",
      content_item_id: contentId,
      content_script_outline: formText(form, "script_outline"),
      content_editing_brief: formText(form, "editing_brief"),
      content_thumbnail_brief: formText(form, "thumbnail_brief"),
      content_brand_notes: formText(form, "brand_notes"),
    }, "تم تحديث Production Brief ومزامنة تعليمات المونتاج والغلاف مع المهام.");
    if (updated) setEditingBriefId(null);
  }

  async function addAsset(event: FormEvent<HTMLFormElement>, contentId: string) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const added = await runCommand({
      action: "add_asset",
      content_item_id: contentId,
      asset_stage: formText(form, "asset_stage"),
      asset_kind: formText(form, "asset_kind"),
      asset_title: formText(form, "asset_title"),
      asset_url: formText(form, "asset_url"),
      asset_notes: formText(form, "asset_notes"),
    }, "تمت إضافة الرابط إلى ملف المحتوى وأصبح متاحًا لصاحب المهمة.");
    if (added) {
      formElement.reset();
      setAssetFormId(null);
    }
  }

  async function requestRevision(event: FormEvent<HTMLFormElement>, contentId: string) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const requested = await runCommand({
      action: "request_revision",
      content_item_id: contentId,
      target_stage: formText(form, "target_stage"),
      revision_instructions: formText(form, "revision_instructions"),
    }, "تم تسجيل جولة تعديل وإسنادها تلقائيًا لصاحب المرحلة.");
    if (requested) {
      formElement.reset();
      setRevisionFormId(null);
    }
  }

  if (loading) return <section className="workspace-state" aria-live="polite"><LoaderCircle className="spin" size={24} /><div><h2>جارٍ تحميل مصنع المحتوى</h2><p>نجمع الأصول والمهام والصلاحيات من المصدر الحقيقي.</p></div></section>;

  if (!session) return (
    <section className="workspace-state workspace-onboarding">
      <LockKeyhole size={27} /><div><p className="overline">دخول موحد</p><h2>سجّل الدخول أولًا من قسم المهام</h2><p>نفس الجلسة والصلاحيات تعمل في كل أقسام النظام.</p></div>
      <Button href="/tasks"><Link2 size={16} /> الانتقال لتسجيل الدخول</Button>
    </section>
  );

  if (!workspace) return (
    <section className="workspace-state workspace-onboarding">
      <Route size={27} /><div><p className="overline">مساحة العمل مطلوبة</p><h2>أنشئ مساحة الشركة مرة واحدة</h2><p>ابدأ من قسم المهام، ثم ارجع هنا لبناء خط الإنتاج.</p></div>
      <Button href="/tasks"><Link2 size={16} /> فتح قسم المهام</Button>
    </section>
  );

  const manager = canManageTasks(workspace.membership.role);
  const peopleById = new Map(workspace.people.map((person) => [person.id, person]));

  return (
    <section className="content-workspace">
      <div className="workspace-toolbar">
        <div><p className="overline">{workspace.organization.name}</p><h2>مصنع الريلز</h2><p>{items.length ? `${items.length} أصل محتوى حقيقي` : "لا يوجد محتوى حقيقي بعد — أنشئ أول ريلز عند الجاهزية."}</p></div>
        <div className="toolbar-actions">
          <button className="icon-button" type="button" aria-label="تحديث المحتوى" onClick={() => void refreshContent(workspace.organization.id)}><RefreshCw size={17} /></button>
          <Button href="/tasks" variant="secondary"><Route size={16} /> عرض كل المهام</Button>
          {manager ? <Button type="button" onClick={() => { setShowQuickIntake((value) => !value); setShowCreate(false); }}><MessageSquareText size={16} /> طلب كامل من Telegram</Button> : null}
          {manager ? <Button type="button" variant="secondary" onClick={() => { setShowCreate((value) => !value); setShowQuickIntake(false); }}><Plus size={16} /> إدخال يدوي</Button> : null}
        </div>
      </div>

      {notice ? <p className="form-notice success" role="status">{notice}</p> : null}
      {error ? <p className="form-notice error" role="alert">{error}</p> : null}

      {showQuickIntake && manager ? <QuickIntakeForm
        currentUserId={session.user.id}
        defaultPublish={defaultPublish}
        people={workspace.people}
        approvedBrandArticles={approvedBrandArticles.map((article) => ({ id: article.id, title: article.title, version: article.version, categoryLabel: brandCategoryConfig[article.category].label }))}
        working={working}
        onCancel={() => setShowQuickIntake(false)}
        onCreate={createQuickWorkflow}
      /> : null}

      {showCreate && manager ? (
        <form className="panel content-create-form" onSubmit={createWorkflow}>
          <div className="section-heading"><div><p className="overline">مصدر حقيقة واحد</p><h2>Production Brief وخط التنفيذ</h2></div><button className="text-button" type="button" onClick={() => setShowCreate(false)}>إغلاق</button></div>
          <div className="form-grid">
            <label><span>عنوان الريلز</span><input name="title" minLength={3} maxLength={180} required placeholder="عنوان واضح للفريق والجمهور" /></label>
            <label><span>موعد النشر النهائي</span><input name="publish_at" type="datetime-local" defaultValue={defaultPublish} required /></label>
            <label className="full-field"><span>الهدف</span><textarea name="goal" minLength={5} maxLength={1000} rows={2} required placeholder="ما الفهم أو القرار المطلوب من الجمهور؟" /></label>
            <label className="full-field"><span>الـHook</span><textarea name="hook" minLength={3} maxLength={1000} rows={2} required placeholder="أول جملة توقف المشاهد" /></label>
            <label className="full-field"><span>الـCTA</span><textarea name="cta" minLength={2} maxLength={500} rows={2} required placeholder="الإجراء المطلوب من المشاهد" /></label>
            <label className="full-field"><span>السكريبت أو تسلسل الفكرة</span><textarea name="script_outline" minLength={10} maxLength={8000} rows={5} required placeholder="الجمل أو المشاهد بالترتيب، وما الذي يجب ظهوره أو سماعه في كل جزء" /></label>
            <label className="full-field"><span>Production Brief للمونتاج</span><textarea name="editing_brief" minLength={10} maxLength={8000} rows={6} required placeholder="حدد إيقاع القطع، متى تعلو أو تنخفض الموسيقى، لحظات الصمت، الترجمة، B-roll، المؤثرات، وما يجب تجنبه" /></label>
            <label className="full-field"><span>Design Brief للغلاف</span><textarea name="thumbnail_brief" minLength={10} maxLength={4000} rows={4} required placeholder="النص الأساسي، ترتيب العناصر، الصورة، الإحساس البصري، المقاس، وما لا يجوز استخدامه" /></label>
            <label className="full-field"><span>استثناءات أو ملاحظات خاصة بهذا الريلز — اختياري</span><textarea name="brand_notes" maxLength={4000} rows={3} placeholder="اكتب فقط ما يختلف عن قواعد البراند المعتمدة لهذا الطلب" /></label>
          </div>
          <BrandReferenceSelector articles={approvedBrandArticles} />
          <div className="asset-seed-block">
            <div><p className="overline">ملفات البداية</p><h3>أضف المتاح الآن واترك الباقي للفريق</h3><p>أي رابط Google Drive أو مصدر خارجي سيظل مرتبطًا بالريلز ومرحلة استخدامه.</p></div>
            <div className="form-grid">
              <label><span>رابط المادة الخام — اختياري</span><input name="initial_raw_url" type="url" dir="ltr" placeholder="https://drive.google.com/..." /></label>
              <label><span>رابط المصدر الأساسي — اختياري</span><input name="initial_source_url" type="url" dir="ltr" placeholder="https://..." /></label>
              <label className="full-field"><span>مرجع بصري أو فيديو مشابه — اختياري</span><input name="initial_reference_url" type="url" dir="ltr" placeholder="https://..." /></label>
            </div>
          </div>
          <div className="assignment-block">
            <div><p className="overline">المساءلة</p><h3>مسؤول واحد لكل خطوة</h3><p>كل خطوة تصل لصاحبها بموعد واعتمادية واضحة.</p></div>
            <div className="assignment-grid">{contentAssignmentFields.map(({ step, name }) => (
              <label key={step}><span>{contentStepConfig[step].label}</span><select name={name} defaultValue={session.user.id} required>{workspace.people.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
            ))}</div>
          </div>
          <div className="form-actions"><Button type="submit" disabled={working}>{working ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />} إنشاء خط الإنتاج</Button><small>إما يُنشأ الـBrief و7 المهام والروابط معًا، أو لا يُحفظ شيء.</small></div>
        </form>
      ) : null}

      {items.length ? <div className="content-list">{items.map((item) => {
        const itemTasks = [...(tasksByContent.get(item.id) ?? [])].sort((a, b) => (a.content_step ? contentStepConfig[a.content_step].order : 99) - (b.content_step ? contentStepConfig[b.content_step].order : 99));
        const itemAssets = assetsByContent.get(item.id) ?? [];
        const itemRevisions = revisionsByContent.get(item.id) ?? [];
        const itemTimeline = [...(timelineByContent.get(item.id) ?? [])].sort((a, b) => a.sort_order - b.sort_order);
        const itemBrandArticles = (brandReferencesByContent.get(item.id) ?? []).map((reference) => brandArticlesById.get(reference.brand_article_id)).filter((article): article is BrandArticle => Boolean(article));
        const doneCount = itemTasks.filter((task) => task.status === "done").length;
        const activeTasks = itemTasks.filter((task) => ["ready", "in_progress", "review", "blocked"].includes(task.status));
        const progress = itemTasks.length ? Math.round((doneCount / itemTasks.length) * 100) : 0;
        const openRevisions = itemRevisions.filter((revision) => ["requested", "in_progress"].includes(revision.status));
        const approvalTask = itemTasks.find((task) => task.content_step === "approval");
        const editingTask = itemTasks.find((task) => task.content_step === "editing");
        const workflowOwner = itemTasks.some((task) => task.owner_id === session.user.id);
        const canAddAsset = manager || workflowOwner;
        const canRequestRevision = manager || approvalTask?.owner_id === session.user.id;
        const canChangeTimeline = manager || editingTask?.owner_id === session.user.id;
        const completedCueCount = itemTimeline.filter((cue) => cue.completed_at).length;
        const openCueCount = itemTimeline.length - completedCueCount;
        const briefComplete = Boolean(item.script_outline.trim() && item.editing_brief.trim() && item.thumbnail_brief.trim());

        return <article className="panel content-card" id={`content-${item.id}`} key={item.id}>
          <header>
            <div className="content-card-title"><span className="icon-tile"><Film size={17} /></span><div><p className="overline">Reel · Instagram + Facebook · v{item.version}</p><h3>{item.title}</h3></div></div>
            <div className="content-card-badges"><StatusBadge tone={contentStatusConfig[item.status].tone}>{contentStatusConfig[item.status].label}</StatusBadge>{openRevisions.length ? <StatusBadge tone="warning">{openRevisions.length} تعديل مفتوح</StatusBadge> : null}{openCueCount ? <StatusBadge tone="info">{openCueCount} تعليمة تنفيذ</StatusBadge> : null}</div>
          </header>

          <div className="content-brief-grid"><div><small>الهدف</small><p>{item.goal}</p></div><div><small>الـHook</small><p>{item.hook}</p></div><div><small>الـCTA</small><p>{item.cta}</p></div></div>
          <section className="content-brand-references"><div><BookOpenCheck size={16} /><div><p className="overline">مرجع التنفيذ</p><h4>مراجع البراند المعتمدة</h4></div></div>{itemBrandArticles.length ? <div>{itemBrandArticles.map((article) => <a href={`/brand#article-${article.id}`} key={article.id}><strong>{article.title}</strong><small>{brandCategoryConfig[article.category].label} · v{article.version}{article.status === "archived" ? " · نسخة محفوظة" : ""}</small></a>)}</div> : <p>لم يُربط مرجع معتمد بهذا الطلب. استخدم الملاحظات الخاصة أدناه فقط عند وجود استثناء فعلي.</p>}</section>
          <div className="production-header"><div><FileText size={17} /><div><p className="overline">تعليمات التنفيذ</p><h4>Production Brief</h4></div></div>{manager ? <button className="text-button" type="button" onClick={() => setEditingBriefId(editingBriefId === item.id ? null : item.id)}><Pencil size={13} /> {briefComplete ? "تعديل التعليمات" : "استكمال التعليمات"}</button> : null}</div>

          {editingBriefId === item.id && manager ? <form className="inline-production-form" onSubmit={(event) => void updateBrief(event, item.id)}>
            <label><span>السكريبت أو التسلسل</span><textarea name="script_outline" minLength={10} maxLength={8000} rows={5} required defaultValue={item.script_outline} /></label>
            <label><span>تعليمات المونتاج</span><textarea name="editing_brief" minLength={10} maxLength={8000} rows={6} required defaultValue={item.editing_brief} placeholder="القطع، الموسيقى، الصمت، الترجمة، B-roll، المؤثرات، والممنوعات" /></label>
            <label><span>تعليمات الغلاف</span><textarea name="thumbnail_brief" minLength={10} maxLength={4000} rows={4} required defaultValue={item.thumbnail_brief} placeholder="النص، الصورة، الترتيب البصري، المقاس، والممنوعات" /></label>
            <label><span>استثناءات أو ملاحظات خاصة — اختياري</span><textarea name="brand_notes" maxLength={4000} rows={3} defaultValue={item.brand_notes ?? ""} /></label>
            <div className="form-actions"><Button type="submit" disabled={working}>{working ? <LoaderCircle className="spin" size={15} /> : <CheckCircle2 size={15} />} حفظ ومزامنة المهام</Button><button className="text-button" type="button" onClick={() => setEditingBriefId(null)}>إلغاء</button></div>
          </form> : <div className={`production-brief-grid ${briefComplete ? "" : "incomplete"}`}>
            <div><small>السكريبت / التسلسل</small><p>{item.script_outline || "لم تُضف تعليمات السكربت بعد."}</p></div>
            <div><small>تعليمات المونتاج</small><p>{item.editing_brief || "لم تُضف تعليمات المونتاج بعد."}</p></div>
            <div><small>تعليمات الغلاف</small><p>{item.thumbnail_brief || "لم تُضف تعليمات الغلاف بعد."}</p></div>
            {item.brand_notes ? <div><small>استثناءات أو ملاحظات خاصة</small><p>{item.brand_notes}</p></div> : null}
          </div>}

          {item.intake_request && item.intake_source_url ? <details className="telegram-intake-source">
            <summary><MessageSquareText size={15} /> الطلب الأصلي من Telegram</summary>
            <div><a href={item.intake_source_url} target="_blank" rel="noreferrer">فتح رسالة المادة الخام <ExternalLink size={12} /></a><pre>{item.intake_request}</pre></div>
          </details> : null}

          <div className="production-tools-grid">
            {itemTimeline.length ? <section className="production-tool-panel content-timeline-panel">
              <div className="production-tool-heading"><div><TimerReset size={16} /><div><p className="overline">Execution Timeline</p><h4>تعليمات المونتاج بالثانية</h4></div></div><span className="timeline-progress">{completedCueCount}/{itemTimeline.length} تم</span></div>
              <ol className="content-timeline-list">{itemTimeline.map((cue) => <li className={cue.completed_at ? "completed" : ""} key={cue.id}>
                <div className="timeline-cue-time"><TimerReset size={13} /><strong>{formatTimelineSeconds(cue.start_seconds)}{cue.end_seconds === null ? "" : ` — ${formatTimelineSeconds(cue.end_seconds)}`}</strong></div>
                <div className="timeline-cue-body"><span>{contentCueKindConfig[cue.kind].label}</span><p>{cue.action}</p>{cue.source_url ? <a href={cue.source_url} target="_blank" rel="noreferrer">فتح المصدر <ExternalLink size={11} /></a> : null}</div>
                {canChangeTimeline ? <button className="timeline-toggle" type="button" disabled={working} onClick={() => void runCommand({ action: "change_timeline_cue", cue_id: cue.id, completed: !cue.completed_at }, cue.completed_at ? "أُعيد فتح تعليمة الـTimeline." : "تم تعليم سطر الـTimeline كمنفذ.")}>{cue.completed_at ? "إعادة فتح" : "تم التنفيذ"}</button> : null}
              </li>)}</ol>
              {openCueCount ? <p className="timeline-guard-note">لا يمكن إغلاق الاعتماد النهائي قبل تنفيذ كل تعليمات الـTimeline.</p> : <p className="timeline-guard-note complete"><CheckCircle2 size={13} /> كل تعليمات المونتاج منفذة.</p>}
            </section> : null}
            <section className="production-tool-panel">
              <div className="production-tool-heading"><div><Paperclip size={16} /><div><p className="overline">ملفات ومراجع</p><h4>مركز الأصول</h4></div></div>{canAddAsset ? <button className="text-button" type="button" onClick={() => setAssetFormId(assetFormId === item.id ? null : item.id)}><Plus size={13} /> إضافة رابط</button> : null}</div>
              {itemAssets.length ? <ul className="asset-list">{itemAssets.map((asset) => <li key={asset.id}>
                <div><span className="asset-kind">{contentAssetKindConfig[asset.kind].label}</span><a href={asset.url} target="_blank" rel="noreferrer">{asset.title} <ExternalLink size={12} /></a><small>{asset.stage ? contentStepConfig[asset.stage].label : "كل المراحل"} · أضافه {peopleById.get(asset.created_by)?.name ?? "عضو فريق"}</small>{asset.notes ? <p>{asset.notes}</p> : null}</div>
                {manager || asset.created_by === session.user.id ? <button className="asset-remove" type="button" disabled={working} aria-label={`إزالة رابط ${asset.title}`} onClick={() => void runCommand({ action: "remove_asset", asset_id: asset.id }, "تمت إزالة الرابط من ملف المحتوى فقط؛ الملف الأصلي لم يُحذف.")}><Trash2 size={13} /> إزالة الرابط</button> : null}
              </li>)}</ul> : <p className="tool-empty">لا توجد روابط بعد. أضف المادة الخام والمصادر ونسخ المراجعة هنا بدل الرسائل المتفرقة.</p>}
              {assetFormId === item.id && canAddAsset ? <form className="compact-command-form" onSubmit={(event) => void addAsset(event, item.id)}>
                <div className="compact-form-grid"><label><span>النوع</span><select name="asset_kind" defaultValue="raw_video">{assetKinds.map((kind) => <option value={kind} key={kind}>{contentAssetKindConfig[kind].label}</option>)}</select></label><label><span>مرحلة الاستخدام</span><select name="asset_stage" defaultValue="editing">{contentSteps.map((step) => <option value={step} key={step}>{contentStepConfig[step].label}</option>)}</select></label></div>
                <label><span>اسم واضح للرابط</span><input name="asset_title" minLength={2} maxLength={160} required placeholder="مثال: المادة الخام — Take 2" /></label>
                <label><span>الرابط</span><input name="asset_url" type="url" dir="ltr" required placeholder="https://drive.google.com/..." /></label>
                <label><span>ملاحظة الاستخدام — اختياري</span><textarea name="asset_notes" maxLength={2000} rows={2} placeholder="من الدقيقة 00:18 أو استخدم الصور 2 و4 فقط" /></label>
                <div className="form-actions"><Button type="submit" disabled={working}>حفظ الرابط</Button><button className="text-button" type="button" onClick={() => setAssetFormId(null)}>إلغاء</button></div>
              </form> : null}
            </section>

            <section className="production-tool-panel">
              <div className="production-tool-heading"><div><MessageSquareText size={16} /><div><p className="overline">Feedback Loop</p><h4>جولات التعديل</h4></div></div>{canRequestRevision ? <button className="text-button" type="button" onClick={() => setRevisionFormId(revisionFormId === item.id ? null : item.id)}><Plus size={13} /> طلب تعديل</button> : null}</div>
              {itemRevisions.length ? <ol className="revision-list">{itemRevisions.map((revision) => {
                const canWorkRevision = manager || revision.assigned_to === session.user.id;
                const canCancelRevision = manager || revision.requested_by === session.user.id;
                return <li key={revision.id}>
                  <div className="revision-top"><strong>جولة {revision.round} · {contentStepConfig[revision.stage].label}</strong><StatusBadge tone={contentRevisionStatusConfig[revision.status].tone}>{contentRevisionStatusConfig[revision.status].label}</StatusBadge></div>
                  <p>{revision.instructions}</p><small>إلى {peopleById.get(revision.assigned_to)?.name ?? "صاحب المرحلة"} · {formatDate(revision.requested_at)}</small>
                  {revision.status === "requested" && canWorkRevision ? <Button type="button" variant="secondary" disabled={working} onClick={() => void runCommand({ action: "start_revision", revision_id: revision.id }, "بدأ تنفيذ التعديل وأعيد فتح مهمة المرحلة.")}>بدء التنفيذ</Button> : null}
                  {revision.status === "in_progress" && canWorkRevision ? <Button type="button" variant="secondary" disabled={working} onClick={() => void runCommand({ action: "resolve_revision", revision_id: revision.id }, "تم إرسال التعديل للمراجعة.")}>تم التنفيذ وإرسال للمراجعة</Button> : null}
                  {["requested", "in_progress"].includes(revision.status) && canCancelRevision ? <button className="text-button danger-text" type="button" disabled={working} onClick={() => void runCommand({ action: "cancel_revision", revision_id: revision.id }, "تم إلغاء طلب التعديل مع الاحتفاظ بسجله.")}>إلغاء الطلب</button> : null}
                </li>;
              })}</ol> : <p className="tool-empty">لا توجد تعديلات مسجلة. عند طلب تعديل سيُسند تلقائيًا لصاحب المرحلة برقم جولة واضح.</p>}
              {revisionFormId === item.id && canRequestRevision ? <form className="compact-command-form" onSubmit={(event) => void requestRevision(event, item.id)}>
                <label><span>المرحلة المطلوب تعديلها</span><select name="target_stage" defaultValue="editing">{revisionSteps.map((step) => <option value={step} key={step}>{contentStepConfig[step].label}</option>)}</select></label>
                <label><span>ما المطلوب تغييره بالضبط؟</span><textarea name="revision_instructions" minLength={5} maxLength={5000} rows={4} required placeholder="اكتب التوقيت أو المشهد، المشكلة، والنتيجة المطلوبة. مثال: 00:18 اخفض الموسيقى واترك نصف ثانية صمت قبل الجملة التالية." /></label>
                <div className="form-actions"><Button type="submit" disabled={working}>إسناد التعديل</Button><button className="text-button" type="button" onClick={() => setRevisionFormId(null)}>إلغاء</button></div>
              </form> : null}
            </section>
          </div>

          <div className="content-progress-row"><div><strong>{progress}%</strong><span>اكتمل {doneCount} من {itemTasks.length}</span></div><div className="content-progress-track" aria-label={`نسبة الإنجاز ${progress}%`}><span style={{ width: `${progress}%` }} /></div><div><CalendarClock size={14} /><span>النشر {formatDate(item.publish_at)}</span></div></div>
          <ol className="content-steps" aria-label="خطوات إنتاج المحتوى">{contentSteps.map((step) => {
            const task = itemTasks.find((candidate) => candidate.content_step === step);
            const isActive = activeTasks.some((activeTask) => activeTask.id === task?.id);
            return <li className={`${task?.status === "done" ? "done" : ""} ${isActive ? "active" : ""}`} key={step}><span>{task?.status === "done" ? <CheckCircle2 size={14} /> : contentStepConfig[step].order}</span><strong>{contentStepConfig[step].label}</strong><small>{task ? peopleById.get(task.owner_id)?.name ?? "عضو فريق" : "—"}</small></li>;
          })}</ol>
          <footer><div>{activeTasks.length ? <><CircleUserRound size={15} /><span>النشط الآن: <strong>{activeTasks.map((task) => task.content_step ? contentStepConfig[task.content_step].label : task.title).join(" + ")}</strong></span></> : <><CheckCircle2 size={15} /><span>لا توجد خطوة نشطة الآن.</span></>}</div><a className="text-link" href="/tasks">فتح بورد التنفيذ <Link2 size={13} /></a></footer>
        </article>;
      })}</div> : <section className="panel empty-state"><span className="empty-visual"><Film size={20} /></span><div><h2>مصنع المحتوى جاهز بدون بيانات وهمية</h2><p>عندما تنشئ أول ريلز سيظهر هنا ومعه الـBrief والملفات والمهام والتعديلات.</p></div><span className="empty-proof"><CheckCircle2 size={15} /> متصل ببورد المهام</span></section>}

      <aside className="automation-note"><LockKeyhole size={17} /><div><strong>النشر الخارجي لم يُفعّل بعد</strong><p>مهمة النشر تُغلق يدويًا بعد الجدولة الفعلية. ربط Meta سيكون تكاملًا منفصلًا بصلاحيات محدودة، ولن نعتبر المحتوى منشورًا قبل تأكيد حقيقي من المنصة.</p></div></aside>
    </section>
  );
}
