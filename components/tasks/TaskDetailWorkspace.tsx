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
  taskTransitionLabel,
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
type TaskDelivery = Tables<"task_deliveries">;
type ContentAsset = Tables<"content_assets">;
type ContentStepDelivery = Tables<"content_step_deliveries">;
type ContentRequest = Pick<Tables<"content_items">, "id" | "intake_request" | "intake_source_url" | "caption_brief">;
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
  taskDeliveries: TaskDelivery[];
  assets: ContentAsset[];
  deliveries: ContentStepDelivery[];
  contentRequest: ContentRequest | null;
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

const deliveryInputsByStep: Partial<Record<ContentStep, ContentStep[]>> = {
  editing: ["recording"],
  scheduling: ["caption", "design"],
  publishing: ["editing", "thumbnail", "caption", "design", "scheduling"],
};

const assetInputsByStep: Partial<Record<ContentStep, ContentStep[]>> = {
  recording: ["brief", "recording"],
  editing: ["brief", "recording", "editing"],
  thumbnail: ["brief", "thumbnail"],
  caption: ["brief", "caption"],
  design: ["brief", "design"],
  scheduling: ["brief", "caption", "design", "scheduling"],
  publishing: ["brief", "recording", "editing", "thumbnail", "caption", "design", "scheduling", "publishing"],
};

const contentStepsRequiringResultUrl = new Set<ContentStep>(["editing", "thumbnail", "design", "publishing"]);

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
  const [showRevisionForm, setShowRevisionForm] = useState(false);
  const [discussionDraft, setDiscussionDraft] = useState("");
  const [error, setError] = useState<string | null>(configured ? null : "اتصال تسجيل الدخول غير متاح مؤقتًا.");
  const [notice, setNotice] = useState<string | null>(null);
  const focusedDiscussion = useRef<string | null>(null);
  const [linkedDiscussionId] = useState(() => typeof window === "undefined" ? null : new URL(window.location.href).searchParams.get("message"));

  const clearWorkspace = useCallback(() => setWorkspace(null), []);
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
        { data: taskDeliveries, error: taskDeliveriesError },
        { data: assets, error: assetsError },
        { data: deliveries, error: deliveriesError },
        { data: contentRequest, error: contentRequestError },
      ] = await Promise.all([
        supabase.from("task_events").select("*").eq("task_id", task.id).order("occurred_at", { ascending: false }).limit(100),
        supabase.from("task_discussion_messages").select("*").eq("task_id", task.id).order("created_at", { ascending: true }).limit(200),
        supabase.from("task_revision_requests").select("*").eq("task_id", task.id).order("requested_at", { ascending: false }).limit(100),
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
          ? supabase.from("content_items").select("id, intake_request, intake_source_url, caption_brief").eq("id", task.content_item_id).maybeSingle()
          : Promise.resolve({ data: null as ContentRequest | null, error: null }),
      ]);
      if (eventsError) throw eventsError;
      if (discussionError) throw discussionError;
      if (revisionsError) throw revisionsError;
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
        taskDeliveries: taskDeliveries ?? [],
        assets: assets ?? [],
        deliveries: deliveries ?? [],
        contentRequest,
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
        .on("postgres_changes", { event: "*", schema: "public", table: "content_step_deliveries", filter: `content_item_id=eq.${workspace.task.content_item_id}` }, () => void loadTaskData(session, false));
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
    if (instructions.length < 3) { setError("اكتب التعديل المطلوب بوضوح."); return; }
    setWorking(true); setError(null); setNotice(null);
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

  async function saveTaskDelivery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || !session) return;
    const form = new FormData(event.currentTarget);
    const resultNote = String(form.get("result_note") ?? "").trim();
    const resultUrl = String(form.get("result_url") ?? "").trim();
    if (!resultNote && !resultUrl) { setError("أضف رابط التسليم أو اكتب ملاحظة التسليم."); return; }
    if (resultNote && resultNote.length < 3) { setError("ملاحظة التسليم لازم تكون 3 حروف على الأقل."); return; }
    if (resultUrl && !/^https?:\/\/\S+$/i.test(resultUrl)) { setError("اكتب رابط تسليم صحيح يبدأ بـ http:// أو https://."); return; }

    if (workspace.task.content_item_id && workspace.task.content_step) {
      if (contentStepsRequiringResultUrl.has(workspace.task.content_step) && !resultUrl) {
        setError(workspace.task.content_step === "publishing" ? "أضف رابط المنشور الحقيقي قبل تأكيد النشر." : "أضف رابط ملف التسليم قبل إغلاق المهمة.");
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
    });
    if (submissionError) setError(friendlyError(submissionError));
    else {
      setNotice(workspace.taskDeliveries.length ? "تم تحديث رابط وملاحظة التسليم." : "تم حفظ رابط وملاحظة التسليم داخل المهمة.");
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
      await loadTaskData(session, false);
    }
    setWorking(false);
  }

  async function confirmTelegramRawHandoff() {
    await submitContentDelivery(
      "تم إرسال المادة الخام على Telegram.",
      "",
      "تم تأكيد إرسال المادة الخام على Telegram وفتح المونتاج تلقائيًا.",
    );
  }

  if (loading) return <section className="panel empty-state"><LoaderCircle className="spin" size={20} /><div><h2>جارٍ فتح ملف المهمة</h2><p>نحمّل التفاصيل وطلبات التعديل وسجل الحالة.</p></div></section>;
  if (!configured) return <section className="panel empty-state"><AlertTriangle size={20} /><div><h2>اتصال تسجيل الدخول غير متاح مؤقتًا</h2><p>حدّث الصفحة بعد استعادة الاتصال.</p></div></section>;
  if (!session || !workspace) return <section className="panel empty-state"><AlertTriangle size={20} /><div><h2>تعذّر فتح ملف المهمة</h2><p>{error ?? "سجّل الدخول بحساب عضو مصرح له."}</p></div><Button href="/tasks" variant="secondary">العودة للمهام</Button></section>;

  const { task, discussion, revisions, events } = workspace;
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
  const transitions = linkedWorkflow
    ? task.content_item_id ? actorTransitions.filter((status) => ["in_progress", "blocked"].includes(status)) : []
    : actorTransitions;
  const canRequestRevision = !linkedWorkflow && !isAssignee && task.status !== "cancelled" && task.status !== "backlog" && (isRequester || platformAdmin);
  const canDiscuss = !readOnly && (isAssignee || isRequester || platformAdmin);
  const owner = peopleById.get(task.owner_id);
  const requester = peopleById.get(task.created_by);
  const currentDelivery = task.content_item_id
    ? workspace.deliveries.find((delivery) => delivery.task_id === task.id) ?? null
    : workspace.taskDeliveries.find((delivery) => delivery.task_id === task.id) ?? null;
  const inputDeliverySteps = task.content_step ? deliveryInputsByStep[task.content_step] ?? [] : [];
  const inputDeliveries = workspace.deliveries.filter((delivery) => delivery.task_id !== task.id && inputDeliverySteps.includes(delivery.step));
  const inputAssetSteps = task.content_step ? assetInputsByStep[task.content_step] ?? [task.content_step] : [];
  const taskAssets = workspace.assets.filter((asset) => !asset.stage || inputAssetSteps.includes(asset.stage));
  const canonicalRequest = workspace.contentRequest?.intake_request?.trim()
    || task.description?.trim()
    || "لا يوجد شرح إضافي لهذه المهمة. ارجع لطالب المهمة من قسم السؤال والجواب إذا احتجت توضيحًا.";
  const hasExecutionResources = taskAssets.length > 0 || inputDeliveries.length > 0;
  const standaloneTask = !linkedWorkflow;
  const contentTask = Boolean(task.content_item_id && task.content_step);
  const canSubmitDelivery = !readOnly && isAssignee && !["backlog", "blocked", "cancelled"].includes(task.status)
    && (standaloneTask || contentTask);
  const canOpenContentWorkspace = workspace.membership.role === "owner" || workspace.membership.allowed_sections.includes("content");
  const linkedHref = task.content_item_id ? canOpenContentWorkspace ? `/content?content=${task.content_item_id}#content-${task.content_item_id}` : null
    : task.launch_deliverable_id ? `/campaigns?deliverable=${task.launch_deliverable_id}#deliverable-${task.launch_deliverable_id}`
      : task.launch_id ? `/campaigns?launch=${task.launch_id}#launch-${task.launch_id}`
        : task.crm_contact_id ? `/crm/${task.crm_contact_id}` : null;
  const linkedLabel = task.content_item_id ? "فتح ملف المحتوى"
    : task.launch_deliverable_id || task.launch_id ? "فتح ملف الإطلاق"
      : task.crm_contact_id ? "فتح ملف العميل" : null;

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
          {transitions.length ? <label className="task-detail-status"><span>الإجراء التالي</span><select value={task.status} disabled={working} onChange={(event) => void changeStatus(event.target.value as TaskStatus)}><option value={task.status}>{taskStatusLabel(task.status, task.content_step)} — الحالية</option>{transitions.map((status) => <option value={status} key={status}>{taskTransitionLabel(task.status, status)}</option>)}</select></label> : null}
          {task.status === "review" && isAssignee ? <p className="task-review-waiting">أرسلت المهمة للمراجعة. الاعتماد أو طلب التعديل عند طالب المهمة.</p> : null}
          {canRequestRevision ? <Button type="button" variant="secondary" onClick={() => setShowRevisionForm((value) => !value)}><MessageSquareText size={15} /> طلب تعديل</Button> : null}
          {linkedHref && linkedLabel ? <Button href={linkedHref} variant="secondary"><Route size={15} /> {linkedLabel}</Button> : null}
          {!transitions.length && !canRequestRevision && !linkedHref ? <p className="task-action-note">لا يوجد إجراء مطلوب من حسابك في الحالة الحالية.</p> : null}
        </aside>

        <div className="task-detail-main">
          {showRevisionForm && canRequestRevision ? <section className="panel task-detail-section task-revision-compose">
            <div className="section-heading compact"><div><p className="overline">تعليمات واضحة للمسؤول</p><h2>ما التعديل المطلوب؟</h2><p>بعد الإرسال ترجع المهمة إلى التنفيذ تلقائيًا لو كانت مكتملة أو تحت المراجعة أو متوقفة.</p></div><MessageSquareText size={19} /></div>
            <form onSubmit={requestRevision}>
              <label><span>تفاصيل التعديل</span><textarea name="instructions" required minLength={3} maxLength={5000} rows={5} placeholder="مثال: عدّل أول 10 ثوانٍ، واحذف الجزء من 00:22 إلى 00:38، ثم ارفع النسخة الجديدة على نفس الرابط." /></label>
              <div className="form-actions"><Button type="submit" disabled={working}>{working ? <LoaderCircle className="spin" size={14} /> : <Send size={14} />} إرسال التعديل للمسؤول</Button><button className="text-button" type="button" onClick={() => setShowRevisionForm(false)}>إلغاء</button></div>
            </form>
          </section> : null}

          <section className="panel task-detail-section task-requirements-section">
            <div className="section-heading compact"><div><p className="overline">المطلوب الآن</p><h2>{isAssignee ? "نفّذ المطلوب بدون بحث أو تخمين" : isRequester ? "الطلب والتسليم في مكان واحد" : "كل المطلوب للتنفيذ"}</h2><p>شرح المهمة أولًا، ثم الملفات والمصادر، وبعدها التسليم النهائي بوضوح.</p></div><FileText size={19} /></div>
            <div className="task-detail-instructions">
              <span><FileText size={14} /> كل المطلوب والروابط</span>
              <p><LinkifiedText text={canonicalRequest} /></p>
              {workspace.contentRequest?.intake_source_url ? <a className="task-original-source" href={workspace.contentRequest.intake_source_url} target="_blank" rel="noreferrer">فتح رسالة Telegram الأصلية <ExternalLink size={12} /></a> : null}
            </div>

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

            {task.content_item_id || standaloneTask ? <div className={`task-current-delivery${currentDelivery ? " has-delivery" : ""}`}>
              <header><div><PackageCheck size={16} /><div><strong>تسليم هذه المهمة</strong><small>{currentDelivery ? `إصدار ${currentDelivery.version} · ${formatDate(currentDelivery.submitted_at)}` : "النتيجة النهائية التي سلّمها منفّذ هذه الخطوة"}</small></div></div>{currentDelivery ? <StatusBadge tone="success">تم التسليم</StatusBadge> : <StatusBadge tone="neutral">في الانتظار</StatusBadge>}</header>
              {currentDelivery ? <div className="task-current-delivery-body"><div>{currentDelivery.result_note ? <p>{currentDelivery.result_note}</p> : <p>تم التسليم بدون ملاحظة مكتوبة.</p>}<small>بواسطة {peopleById.get(currentDelivery.submitted_by)?.name ?? "عضو فريق"}</small></div>{currentDelivery.result_url ? <a href={currentDelivery.result_url} target="_blank" rel="noreferrer"><span>{task.content_step === "publishing" ? "فتح المنشور" : "فتح ملف التسليم"}<small dir="ltr">{resourceHost(currentDelivery.result_url)}</small></span><ExternalLink size={15} /></a> : null}</div> : <p className="task-resource-empty"><PackageCheck size={14} /> {isAssignee ? "لم تسلّم نتيجة هذه المهمة بعد. يمكنك التسليم من هنا مباشرة." : "لم يرفع المنفّذ تسليم هذه المهمة حتى الآن."}</p>}
              {canSubmitDelivery && task.content_step === "recording" && !currentDelivery ? <div className="task-telegram-handoff"><Button type="button" disabled={working} onClick={() => void confirmTelegramRawHandoff()}>{working ? <LoaderCircle className="spin" size={14} /> : <Send size={14} />} أرسلت المادة الخام على Telegram</Button><small>ضغطة واحدة تكفي؛ رابط رسالة Telegram اختياري.</small></div> : null}
              {canSubmitDelivery ? <form className="task-delivery-compose" key={`delivery-${currentDelivery?.version ?? 0}`} onSubmit={saveTaskDelivery}>
                <label><span>{task.content_step === "publishing" ? "رابط المنشور" : task.content_step === "recording" ? "رابط رسالة أو ملف المادة الخام — اختياري" : "رابط ملف التسليم"}</span><input name="result_url" type="url" inputMode="url" dir="ltr" maxLength={2000} required={Boolean(task.content_step && contentStepsRequiringResultUrl.has(task.content_step))} defaultValue={currentDelivery?.result_url ?? ""} placeholder={task.content_step === "publishing" ? "https://instagram.com/p/..." : task.content_step === "recording" ? "https://t.me/c/..." : "https://drive.google.com/..."} disabled={working} /></label>
                <label><span>{task.content_step === "publishing" ? "الكابشن النهائي والهاشتاجات" : task.content_step === "recording" ? "الكابشن النهائي — اختياري الآن" : "ملاحظة التسليم — اختيارية عند وجود رابط"}</span><textarea name="result_note" rows={task.content_step === "publishing" || task.content_step === "recording" ? 6 : 3} minLength={3} maxLength={10000} required={task.content_step === "publishing"} defaultValue={currentDelivery?.result_note === "تم إرسال المادة الخام على Telegram." ? "" : currentDelivery?.result_note ?? (task.content_step === "publishing" ? workspace.contentRequest?.caption_brief : "") ?? ""} placeholder={task.content_step === "publishing" ? "اكتب النص الذي سيُنشر كما هو مع الهاشتاجات." : task.content_step === "recording" ? "لو الكابشن جاهز اكتبه هنا؛ وإن لم يكن جاهزًا سيكمله مسؤول النشر داخل مهمته." : "اكتب مكان النسخة النهائية أو أي ملاحظة مهمة لطالب المهمة."} disabled={working} />{task.content_step === "recording" ? <small>لن تُنشأ مهمة كابشن منفصلة. النص الذي تحفظه هنا يظهر تلقائيًا لمسؤول النشر.</small> : null}</label>
                <div className="form-actions"><Button type="submit" disabled={working}>{working ? <LoaderCircle className="spin" size={14} /> : <PackageCheck size={14} />} {currentDelivery ? "تحديث التسليم" : task.content_step === "publishing" ? "تأكيد تم النشر" : "تسليم وإغلاق المهمة"}</Button><small>الخانة تفضل موجودة حتى بعد اكتمال المهمة.</small></div>
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
            <div className="section-heading compact"><div><p className="overline">طلبات التعديل</p><h2>تعليمات لا تضيع في الشات</h2></div><StatusBadge tone={revisions.length ? "warning" : "neutral"}>{revisions.length}</StatusBadge></div>
            {revisions.length ? <ol className="task-revision-list">{revisions.map((revision) => <li key={revision.id}><span aria-hidden="true" /><div><strong>{peopleById.get(revision.requested_by)?.name ?? "طالب المهمة"}</strong><p>{revision.instructions}</p><small>{formatDate(revision.requested_at)} · على نسخة v{revision.task_version}</small></div></li>)}</ol> : <p className="task-empty-proof"><CheckCircle2 size={14} /> لا توجد طلبات تعديل حتى الآن.</p>}
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
