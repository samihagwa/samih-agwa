"use client";

import type { Session } from "@supabase/supabase-js";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleUserRound,
  Clock3,
  ContactRound,
  ExternalLink,
  FileText,
  History,
  Link2,
  LoaderCircle,
  MessageSquareText,
  PackageCheck,
  Paperclip,
  Route,
  Send,
  ShieldCheck,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { contentAssetKindConfig, contentStepConfig, type ContentStep } from "../../lib/content";
import { taskReference } from "../../lib/deep-links";
import { launchGateConfig } from "../../lib/launches";
import {
  allowedTaskTransitionsForActor,
  canManageAllTaskExecution,
  taskPriorityConfig,
  taskStatusConfig,
  taskStatusLabel,
  type TaskStatus,
} from "../../lib/tasks";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Tables } from "../../lib/supabase/database.types";
import { getSupabaseFunctionErrorMessage } from "../../lib/supabase/function-errors";
import { useWorkspaceAuth } from "../../lib/supabase/use-workspace-auth";
import { Button } from "../ui/Button";
import { StatusBadge } from "../ui/StatusBadge";

type Task = Tables<"tasks">;
type TaskEvent = Tables<"task_events">;
type TaskDiscussionMessage = Tables<"task_discussion_messages">;
type TaskRevisionRequest = Tables<"task_revision_requests">;
type ContentRevisionRequest = Tables<"content_revision_requests">;
type TaskDelivery = Tables<"task_deliveries">;
type ContentAsset = Tables<"content_assets">;
type ContentStepDelivery = Tables<"content_step_deliveries">;
type ContentRequest = Pick<
  Tables<"content_items">,
  "id" | "version" | "intake_request" | "intake_source_url" | "caption_brief" | "editing_brief" | "thumbnail_brief" | "copy_brief" | "design_brief"
>;
type Membership = Tables<"memberships">;
type Organization = Tables<"organizations">;
type Person = { id: string; name: string; role: Membership["role"] };
type Workspace = {
  organization: Organization;
  membership: Membership;
  people: Person[];
  task: Task;
  events: TaskEvent[];
  discussion: TaskDiscussionMessage[];
  revisions: TaskRevisionRequest[];
  contentRevisions: ContentRevisionRequest[];
  taskDeliveries: TaskDelivery[];
  assets: ContentAsset[];
  deliveries: ContentStepDelivery[];
  contentRequest: ContentRequest | null;
};

type CaptionDraft = {
  contentItemId: string;
  baseVersion: number;
  baseValue: string;
  value: string;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String(error.message) : "";
  if (/Task changed/i.test(message)) return "المهمة اتغيرت عند عضو آخر. حدّث الصفحة ثم أعد المحاولة.";
  if (/Only the task requester/i.test(message)) return "طلب التعديل متاح لطالب المهمة أو إدارة المنصة فقط.";
  if (/assignee cannot request/i.test(message)) return "المنفّذ لا يطلب تعديلًا من نفسه.";
  if (/Linked workflow revisions/i.test(message)) return "التعديل على هذه المهمة يتم من ملف المحتوى أو العميل أو الإطلاق المرتبط بها.";
  if (/cancelled task/i.test(message)) return "المهمة الملغاة لا تستقبل طلبات تعديل.";
  if (/Only task participants/i.test(message)) return "النقاش متاح للمسؤول وطالب المهمة وإدارة المنصة فقط.";
  if (/discussion messages must contain/i.test(message)) return "اكتب سؤالًا أو توضيحًا من حرفين على الأقل.";
  if (/Platform leadership cannot execute/i.test(message)) return "تنفيذ المهمة وتغيير حالتها متاحان للمسؤول المسند إليه فقط.";
  if (/Only the assigned task owner can submit/i.test(message)) return "إضافة أو تعديل التسليم متاح للمسؤول عن المهمة فقط.";
  if (/Start the task before submitting/i.test(message)) return "اضغط «استلمت وبدأت» أولًا، وبعدها سلّم النتيجة.";
  if (/Resume the task before submitting/i.test(message)) return "استأنف المهمة أولًا قبل تسليم النتيجة.";
  if (/awaiting review and cannot be changed|delivery cannot be changed in the current task state/i.test(message)) return "التسليم بانتظار المراجعة ولا يمكن تعديله الآن. اطلب إرجاع المهمة للتنفيذ لو محتاج تغييره.";
  if (/Task changed since this page was opened/i.test(message)) return "تم تحديث المهمة بعد فتح الصفحة. حمّلنا أحدث نسخة؛ راجع التعديل ثم سلّم من جديد.";
  if (/Delivery changed since this page was opened/i.test(message)) return "تم تحديث رابط أو ملاحظة التسليم من جلسة أخرى. حمّلنا أحدث نسخة قبل أي تعديل جديد.";
  if (/approved delivery can only change through a new revision request/i.test(message)) return "هذا التسليم تم اعتماده. أي تعديل جديد لازم يبدأ بطلب تعديل من طالب المهمة.";
  if (/Submit the task result before completion/i.test(message)) return "احفظ رابط أو ملاحظة التسليم من خانة «تم تنفيذ المهمة» قبل الإغلاق.";
  if (/Add a delivery note or URL/i.test(message)) return "أضف رابط التسليم أو اكتب ملاحظة التسليم.";
  if (/Delivery URL must be/i.test(message)) return "اكتب رابط تسليم صحيح يبدأ بـ http:// أو https://.";
  if (/Delivery note must contain/i.test(message)) return "ملاحظة التسليم لازم تكون 3 حروف على الأقل.";
  if (/Publishing requires the final caption/i.test(message)) return "اكتب الكابشن النهائي قبل تأكيد النشر.";
  return message || "حدث خطأ غير متوقع.";
}

function resourceHost(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "رابط خارجي";
  }
}

function LinkifiedText({ text }: { text: string }) {
  return <>{text.split(/(https?:\/\/[^\s]+)/g).map((part, index) => /^https?:\/\//.test(part)
    ? <a href={part} target="_blank" rel="noreferrer" key={`${part}-${index}`}>{part} <ExternalLink size={11} /></a>
    : part)}</>;
}

const requestSectionHeadings = new Set([
  "الطلب العام",
  "تعليمات المونتاج",
  "تعليمات الغلاف",
  "تعليمات الكابشن",
  "تعليمات التصميم",
  "تعليمات النشر",
]);

function requestSection(text: string, heading: string) {
  const lines = text.split(/\r?\n/);
  const collected: string[] = [];
  let active = false;
  for (const line of lines) {
    const normalized = line.trim().replace(/[:：]\s*$/, "");
    if (requestSectionHeadings.has(normalized)) {
      if (active) break;
      active = normalized === heading;
      continue;
    }
    if (active) collected.push(line);
  }
  return collected.join("\n").trim();
}

function roleSpecificInstructions(fullRequest: string, heading: string, storedBrief: string) {
  const embeddedBrief = requestSection(fullRequest, heading);
  const explicitBrief = storedBrief.trim();
  const looksLikeLegacyRequestCopy = explicitBrief.startsWith("الطلب العام:")
    || explicitBrief === fullRequest
    || (explicitBrief.length >= 10 && fullRequest.startsWith(explicitBrief));

  if (embeddedBrief && looksLikeLegacyRequestCopy) return embeddedBrief;
  return explicitBrief || embeddedBrief || fullRequest;
}

function instructionsForTask(task: Task, contentRequest: ContentRequest | null, fullRequest: string) {
  if (!task.content_step || !contentRequest) return fullRequest;
  if (task.content_step === "editing") {
    return roleSpecificInstructions(fullRequest, "تعليمات المونتاج", contentRequest.editing_brief);
  }
  if (task.content_step === "thumbnail") {
    return roleSpecificInstructions(fullRequest, "تعليمات الغلاف", contentRequest.thumbnail_brief);
  }
  if (task.content_step === "caption") {
    return contentRequest.copy_brief.trim()
      || requestSection(fullRequest, "تعليمات الكابشن")
      || fullRequest;
  }
  if (task.content_step === "design") {
    return contentRequest.design_brief.trim()
      || requestSection(fullRequest, "تعليمات التصميم")
      || fullRequest;
  }
  if (task.content_step === "publishing") {
    return contentRequest.caption_brief.trim()
      || requestSection(fullRequest, "تعليمات النشر")
      || fullRequest;
  }
  return requestSection(fullRequest, "الطلب العام") || fullRequest;
}

const deliveryInputsByStep: Partial<Record<ContentStep, ContentStep[]>> = {
  editing: ["recording"],
  scheduling: ["caption", "design"],
  publishing: ["editing", "thumbnail", "caption", "design", "scheduling"],
};

const assetInputsByStep: Partial<Record<ContentStep, ContentStep[]>> = {
  recording: ["brief", "recording"],
  editing: ["brief", "recording", "editing"],
  // Raw links are shared source material. The designer still sees only the
  // cover brief as instructions, but can open the supplied frame/image/video
  // references without hunting through the full content workspace.
  thumbnail: ["brief", "recording", "thumbnail"],
  caption: ["brief", "caption"],
  design: ["brief", "design"],
  scheduling: ["brief", "caption", "design", "scheduling"],
  publishing: ["brief", "recording", "editing", "thumbnail", "caption", "design", "scheduling", "publishing"],
};

const contentStepsRequiringResultUrl = new Set<ContentStep>(["recording", "editing", "thumbnail", "design", "publishing"]);
const contentStepsSupportingRevision = new Set<ContentStep>(["recording", "editing", "thumbnail", "caption", "design"]);

const contentRevisionStatusLabels: Record<ContentRevisionRequest["status"], string> = {
  requested: "مطلوب",
  in_progress: "قيد التنفيذ",
  resolved: "تم تنفيذه",
  cancelled: "ملغي",
};

function taskEventTitle(event: TaskEvent) {
  if (event.event_type === "created") return "تم إنشاء المهمة";
  if (event.event_type === "reassigned") return "تم تغيير المسؤول";
  if (event.event_type === "status_changed") {
    const from = event.from_status ? taskStatusConfig[event.from_status].label : "بداية المهمة";
    const to = event.to_status ? taskStatusConfig[event.to_status].label : "حالة جديدة";
    return `${from} ← ${to}`;
  }
  return "تم تحديث المهمة";
}

export function TaskDetailWorkspace({ taskId }: { taskId: string }) {
  const configured = isSupabaseConfigured();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(configured);
  const [working, setWorking] = useState(false);
  const [showRevisionForm, setShowRevisionForm] = useState(() => typeof window !== "undefined" && new URL(window.location.href).searchParams.get("action") === "revise");
  const [deliveryFormOpen, setDeliveryFormOpen] = useState(() => typeof window !== "undefined" && window.location.hash === "#delivery");
  const [deliverySnapshot, setDeliverySnapshot] = useState<{ taskVersion: number; deliveryVersion: number | null } | null>(null);
  const [captionDraft, setCaptionDraft] = useState<CaptionDraft | null>(null);
  const [discussionDraft, setDiscussionDraft] = useState("");
  const [error, setError] = useState<string | null>(configured ? null : "اتصال تسجيل الدخول غير متاح مؤقتًا.");
  const [notice, setNotice] = useState<string | null>(null);
  const focusedDiscussion = useRef<string | null>(null);
  const deliverySection = useRef<HTMLDivElement | null>(null);
  const deliveryFocusPending = useRef(typeof window !== "undefined" && (window.location.hash === "#delivery" || new URL(window.location.href).searchParams.get("action") === "deliver"));
  const [linkedDiscussionId] = useState(() => typeof window === "undefined" ? null : new URL(window.location.href).searchParams.get("message"));

  const clearWorkspace = useCallback(() => {
    setWorkspace(null);
    setDeliveryFormOpen(false);
    setDeliverySnapshot(null);
    setCaptionDraft(null);
  }, []);
  const clearTransientState = useCallback(() => { setError(null); setNotice(null); }, []);

  const loadTaskData = useCallback(async (activeSession: Session, showLoading = true) => {
    const supabase = getSupabaseBrowserClient();
    if (showLoading) setLoading(true);
    try {
      const { data: membership, error: membershipError } = await supabase
        .from("memberships")
        .select("*")
        .eq("user_id", activeSession.user.id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) { setWorkspace(null); return; }

      const [{ data: organization, error: organizationError }, { data: task, error: taskError }, { data: memberRows, error: membersError }] = await Promise.all([
        supabase.from("organizations").select("*").eq("id", membership.organization_id).single(),
        supabase.from("tasks").select("*").eq("id", taskId).eq("organization_id", membership.organization_id).maybeSingle(),
        supabase.from("memberships").select("user_id, role").eq("organization_id", membership.organization_id).eq("status", "active"),
      ]);
      if (organizationError) throw organizationError;
      if (taskError) throw taskError;
      if (membersError) throw membersError;
      if (!task) throw new Error("المهمة غير موجودة أو خارج صلاحيات حسابك.");

      const [
        { data: events, error: eventsError },
        { data: discussion, error: discussionError },
        { data: revisions, error: revisionsError },
        { data: contentRevisions, error: contentRevisionsError },
        { data: taskDeliveries, error: taskDeliveriesError },
        { data: assets, error: assetsError },
        { data: deliveries, error: deliveriesError },
        { data: contentRequest, error: contentRequestError },
      ] = await Promise.all([
        supabase.from("task_events").select("*").eq("task_id", task.id).order("occurred_at", { ascending: false }).limit(100),
        supabase.from("task_discussion_messages").select("*").eq("task_id", task.id).order("created_at", { ascending: true }).limit(200),
        supabase.from("task_revision_requests").select("*").eq("task_id", task.id).order("requested_at", { ascending: false }).limit(100),
        task.content_item_id
          ? supabase.from("content_revision_requests").select("*").eq("task_id", task.id).order("requested_at", { ascending: false }).limit(100)
          : Promise.resolve({ data: [] as ContentRevisionRequest[], error: null }),
        !task.content_item_id && !task.launch_id && !task.launch_deliverable_id && !task.crm_contact_id
          ? supabase.from("task_deliveries").select("*").eq("task_id", task.id).limit(1)
          : Promise.resolve({ data: [] as TaskDelivery[], error: null }),
        task.content_item_id
          ? supabase.from("content_assets").select("*").eq("content_item_id", task.content_item_id).order("created_at", { ascending: true })
          : Promise.resolve({ data: [] as ContentAsset[], error: null }),
        task.content_item_id
          ? supabase.from("content_step_deliveries").select("*").eq("content_item_id", task.content_item_id).order("submitted_at", { ascending: false })
          : Promise.resolve({ data: [] as ContentStepDelivery[], error: null }),
        task.content_item_id
          ? supabase.from("content_items").select("id, version, intake_request, intake_source_url, caption_brief, editing_brief, thumbnail_brief, copy_brief, design_brief").eq("id", task.content_item_id).maybeSingle()
          : Promise.resolve({ data: null as ContentRequest | null, error: null }),
      ]);
      if (eventsError) throw eventsError;
      if (discussionError) throw discussionError;
      if (revisionsError) throw revisionsError;
      if (contentRevisionsError) throw contentRevisionsError;
      if (taskDeliveriesError) throw taskDeliveriesError;
      if (assetsError) throw assetsError;
      if (deliveriesError) throw deliveriesError;
      if (contentRequestError) throw contentRequestError;

      const profileIds = [...new Set([
        ...(memberRows ?? []).map((member) => member.user_id),
        task.owner_id,
        task.created_by,
        ...(events ?? []).flatMap((event) => event.actor_id ? [event.actor_id] : []),
        ...(discussion ?? []).map((message) => message.author_id),
        ...(revisions ?? []).map((revision) => revision.requested_by),
        ...(contentRevisions ?? []).flatMap((revision) => [revision.requested_by, revision.assigned_to, ...(revision.resolved_by ? [revision.resolved_by] : [])]),
        ...(taskDeliveries ?? []).map((delivery) => delivery.submitted_by),
        ...(assets ?? []).map((asset) => asset.created_by),
        ...(deliveries ?? []).map((delivery) => delivery.submitted_by),
      ])];
      const { data: profiles, error: profilesError } = profileIds.length
        ? await supabase.from("profiles").select("id, full_name").in("id", profileIds)
        : { data: [], error: null };
      if (profilesError) throw profilesError;

      const people = (memberRows ?? []).map((member) => ({
        id: member.user_id,
        role: member.role,
        name: profiles?.find((profile) => profile.id === member.user_id)?.full_name
          ?? (member.user_id === activeSession.user.id ? activeSession.user.email : null)
          ?? "عضو فريق",
      }));
      for (const profile of profiles ?? []) {
        if (!people.some((person) => person.id === profile.id)) {
          people.push({ id: profile.id, role: "viewer", name: profile.full_name ?? "عضو سابق" });
        }
      }

      setWorkspace({
        organization,
        membership,
        people,
        task,
        events: events ?? [],
        discussion: discussion ?? [],
        revisions: revisions ?? [],
        contentRevisions: contentRevisions ?? [],
        taskDeliveries: taskDeliveries ?? [],
        assets: assets ?? [],
        deliveries: deliveries ?? [],
        contentRequest,
      });
      setCaptionDraft((current) => {
        if (!contentRequest) return null;
        const serverValue = contentRequest.caption_brief ?? "";
        if (!current || current.contentItemId !== contentRequest.id) {
          return {
            contentItemId: contentRequest.id,
            baseVersion: contentRequest.version,
            baseValue: serverValue,
            value: serverValue,
          };
        }
        if (current.baseVersion === contentRequest.version) return current;
        if (current.value !== current.baseValue) return current;
        return {
          contentItemId: contentRequest.id,
          baseVersion: contentRequest.version,
          baseValue: serverValue,
          value: serverValue,
        };
      });
      setError(null);
    } catch (loadError) {
      setError(friendlyError(loadError));
      if (showLoading) setWorkspace(null);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [taskId]);

  const loadWorkspace = useCallback(async (activeSession: Session) => loadTaskData(activeSession, true), [loadTaskData]);
  const session = useWorkspaceAuth({ configured, loadWorkspace, clearWorkspace, setLoading, clearTransientState });
  const deliveryFocusTaskStatus = workspace?.task.status;

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.hash !== "#delivery" && url.searchParams.get("action") !== "deliver") return;
    const frame = window.requestAnimationFrame(() => setDeliveryFormOpen(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!deliveryFormOpen || deliverySnapshot || !workspace || !["in_progress", "done"].includes(workspace.task.status)) return;
    const current = workspace.task.content_item_id
      ? workspace.deliveries.find((delivery) => delivery.task_id === workspace.task.id) ?? null
      : workspace.taskDeliveries.find((delivery) => delivery.task_id === workspace.task.id) ?? null;
    const frame = window.requestAnimationFrame(() => {
      setDeliverySnapshot({ taskVersion: workspace.task.version, deliveryVersion: current?.version ?? null });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [deliveryFormOpen, deliverySnapshot, workspace]);

  useEffect(() => {
    if (!workspace || !session) return;
    const supabase = getSupabaseBrowserClient();
    let channel = supabase
      .channel(`task-detail:${taskId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `id=eq.${taskId}` }, () => void loadTaskData(session, false))
      .on("postgres_changes", { event: "*", schema: "public", table: "task_events", filter: `task_id=eq.${taskId}` }, () => void loadTaskData(session, false))
      .on("postgres_changes", { event: "*", schema: "public", table: "task_discussion_messages", filter: `task_id=eq.${taskId}` }, () => void loadTaskData(session, false))
      .on("postgres_changes", { event: "*", schema: "public", table: "task_revision_requests", filter: `task_id=eq.${taskId}` }, () => void loadTaskData(session, false))
      .on("postgres_changes", { event: "*", schema: "public", table: "task_deliveries", filter: `task_id=eq.${taskId}` }, () => void loadTaskData(session, false));
    if (workspace.task.content_item_id) {
      channel = channel
        .on("postgres_changes", { event: "*", schema: "public", table: "content_items", filter: `id=eq.${workspace.task.content_item_id}` }, () => void loadTaskData(session, false))
        .on("postgres_changes", { event: "*", schema: "public", table: "content_assets", filter: `content_item_id=eq.${workspace.task.content_item_id}` }, () => void loadTaskData(session, false))
        .on("postgres_changes", { event: "*", schema: "public", table: "content_step_deliveries", filter: `content_item_id=eq.${workspace.task.content_item_id}` }, () => void loadTaskData(session, false))
        .on("postgres_changes", { event: "*", schema: "public", table: "content_revision_requests", filter: `task_id=eq.${taskId}` }, () => void loadTaskData(session, false));
    }
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadTaskData, session, taskId, workspace]);

  const peopleById = useMemo(() => new Map(workspace?.people.map((person) => [person.id, person]) ?? []), [workspace?.people]);

  useEffect(() => {
    if (!linkedDiscussionId || focusedDiscussion.current === linkedDiscussionId || !workspace?.discussion.some((message) => message.id === linkedDiscussionId)) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(`discussion-${linkedDiscussionId}`);
      if (!target) return;
      focusedDiscussion.current = linkedDiscussionId;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [linkedDiscussionId, workspace?.discussion]);

  useEffect(() => {
    if (!deliveryFocusPending.current || !deliveryFormOpen || !deliveryFocusTaskStatus || !["in_progress", "done"].includes(deliveryFocusTaskStatus)) return;
    const frame = window.requestAnimationFrame(() => {
      const target = deliverySection.current;
      if (!target) return;
      deliveryFocusPending.current = false;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.querySelector<HTMLInputElement | HTMLTextAreaElement>("input:not(:disabled), textarea:not(:disabled)")?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [deliveryFormOpen, deliveryFocusTaskStatus]);

  function openDeliveryForm() {
    if (!workspace) return;
    setError(null);
    setNotice(null);
    deliveryFocusPending.current = true;
    const current = workspace.task.content_item_id
      ? workspace.deliveries.find((delivery) => delivery.task_id === workspace.task.id) ?? null
      : workspace.taskDeliveries.find((delivery) => delivery.task_id === workspace.task.id) ?? null;
    setDeliverySnapshot({ taskVersion: workspace.task.version, deliveryVersion: current?.version ?? null });
    setDeliveryFormOpen(true);
    const url = new URL(window.location.href);
    url.hash = "delivery";
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function closeDeliveryForm() {
    setDeliveryFormOpen(false);
    setDeliverySnapshot(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("action");
    url.hash = "";
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  async function changeStatus(nextStatus: TaskStatus) {
    if (!workspace || nextStatus === workspace.task.status) return;
    setWorking(true); setError(null); setNotice(null);
    const { data, error: updateError } = await getSupabaseBrowserClient()
      .from("tasks")
      .update({ status: nextStatus })
      .eq("id", workspace.task.id)
      .eq("version", workspace.task.version)
      .select("id")
      .maybeSingle();
    if (updateError) setError(friendlyError(updateError));
    else if (!data) setError("المهمة اتغيرت عند عضو آخر. حدّث الصفحة ثم أعد المحاولة.");
    else {
      setNotice(`انتقلت المهمة إلى «${taskStatusLabel(nextStatus, workspace.task.content_step)}».`);
      await loadTaskData(session!, false);
    }
    setWorking(false);
  }

  async function requestRevision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || !session) return;
    const formElement = event.currentTarget;
    const instructions = String(new FormData(formElement).get("instructions") ?? "").trim();
    if (instructions.length < 5) { setError("اكتب التعديل المطلوب بوضوح في 5 حروف على الأقل."); return; }
    setWorking(true); setError(null); setNotice(null);
    if (workspace.task.content_item_id && workspace.task.content_step) {
      const { error: commandError } = await getSupabaseBrowserClient().functions.invoke("content-commands", {
        body: {
          action: "request_revision",
          content_item_id: workspace.task.content_item_id,
          target_stage: workspace.task.content_step,
          revision_instructions: instructions,
        },
      });
      if (commandError) setError(await getSupabaseFunctionErrorMessage(commandError, "تعذّر إرسال طلب التعديل."));
      else {
        formElement.reset();
        setShowRevisionForm(false);
        setNotice(`تم إرسال تعديل «${contentStepConfig[workspace.task.content_step].label}» للمسؤول وإعادة فتح مرحلته.`);
        await loadTaskData(session, false);
      }
      setWorking(false);
      return;
    }
    const { error: insertError } = await getSupabaseBrowserClient().from("task_revision_requests").insert({
      task_id: workspace.task.id,
      instructions,
      task_version: workspace.task.version,
    });
    if (insertError) setError(friendlyError(insertError));
    else {
      formElement.reset();
      setShowRevisionForm(false);
      setNotice("تم إرسال طلب التعديل للمسؤول وإرجاع المهمة للتنفيذ عند الحاجة.");
      await loadTaskData(session, false);
    }
    setWorking(false);
  }

  async function sendDiscussionMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || !session) return;
    const body = discussionDraft.trim();
    if (body.length < 2) { setError("اكتب سؤالًا أو توضيحًا من حرفين على الأقل."); return; }
    setWorking(true); setError(null); setNotice(null);
    const { error: insertError } = await getSupabaseBrowserClient().from("task_discussion_messages").insert({
      task_id: workspace.task.id,
      body,
    });
    if (insertError) setError(friendlyError(insertError));
    else {
      setDiscussionDraft("");
      setNotice(workspace.task.owner_id === session.user.id ? "تم إرسال سؤالك لطالب المهمة ووصل له إشعار." : "تم إرسال التوضيح للمسؤول ووصل له إشعار.");
      await loadTaskData(session, false);
    }
    setWorking(false);
  }

  async function saveContentCaption(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace?.contentRequest || !workspace.task.content_item_id || !session || !captionDraft) return;
    if (captionDraft.contentItemId !== workspace.contentRequest.id
      || captionDraft.baseVersion !== workspace.contentRequest.version) {
      setError("وصل إصدار أحدث للكابشن أثناء الكتابة. راجع التعارض الظاهر داخل خانة الكابشن قبل الحفظ.");
      return;
    }
    const captionText = captionDraft.value.trim();
    if (captionText.length < 3) {
      setError("اكتب الكابشن من 3 حروف على الأقل.");
      return;
    }
    setWorking(true); setError(null); setNotice(null);
    const { data: commandData, error: commandError } = await getSupabaseBrowserClient().functions.invoke("content-commands", {
      body: {
        action: "update_content_caption",
        content_item_id: workspace.task.content_item_id,
        caption: captionText,
        expected_content_version: captionDraft.baseVersion,
      },
    });
    if (commandError) {
      setError(await getSupabaseFunctionErrorMessage(commandError, "تعذّر حفظ الكابشن."));
      await loadTaskData(session, false);
    } else {
      const returnedVersion = Number((commandData as { version?: unknown } | null)?.version);
      setCaptionDraft({
        contentItemId: workspace.contentRequest.id,
        baseVersion: Number.isSafeInteger(returnedVersion) && returnedVersion > 0
          ? returnedVersion
          : captionDraft.baseVersion,
        baseValue: captionText,
        value: captionText,
      });
      setNotice("تم حفظ الكابشن داخل طلب المحتوى وسيظهر لمسؤول النشر.");
      await loadTaskData(session, false);
    }
    setWorking(false);
  }

  function useLatestCaption() {
    if (!workspace?.contentRequest) return;
    const value = workspace.contentRequest.caption_brief ?? "";
    setCaptionDraft({
      contentItemId: workspace.contentRequest.id,
      baseVersion: workspace.contentRequest.version,
      baseValue: value,
      value,
    });
    setError(null);
    setNotice("تم تحميل أحدث كابشن. مسودتك السابقة لم تعد مستخدمة.");
  }

  function rebaseCaptionDraft() {
    if (!workspace?.contentRequest || !captionDraft) return;
    setCaptionDraft({
      ...captionDraft,
      contentItemId: workspace.contentRequest.id,
      baseVersion: workspace.contentRequest.version,
      baseValue: workspace.contentRequest.caption_brief ?? "",
    });
    setError(null);
    setNotice("تم الاحتفاظ بمسودتك على أحدث نسخة. راجع الفرق ثم احفظها يدويًا.");
  }

  async function saveTaskDelivery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || !session) return;
    const latestDelivery = workspace.task.content_item_id
      ? workspace.deliveries.find((delivery) => delivery.task_id === workspace.task.id) ?? null
      : workspace.taskDeliveries.find((delivery) => delivery.task_id === workspace.task.id) ?? null;
    if (!deliverySnapshot
      || deliverySnapshot.taskVersion !== workspace.task.version
      || deliverySnapshot.deliveryVersion !== (latestDelivery?.version ?? null)) {
      setError("وصل تحديث جديد للمهمة أو التسليم أثناء الكتابة. اقفل النموذج، راجع التحديث، وبعدها افتحه من جديد.");
      return;
    }
    if (workspace.task.status === "ready") { setError("اضغط «استلمت وبدأت» أولًا، وبعدها سلّم النتيجة."); return; }
    if (workspace.task.status === "blocked") { setError("استأنف المهمة أولًا قبل تسليم النتيجة."); return; }
    if (workspace.task.status === "review") { setError("التسليم بانتظار المراجعة ولا يمكن تعديله الآن."); return; }
    if (!["in_progress", "done"].includes(workspace.task.status)) { setError("لا يمكن تسليم هذه المهمة في حالتها الحالية."); return; }
    const form = new FormData(event.currentTarget);
    const resultNote = String(form.get("result_note") ?? "").trim();
    const resultUrl = String(form.get("result_url") ?? "").trim();
    if (!resultNote && !resultUrl) { setError("أضف رابط التسليم أو اكتب ملاحظة التسليم."); return; }
    if (resultNote && resultNote.length < 3) { setError("ملاحظة التسليم لازم تكون 3 حروف على الأقل."); return; }
    if (resultUrl && !/^https?:\/\/\S+$/i.test(resultUrl)) { setError("اكتب رابط تسليم صحيح يبدأ بـ http:// أو https://."); return; }

    if (workspace.task.content_item_id && workspace.task.content_step) {
      if (contentStepsRequiringResultUrl.has(workspace.task.content_step) && !resultUrl) {
        setError(workspace.task.content_step === "publishing"
          ? "أضف رابط المنشور الحقيقي قبل تأكيد النشر."
          : workspace.task.content_step === "recording"
            ? "أضف رابط المادة الخام قبل فتح المونتاج والغلاف."
            : "أضف رابط ملف التسليم قبل إغلاق المهمة.");
        return;
      }
      if (workspace.task.content_step === "publishing" && !resultNote && !workspace.contentRequest?.caption_brief.trim()) {
        setError("اكتب الكابشن النهائي قبل تأكيد النشر.");
        return;
      }
      await submitContentDelivery(resultNote, resultUrl, currentDelivery
        ? "تم تحديث التسليم داخل المهمة."
        : workspace.task.content_step === "publishing"
          ? "تم تأكيد النشر وحفظ الرابط."
          : "تم حفظ التسليم وإغلاق المهمة وفتح الخطوة التالية.");
      return;
    }

    setWorking(true); setError(null); setNotice(null);
    const { error: submissionError } = await getSupabaseBrowserClient().rpc("submit_task_delivery", {
      target_task_id: workspace.task.id,
      delivery_result_note: resultNote,
      delivery_result_url: resultUrl,
      expected_task_version: deliverySnapshot.taskVersion,
      expected_delivery_version: deliverySnapshot.deliveryVersion,
    });
    if (submissionError) {
      const submissionMessage = friendlyError(submissionError);
      if (/Task changed since this page was opened|Delivery changed since this page was opened/i.test(submissionError.message)) {
        closeDeliveryForm();
        await loadTaskData(session, false);
      }
      setError(submissionMessage);
    }
    else {
      setNotice(workspace.task.status === "done"
        ? "تم تحديث رابط وملاحظة التسليم بدون إعادة فتح المهمة."
          : workspace.task.requires_review
          ? "تم حفظ التسليم وإرساله إلى طالب المهمة للمراجعة."
          : "تم حفظ التسليم وإغلاق المهمة بنجاح.");
      closeDeliveryForm();
      await loadTaskData(session, false);
    }
    setWorking(false);
  }

  async function submitContentDelivery(resultNote: string, resultUrl: string, successMessage: string) {
    if (!workspace?.task.content_item_id || !workspace.task.content_step || !session) return;
    setWorking(true); setError(null); setNotice(null);
    const { error: submissionError } = await getSupabaseBrowserClient().functions.invoke("content-commands", {
      body: {
        action: "submit_step_delivery",
        task_id: workspace.task.id,
        step: workspace.task.content_step,
        result_note: resultNote,
        result_url: resultUrl,
      },
    });
    if (submissionError) {
      setError(await getSupabaseFunctionErrorMessage(submissionError, "تعذّر حفظ تسليم المهمة."));
    } else {
      setNotice(successMessage);
      closeDeliveryForm();
      await loadTaskData(session, false);
    }
    setWorking(false);
  }

  if (loading) return <section className="panel empty-state"><LoaderCircle className="spin" size={20} /><div><h2>جارٍ فتح ملف المهمة</h2><p>نحمّل التفاصيل وطلبات التعديل وسجل الحالة.</p></div></section>;
  if (!configured) return <section className="panel empty-state"><AlertTriangle size={20} /><div><h2>اتصال تسجيل الدخول غير متاح مؤقتًا</h2><p>حدّث الصفحة بعد استعادة الاتصال.</p></div></section>;
  if (!session || !workspace) return <section className="panel empty-state"><AlertTriangle size={20} /><div><h2>تعذّر فتح ملف المهمة</h2><p>{error ?? "سجّل الدخول بحساب عضو مصرح له."}</p></div><Button href="/tasks" variant="secondary">العودة للمهام</Button></section>;

  const { task, discussion, revisions, contentRevisions, events } = workspace;
  const isAssignee = task.owner_id === session.user.id;
  const isRequester = task.created_by === session.user.id;
  const platformAdmin = canManageAllTaskExecution(workspace.membership.role);
  const readOnly = workspace.membership.role === "viewer";
  const linkedWorkflow = Boolean(task.content_item_id || task.launch_id || task.launch_deliverable_id || task.crm_contact_id);
  const actorTransitions = allowedTaskTransitionsForActor({
    status: task.status,
    requiresReview: task.requires_review,
    isAssignee,
    isRequester,
    role: workspace.membership.role,
  });
  const contentTask = Boolean(task.content_item_id && task.content_step);
  const standaloneTask = !linkedWorkflow;
  const contentTaskSupportsRevision = Boolean(task.content_step && contentStepsSupportingRevision.has(task.content_step));
  const canRequestContentRevision = contentTask
    && contentTaskSupportsRevision
    && !readOnly
    && !isAssignee
    && ["review", "done"].includes(task.status)
    && (isRequester || platformAdmin);
  const canRequestStandaloneRevision = standaloneTask
    && !isAssignee
    && task.status !== "cancelled"
    && task.status !== "backlog"
    && (isRequester || platformAdmin);
  const canRequestRevision = canRequestContentRevision || canRequestStandaloneRevision;
  const canDiscuss = !readOnly && (isAssignee || isRequester || platformAdmin);
  const canEditCaption = contentTask && !readOnly && (isAssignee || isRequester || platformAdmin);
  const owner = peopleById.get(task.owner_id);
  const requester = peopleById.get(task.created_by);
  const currentDelivery = task.content_item_id
    ? workspace.deliveries.find((delivery) => delivery.task_id === task.id) ?? null
    : workspace.taskDeliveries.find((delivery) => delivery.task_id === task.id) ?? null;
  const deliveryDraftStale = Boolean(deliverySnapshot && (
    deliverySnapshot.taskVersion !== task.version
    || deliverySnapshot.deliveryVersion !== (currentDelivery?.version ?? null)
  ));
  const inputDeliverySteps = task.content_step ? deliveryInputsByStep[task.content_step] ?? [] : [];
  const inputDeliveries = workspace.deliveries.filter((delivery) => delivery.task_id !== task.id && inputDeliverySteps.includes(delivery.step));
  const inputAssetSteps = task.content_step ? assetInputsByStep[task.content_step] ?? [task.content_step] : [];
  const taskAssets = workspace.assets.filter((asset) => !asset.stage || inputAssetSteps.includes(asset.stage));
  const fullRequest = workspace.contentRequest?.intake_request?.trim()
    || task.description?.trim()
    || "لا يوجد شرح إضافي لهذه المهمة. ارجع لطالب المهمة من قسم السؤال والجواب إذا احتجت توضيحًا.";
  const taskInstructions = instructionsForTask(task, workspace.contentRequest, fullRequest);
  const captionServerValue = workspace.contentRequest?.caption_brief ?? "";
  const captionDraftMatchesItem = Boolean(captionDraft && captionDraft.contentItemId === workspace.contentRequest?.id);
  const captionDraftStale = Boolean(captionDraftMatchesItem
    && captionDraft
    && workspace.contentRequest
    && captionDraft.baseVersion !== workspace.contentRequest.version);
  const captionDraftDirty = Boolean(captionDraftMatchesItem && captionDraft && captionDraft.value !== captionDraft.baseValue);
  const hasExecutionResources = taskAssets.length > 0 || inputDeliveries.length > 0;
  const canSubmitDelivery = !readOnly && isAssignee
    && (task.status === "in_progress" || (task.status === "done" && !task.requires_review))
    && (standaloneTask || contentTask);
  const canChangeStatusHere = !linkedWorkflow || contentTask;
  const canStartTask = canChangeStatusHere && task.status === "ready" && actorTransitions.includes("in_progress");
  const canResumeTask = canChangeStatusHere && task.status === "blocked" && actorTransitions.includes("in_progress");
  const canBlockTask = canChangeStatusHere && task.status === "in_progress" && actorTransitions.includes("blocked");
  const canOpenDelivery = canSubmitDelivery && ["in_progress", "done"].includes(task.status) && !deliveryFormOpen;
  const canApproveTask = !linkedWorkflow && task.status === "review" && actorTransitions.includes("done");
  const showDeliveryForm = canSubmitDelivery && deliveryFormOpen && Boolean(deliverySnapshot);
  const canOpenContentWorkspace = workspace.membership.role === "owner" || workspace.membership.allowed_sections.includes("content");
  const linkedHref = task.content_item_id ? canOpenContentWorkspace ? `/content?content=${task.content_item_id}#content-${task.content_item_id}` : null
    : task.launch_deliverable_id ? `/campaigns?deliverable=${task.launch_deliverable_id}#deliverable-${task.launch_deliverable_id}`
      : task.launch_id ? `/campaigns?launch=${task.launch_id}#launch-${task.launch_id}`
        : task.crm_contact_id ? `/crm/${task.crm_contact_id}` : null;
  const linkedLabel = task.content_item_id ? "فتح ملف المحتوى"
    : task.launch_deliverable_id || task.launch_id ? "فتح ملف الإطلاق"
      : task.crm_contact_id ? "فتح ملف العميل" : null;
  const revisionTimeline = [
    ...revisions.map((revision) => ({
      id: `task:${revision.id}`,
      requestedAt: revision.requested_at,
      title: "تعديل عام للمهمة",
      instructions: revision.instructions,
      requestedBy: revision.requested_by,
      assignedTo: task.owner_id,
      meta: `على نسخة v${revision.task_version}`,
    })),
    ...contentRevisions.map((revision) => ({
      id: `content:${revision.id}`,
      requestedAt: revision.requested_at,
      title: `تعديل ${contentStepConfig[revision.stage].label} · الجولة ${revision.round}`,
      instructions: revision.instructions,
      requestedBy: revision.requested_by,
      assignedTo: revision.assigned_to,
      meta: `${contentRevisionStatusLabels[revision.status]}${revision.resolved_at ? ` · أُغلق ${formatDate(revision.resolved_at)}` : ""}`,
    })),
  ].sort((left, right) => new Date(right.requestedAt).getTime() - new Date(left.requestedAt).getTime());

  return (
    <section className="task-detail-workspace">
      <div className="task-detail-toolbar">
        <Button href="/tasks" variant="ghost"><ArrowRight size={15} /> العودة للبورد</Button>
        <span className="task-reference">{taskReference(task.id)}</span>
      </div>

      <section className="panel task-detail-header">
        <div>
          <p className="overline">{taskPriorityConfig[task.priority].mark} أولوية {taskPriorityConfig[task.priority].label}</p>
          <h2>{task.title}</h2>
          <p>طلبها {requester?.name ?? "عضو فريق"} ومسندة إلى {owner?.name ?? "عضو فريق"}.</p>
        </div>
        <StatusBadge tone={taskStatusConfig[task.status].tone}>{taskStatusLabel(task.status, task.content_step)}</StatusBadge>
      </section>

      {notice ? <p className="form-notice success" role="status"><CheckCircle2 size={14} /> {notice}</p> : null}
      {error ? <p className="form-notice error" role="alert">{error}</p> : null}

      <div className="task-detail-layout">
        <aside className="panel task-detail-action">
          <div className="section-heading compact"><div><p className="overline">الإجراء الحالي</p><h2>{isAssignee ? "تنفيذ مهمتك" : isRequester ? "متابعة ما طلبته" : "متابعة المهمة"}</h2></div><ShieldCheck size={19} /></div>
          {isAssignee ? <p className="task-role-proof"><CircleUserRound size={14} /> أنت المسؤول عن التنفيذ.</p> : <p className="task-role-proof"><CircleUserRound size={14} /> التنفيذ يخص {owner?.name ?? "المسؤول"} فقط.</p>}
          {canStartTask ? <Button type="button" disabled={working} onClick={() => void changeStatus("in_progress")}><CheckCircle2 size={15} /> استلمت وبدأت</Button> : null}
          {canOpenDelivery ? <Button type="button" disabled={working} onClick={openDeliveryForm}><PackageCheck size={15} /> {task.status === "done" ? "تعديل رابط أو ملاحظة التسليم" : "تم تنفيذ المهمة"}</Button> : null}
          {canBlockTask ? <Button type="button" variant="secondary" disabled={working} onClick={() => void changeStatus("blocked")}><AlertTriangle size={15} /> عندي عائق</Button> : null}
          {canResumeTask ? <Button type="button" disabled={working} onClick={() => void changeStatus("in_progress")}><CheckCircle2 size={15} /> تم حل العائق — أكمل</Button> : null}
          {canApproveTask ? <Button type="button" disabled={working} onClick={() => void changeStatus("done")}><CheckCircle2 size={15} /> اعتماد وإغلاق المهمة</Button> : null}
          {task.status === "review" && isAssignee ? <p className="task-review-waiting">أرسلت المهمة للمراجعة. الاعتماد أو طلب التعديل عند طالب المهمة.</p> : null}
          {canRequestRevision ? <Button type="button" variant="secondary" onClick={() => setShowRevisionForm((value) => !value)}><MessageSquareText size={15} /> طلب تعديل</Button> : null}
          {linkedHref && linkedLabel ? <Button href={linkedHref} variant="secondary"><Route size={15} /> {linkedLabel}</Button> : null}
          {!canStartTask && !canOpenDelivery && !canBlockTask && !canResumeTask && !canApproveTask && !canRequestRevision && !linkedHref ? <p className="task-action-note">لا يوجد إجراء مطلوب من حسابك في الحالة الحالية.</p> : null}
        </aside>

        <div className="task-detail-main">
          {showRevisionForm && canRequestRevision ? <section id="revision" className="panel task-detail-section task-revision-compose">
            <div className="section-heading compact"><div><p className="overline">تعليمات واضحة للمسؤول</p><h2>ما التعديل المطلوب؟</h2><p>بعد الإرسال ترجع المهمة إلى التنفيذ تلقائيًا لو كانت مكتملة أو تحت المراجعة أو متوقفة.</p></div><MessageSquareText size={19} /></div>
            <form onSubmit={requestRevision}>
              <label><span>تفاصيل التعديل</span><textarea name="instructions" required minLength={5} maxLength={5000} rows={5} placeholder="مثال: عدّل أول 10 ثوانٍ، واحذف الجزء من 00:22 إلى 00:38، ثم ارفع النسخة الجديدة على نفس الرابط." /></label>
              <div className="form-actions"><Button type="submit" disabled={working}>{working ? <LoaderCircle className="spin" size={14} /> : <Send size={14} />} إرسال التعديل للمسؤول</Button><button className="text-button" type="button" onClick={() => setShowRevisionForm(false)}>إلغاء</button></div>
            </form>
          </section> : null}

          <section className="panel task-detail-section task-requirements-section">
            <div className="section-heading compact"><div><p className="overline">المطلوب الآن</p><h2>{isAssignee ? "نفّذ المطلوب بدون بحث أو تخمين" : isRequester ? "الطلب والتسليم في مكان واحد" : "كل المطلوب للتنفيذ"}</h2><p>شرح المهمة أولًا، ثم الملفات والمصادر، وبعدها التسليم النهائي بوضوح.</p></div><FileText size={19} /></div>
            <div className="task-detail-instructions">
              <span><FileText size={14} /> {task.content_step ? `المطلوب منك · ${contentStepConfig[task.content_step].label}` : "كل المطلوب والروابط"}</span>
              <p><LinkifiedText text={taskInstructions} /></p>
              {workspace.contentRequest?.intake_source_url ? <a className="task-original-source" href={workspace.contentRequest.intake_source_url} target="_blank" rel="noreferrer">فتح المصدر الأصلي <ExternalLink size={12} /></a> : null}
            </div>

            {task.content_item_id && taskInstructions !== fullRequest ? <details className="task-full-request">
              <summary>عرض الطلب الأساسي الكامل عند الحاجة</summary>
              <div><LinkifiedText text={fullRequest} /></div>
            </details> : null}

            {task.content_item_id ? <section className={`task-caption-block${task.content_step === "publishing" ? " publishing-caption" : ""}`}>
              <header><div><MessageSquareText size={15} /><div><strong>الكابشن داخل نفس الطلب</strong><small>{task.content_step === "publishing" ? "راجع النص النهائي هنا قبل النشر." : "محفوظ مرة واحدة ويصل تلقائيًا لمسؤول النشر."}</small></div></div><StatusBadge tone={workspace.contentRequest?.caption_brief.trim() ? "success" : "neutral"}>{workspace.contentRequest?.caption_brief.trim() ? "محفوظ" : "غير مكتوب"}</StatusBadge></header>
              {canEditCaption ? <form onSubmit={saveContentCaption}>
                {captionDraftStale ? <div className="form-notice error" role="alert">
                  <strong>وصل إصدار أحدث أثناء كتابة الكابشن.</strong>
                  <p>مسودتك ما زالت محفوظة في الخانة ولم نستبدلها تلقائيًا. قارنها بالنسخة الحالية ثم اختر كيف تكمل.</p>
                  {captionServerValue ? <details><summary>عرض الكابشن المحفوظ حاليًا</summary><p><LinkifiedText text={captionServerValue} /></p></details> : <small>النسخة الأحدث لا تحتوي كابشنًا.</small>}
                  <div className="form-actions"><button className="text-button" type="button" onClick={useLatestCaption}>استخدام النسخة الأحدث</button><button className="text-button" type="button" onClick={rebaseCaptionDraft}>الاحتفاظ بمسودتي ومراجعتها</button></div>
                </div> : null}
                <label><span>نص الكابشن والهاشتاجات</span><textarea name="caption_text" minLength={3} maxLength={10000} rows={6} required value={captionDraftMatchesItem ? captionDraft?.value ?? "" : captionServerValue} onChange={(event) => {
                  const value = event.target.value;
                  const contentRequest = workspace.contentRequest;
                  if (!contentRequest) return;
                  setCaptionDraft((current) => current?.contentItemId === contentRequest.id
                    ? { ...current, value }
                    : { contentItemId: contentRequest.id, baseVersion: contentRequest.version, baseValue: contentRequest.caption_brief ?? "", value });
                }} placeholder="اكتب الكابشن النهائي والهاشتاجات هنا…" disabled={working} /></label>
                <div className="form-actions"><Button type="submit" variant={task.content_step === "publishing" ? "primary" : "secondary"} disabled={working || captionDraftStale || !captionDraftDirty}>{working ? <LoaderCircle className="spin" size={14} /> : <CheckCircle2 size={14} />} حفظ الكابشن</Button><small>{captionDraftDirty ? "عندك تعديل غير محفوظ. الحفظ لا يغيّر حالة المهمة ولا يعتبرها منشورة." : "الكابشن مطابق للنسخة المحفوظة."}</small></div>
              </form> : workspace.contentRequest?.caption_brief.trim() ? <p><LinkifiedText text={workspace.contentRequest.caption_brief} /></p> : <p className="task-resource-empty">لم يُكتب الكابشن حتى الآن.</p>}
            </section> : null}

            {task.content_item_id ? <div className="task-resource-block">
              <header><div><Paperclip size={15} /><div><strong>ملفات وروابط التنفيذ</strong><small>المصادر والتسليمات السابقة التي تحتاجها في هذه الخطوة.</small></div></div><StatusBadge tone={hasExecutionResources ? "info" : "neutral"}>{hasExecutionResources ? `${taskAssets.length + inputDeliveries.length} مرفق` : "لا يوجد"}</StatusBadge></header>
              {hasExecutionResources ? <ul className="task-resource-list">
                {inputDeliveries.map((delivery) => <li key={`delivery-${delivery.id}`}>
                  <span className="task-resource-mark"><PackageCheck size={15} /></span>
                  <div><strong>تسليم {contentStepConfig[delivery.step].label}</strong>{delivery.result_note ? <p>{delivery.result_note}</p> : null}<small>سلّمه {peopleById.get(delivery.submitted_by)?.name ?? "عضو فريق"} · {formatDate(delivery.submitted_at)}</small></div>
                  {delivery.result_url ? <a href={delivery.result_url} target="_blank" rel="noreferrer"><span>فتح التسليم<small dir="ltr">{resourceHost(delivery.result_url)}</small></span><ExternalLink size={14} /></a> : null}
                </li>)}
                {taskAssets.map((asset) => <li key={asset.id}>
                  <span className="task-resource-mark"><Link2 size={15} /></span>
                  <div><strong>{asset.title}</strong><p>{contentAssetKindConfig[asset.kind].label}{asset.notes ? ` · ${asset.notes}` : ""}</p><small>{asset.stage ? `مخصص لخطوة ${contentStepConfig[asset.stage].label}` : "مرجع مشترك"}</small></div>
                  <a href={asset.url} target="_blank" rel="noreferrer"><span>فتح الرابط<small dir="ltr">{resourceHost(asset.url)}</small></span><ExternalLink size={14} /></a>
                </li>)}
              </ul> : <p className="task-resource-empty"><Paperclip size={14} /> لم يرفق طالب المهمة ملفات أو روابط لهذه الخطوة حتى الآن.</p>}
            </div> : null}

            {task.content_item_id || standaloneTask ? <div id="delivery" ref={deliverySection} className={`task-current-delivery${currentDelivery ? " has-delivery" : ""}`} tabIndex={-1}>
              <header><div><PackageCheck size={16} /><div><strong>تسليم هذه المهمة</strong><small>{currentDelivery ? `إصدار ${currentDelivery.version} · ${formatDate(currentDelivery.submitted_at)}` : "النتيجة النهائية التي سلّمها منفّذ هذه الخطوة"}</small></div></div>{currentDelivery ? <StatusBadge tone="success">تم التسليم</StatusBadge> : <StatusBadge tone="neutral">في الانتظار</StatusBadge>}</header>
              {currentDelivery ? <div className="task-current-delivery-body"><div>{currentDelivery.result_note ? <p>{currentDelivery.result_note}</p> : <p>تم التسليم بدون ملاحظة مكتوبة.</p>}<small>بواسطة {peopleById.get(currentDelivery.submitted_by)?.name ?? "عضو فريق"}</small></div>{currentDelivery.result_url ? <a href={currentDelivery.result_url} target="_blank" rel="noreferrer"><span>{task.content_step === "publishing" ? "فتح المنشور" : "فتح ملف التسليم"}<small dir="ltr">{resourceHost(currentDelivery.result_url)}</small></span><ExternalLink size={15} /></a> : null}</div> : <p className="task-resource-empty"><PackageCheck size={14} /> {isAssignee ? task.status === "ready" ? "ابدأ المهمة أولًا، وبعدها يظهر لك زر «تم تنفيذ المهمة»." : task.status === "in_progress" ? "اضغط «تم تنفيذ المهمة» من مربع الإجراء الحالي لفتح خانة التسليم." : task.status === "review" ? "التسليم بانتظار مراجعة طالب المهمة." : "لم تسلّم نتيجة هذه المهمة بعد." : "لم يرفع المنفّذ تسليم هذه المهمة حتى الآن."}</p>}
              {showDeliveryForm ? <form className="task-delivery-compose" key={`delivery-${deliverySnapshot?.taskVersion ?? 0}-${deliverySnapshot?.deliveryVersion ?? 0}`} onSubmit={saveTaskDelivery}>
                {deliveryDraftStale ? <p className="form-notice error" role="alert">وصل تعديل جديد أثناء الكتابة. اقفل النموذج وراجع أحدث تعليمات أو تسليم قبل الحفظ.</p> : null}
                <label><span>{task.content_step === "publishing" ? "رابط المنشور" : task.content_step === "recording" ? "رابط المادة الخام" : "رابط ملف التسليم"}</span><input name="result_url" type="url" inputMode="url" dir="ltr" maxLength={2000} required={Boolean(task.content_step && contentStepsRequiringResultUrl.has(task.content_step))} defaultValue={currentDelivery?.result_url ?? ""} placeholder={task.content_step === "publishing" ? "https://instagram.com/p/..." : "https://drive.google.com/..."} disabled={working || deliveryDraftStale} /></label>
                <label><span>{task.content_step === "publishing" ? "الكابشن النهائي والهاشتاجات" : task.content_step === "recording" ? "الكابشن النهائي — اختياري الآن" : "ملاحظة التسليم — اختيارية عند وجود رابط"}</span><textarea name="result_note" rows={task.content_step === "publishing" || task.content_step === "recording" ? 6 : 3} minLength={3} maxLength={10000} required={task.content_step === "publishing"} defaultValue={currentDelivery?.result_note === "تم إرسال المادة الخام على Telegram." ? "" : currentDelivery?.result_note ?? (task.content_step === "publishing" ? workspace.contentRequest?.caption_brief : "") ?? ""} placeholder={task.content_step === "publishing" ? "اكتب النص الذي سيُنشر كما هو مع الهاشتاجات." : task.content_step === "recording" ? "لو الكابشن جاهز اكتبه هنا؛ وإن لم يكن جاهزًا سيكمله مسؤول النشر داخل مهمته." : "اكتب مكان النسخة النهائية أو أي ملاحظة مهمة لطالب المهمة."} disabled={working || deliveryDraftStale} />{task.content_step === "recording" ? <small>لن تُنشأ مهمة كابشن منفصلة. النص الذي تحفظه هنا يظهر تلقائيًا لمسؤول النشر.</small> : null}</label>
                <div className="form-actions"><Button type="submit" disabled={working || deliveryDraftStale}>{working ? <LoaderCircle className="spin" size={14} /> : <PackageCheck size={14} />} {currentDelivery && task.status === "done" ? "تحديث التسليم" : task.content_step === "publishing" ? "تأكيد تم النشر" : task.requires_review ? "حفظ وإرسال للمراجعة" : "تسليم وإغلاق المهمة"}</Button><button className="text-button" type="button" disabled={working} onClick={closeDeliveryForm}>{deliveryDraftStale ? "إغلاق ومراجعة التحديث" : "إلغاء"}</button><small>{task.status === "done" ? "يمكنك تصحيح الرابط أو الملاحظة بدون إعادة فتح المهمة." : task.requires_review ? "الحفظ يرسل النتيجة للمراجعة في نفس العملية." : "الحفظ يغلق المهمة في نفس العملية، والخانة تفضل موجودة حتى بعد اكتمال المهمة."}</small></div>
              </form> : null}
            </div> : null}

            {task.acceptance_criteria.trim() ? <div className="task-detail-copy acceptance"><strong>معيار القبول — اختياري</strong><p>{task.acceptance_criteria}</p></div> : null}
            <dl className="task-detail-facts">
              <div><dt><CircleUserRound size={13} /> المسؤول</dt><dd>{owner?.name ?? "عضو فريق"}</dd></div>
              <div><dt><CircleUserRound size={13} /> طالب المهمة</dt><dd>{requester?.name ?? "عضو فريق"}</dd></div>
              <div><dt><CalendarClock size={13} /> الموعد النهائي</dt><dd>{formatDate(task.due_at)}</dd></div>
              <div><dt><Clock3 size={13} /> تاريخ الطلب</dt><dd>{formatDate(task.created_at)}</dd></div>
              <div><dt><Clock3 size={13} /> بدأ التنفيذ</dt><dd>{formatDate(task.started_at)}</dd></div>
              <div><dt><CheckCircle2 size={13} /> اكتملت</dt><dd>{formatDate(task.completed_at)}</dd></div>
            </dl>
            {task.requires_review ? <p className="task-review-rule"><ShieldCheck size={13} /> هذه المهمة تحتاج اعتماد طالب المهمة قبل الإغلاق.</p> : <p className="task-direct-close-rule"><CheckCircle2 size={13} /> المسؤول يقدر يغلق المهمة مباشرة بعد التنفيذ.</p>}
            {task.content_step ? <span className="workflow-task-label"><FileText size={12} /> محتوى · {contentStepConfig[task.content_step].label}</span> : null}
            {task.launch_gate ? <span className="workflow-task-label launch-task-label"><Route size={12} /> إطلاق · {launchGateConfig[task.launch_gate].label}</span> : null}
            {task.crm_contact_id ? <span className="workflow-task-label crm-task-label"><ContactRound size={12} /> متابعة عميل</span> : null}
          </section>

          <section className="panel task-detail-section task-discussion-section">
            <div className="section-heading compact"><div><p className="overline">سؤال وجواب داخل المهمة</p><h2>{isAssignee ? `اسأل ${requester?.name ?? "طالب المهمة"} لو المطلوب مش واضح` : `وضّح المطلوب لـ ${owner?.name ?? "المسؤول"}`}</h2><p>كل سؤال ورد يفضل محفوظًا هنا، والطرف الآخر يصله إشعار يفتح نفس الرسالة مباشرة.</p></div><MessageSquareText size={19} /></div>
            {linkedDiscussionId && discussion.some((message) => message.id === linkedDiscussionId) ? <p className="direct-link-notice"><Route size={14} /> تم فتح الرسالة المطلوبة داخل نقاش المهمة.</p> : null}
            {discussion.length ? <ol className="task-discussion-list">{discussion.map((message) => {
              const author = peopleById.get(message.author_id);
              const authorRole = message.author_id === task.owner_id ? "المسؤول عن التنفيذ" : message.author_id === task.created_by ? "طالب المهمة" : "إدارة المنصة";
              const directTarget = linkedDiscussionId === message.id;
              return <li id={`discussion-${message.id}`} data-direct-target={directTarget || undefined} tabIndex={directTarget ? -1 : undefined} key={message.id}>
                <span className="task-discussion-avatar" aria-hidden="true">{(author?.name ?? "ع").trim().charAt(0)}</span>
                <div><header><strong>{author?.name ?? "عضو فريق"}</strong><small>{authorRole}</small><time dateTime={message.created_at}>{formatDate(message.created_at)}</time></header><p>{message.body}</p></div>
              </li>;
            })}</ol> : <p className="task-empty-proof"><MessageSquareText size={14} /> لا توجد أسئلة حتى الآن. اكتب هنا بدل ما تضيع التفاصيل في شات خارجي.</p>}
            {canDiscuss ? <form className="task-discussion-compose" onSubmit={sendDiscussionMessage}>
              <label htmlFor="task-discussion-body">{isAssignee ? "سؤالك لطالب المهمة" : "رد أو توضيح للمسؤول"}</label>
              <div><textarea id="task-discussion-body" value={discussionDraft} onChange={(event) => setDiscussionDraft(event.target.value)} minLength={2} maxLength={4000} rows={3} placeholder={isAssignee ? "مثال: هل المقاس المطلوب 1080×1920؟ وأستخدم أي رابط للمادة الخام؟" : "اكتب الرد أو التوضيح هنا، وسيصل للمسؤول إشعار مباشر."} disabled={working} /><Button type="submit" disabled={working || discussionDraft.trim().length < 2}>{working ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />} إرسال</Button></div>
            </form> : null}
          </section>

          <section className="panel task-detail-section">
            <div className="section-heading compact"><div><p className="overline">سجل التعديلات</p><h2>كل جولة تعديل مرتبطة بهذه المهمة</h2><p>طلبات تعديل مرحلة المحتوى والتعديلات العامة تظهر هنا بترتيبها الحقيقي.</p></div><StatusBadge tone={revisionTimeline.length ? "warning" : "neutral"}>{revisionTimeline.length}</StatusBadge></div>
            {revisionTimeline.length ? <ol className="task-revision-list">{revisionTimeline.map((revision) => <li key={revision.id}><span aria-hidden="true" /><div><strong>{revision.title}</strong><p>{revision.instructions}</p><small>طلبه {peopleById.get(revision.requestedBy)?.name ?? "طالب المهمة"} من {peopleById.get(revision.assignedTo)?.name ?? "المسؤول"} · {formatDate(revision.requestedAt)} · {revision.meta}</small></div></li>)}</ol> : <p className="task-empty-proof"><CheckCircle2 size={14} /> لا توجد طلبات تعديل حتى الآن.</p>}
          </section>

          <section className="panel task-detail-section">
            <div className="section-heading compact"><div><p className="overline">سجل الحالة</p><h2>من غيّر ماذا ومتى</h2></div><History size={19} /></div>
            {events.length ? <ol className="task-event-list">{events.map((event) => <li key={event.id}><span aria-hidden="true" /><div><strong>{taskEventTitle(event)}</strong><p>{peopleById.get(event.actor_id ?? "")?.name ?? "النظام"}</p><small>{formatDate(event.occurred_at)}</small></div></li>)}</ol> : <p className="task-empty-proof">لا يوجد نشاط مسجل.</p>}
          </section>
        </div>
      </div>
    </section>
  );
}
