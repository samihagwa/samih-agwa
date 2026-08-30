"use client";

import type { Session } from "@supabase/supabase-js";
import {
  CalendarClock,
  BookOpenCheck,
  CheckCircle2,
  ChevronDown,
  CircleUserRound,
  ExternalLink,
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
  Upload,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  contentAssetKindConfig,
  contentAssignmentFields,
  contentCueKindConfig,
  contentRevisionStatusConfig,
  contentStatusConfig,
  contentStepConfig,
  contentRevisionSteps,
  contentWorkflowSteps,
  type ContentAssetKind,
  type ContentStep,
} from "../../lib/content";
import { formatTimelineSeconds } from "../../lib/content-intake";
import { brandCategoryConfig } from "../../lib/brand";
import { currentUuidDeepLink } from "../../lib/deep-links";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Tables } from "../../lib/supabase/database.types";
import { getSupabaseFunctionErrorMessage } from "../../lib/supabase/function-errors";
import { useWorkspaceAuth } from "../../lib/supabase/use-workspace-auth";
import { canManageAllTaskExecution, canManageTasks, taskStatusConfig, taskStatusLabel } from "../../lib/tasks";
import { Button } from "../ui/Button";
import { StatusBadge } from "../ui/StatusBadge";
import { QuickIntakeForm, type QuickIntakePayload } from "./QuickIntakeForm";

type ContentItem = Tables<"content_items">;
type ContentAsset = Tables<"content_assets">;
type ContentRevision = Tables<"content_revision_requests">;
type ContentStepDelivery = Tables<"content_step_deliveries">;
type ContentTimelineCue = Tables<"content_timeline_cues">;
type BrandArticle = Tables<"brand_articles">;
type ContentBrandReference = Tables<"content_brand_references">;
type Task = Tables<"tasks">;
type Membership = Tables<"memberships">;
type Organization = Tables<"organizations">;
type CaptionOption = { label: string; caption: string; hashtags: string[] };
type ThumbnailOption = { label: string; cover_text: string; visual_direction: string; script_connection: string };
type AiChoiceSet<T> = { version: number; options: T[] };

type TeamPerson = {
  id: string;
  name: string;
  role: Membership["role"];
  allowedSections: string[];
};
type Workspace = { organization: Organization; membership: Membership; people: TeamPerson[] };
type ContentFilter = "active" | "scheduled" | "archive";

const assetKinds = Object.keys(contentAssetKindConfig) as ContentAssetKind[];
const resultSteps = ["recording", "editing", "thumbnail", "caption", "design", "scheduling", "publishing"] as ContentStep[];

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

function captionOptionText(option: CaptionOption) {
  const hashtags = option.hashtags.map((tag) => tag.trim()).filter(Boolean)
    .map((tag) => tag.startsWith("#") ? tag : `#${tag}`);
  return [option.caption.trim(), hashtags.join(" ")].filter(Boolean).join("\n\n");
}

function thumbnailOptionText(option: ThumbnailOption) {
  return `النص على الغلاف: ${option.cover_text}\nالاتجاه البصري: ${option.visual_direction}\nصلته بالاسكريبت: ${option.script_connection}`;
}

function contentRequestText(item: ContentItem) {
  if (item.intake_request?.trim()) return item.intake_request.trim();
  return [
    item.goal ? `الهدف:\n${item.goal}` : "",
    item.hook ? `الهوك:\n${item.hook}` : "",
    item.cta ? `الدعوة للإجراء:\n${item.cta}` : "",
    item.script_outline ? `السكريبت أو التسلسل:\n${item.script_outline}` : "",
    item.editing_brief ? `تعليمات المونتاج:\n${item.editing_brief}` : "",
    item.thumbnail_brief ? `تعليمات الغلاف:\n${item.thumbnail_brief}` : "",
    item.copy_brief ? `تعليمات الكتابة:\n${item.copy_brief}` : "",
    item.design_brief ? `تعليمات التصميم:\n${item.design_brief}` : "",
  ].filter(Boolean).join("\n\n");
}

function LinkifiedText({ text }: { text: string }) {
  return <>{text.split(/(https?:\/\/[^\s]+)/g).map((part, index) => /^https?:\/\//.test(part)
    ? <a href={part} target="_blank" rel="noreferrer" key={`${part}-${index}`}>{part} <ExternalLink size={11} /></a>
    : part)}</>;
}

export function ContentWorkspace() {
  const configured = isSupabaseConfigured();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [items, setItems] = useState<ContentItem[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [assets, setAssets] = useState<ContentAsset[]>([]);
  const [revisions, setRevisions] = useState<ContentRevision[]>([]);
  const [deliveries, setDeliveries] = useState<ContentStepDelivery[]>([]);
  const [timelineCues, setTimelineCues] = useState<ContentTimelineCue[]>([]);
  const [brandArticles, setBrandArticles] = useState<BrandArticle[]>([]);
  const [brandReferences, setBrandReferences] = useState<ContentBrandReference[]>([]);
  const [loading, setLoading] = useState(configured);
  const [working, setWorking] = useState(false);
  const [showQuickIntake, setShowQuickIntake] = useState(false);
  const [editingBriefId, setEditingBriefId] = useState<string | null>(null);
  const [assetFormId, setAssetFormId] = useState<string | null>(null);
  const [revisionFormId, setRevisionFormId] = useState<string | null>(null);
  const [reviewFormTaskId, setReviewFormTaskId] = useState<string | null>(null);
  const [deliveryFormTaskId, setDeliveryFormTaskId] = useState<string | null>(null);
  const [contentFilter, setContentFilter] = useState<ContentFilter>("active");
  const [linkedContentId] = useState(() => currentUuidDeepLink("content", "content"));
  const [linkedRevisionId] = useState(() => currentUuidDeepLink("revision", "revision"));
  const [captionChoices, setCaptionChoices] = useState<Record<string, AiChoiceSet<CaptionOption>>>({});
  const [thumbnailChoices, setThumbnailChoices] = useState<Record<string, AiChoiceSet<ThumbnailOption>>>({});
  const [aiWorking, setAiWorking] = useState<string | null>(null);
  const [expandedContentIds, setExpandedContentIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(configured ? null : "لم يتم إعداد اتصال Supabase لهذه النسخة.");
  const [notice, setNotice] = useState<string | null>(null);
  const openedContentHash = useRef<string | null>(null);
  const [defaultPublish] = useState(() => toLocalDateTimeInput(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)));

  const clearData = useCallback(() => {
    setItems([]);
    setTasks([]);
    setAssets([]);
    setRevisions([]);
    setDeliveries([]);
    setTimelineCues([]);
    setBrandArticles([]);
    setBrandReferences([]);
    setEditingBriefId(null);
    setAssetFormId(null);
    setRevisionFormId(null);
    setReviewFormTaskId(null);
    setDeliveryFormTaskId(null);
    setCaptionChoices({});
    setThumbnailChoices({});
    setAiWorking(null);
    setExpandedContentIds(new Set());
  }, []);

  const clearWorkspace = useCallback(() => {
    setWorkspace(null);
    clearData();
  }, [clearData]);

  const clearTransientState = useCallback(() => setNotice(null), []);

  const refreshContent = useCallback(async (organizationId: string) => {
    const supabase = getSupabaseBrowserClient();
    const [contentResult, taskResult, assetResult, revisionResult, deliveryResult, timelineResult, brandResult, brandReferenceResult] = await Promise.all([
      supabase.from("content_items").select("*").eq("organization_id", organizationId).order("publish_at", { ascending: true }),
      supabase.from("tasks").select("*").eq("organization_id", organizationId).not("content_item_id", "is", null).order("due_at", { ascending: true }),
      supabase.from("content_assets").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }),
      supabase.from("content_revision_requests").select("*").eq("organization_id", organizationId).order("round", { ascending: false }),
      supabase.from("content_step_deliveries").select("*").eq("organization_id", organizationId).order("submitted_at", { ascending: false }),
      supabase.from("content_timeline_cues").select("*").eq("organization_id", organizationId).order("sort_order", { ascending: true }),
      supabase.from("brand_articles").select("*").eq("organization_id", organizationId).order("title", { ascending: true }),
      supabase.from("content_brand_references").select("*").eq("organization_id", organizationId),
    ]);

    if (contentResult.error) throw contentResult.error;
    if (taskResult.error) throw taskResult.error;
    if (assetResult.error) throw assetResult.error;
    if (revisionResult.error) throw revisionResult.error;
    if (deliveryResult.error) throw deliveryResult.error;
    if (timelineResult.error) throw timelineResult.error;
    if (brandResult.error) throw brandResult.error;
    if (brandReferenceResult.error) throw brandReferenceResult.error;
    setItems(contentResult.data ?? []);
    setTasks(taskResult.data ?? []);
    setAssets(assetResult.data ?? []);
    setRevisions(revisionResult.data ?? []);
    setDeliveries(deliveryResult.data ?? []);
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
        supabase.from("memberships").select("user_id, role, allowed_sections").eq("organization_id", membership.organization_id).eq("status", "active"),
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
        allowedSections: member.allowed_sections,
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
    const refresh = () => void refreshContent(workspace.organization.id);
    let channel = supabase.channel(`content:${workspace.organization.id}`);
    for (const table of ["content_items", "tasks", "content_assets", "content_revision_requests", "content_step_deliveries", "content_timeline_cues", "brand_articles", "content_brand_references"] as const) {
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

  const defaultOwnerIds = useMemo(() => {
    const fallback = session?.user.id ?? workspace?.people[0]?.id ?? "";
    const recentTasks = [...tasks].sort((left, right) =>
      new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()
    );
    return Object.fromEntries(contentAssignmentFields.map(({ name, step }) => {
      const candidateSteps: ContentStep[] = step === "recording" ? ["recording", "caption"] : [step];
      const recentOwner = recentTasks.find((task) => task.content_step && candidateSteps.includes(task.content_step))?.owner_id;
      return [name, recentOwner ?? fallback];
    }));
  }, [session?.user.id, tasks, workspace?.people]);

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

  const deliveriesByTask = useMemo(() => new Map(deliveries.map((delivery) => [delivery.task_id, delivery])), [deliveries]);

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
  const visibleItems = useMemo(() => {
    if (linkedContentId) return items.filter((item) => item.id === linkedContentId);
    if (contentFilter === "active") return items.filter((item) => !["published", "cancelled"].includes(item.status));
    if (contentFilter === "scheduled") return items.filter((item) => item.status === "scheduled");
    return items.filter((item) => ["published", "cancelled"].includes(item.status));
  }, [contentFilter, items, linkedContentId]);

  useEffect(() => {
    if (!linkedContentId || openedContentHash.current === `${linkedContentId}:${linkedRevisionId ?? ""}` || !items.some((item) => item.id === linkedContentId)) return;
    setExpandedContentIds((current) => new Set(current).add(linkedContentId));
    const frame = window.requestAnimationFrame(() => {
      const targetId = linkedRevisionId && revisions.some((revision) => revision.id === linkedRevisionId)
        ? `revision-${linkedRevisionId}`
        : `content-${linkedContentId}`;
      const target = document.getElementById(targetId);
      if (!target) return;
      openedContentHash.current = `${linkedContentId}:${linkedRevisionId ?? ""}`;
      target.scrollIntoView({ block: "center" });
      target.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [items, linkedContentId, linkedRevisionId, revisions]);

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

  async function generateContentAiChoices(item: ContentItem, scope: "caption" | "thumbnail") {
    const workingKey = `${item.id}:${scope}`;
    setAiWorking(workingKey);
    setError(null);
    setNotice(null);
    const { data, error: functionError } = await getSupabaseBrowserClient().functions.invoke("script-ai", {
      body: {
        content_id: item.id,
        expected_edit_version: item.version,
        mode: "improve",
        scope,
      },
    });
    setAiWorking(null);
    if (functionError) {
      setError(await getSupabaseFunctionErrorMessage(functionError, `تعذّر توليد اقتراحات ${scope === "caption" ? "الكابشن" : "الغلاف"}.`));
      return;
    }
    const generated = (data as { generated?: { caption_options?: CaptionOption[]; thumbnail_options?: ThumbnailOption[] } } | null)?.generated;
    const quality = (data as { quality?: { removed_options?: number } } | null)?.quality;
    const removed = Number(quality?.removed_options ?? 0);
    const guardNote = removed ? ` الحارس أخفى ${removed} اقتراح غير مطابق من غير استهلاك طلب إضافي.` : "";
    if (scope === "caption") {
      const options = Array.isArray(generated?.caption_options) ? generated.caption_options : [];
      setCaptionChoices((current) => ({ ...current, [item.id]: { version: item.version, options } }));
      setNotice(`ظهر ${options.length} اقتراحات كابشن. لم يُحفظ شيء؛ صاحب المهمة يختار واحدًا بعلامة صح.${guardNote}`);
    } else {
      const options = Array.isArray(generated?.thumbnail_options) ? generated.thumbnail_options : [];
      setThumbnailChoices((current) => ({ ...current, [item.id]: { version: item.version, options } }));
      setNotice(`ظهر ${options.length} اقتراحات غلاف مبنية على الاسكريبت النهائي. لم يُحفظ شيء؛ المصمم يختار واحدًا بعلامة صح.${guardNote}`);
    }
  }

  async function applyContentAiChoice(item: ContentItem, scope: "caption" | "thumbnail", version: number, selectedText: string) {
    const applied = await runCommand({
      action: "apply_ai_choice",
      content_item_id: item.id,
      scope,
      expected_content_version: version,
      selected_text: selectedText,
    }, scope === "caption"
      ? "تم اعتماد الكابشن المختار داخل ملف الريلز. راجعه قبل تأكيد النشر."
      : "تم اعتماد تعليمات الغلاف داخل ملف الريلز، وسيجدها المصمم عند فتح المهمة.");
    if (!applied) return;
    if (scope === "caption") setCaptionChoices((current) => { const next = { ...current }; delete next[item.id]; return next; });
    else setThumbnailChoices((current) => { const next = { ...current }; delete next[item.id]; return next; });
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
    setNotice(payload.raw_material_sent
      ? "تم إنشاء الطلب كما كتبته وإسناد المونتاج والغلاف والنشر. لن تُنشأ مهمة إضافية للمادة الخام."
      : "تم إنشاء الطلب كما كتبته وإسناد المادة الخام والمونتاج والغلاف والنشر.");
    await refreshContent(workspace.organization.id);
    return true;
  }

  async function updateContentRequest(event: FormEvent<HTMLFormElement>, item: ContentItem) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const updated = await runCommand({
      action: "update_request_text",
      content_item_id: item.id,
      expected_content_version: item.version,
      content_request_text: formText(form, "request_text"),
      telegram_source_url: formText(form, "telegram_source_url"),
    }, "تم تحديث نص «كل المطلوب» مع الحفاظ على نفس الروابط ومكانها.");
    if (updated) setEditingBriefId(null);
  }

  async function submitStepDelivery(event: FormEvent<HTMLFormElement>, task: Task) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const submitted = await runCommand({
      action: "submit_step_delivery",
      task_id: task.id,
      step: task.content_step,
      result_note: formText(form, "result_note"),
      result_url: formText(form, "result_url"),
    }, task.content_step === "caption" && !task.is_work_item
      ? "تم حفظ الكابشن داخل الريلز وإغلاق خطوة الكتابة وفتح ما يليها تلقائيًا."
      : task.content_step === "publishing"
        ? "تم تأكيد النشر وحفظ الرابط الحقيقي ونقل المحتوى إلى «منشور»."
        : "تم حفظ التسليم وإغلاق المهمة وفتح الخطوة التالية تلقائيًا.");
    if (submitted) setDeliveryFormTaskId(null);
  }

  async function requestTaskRevision(event: FormEvent<HTMLFormElement>, task: Task) {
    event.preventDefault();
    if (!task.content_item_id || !task.content_step) return;
    const form = new FormData(event.currentTarget);
    const requested = await runCommand({
      action: "request_revision",
      content_item_id: task.content_item_id,
      target_stage: task.content_step,
      revision_instructions: formText(form, "revision_instructions"),
    }, `تم طلب تعديل «${contentStepConfig[task.content_step].label}» وإعادته تلقائيًا لصاحب المهمة.`);
    if (requested) setReviewFormTaskId(null);
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

  if (loading) return <section className="workspace-state" aria-live="polite"><LoaderCircle className="spin" size={24} /><div><h2>جارٍ تحميل طلبات التنفيذ</h2><p>نجمع الطلبات والمهام والتسليمات من المصدر الحقيقي.</p></div></section>;

  if (!session) return (
    <section className="workspace-state workspace-onboarding">
      <LockKeyhole size={27} /><div><p className="overline">دخول موحد</p><h2>سجّل الدخول أولًا من قسم المهام</h2><p>نفس الجلسة والصلاحيات تعمل في كل أقسام النظام.</p></div>
      <Button href="/tasks"><Link2 size={16} /> الانتقال لتسجيل الدخول</Button>
    </section>
  );

  if (!workspace) return (
    <section className="workspace-state workspace-onboarding">
      <Route size={27} /><div><p className="overline">مساحة العمل مطلوبة</p><h2>أنشئ مساحة الشركة مرة واحدة</h2><p>ابدأ من قسم المهام، ثم ارجع هنا لإضافة طلب التنفيذ.</p></div>
      <Button href="/tasks"><Link2 size={16} /> فتح قسم المهام</Button>
    </section>
  );

  const manager = canManageTasks(workspace.membership.role);
  const platformAdmin = canManageAllTaskExecution(workspace.membership.role);
  const readOnly = workspace.membership.role === "viewer";
  const canCreateContentWorkflow = manager && (workspace.membership.role === "owner"
    || workspace.membership.allowed_sections.includes("tasks"));
  const peopleById = new Map(workspace.people.map((person) => [person.id, person]));
  const assignablePeople = workspace.people.filter((person) => person.role !== "viewer"
    && (person.role === "owner" || person.allowedSections.includes("tasks")));

  return (
    <section className="content-workspace">
      <div className="workspace-toolbar">
        <div><p className="overline">{workspace.organization.name}</p><h2>تنفيذ المحتوى</h2><p>{items.length ? `${items.length} طلب محتوى` : "لا توجد طلبات بعد — اكتب أول طلب كما ترسله للفريق."}</p></div>
        <div className="toolbar-actions">
          <div className="segmented-control" aria-label="تصفية المحتوى">{(["active", "scheduled", "archive"] as ContentFilter[]).map((value) => <button type="button" key={value} className={contentFilter === value ? "active" : ""} onClick={() => setContentFilter(value)}>{value === "active" ? "الحالي" : value === "scheduled" ? "المجدول" : "الأرشيف"}</button>)}</div>
          <button className="icon-button" type="button" aria-label="تحديث المحتوى" onClick={() => void refreshContent(workspace.organization.id)}><RefreshCw size={17} /></button>
          <Button href="/tasks" variant="secondary"><Route size={16} /> عرض كل المهام</Button>
          {canCreateContentWorkflow ? <Button type="button" onClick={() => setShowQuickIntake((value) => !value)}><MessageSquareText size={16} /> طلب ريلز كامل</Button> : null}
        </div>
      </div>

      {notice ? <p className="form-notice success" role="status">{notice}</p> : null}
      {error ? <p className="form-notice error" role="alert">{error}</p> : null}
      {linkedContentId && visibleItems.length ? <p className="direct-link-notice" role="status"><Route size={15} /> تم فتح {linkedRevisionId ? "طلب التعديل" : "ملف المحتوى"} المطلوب مباشرة وإظهار تفاصيله.</p> : linkedContentId ? <p className="form-notice error" role="alert">ملف المحتوى المطلوب غير موجود أو ليس ضمن صلاحيات حسابك.</p> : null}

      {showQuickIntake && canCreateContentWorkflow ? <QuickIntakeForm
        currentUserId={session.user.id}
        defaultOwnerIds={defaultOwnerIds}
        defaultPublish={defaultPublish}
        people={assignablePeople}
        approvedBrandArticles={approvedBrandArticles.map((article) => ({ id: article.id, title: article.title, version: article.version, categoryLabel: brandCategoryConfig[article.category].label }))}
        working={working}
        onCancel={() => setShowQuickIntake(false)}
        onCreate={createQuickWorkflow}
      /> : null}

      {visibleItems.length ? <div className="content-list workflow-entity-list">{visibleItems.map((item) => {
        const itemTasks = [...(tasksByContent.get(item.id) ?? [])].sort((a, b) => (a.content_step ? contentStepConfig[a.content_step].order : 99) - (b.content_step ? contentStepConfig[b.content_step].order : 99));
        const itemAssets = assetsByContent.get(item.id) ?? [];
        const itemRevisions = revisionsByContent.get(item.id) ?? [];
        const itemTimeline = [...(timelineByContent.get(item.id) ?? [])].sort((a, b) => a.sort_order - b.sort_order);
        const itemBrandArticles = (brandReferencesByContent.get(item.id) ?? []).map((reference) => brandArticlesById.get(reference.brand_article_id)).filter((article): article is BrandArticle => Boolean(article));
        const workTasks = itemTasks.filter((task) => task.is_work_item);
        const doneCount = workTasks.filter((task) => task.status === "done").length;
        const activeTasks = workTasks.filter((task) => ["ready", "in_progress", "review", "blocked"].includes(task.status));
        const progress = workTasks.length ? Math.round((doneCount / workTasks.length) * 100) : 0;
        const openRevisions = itemRevisions.filter((revision) => ["requested", "in_progress"].includes(revision.status));
        const editingTask = itemTasks.find((task) => task.content_step === "editing");
        const thumbnailTask = itemTasks.find((task) => task.content_step === "thumbnail");
        const publishingTask = itemTasks.find((task) => task.content_step === "publishing");
        const workflowOwner = itemTasks.some((task) => task.owner_id === session.user.id);
        const contentCoordinator = item.created_by === session.user.id;
        const canEditBrief = !readOnly && (platformAdmin || contentCoordinator);
        const canAddAsset = !readOnly && (platformAdmin || contentCoordinator || workflowOwner);
        const canRequestRevision = !readOnly && (platformAdmin || contentCoordinator || workflowOwner);
        const canChangeTimeline = !readOnly && (platformAdmin || editingTask?.owner_id === session.user.id);
        const completedCueCount = itemTimeline.filter((cue) => cue.completed_at).length;
        const openCueCount = itemTimeline.length - completedCueCount;
        const isSocialPost = item.format === "post";
        const workflowSteps = contentWorkflowSteps(item.format);
        const revisionOptions = contentRevisionSteps(item.format).filter((step) =>
          itemTasks.some((task) => task.content_step === step && task.status !== "cancelled")
        );
        const canonicalRequest = contentRequestText(item);
        const deliveryTasks = itemTasks.filter((task) => task.content_step
          && resultSteps.includes(task.content_step)
          && (isSocialPost || task.content_step !== "caption"));
        const platformLabel = item.platforms.map((platform) => platform.charAt(0).toUpperCase() + platform.slice(1)).join(" + ");
        const expanded = expandedContentIds.has(item.id);
        const canUseCaptionAi = Boolean(!isSocialPost && publishingTask
          && !["done", "cancelled"].includes(publishingTask.status)
          && !readOnly
          && (platformAdmin || publishingTask.owner_id === session.user.id));
        const canUseThumbnailAi = Boolean(!isSocialPost && thumbnailTask
          && !["done", "cancelled"].includes(thumbnailTask.status)
          && !readOnly
          && (platformAdmin || thumbnailTask.owner_id === session.user.id));
        const itemCaptionChoices = captionChoices[item.id];
        const itemThumbnailChoices = thumbnailChoices[item.id];

        return <article className="panel content-card workflow-entity-card" data-card-state={item.status} data-direct-target={linkedContentId === item.id && !linkedRevisionId || undefined} tabIndex={linkedContentId === item.id && !linkedRevisionId ? -1 : undefined} id={`content-${item.id}`} key={item.id}>
          <header>
            <div className="content-card-title"><span className="icon-tile"><Film size={17} /></span><div><p className="overline">{isSocialPost ? "Social Post" : "Reel"} · {platformLabel} · v{item.version}</p><h3 className="workflow-card-heading">{item.title}</h3></div></div>
            <div className="content-card-actions"><div className="content-card-badges"><StatusBadge tone={contentStatusConfig[item.status].tone}>{contentStatusConfig[item.status].label}</StatusBadge>{openRevisions.length ? <StatusBadge tone="warning">{openRevisions.length} تعديل مفتوح</StatusBadge> : null}{openCueCount ? <StatusBadge tone="info">{openCueCount} تعليمة تنفيذ</StatusBadge> : null}</div><button className="content-expand-button" type="button" aria-expanded={expanded} onClick={() => setExpandedContentIds((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })}>{expanded ? "إخفاء التفاصيل" : "فتح التفاصيل"}<ChevronDown className={expanded ? "expanded" : ""} size={14} /></button></div>
          </header>

          {!expanded ? <p className="content-request-preview"><LinkifiedText text={canonicalRequest} /></p> : null}

          {expanded ? <>
          <section className="content-canonical-request">
            <div className="production-header"><div><MessageSquareText size={17} /><div><p className="overline">المرجع الأساسي</p><h4>كل المطلوب والروابط</h4></div></div>{canEditBrief ? <button className="text-button" type="button" onClick={() => setEditingBriefId(editingBriefId === item.id ? null : item.id)}><Pencil size={13} /> تعديل الطلب</button> : null}</div>
            {editingBriefId === item.id && canEditBrief ? <form className="inline-production-form" onSubmit={(event) => void updateContentRequest(event, item)}>
              <label><span>كل المطلوب والروابط</span><textarea name="request_text" minLength={10} maxLength={30000} rows={18} required defaultValue={canonicalRequest} /></label>
              <label><span>رابط رسالة Telegram الأصلية — اختياري</span><input name="telegram_source_url" type="url" dir="ltr" defaultValue={item.intake_source_url ?? ""} placeholder="https://t.me/c/..." /></label>
              <div className="form-actions"><Button type="submit" disabled={working}>{working ? <LoaderCircle className="spin" size={15} /> : <CheckCircle2 size={15} />} حفظ النص كما هو</Button><button className="text-button" type="button" onClick={() => setEditingBriefId(null)}>إلغاء</button></div>
            </form> : <div className="content-canonical-request-body"><LinkifiedText text={canonicalRequest} /></div>}
            {item.intake_source_url && editingBriefId !== item.id ? <a className="content-request-source-link" href={item.intake_source_url} target="_blank" rel="noreferrer">فتح رسالة Telegram الأصلية <ExternalLink size={12} /></a> : null}
          </section>

          <section className="content-brand-references"><div><BookOpenCheck size={16} /><div><p className="overline">اختياري</p><h4>مراجع البراند</h4></div></div>{itemBrandArticles.length ? <div>{itemBrandArticles.map((article) => <a href={`/brand#article-${article.id}`} key={article.id}><strong>{article.title}</strong><small>{brandCategoryConfig[article.category].label} · v{article.version}{article.status === "archived" ? " · نسخة محفوظة" : ""}</small></a>)}</div> : <p>لا توجد مراجع إضافية مرتبطة بهذا الطلب.</p>}</section>

          {canUseThumbnailAi ? <section className="content-ai-choice-panel">
            <div className="content-ai-choice-heading"><div><Sparkles size={16} /><div><strong>مساعد الغلاف للمصمم</strong><small>يقرأ الاسكريبت والفكرة ثم يعرض بدائل فقط؛ لا يعتمد شيئًا تلقائيًا.</small></div></div><Button type="button" variant="secondary" disabled={Boolean(aiWorking) || working} onClick={() => void generateContentAiChoices(item, "thumbnail")}>{aiWorking === `${item.id}:thumbnail` ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />} 3 اقتراحات غلاف</Button></div>
            {itemThumbnailChoices?.options.length ? <div className="script-variants-grid" aria-label="اقتراحات الغلاف داخل طلب التنفيذ">{itemThumbnailChoices.options.map((option, index) => <article key={`${option.label}-${index}`}><header><span>غلاف {index + 1}</span><strong>{option.label}</strong></header><p><strong>النص:</strong> {option.cover_text}</p><p><strong>الاتجاه البصري:</strong> {option.visual_direction}</p><p><strong>صلته بالنص:</strong> {option.script_connection}</p><Button type="button" disabled={working} onClick={() => void applyContentAiChoice(item, "thumbnail", itemThumbnailChoices.version, thumbnailOptionText(option))}><CheckCircle2 size={14} /> اختيار واعتماد للمهمة</Button></article>)}</div> : <small className="content-ai-cost-note">الضغط يستهلك طلب API واحد. الاختيار فقط هو الذي يُحفظ ويُرسل لمهمة الغلاف.</small>}
          </section> : null}

          {!isSocialPost ? <section className="reel-caption-panel">
            <div className="reel-caption-heading">
              <div><MessageSquareText size={17} /><div><p className="overline">داخل ملف الريلز</p><h4>الكابشن النهائي</h4></div></div>
              <div><small>المسؤول عند النشر</small><strong>{publishingTask ? peopleById.get(publishingTask.owner_id)?.name ?? "مسؤول النشر" : "—"}</strong></div>
            </div>
            {item.caption_brief ? <div className="saved-reel-caption"><span>محفوظ مع ملف الريلز وسيظهر تلقائيًا لمسؤول النشر</span><p>{item.caption_brief}</p></div>
              : <p className="reel-caption-empty">الكابشن ليس مهمة إضافية. يمكن لصانع المحتوى كتابته عند تسليم الخام، وإن لم يكن جاهزًا يكمله مسؤول النشر داخل نفس نموذج النشر.</p>}
            {canUseCaptionAi ? <div className="content-caption-ai-actions"><Button type="button" variant="secondary" disabled={Boolean(aiWorking) || working} onClick={() => void generateContentAiChoices(item, "caption")}>{aiWorking === `${item.id}:caption` ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />} 3 اقتراحات كابشن بالـAI</Button><small>طلب API واحد، ولا يُحفظ اقتراح قبل اختيارك.</small></div> : null}
            {canUseCaptionAi && itemCaptionChoices?.options.length ? <div className="script-variants-grid" aria-label="اقتراحات الكابشن داخل طلب التنفيذ">{itemCaptionChoices.options.map((option, index) => <article key={`${option.label}-${index}`}><header><span>كابشن {index + 1}</span><strong>{option.label}</strong></header><p>{option.caption}</p><small>{option.hashtags.join(" ")}</small><Button type="button" disabled={working} onClick={() => void applyContentAiChoice(item, "caption", itemCaptionChoices.version, captionOptionText(option))}><CheckCircle2 size={14} /> اختيار ووضعه في الملف</Button></article>)}</div> : null}
          </section> : null}

          <div className="production-tools-grid">
            {itemTimeline.length ? <section className="production-tool-panel content-timeline-panel">
              <div className="production-tool-heading"><div><TimerReset size={16} /><div><p className="overline">Execution Timeline</p><h4>تعليمات المونتاج بالثانية</h4></div></div><span className="timeline-progress">{completedCueCount}/{itemTimeline.length} تم</span></div>
              <ol className="content-timeline-list">{itemTimeline.map((cue) => <li className={cue.completed_at ? "completed" : ""} key={cue.id}>
                <div className="timeline-cue-time"><TimerReset size={13} /><strong>{formatTimelineSeconds(cue.start_seconds)}{cue.end_seconds === null ? "" : ` — ${formatTimelineSeconds(cue.end_seconds)}`}</strong></div>
                <div className="timeline-cue-body"><span>{contentCueKindConfig[cue.kind].label}</span><p>{cue.action}</p>{cue.source_url ? <a href={cue.source_url} target="_blank" rel="noreferrer">فتح المصدر <ExternalLink size={11} /></a> : null}</div>
                {canChangeTimeline ? <button className="timeline-toggle" type="button" disabled={working} onClick={() => void runCommand({ action: "change_timeline_cue", cue_id: cue.id, completed: !cue.completed_at }, cue.completed_at ? "أُعيد فتح تعليمة الـTimeline." : "تم تعليم سطر الـTimeline كمنفذ.")}>{cue.completed_at ? "إعادة فتح" : "تم التنفيذ"}</button> : null}
              </li>)}</ol>
              {openCueCount ? <p className="timeline-guard-note">ما زال هناك {openCueCount} تعليمات يجب تنفيذها داخل تسليم المونتاج.</p> : <p className="timeline-guard-note complete"><CheckCircle2 size={13} /> كل تعليمات المونتاج منفذة.</p>}
            </section> : null}
            <section className="production-tool-panel">
              <div className="production-tool-heading"><div><Paperclip size={16} /><div><p className="overline">ملفات ومراجع</p><h4>مركز الأصول</h4></div></div>{canAddAsset ? <button className="text-button" type="button" onClick={() => setAssetFormId(assetFormId === item.id ? null : item.id)}><Plus size={13} /> إضافة رابط</button> : null}</div>
              {itemAssets.length ? <ul className="asset-list">{itemAssets.map((asset) => <li key={asset.id}>
                <div><span className="asset-kind">{contentAssetKindConfig[asset.kind].label}</span><a href={asset.url} target="_blank" rel="noreferrer">{asset.title} <ExternalLink size={12} /></a><small>{asset.stage ? contentStepConfig[asset.stage].label : "كل المراحل"} · أضافه {peopleById.get(asset.created_by)?.name ?? "عضو فريق"}</small>{asset.notes ? <p>{asset.notes}</p> : null}</div>
                {!readOnly && (platformAdmin || asset.created_by === session.user.id) ? <button className="asset-remove" type="button" disabled={working} aria-label={`إزالة رابط ${asset.title}`} onClick={() => void runCommand({ action: "remove_asset", asset_id: asset.id }, "تمت إزالة الرابط من ملف المحتوى فقط؛ الملف الأصلي لم يُحذف.")}><Trash2 size={13} /> إزالة الرابط</button> : null}
              </li>)}</ul> : <p className="tool-empty">لا توجد روابط بعد. أضف المادة الخام والمصادر ونسخ المراجعة هنا بدل الرسائل المتفرقة.</p>}
              {assetFormId === item.id && canAddAsset ? <form className="compact-command-form" onSubmit={(event) => void addAsset(event, item.id)}>
                <div className="compact-form-grid"><label><span>النوع</span><select name="asset_kind" defaultValue={isSocialPost ? "image" : "raw_video"}>{assetKinds.map((kind) => <option value={kind} key={kind}>{contentAssetKindConfig[kind].label}</option>)}</select></label><label><span>مرحلة الاستخدام</span><select name="asset_stage" defaultValue={isSocialPost ? "design" : "editing"}>{workflowSteps.map((step) => <option value={step} key={step}>{contentStepConfig[step].label}</option>)}</select></label></div>
                <label><span>اسم واضح للرابط</span><input name="asset_title" minLength={2} maxLength={160} required placeholder="مثال: المادة الخام — Take 2" /></label>
                <label><span>الرابط</span><input name="asset_url" type="url" dir="ltr" required placeholder="https://drive.google.com/..." /></label>
                <label><span>ملاحظة الاستخدام — اختياري</span><textarea name="asset_notes" maxLength={2000} rows={2} placeholder="من الدقيقة 00:18 أو استخدم الصور 2 و4 فقط" /></label>
                <div className="form-actions"><Button type="submit" disabled={working}>حفظ الرابط</Button><button className="text-button" type="button" onClick={() => setAssetFormId(null)}>إلغاء</button></div>
              </form> : null}
            </section>

            <section className="production-tool-panel">
              <div className="production-tool-heading"><div><MessageSquareText size={16} /><div><p className="overline">Feedback Loop</p><h4>جولات التعديل</h4></div></div>{canRequestRevision ? <button className="text-button" type="button" onClick={() => setRevisionFormId(revisionFormId === item.id ? null : item.id)}><Plus size={13} /> طلب تعديل</button> : null}</div>
              {itemRevisions.length ? <ol className="revision-list">{itemRevisions.map((revision) => {
                const canWorkRevision = !readOnly && (platformAdmin || revision.assigned_to === session.user.id);
                const canCancelRevision = !readOnly && (platformAdmin || revision.requested_by === session.user.id);
                return <li key={revision.id} id={`revision-${revision.id}`} data-direct-target={linkedRevisionId === revision.id || undefined} tabIndex={linkedRevisionId === revision.id ? -1 : undefined}>
                  <div className="revision-top"><strong>جولة {revision.round} · {contentStepConfig[revision.stage].label}</strong><StatusBadge tone={contentRevisionStatusConfig[revision.status].tone}>{contentRevisionStatusConfig[revision.status].label}</StatusBadge></div>
                  {linkedRevisionId === revision.id ? <span className="direct-target-label"><Route size={11} /> ده التعديل المطلوب</span> : null}
                  <p>{revision.instructions}</p><small>إلى {peopleById.get(revision.assigned_to)?.name ?? "صاحب المرحلة"} · {formatDate(revision.requested_at)}</small>
                  {revision.status === "requested" && canWorkRevision ? <Button type="button" variant="secondary" disabled={working} onClick={() => void runCommand({ action: "start_revision", revision_id: revision.id }, "بدأ تنفيذ التعديل وأعيد فتح مهمة المرحلة.")}>بدء التنفيذ</Button> : null}
                  {revision.status === "in_progress" && canWorkRevision ? <Button type="button" variant="secondary" disabled={working} onClick={() => void runCommand({ action: "resolve_revision", revision_id: revision.id }, "تم إرسال التعديل للمراجعة.")}>تم التنفيذ وإرسال للمراجعة</Button> : null}
                  {["requested", "in_progress"].includes(revision.status) && canCancelRevision ? <button className="text-button danger-text" type="button" disabled={working} onClick={() => void runCommand({ action: "cancel_revision", revision_id: revision.id }, "تم إلغاء طلب التعديل مع الاحتفاظ بسجله.")}>إلغاء الطلب</button> : null}
                </li>;
              })}</ol> : <p className="tool-empty">لا توجد تعديلات مسجلة. عند طلب تعديل سيُسند تلقائيًا لصاحب المرحلة برقم جولة واضح.</p>}
              {revisionFormId === item.id && canRequestRevision ? <form className="compact-command-form" onSubmit={(event) => void requestRevision(event, item.id)}>
                <label><span>المرحلة المطلوب تعديلها</span><select name="target_stage" defaultValue={isSocialPost ? "caption" : "editing"}>{revisionOptions.map((step) => <option value={step} key={step}>{contentStepConfig[step].label}</option>)}</select></label>
                <label><span>ما المطلوب تغييره بالضبط؟</span><textarea name="revision_instructions" minLength={5} maxLength={5000} rows={4} required placeholder="اكتب التوقيت أو المشهد، المشكلة، والنتيجة المطلوبة. مثال: 00:18 اخفض الموسيقى واترك نصف ثانية صمت قبل الجملة التالية." /></label>
                <div className="form-actions"><Button type="submit" disabled={working}>إسناد التعديل</Button><button className="text-button" type="button" onClick={() => setRevisionFormId(null)}>إلغاء</button></div>
              </form> : null}
            </section>
          </div>

          {deliveryTasks.length ? <section className="content-delivery-section">
            <div className="production-tool-heading"><div><CheckCircle2 size={16} /><div><p className="overline">تسليم واحد</p><h4>النتيجة تغلق المهمة وتفتح التالية تلقائيًا</h4></div></div></div>
            <div className="content-delivery-grid">{deliveryTasks.map((task) => {
              const delivery = deliveriesByTask.get(task.id);
              const canSubmitResult = !readOnly && (platformAdmin || task.owner_id === session.user.id);
              const isPublishing = task.content_step === "publishing";
              const canEditResult = canSubmitResult && (["ready", "in_progress", "review", "done"].includes(task.status));
              const needsUrl = Boolean(task.content_step && ["editing", "thumbnail", "design", "publishing"].includes(task.content_step));
              const canReviseTask = Boolean(task.content_step && revisionOptions.includes(task.content_step));
              const resultUrlLabel = isPublishing ? "رابط المنشور" : "رابط التسليم";
              return <article key={task.id} className={`${delivery ? "has-delivery" : ""} ${task.status === "done" ? "approved-delivery" : ""} ${isPublishing ? "publishing-delivery" : ""}`}>
                <header><div><strong>{task.content_step ? contentStepConfig[task.content_step].label : task.title}</strong><small>{peopleById.get(task.owner_id)?.name ?? "عضو فريق"}</small></div><StatusBadge tone={taskStatusConfig[task.status].tone}>{taskStatusLabel(task.status, task.content_step)}</StatusBadge></header>
                {delivery ? <div className="saved-step-result"><span>{isPublishing && task.status === "done" ? "تم النشر" : `إصدار ${delivery.version}`} · {formatDate(delivery.submitted_at)}</span>{delivery.result_note ? <p>{delivery.result_note}</p> : null}{delivery.result_url ? <a href={delivery.result_url} target="_blank" rel="noreferrer">{isPublishing ? "فتح المنشور" : "فتح التسليم"} <ExternalLink size={11} /></a> : null}</div> : <p>{isPublishing ? "لم يتم تأكيد النشر بعد. أضف رابط المنشور الحقيقي عند النشر." : task.status === "backlog" ? "تنتظر هذه المهمة اكتمال الخطوة السابقة." : "لم يسلّم صاحب المهمة النتيجة بعد."}</p>}
                {canEditResult ? <button className="text-button delivery-primary-action" type="button" onClick={() => setDeliveryFormTaskId(deliveryFormTaskId === task.id ? null : task.id)}><Upload size={12} /> {isPublishing ? delivery ? "تحديث بيانات النشر" : "تأكيد تم النشر" : delivery ? "تحديث التسليم" : "تسليم وإغلاق المهمة"}</button> : null}
                {!readOnly && (platformAdmin || contentCoordinator) && delivery && canReviseTask && task.status === "done" ? <div className="delivery-review-actions"><button className="text-button" type="button" onClick={() => setReviewFormTaskId(reviewFormTaskId === task.id ? null : task.id)}>طلب تعديل وإعادة فتح المهمة</button></div> : null}
                {reviewFormTaskId === task.id && !readOnly && (platformAdmin || contentCoordinator) && canReviseTask ? <form className="compact-command-form" onSubmit={(event) => void requestTaskRevision(event, task)}><label><span>التعديل المطلوب</span><textarea name="revision_instructions" minLength={5} maxLength={5000} rows={3} required placeholder="اكتب المشكلة والنتيجة المطلوبة بوضوح." /></label><div className="form-actions"><Button type="submit" disabled={working}>إرسال التعديل لصاحب المهمة</Button><button className="text-button" type="button" onClick={() => setReviewFormTaskId(null)}>إلغاء</button></div></form> : null}
                {deliveryFormTaskId === task.id && canEditResult ? <form className="compact-command-form" onSubmit={(event) => void submitStepDelivery(event, task)}>
                  <label><span>{task.content_step === "caption" ? "الكابشن النهائي" : isPublishing ? "الكابشن النهائي والهاشتاجات — مطلوب" : "ملاحظة التسليم"}</span><textarea name="result_note" minLength={3} maxLength={10000} rows={isPublishing ? 6 : 4} required={isPublishing || task.content_step === "caption"} defaultValue={delivery?.result_note ?? (isPublishing ? item.caption_brief : "")} placeholder={task.content_step === "scheduling" ? "المنصات وموعد الجدولة والتأكيد" : isPublishing ? "اكتب النص الذي سيُنشر كما هو مع الهاشتاجات." : "اكتب ما تم تسليمه وما يحتاجه المراجع"} /></label>
                  <label><span>{resultUrlLabel}{needsUrl ? " — مطلوب" : " — اختياري"}</span><input name="result_url" type="url" dir="ltr" required={needsUrl} defaultValue={delivery?.result_url ?? ""} placeholder={isPublishing ? "https://instagram.com/p/..." : task.content_step === "recording" ? "رابط رسالة Telegram — اختياري" : "https://drive.google.com/..."} /></label>
                  <div className="form-actions"><Button type="submit" disabled={working}>{isPublishing ? "تأكيد أنه تم النشر" : "حفظ التسليم وإغلاق المهمة"}</Button><button className="text-button" type="button" onClick={() => setDeliveryFormTaskId(null)}>إلغاء</button>{!isPublishing ? <small>بعد الحفظ يفتح النظام الخطوة التالية تلقائيًا ويبلغ الإدارة بالإنجاز.</small> : null}</div>
                </form> : null}
              </article>;
            })}</div>
          </section> : null}

          <div className="content-progress-row"><div><strong>{progress}%</strong><span>اكتمل {doneCount} من {workTasks.length} مهام تنفيذ</span></div><div className="content-progress-track" aria-label={`نسبة الإنجاز ${progress}%`}><span style={{ width: `${progress}%` }} /></div><div><CalendarClock size={14} /><span>{item.status === "published" && item.published_at ? `تم النشر ${formatDate(item.published_at)}` : `موعد النشر ${formatDate(item.publish_at)}`}</span></div></div>
          <ol className="content-steps" aria-label="خطوات إنتاج المحتوى">{workflowSteps.map((step, index) => {
            const task = itemTasks.find((candidate) => candidate.content_step === step);
            const isActive = activeTasks.some((activeTask) => activeTask.id === task?.id);
            const supplied = step === "recording" && (!task || (task.status === "cancelled" && !task.is_work_item));
            return <li className={`${task?.status === "done" || supplied ? "done" : ""} ${isActive ? "active" : ""}`} key={step}><span>{task?.status === "done" || supplied ? <CheckCircle2 size={14} /> : index + 1}</span><strong>{step === "publishing" && task?.status === "done" ? "تم النشر" : contentStepConfig[step].label}</strong><small>{supplied ? "المادة جاهزة" : task ? peopleById.get(task.owner_id)?.name ?? "عضو فريق" : "—"}</small></li>;
          })}</ol>
          <footer><div>{activeTasks.length ? <><CircleUserRound size={15} /><span>النشط الآن: <strong>{activeTasks.map((task) => task.content_step ? contentStepConfig[task.content_step].label : task.title).join(" + ")}</strong></span></> : <><CheckCircle2 size={15} /><span>{item.status === "published" ? "تم النشر وإغلاق طلب التنفيذ." : "لا توجد خطوة نشطة الآن."}</span></>}</div><a className="text-link" href="/tasks">فتح مهام الأشخاص <Link2 size={13} /></a></footer>
          </> : <div className="content-collapsed-summary"><div><strong>{progress}%</strong><span>اكتمل {doneCount} من {workTasks.length} مهام تنفيذ</span></div><div className="content-progress-track" aria-label={`نسبة الإنجاز ${progress}%`}><span style={{ width: `${progress}%` }} /></div><div><span>الخطوة الحالية</span><strong>{activeTasks.length ? activeTasks.map((task) => task.content_step ? contentStepConfig[task.content_step].label : task.title).join(" + ") : item.status === "published" ? "منشور" : "لا توجد خطوة نشطة"}</strong></div><div><CalendarClock size={14} /><span>{formatDate(item.publish_at)}</span></div></div>}
        </article>;
      })}</div> : <section className="panel empty-state"><span className="empty-visual"><Film size={20} /></span><div><h2>{items.length ? "لا يوجد محتوى في هذا الفلتر" : "لا توجد طلبات تنفيذ حتى الآن"}</h2><p>{items.length ? "غيّر الفلتر لعرض المحتوى الجاري أو المنشور أو كل الأرشيف." : "أنشئ أول طلب، والصق فيه كل المطلوب والروابط كما ترسلها للفريق."}</p></div><span className="empty-proof"><CheckCircle2 size={15} /> مرتبط بمهام الأشخاص</span></section>}

      <aside className="automation-note"><LockKeyhole size={17} /><div><strong>النشر الخارجي لم يُفعّل بعد</strong><p>الجدولة والنشر موثّقان داخل المسار، لكن التنفيذ على Meta ما زال يدويًا. لن يعتبر السيستم المحتوى منشورًا قبل حفظ رابط المنشور الحقيقي.</p></div></aside>
    </section>
  );
}
