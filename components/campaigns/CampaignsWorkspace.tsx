"use client";

import type { Session } from "@supabase/supabase-js";
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  CheckCircle2,
  CircleUserRound,
  Film,
  FileText,
  ListChecks,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
  Route,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { currentUuidDeepLink } from "../../lib/deep-links";
import {
  launchGateConfig,
  launchGates,
  launchBudgetCategoryConfig,
  launchDeliverableKindConfig,
  launchDocumentStatusConfig,
  launchStatusConfig,
  launchTypeConfig,
  type LaunchBudgetCategory,
  type LaunchDeliverableKind,
  type LaunchDocumentStatus,
  type LaunchGate,
  type LaunchType,
} from "../../lib/launches";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Tables } from "../../lib/supabase/database.types";
import { getSupabaseFunctionErrorMessage } from "../../lib/supabase/function-errors";
import { useWorkspaceAuth } from "../../lib/supabase/use-workspace-auth";
import { canManageAllTaskExecution, canManageTasks, taskStatusConfig } from "../../lib/tasks";
import { Button } from "../ui/Button";
import { StatusBadge } from "../ui/StatusBadge";

type Launch = Tables<"launches">;
type LaunchContentLink = Tables<"launch_content_items">;
type LaunchDocument = Tables<"launch_documents">;
type LaunchDeliverable = Tables<"launch_deliverables">;
type LaunchDeliverableDependency = Tables<"launch_deliverable_dependencies">;
type ContentItem = Tables<"content_items">;
type Task = Tables<"tasks">;
type Membership = Tables<"memberships">;
type Organization = Tables<"organizations">;

type TeamPerson = {
  id: string;
  name: string;
  role: Membership["role"];
};

type Workspace = {
  organization: Organization;
  membership: Membership;
  people: TeamPerson[];
};
type LaunchView = "current" | "archive";

const assignmentFields: Array<{ gate: LaunchGate; name: string }> = [
  { gate: "strategy", name: "strategy_owner_id" },
  { gate: "offer", name: "offer_owner_id" },
  { gate: "registration", name: "registration_owner_id" },
  { gate: "delivery", name: "delivery_owner_id" },
  { gate: "promotion", name: "promotion_owner_id" },
  { gate: "tracking", name: "tracking_owner_id" },
  { gate: "go_no_go", name: "go_no_go_owner_id" },
  { gate: "launch_day", name: "launch_day_owner_id" },
];

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) return String(error.message);
  return "حدث خطأ غير متوقع.";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function toLocalDateTimeInput(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function optionalNumber(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text === "" ? null : Number(text);
}

function formatTarget(value: number, unit: string) {
  return new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 }).format(value) + ` ${unit}`;
}

export function CampaignsWorkspace() {
  const configured = isSupabaseConfigured();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [launches, setLaunches] = useState<Launch[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [contentItems, setContentItems] = useState<ContentItem[]>([]);
  const [contentLinks, setContentLinks] = useState<LaunchContentLink[]>([]);
  const [documents, setDocuments] = useState<LaunchDocument[]>([]);
  const [deliverables, setDeliverables] = useState<LaunchDeliverable[]>([]);
  const [deliverableDependencies, setDeliverableDependencies] = useState<LaunchDeliverableDependency[]>([]);
  const [contentSelection, setContentSelection] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(configured);
  const [working, setWorking] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editFormId, setEditFormId] = useState<string | null>(null);
  const [documentFormId, setDocumentFormId] = useState<string | null>(null);
  const [deliverableFormId, setDeliverableFormId] = useState<string | null>(null);
  const [deliverableKindsByLaunch, setDeliverableKindsByLaunch] = useState<Record<string, LaunchDeliverableKind>>({});
  const [submissionFormId, setSubmissionFormId] = useState<string | null>(null);
  const [launchView, setLaunchView] = useState<LaunchView>("current");
  const [linkedLaunchId] = useState(() => currentUuidDeepLink("launch", "launch"));
  const [linkedDeliverableId] = useState(() => currentUuidDeepLink("deliverable", "deliverable"));
  const [error, setError] = useState<string | null>(configured ? null : "لم يتم إعداد اتصال Supabase لهذه النسخة.");
  const [notice, setNotice] = useState<string | null>(null);
  const [renderNow] = useState(() => Date.now());
  const [defaultStart] = useState(() => toLocalDateTimeInput(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)));
  const [defaultEnd] = useState(() => toLocalDateTimeInput(new Date(Date.now() + (30 * 24 + 2) * 60 * 60 * 1000)));
  const openedCampaignLink = useRef<string | null>(null);

  const clearWorkspace = useCallback(() => {
    setWorkspace(null);
    setLaunches([]);
    setTasks([]);
    setContentItems([]);
    setContentLinks([]);
    setDocuments([]);
    setDeliverables([]);
    setDeliverableDependencies([]);
  }, []);

  const clearTransientState = useCallback(() => setNotice(null), []);

  const refreshLaunches = useCallback(async (organizationId: string) => {
    const supabase = getSupabaseBrowserClient();
    const [launchResult, taskResult, contentResult, linkResult, documentResult, deliverableResult, dependencyResult] = await Promise.all([
      supabase
        .from("launches")
        .select("*")
        .eq("organization_id", organizationId)
        .order("starts_at", { ascending: true }),
      supabase
        .from("tasks")
        .select("*")
        .eq("organization_id", organizationId)
        .or("launch_id.not.is.null,launch_deliverable_id.not.is.null")
        .order("due_at", { ascending: true }),
      supabase
        .from("content_items")
        .select("*")
        .eq("organization_id", organizationId)
        .order("publish_at", { ascending: true }),
      supabase
        .from("launch_content_items")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: true }),
      supabase.from("launch_documents").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }),
      supabase.from("launch_deliverables").select("*").eq("organization_id", organizationId).order("due_at", { ascending: true }),
      supabase.from("launch_deliverable_dependencies").select("*").eq("organization_id", organizationId).order("created_at", { ascending: true }),
    ]);

    if (launchResult.error) throw launchResult.error;
    if (taskResult.error) throw taskResult.error;
    if (contentResult.error) throw contentResult.error;
    if (linkResult.error) throw linkResult.error;
    if (documentResult.error) throw documentResult.error;
    if (deliverableResult.error) throw deliverableResult.error;
    if (dependencyResult.error) throw dependencyResult.error;

    setLaunches(launchResult.data ?? []);
    setTasks(taskResult.data ?? []);
    setContentItems(contentResult.data ?? []);
    setContentLinks(linkResult.data ?? []);
    setDocuments(documentResult.data ?? []);
    setDeliverables(deliverableResult.data ?? []);
    setDeliverableDependencies(dependencyResult.data ?? []);
  }, []);

  const loadWorkspace = useCallback(async (activeSession: Session) => {
    const supabase = getSupabaseBrowserClient();
    setLoading(true);
    setError(null);

    try {
      const { data: membership, error: membershipError } = await supabase
        .from("memberships")
        .select("*")
        .eq("user_id", activeSession.user.id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();

      if (membershipError) throw membershipError;
      if (!membership) {
        setWorkspace(null);
        setLaunches([]);
        setTasks([]);
        setContentItems([]);
        setContentLinks([]);
        setDocuments([]);
        setDeliverables([]);
        setDeliverableDependencies([]);
        return;
      }

      const [organizationResult, membersResult] = await Promise.all([
        supabase.from("organizations").select("*").eq("id", membership.organization_id).single(),
        supabase
          .from("memberships")
          .select("user_id, role")
          .eq("organization_id", membership.organization_id)
          .eq("status", "active"),
      ]);

      if (organizationResult.error) throw organizationResult.error;
      if (membersResult.error) throw membersResult.error;

      const memberIds = (membersResult.data ?? []).map((member) => member.user_id);
      const { data: profiles, error: profilesError } = memberIds.length
        ? await supabase.from("profiles").select("id, full_name").in("id", memberIds)
        : { data: [], error: null };

      if (profilesError) throw profilesError;

      const people = (membersResult.data ?? []).map((member) => ({
        id: member.user_id,
        role: member.role,
        name:
          profiles?.find((profile) => profile.id === member.user_id)?.full_name
          ?? (member.user_id === activeSession.user.id ? activeSession.user.email : null)
          ?? "عضو فريق",
      }));

      setWorkspace({
        organization: organizationResult.data,
        membership,
        people,
      });
      await refreshLaunches(membership.organization_id);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [refreshLaunches]);

  const session = useWorkspaceAuth({
    configured,
    loadWorkspace,
    clearWorkspace,
    setLoading,
    clearTransientState,
  });

  useEffect(() => {
    const linkedDeliverable = linkedDeliverableId ? deliverables.find((deliverable) => deliverable.id === linkedDeliverableId) ?? null : null;
    const targetLaunchId = linkedLaunchId ?? linkedDeliverable?.launch_id ?? null;
    if (!targetLaunchId) return;
    const targetLaunch = launches.find((launch) => launch.id === targetLaunchId);
    if (!targetLaunch) return;
    const targetView = ["completed", "cancelled"].includes(targetLaunch.status) ? "archive" : "current";
    if (launchView !== targetView) {
      const frame = window.requestAnimationFrame(() => setLaunchView(targetView));
      return () => window.cancelAnimationFrame(frame);
    }
    const targetKey = linkedDeliverableId ?? targetLaunchId;
    if (openedCampaignLink.current === targetKey) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(linkedDeliverableId ? `deliverable-${linkedDeliverableId}` : `launch-${targetLaunchId}`);
      if (!target) return;
      openedCampaignLink.current = targetKey;
      target.scrollIntoView({ block: "center" });
      target.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [deliverables, launchView, launches, linkedDeliverableId, linkedLaunchId]);

  useEffect(() => {
    if (!workspace) return;
    const supabase = getSupabaseBrowserClient();
    const refresh = () => void refreshLaunches(workspace.organization.id);
    const channel = supabase
      .channel(`launches:${workspace.organization.id}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "launches",
        filter: `organization_id=eq.${workspace.organization.id}`,
      }, refresh)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "tasks",
        filter: `organization_id=eq.${workspace.organization.id}`,
      }, refresh)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "launch_content_items",
        filter: `organization_id=eq.${workspace.organization.id}`,
      }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "launch_documents", filter: `organization_id=eq.${workspace.organization.id}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "launch_deliverables", filter: `organization_id=eq.${workspace.organization.id}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "launch_deliverable_dependencies", filter: `organization_id=eq.${workspace.organization.id}` }, refresh)
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refreshLaunches, workspace]);

  const tasksByLaunch = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    for (const task of tasks) {
      if (!task.launch_id) continue;
      const group = grouped.get(task.launch_id) ?? [];
      group.push(task);
      grouped.set(task.launch_id, group);
    }
    return grouped;
  }, [tasks]);

  const linksByLaunch = useMemo(() => {
    const grouped = new Map<string, LaunchContentLink[]>();
    for (const link of contentLinks) {
      const group = grouped.get(link.launch_id) ?? [];
      group.push(link);
      grouped.set(link.launch_id, group);
    }
    return grouped;
  }, [contentLinks]);

  const documentsByLaunch = useMemo(() => {
    const grouped = new Map<string, LaunchDocument[]>();
    for (const document of documents) grouped.set(document.launch_id, [...(grouped.get(document.launch_id) ?? []), document]);
    return grouped;
  }, [documents]);

  const deliverablesByLaunch = useMemo(() => {
    const grouped = new Map<string, LaunchDeliverable[]>();
    for (const deliverable of deliverables) grouped.set(deliverable.launch_id, [...(grouped.get(deliverable.launch_id) ?? []), deliverable]);
    return grouped;
  }, [deliverables]);

  const dependenciesByDeliverable = useMemo(() => {
    const grouped = new Map<string, LaunchDeliverableDependency[]>();
    for (const dependency of deliverableDependencies) grouped.set(dependency.deliverable_id, [...(grouped.get(dependency.deliverable_id) ?? []), dependency]);
    return grouped;
  }, [deliverableDependencies]);

  async function invokeLaunch(body: Record<string, unknown>, successMessage: string) {
    if (!workspace) return false;
    setWorking(true);
    setError(null);
    setNotice(null);
    const { error: commandError } = await getSupabaseBrowserClient().functions.invoke("launch-commands", { body });
    setWorking(false);
    if (commandError) {
      setError(await getSupabaseFunctionErrorMessage(commandError, "تعذّر تنفيذ أمر الإطلاق. لم يتم حفظ أي جزء من العملية."));
      return false;
    }
    setNotice(successMessage);
    await refreshLaunches(workspace.organization.id);
    return true;
  }

  async function saveGateDocument(event: FormEvent<HTMLFormElement>, launch: Launch) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const saved = await invokeLaunch({
      action: "save_gate_document",
      launch_id: launch.id,
      gate: String(form.get("gate") ?? "strategy") as LaunchGate,
      title: String(form.get("title") ?? "").trim(),
      summary: String(form.get("summary") ?? "").trim(),
      document_url: String(form.get("document_url") ?? "").trim(),
      status: String(form.get("status") ?? "submitted") as LaunchDocumentStatus,
    }, "تم حفظ مخرج البوابة داخل الإطلاق وأصبح مرئيًا للفريق.");
    if (saved) {
      formElement.reset();
      setDocumentFormId(null);
    }
  }

  async function createDeliverable(event: FormEvent<HTMLFormElement>, launch: Launch) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const dueAt = new Date(String(form.get("due_at") ?? ""));
    const kind = String(form.get("kind") ?? "other") as LaunchDeliverableKind;
    if (Number.isNaN(dueAt.getTime()) || dueAt.getTime() <= Date.now()) {
      setError("حدد موعد تسليم صحيحًا في المستقبل.");
      return;
    }
    const firstPublishAt = kind === "social_post"
      ? new Date(String(form.get("first_publish_at") ?? ""))
      : null;
    if (firstPublishAt && (Number.isNaN(firstPublishAt.getTime()) || firstPublishAt.getTime() > dueAt.getTime())) {
      setError("أول موعد نشر يجب أن يكون صحيحًا ويسبق الموعد النهائي للدفعة.");
      return;
    }
    const created = await invokeLaunch({
      action: "create_deliverable",
      launch_id: launch.id,
      kind,
      title: String(form.get("title") ?? "").trim(),
      brief: String(form.get("brief") ?? "").trim(),
      channel: String(form.get("channel") ?? "").trim(),
      destination: String(form.get("destination") ?? "").trim(),
      planned_quantity: Number(form.get("planned_quantity") ?? 1),
      owner_id: String(form.get("owner_id") ?? ""),
      due_at: dueAt.toISOString(),
      budget_category: String(form.get("budget_category") ?? "production") as LaunchBudgetCategory,
      budget_amount: Number(form.get("budget_amount") ?? 0),
      currency: String(form.get("currency") ?? launch.currency).trim().toUpperCase(),
      depends_on_deliverable_id: String(form.get("depends_on_deliverable_id") ?? ""),
      ...(kind === "social_post" ? {
        first_publish_at: firstPublishAt!.toISOString(),
        goal: String(form.get("goal") ?? "").trim(),
        hook: String(form.get("hook") ?? "").trim(),
        cta: String(form.get("cta") ?? "").trim(),
        copy_brief: String(form.get("copy_brief") ?? "").trim(),
        design_brief: String(form.get("design_brief") ?? "").trim(),
        platforms: form.getAll("platforms").map(String),
        brief_owner_id: String(form.get("brief_owner_id") ?? ""),
        caption_owner_id: String(form.get("caption_owner_id") ?? ""),
        design_owner_id: String(form.get("design_owner_id") ?? ""),
        scheduling_owner_id: String(form.get("scheduling_owner_id") ?? ""),
        publishing_owner_id: String(form.get("publishing_owner_id") ?? ""),
        creation_request_id: crypto.randomUUID(),
      } : {}),
    }, kind === "social_post"
      ? "تم إنشاء بند البوستات وكروت المحتوى ومراحل التنفيذ تلقائيًا."
      : "تم إنشاء مخرج الإطلاق ومهمته واعتماديته معًا.");
    if (created) {
      formElement.reset();
      setDeliverableFormId(null);
    }
  }

  async function submitDeliverable(event: FormEvent<HTMLFormElement>, deliverable: LaunchDeliverable) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const submitted = await invokeLaunch({
      action: "submit_deliverable",
      deliverable_id: deliverable.id,
      result_note: String(form.get("result_note") ?? "").trim(),
      result_url: String(form.get("result_url") ?? "").trim(),
    }, "تم حفظ التسليم ونقل المهمة تلقائيًا إلى المراجعة.");
    if (submitted) {
      formElement.reset();
      setSubmissionFormId(null);
    }
  }

  async function updateLaunch(event: FormEvent<HTMLFormElement>, launch: Launch) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const startsAt = new Date(String(form.get("starts_at") ?? ""));
    const endsAt = new Date(String(form.get("ends_at") ?? ""));
    const leadTarget = optionalNumber(form.get("lead_target"));
    const salesTarget = optionalNumber(form.get("sales_target"));
    const revenueTarget = optionalNumber(form.get("revenue_target"));
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
      setError("راجع بداية الإطلاق ونهايته قبل الحفظ.");
      return;
    }
    const updated = await invokeLaunch({
      action: "update_launch",
      launch_id: launch.id,
      expected_version: launch.version,
      launch_title: String(form.get("title") ?? "").trim(),
      launch_kind: String(form.get("type") ?? launch.type),
      launch_objective: String(form.get("objective") ?? "").trim(),
      launch_audience: String(form.get("audience") ?? "").trim(),
      launch_offer: String(form.get("offer") ?? "").trim(),
      launch_cta: String(form.get("cta") ?? "").trim(),
      launch_starts_at: startsAt.toISOString(),
      launch_ends_at: endsAt.toISOString(),
      launch_lead_target: leadTarget,
      launch_sales_target: salesTarget,
      launch_revenue_target: revenueTarget,
      launch_currency: String(form.get("currency") ?? launch.currency).trim().toUpperCase(),
    }, "تم تحديث الإطلاق ومزامنة عناوين ومواعيد مهامه المفتوحة.");
    if (updated) setEditFormId(null);
  }

  async function cancelLaunch(launch: Launch) {
    const reason = window.prompt(`اكتب سبب إلغاء «${launch.title}». سيتم إغلاق مهامه مع الاحتفاظ بكل السجل:`)?.trim();
    if (!reason) return;
    if (!window.confirm("تأكيد إلغاء الإطلاق وإغلاق كل مهامه المفتوحة؟")) return;
    await invokeLaunch({
      action: "cancel_launch",
      launch_id: launch.id,
      expected_version: launch.version,
      cancellation_reason: reason,
    }, "تم إلغاء الإطلاق وإغلاق مهامه مع الاحتفاظ بكل المخرجات وسجل التدقيق.");
  }

  async function createLaunch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace) return;

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const startsAt = new Date(String(form.get("starts_at") ?? ""));
    const endsAt = new Date(String(form.get("ends_at") ?? ""));
    const leadTarget = optionalNumber(form.get("lead_target"));
    const salesTarget = optionalNumber(form.get("sales_target"));
    const revenueTarget = optionalNumber(form.get("revenue_target"));

    if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= Date.now() + 24 * 60 * 60 * 1000) {
      setError("بداية الإطلاق يجب أن تكون بعد 24 ساعة على الأقل.");
      return;
    }
    if (Number.isNaN(endsAt.getTime()) || endsAt.getTime() <= startsAt.getTime()) {
      setError("نهاية الإطلاق يجب أن تكون بعد بدايته.");
      return;
    }
    if ((leadTarget !== null && !Number.isInteger(leadTarget)) || (salesTarget !== null && !Number.isInteger(salesTarget))) {
      setError("مستهدف العملاء والمبيعات يجب أن يكون عددًا صحيحًا.");
      return;
    }
    if ((leadTarget ?? 0) <= 0 && (salesTarget ?? 0) <= 0 && (revenueTarget ?? 0) <= 0) {
      setError("ضع مستهدفًا موجبًا واحدًا على الأقل حتى يمكن تقييم الإطلاق.");
      return;
    }

    setWorking(true);
    setError(null);
    setNotice(null);

    const body: Record<string, unknown> = {
      action: "create",
      target_organization_id: workspace.organization.id,
      launch_title: String(form.get("title") ?? "").trim(),
      launch_kind: String(form.get("type") ?? "") as LaunchType,
      launch_objective: String(form.get("objective") ?? "").trim(),
      launch_audience: String(form.get("audience") ?? "").trim(),
      launch_offer: String(form.get("offer") ?? "").trim(),
      launch_cta: String(form.get("cta") ?? "").trim(),
      launch_starts_at: startsAt.toISOString(),
      launch_ends_at: endsAt.toISOString(),
      launch_lead_target: leadTarget,
      launch_sales_target: salesTarget,
      launch_revenue_target: revenueTarget,
      launch_currency: String(form.get("currency") ?? "EGP").trim().toUpperCase(),
    };

    for (const { name } of assignmentFields) body[name] = String(form.get(name) ?? "");

    const { error: commandError } = await getSupabaseBrowserClient().functions.invoke("launch-commands", { body });
    setWorking(false);

    if (commandError) {
      setError(await getSupabaseFunctionErrorMessage(commandError, "تعذّر إنشاء الإطلاق. لم يتم حفظ أي جزء من العملية."));
      return;
    }

    formElement.reset();
    setShowCreate(false);
    setNotice("تم إنشاء الإطلاق و8 بوابات مترابطة. بوابة الاستراتيجية فقط جاهزة الآن.");
    await refreshLaunches(workspace.organization.id);
  }

  async function changeContentLink(launchId: string, contentItemId: string, attach: boolean) {
    if (!workspace || !contentItemId) return;
    setWorking(true);
    setError(null);
    setNotice(null);

    const { error: commandError } = await getSupabaseBrowserClient().functions.invoke("launch-commands", {
      body: {
        action: attach ? "attach_content" : "detach_content",
        launch_id: launchId,
        content_item_id: contentItemId,
      },
    });

    setWorking(false);
    if (commandError) {
      setError(await getSupabaseFunctionErrorMessage(commandError, "تعذّر تحديث ارتباط المحتوى بالإطلاق."));
      return;
    }

    setContentSelection((current) => ({ ...current, [launchId]: "" }));
    setNotice(attach ? "تم ربط أصل المحتوى بالإطلاق." : "تمت إزالة الرابط فقط؛ أصل المحتوى لم يُحذف.");
    await refreshLaunches(workspace.organization.id);
  }

  if (loading) {
    return <section className="workspace-state" aria-live="polite"><LoaderCircle className="spin" size={24} /><div><h2>جارٍ تحميل غرفة الإطلاق</h2><p>نجمع الخطة والبوابات والمهام والأصول المرتبطة من المصدر الحقيقي.</p></div></section>;
  }

  if (!session) {
    return (
      <section className="workspace-state workspace-onboarding">
        <LockKeyhole size={27} />
        <div><p className="overline">دخول موحد</p><h2>سجّل الدخول أولًا من قسم المهام</h2><p>الحملات تستخدم نفس الحساب والصلاحيات وسجل التدقيق، ولا يوجد دخول منفصل.</p></div>
        <Button href="/tasks"><Link2 size={16} /> الانتقال لتسجيل الدخول</Button>
      </section>
    );
  }

  if (!workspace) {
    return (
      <section className="workspace-state workspace-onboarding">
        <Route size={27} />
        <div><p className="overline">مساحة العمل مطلوبة</p><h2>أنشئ مساحة الشركة مرة واحدة</h2><p>ابدأ من قسم المهام، ثم ارجع هنا لبناء أول إطلاق حقيقي.</p></div>
        <Button href="/tasks"><Link2 size={16} /> فتح قسم المهام</Button>
      </section>
    );
  }

  const manager = canManageTasks(workspace.membership.role);
  const platformAdmin = canManageAllTaskExecution(workspace.membership.role);
  const peopleById = new Map(workspace.people.map((person) => [person.id, person]));
  const contentById = new Map(contentItems.map((item) => [item.id, item]));
  const archivedLaunches = launches.filter((launch) => ["completed", "cancelled"].includes(launch.status));
  const currentLaunches = launches.filter((launch) => !["completed", "cancelled"].includes(launch.status));
  const linkedDeliverable = linkedDeliverableId ? deliverables.find((deliverable) => deliverable.id === linkedDeliverableId) ?? null : null;
  const targetLaunchId = linkedLaunchId ?? linkedDeliverable?.launch_id ?? null;
  const targetedLaunch = targetLaunchId ? launches.find((launch) => launch.id === targetLaunchId) ?? null : null;
  const visibleLaunches = targetedLaunch ? [targetedLaunch] : launchView === "current" ? currentLaunches : archivedLaunches;

  return (
    <section className="campaigns-workspace">
      <div className="workspace-toolbar">
        <div><p className="overline">{workspace.organization.name}</p><h2>غرفة الإطلاق</h2><p>{launches.length ? `${launches.length} إطلاق حقيقي مسجل` : "لا توجد إطلاقات حقيقية بعد — أنشئ الأول عندما تتحدد الخطة والأهداف."}</p></div>
        <div className="toolbar-actions">
          <button className="icon-button" type="button" aria-label="تحديث الحملات" onClick={() => void refreshLaunches(workspace.organization.id)}><RefreshCw size={17} /></button>
          <Button href="/tasks" variant="secondary"><Route size={16} /> كل المهام</Button>
          <Button href="/content" variant="secondary"><Film size={16} /> مصنع المحتوى</Button>
          {manager ? <Button type="button" onClick={() => setShowCreate((value) => !value)}><Plus size={16} /> إطلاق جديد</Button> : null}
        </div>
      </div>

      {notice ? <p className="form-notice success" role="status">{notice}</p> : null}
      {error ? <p className="form-notice error" role="alert">{error}</p> : null}
      {targetedLaunch ? <p className="direct-link-notice" role="status"><Route size={15} /> تم فتح {linkedDeliverableId ? "البند التنفيذي" : "الإطلاق"} المطلوب مباشرة.</p> : targetLaunchId ? <p className="form-notice error" role="alert">العنصر المطلوب غير موجود أو ليس ضمن صلاحيات حسابك.</p> : null}

      <div className="workspace-view-switch">
        <div><p className="overline">تنظيم الغرفة</p><strong>الإطلاق المكتمل أو الملغي ينتقل للأرشيف تلقائيًا.</strong></div>
        <div className="segmented-control" aria-label="عرض الحملات والإطلاقات"><button type="button" className={launchView === "current" ? "active" : ""} onClick={() => setLaunchView("current")}>الحالي ({currentLaunches.length})</button><button type="button" className={launchView === "archive" ? "active" : ""} onClick={() => setLaunchView("archive")}>الأرشيف ({archivedLaunches.length})</button></div>
      </div>

      {showCreate && manager ? (
        <form className="panel launch-create-form" onSubmit={createLaunch}>
          <div className="section-heading"><div><p className="overline">قرار تجاري قبل جدول مهام</p><h2>Brief الإطلاق والخطة العكسية</h2></div><button className="text-button" type="button" onClick={() => setShowCreate(false)}>إغلاق</button></div>

          <div className="form-grid">
            <label><span>اسم الإطلاق</span><input name="title" minLength={3} maxLength={180} required placeholder="مثال: إطلاق كورس إدارة المخاطر" /></label>
            <label><span>النوع</span><select name="type" defaultValue="course">{(Object.keys(launchTypeConfig) as LaunchType[]).map((type) => <option value={type} key={type}>{launchTypeConfig[type].label}</option>)}</select></label>
            <label><span>بداية الإطلاق</span><input name="starts_at" type="datetime-local" defaultValue={defaultStart} required /></label>
            <label><span>نهاية الإطلاق</span><input name="ends_at" type="datetime-local" defaultValue={defaultEnd} required /></label>
            <label className="full-field"><span>الهدف الاستراتيجي</span><textarea name="objective" minLength={5} maxLength={1500} rows={2} required placeholder="ما النتيجة التي يجب أن يحققها الإطلاق ولماذا الآن؟" /></label>
            <label className="full-field"><span>الجمهور المحدد</span><textarea name="audience" minLength={3} maxLength={1000} rows={2} required placeholder="لمن هذا العرض تحديدًا، وما المشكلة التي يحاول حلها؟" /></label>
            <label className="full-field"><span>العرض</span><textarea name="offer" minLength={3} maxLength={1500} rows={2} required placeholder="المنتج، السعر، النتيجة الموعودة، الضمان والمكافآت إن وُجدت" /></label>
            <label className="full-field"><span>الـCTA الرئيسي</span><textarea name="cta" minLength={2} maxLength={500} rows={2} required placeholder="الفعل الواحد المطلوب من الجمهور" /></label>
          </div>

          <div className="launch-targets">
            <div><p className="overline">تعريف النجاح</p><h3>ضع مستهدفًا واحدًا على الأقل</h3><p>هذه أرقام الخطة فقط. الفعلي لن يظهر حتى يصل من مصدر موثوق أو إدخال معتمد.</p></div>
            <div className="launch-target-grid">
              <label><span>مستهدف العملاء المحتملين</span><input name="lead_target" type="number" min="0" step="1" inputMode="numeric" placeholder="اختياري" /></label>
              <label><span>مستهدف المبيعات</span><input name="sales_target" type="number" min="0" step="1" inputMode="numeric" placeholder="اختياري" /></label>
              <label><span>مستهدف الإيراد</span><input name="revenue_target" type="number" min="0" step="0.01" inputMode="decimal" placeholder="اختياري" /></label>
              <label><span>العملة</span><input name="currency" defaultValue="EGP" minLength={3} maxLength={3} pattern="[A-Za-z]{3}" dir="ltr" required /></label>
            </div>
          </div>

          <div className="assignment-block">
            <div><p className="overline">المساءلة</p><h3>مالك واحد لكل بوابة</h3><p>أثناء اختبارك الشخصي يمكن أن يكون حسابك مالكًا لكل البوابات. التوزيع جاهز عندما تقرر إدخال الفريق لاحقًا.</p></div>
            <div className="assignment-grid launch-assignment-grid">
              {assignmentFields.map(({ gate, name }) => (
                <label key={gate}><span>{launchGateConfig[gate].label}</span><select name={name} defaultValue={session.user.id} required>{workspace.people.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
              ))}
            </div>
          </div>

          <div className="form-actions"><Button type="submit" disabled={working}>{working ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />} إنشاء غرفة الإطلاق</Button><small>العملية ذرّية: الحملة و8 المهام و10 اعتماديات تُحفظ معًا أو لا يُحفظ شيء.</small></div>
        </form>
      ) : null}

      {visibleLaunches.length ? (
        <div className="launch-list workflow-entity-list">
          {visibleLaunches.map((launch) => {
            const launchTasks = [...(tasksByLaunch.get(launch.id) ?? [])].sort((a, b) => {
              const aOrder = a.launch_gate ? launchGateConfig[a.launch_gate].order : 99;
              const bOrder = b.launch_gate ? launchGateConfig[b.launch_gate].order : 99;
              return aOrder - bOrder;
            });
            const launchDocuments = documentsByLaunch.get(launch.id) ?? [];
            const launchDeliverables = deliverablesByLaunch.get(launch.id) ?? [];
            const deliverableById = new Map(launchDeliverables.map((deliverable) => [deliverable.id, deliverable]));
            const deliverableTaskById = new Map(
              tasks.filter((task) => task.launch_deliverable_id).map((task) => [task.launch_deliverable_id as string, task]),
            );
            const linkedItems = (linksByLaunch.get(launch.id) ?? [])
              .map((link) => contentById.get(link.content_item_id))
              .filter((item): item is ContentItem => Boolean(item));
            const linkedIds = new Set(linkedItems.map((item) => item.id));
            const availableContent = contentItems.filter((item) => !linkedIds.has(item.id));
            const doneCount = launchTasks.filter((task) => task.status === "done").length;
            const progress = launchTasks.length ? Math.round((doneCount / launchTasks.length) * 100) : 0;
            const activeTasks = launchTasks.filter((task) => ["ready", "in_progress", "review", "blocked"].includes(task.status));
            const blockedCount = launchTasks.filter((task) => task.status === "blocked").length;
            const overdueCount = launchTasks.filter((task) => !["done", "cancelled"].includes(task.status) && new Date(task.due_at).getTime() < renderNow).length;
            const targets = [
              launch.lead_target === null ? null : { label: "عملاء محتملون", value: formatTarget(launch.lead_target, "Lead") },
              launch.sales_target === null ? null : { label: "مبيعات", value: formatTarget(launch.sales_target, "Sale") },
              launch.revenue_target === null ? null : { label: "إيراد", value: formatTarget(launch.revenue_target, launch.currency) },
            ].filter((target): target is { label: string; value: string } => Boolean(target));
            const quantitySummary = Object.entries(launchDeliverables.reduce<Record<string, number>>((summary, deliverable) => {
              summary[deliverable.kind] = (summary[deliverable.kind] ?? 0) + deliverable.planned_quantity;
              return summary;
            }, {}));
            const budgetSummary = Object.entries(launchDeliverables.reduce<Record<string, number>>((summary, deliverable) => {
              summary[deliverable.currency] = (summary[deliverable.currency] ?? 0) + Number(deliverable.budget_amount);
              return summary;
            }, {}));
            const executionDone = launchDeliverables.filter((deliverable) => deliverableTaskById.get(deliverable.id)?.status === "done").length;
            const launchIsOpen = !["cancelled", "completed"].includes(launch.status);
            const canSaveGateOutput = launchIsOpen && (platformAdmin || launchTasks.some((task) => task.owner_id === session.user.id));
            const launchEndTime = new Date(launch.ends_at).getTime();
            const canPlanMore = manager && launchIsOpen && launchEndTime > renderNow;
            const suggestedDue = toLocalDateTimeInput(new Date(Math.min(renderNow + 7 * 24 * 60 * 60 * 1000, launchEndTime - 60 * 60 * 1000)));
            const suggestedFirstPublish = toLocalDateTimeInput(new Date(Math.min(renderNow + 24 * 60 * 60 * 1000, new Date(suggestedDue).getTime())));
            const selectedDeliverableKind = deliverableKindsByLaunch[launch.id] ?? "reel";
            const workingPeople = workspace.people.filter((person) => person.role !== "viewer");

            return (
              <article className="panel launch-card workflow-entity-card" data-card-state={launch.status} data-direct-target={(linkedLaunchId === launch.id && !linkedDeliverableId) || undefined} tabIndex={linkedLaunchId === launch.id && !linkedDeliverableId ? -1 : undefined} id={`launch-${launch.id}`} key={launch.id}>
                <header>
                  <div className="content-card-title"><span className="icon-tile"><Route size={17} /></span><div><p className="overline">{launchTypeConfig[launch.type].label} · v{launch.version}</p><h3 className="workflow-card-heading">{launch.title}</h3>{linkedLaunchId === launch.id && !linkedDeliverableId ? <span className="direct-target-label"><Route size={11} /> ده الإطلاق المطلوب</span> : null}</div></div>
                  <div className="launch-admin-actions"><StatusBadge tone={launchStatusConfig[launch.status].tone}>{launchStatusConfig[launch.status].label}</StatusBadge>{platformAdmin && !["cancelled", "completed"].includes(launch.status) ? <><button className="text-button" type="button" onClick={() => setEditFormId(editFormId === launch.id ? null : launch.id)}><Pencil size={13} /> تعديل</button><button className="text-button danger-text" type="button" disabled={working} onClick={() => void cancelLaunch(launch)}><Trash2 size={13} /> إلغاء الإطلاق</button></> : null}</div>
                </header>

                {editFormId === launch.id && platformAdmin ? <form className="launch-inline-form launch-edit-form" onSubmit={(event) => void updateLaunch(event, launch)}>
                  <div className="section-heading"><div><p className="overline">تعديل محكوم</p><h4>بيانات الإطلاق والأهداف</h4></div><button className="text-button" type="button" onClick={() => setEditFormId(null)}>إغلاق</button></div>
                  <label><span>اسم الإطلاق</span><input name="title" required minLength={3} maxLength={180} defaultValue={launch.title} /></label>
                  <label><span>النوع</span><select name="type" defaultValue={launch.type}>{(Object.keys(launchTypeConfig) as LaunchType[]).map((type) => <option key={type} value={type}>{launchTypeConfig[type].label}</option>)}</select></label>
                  <label><span>البداية</span><input name="starts_at" type="datetime-local" required defaultValue={toLocalDateTimeInput(new Date(launch.starts_at))} /></label>
                  <label><span>النهاية</span><input name="ends_at" type="datetime-local" required defaultValue={toLocalDateTimeInput(new Date(launch.ends_at))} /></label>
                  <label className="wide"><span>الهدف</span><textarea name="objective" required minLength={5} maxLength={1500} defaultValue={launch.objective} /></label>
                  <label className="wide"><span>الجمهور</span><textarea name="audience" required minLength={3} maxLength={1000} defaultValue={launch.audience} /></label>
                  <label className="wide"><span>العرض</span><textarea name="offer" required minLength={3} maxLength={1500} defaultValue={launch.offer} /></label>
                  <label className="wide"><span>الـCTA</span><textarea name="cta" required minLength={2} maxLength={500} defaultValue={launch.primary_cta} /></label>
                  <label><span>مستهدف العملاء</span><input name="lead_target" type="number" min="0" step="1" defaultValue={launch.lead_target ?? ""} /></label>
                  <label><span>مستهدف المبيعات</span><input name="sales_target" type="number" min="0" step="1" defaultValue={launch.sales_target ?? ""} /></label>
                  <label><span>مستهدف الإيراد</span><input name="revenue_target" type="number" min="0" step="0.01" defaultValue={launch.revenue_target ?? ""} /></label>
                  <label><span>العملة</span><input name="currency" required minLength={3} maxLength={3} defaultValue={launch.currency} dir="ltr" /></label>
                  <div className="form-actions wide"><Button type="submit" disabled={working}>{working ? <LoaderCircle className="spin" size={14} /> : <CheckCircle2 size={14} />} حفظ التعديلات</Button><small>التعديل مسجل بإصدار جديد؛ الإطلاق الملغي أو المكتمل يظل للقراءة فقط.</small></div>
                </form> : null}

                {launch.status === "cancelled" && launch.cancellation_reason ? <p className="launch-risk"><AlertTriangle size={15} /> سبب الإلغاء: {launch.cancellation_reason}</p> : null}

                <div className="launch-summary-grid">
                  <div><small>الهدف</small><p>{launch.objective}</p></div>
                  <div><small>الجمهور</small><p>{launch.audience}</p></div>
                  <div><small>العرض</small><p>{launch.offer}</p></div>
                  <div><small>الـCTA</small><p>{launch.primary_cta}</p></div>
                </div>

                <div className="launch-control-strip">
                  <div><strong>{progress}%</strong><span>اكتمل {doneCount} من {launchTasks.length} بوابات</span></div>
                  <div className="content-progress-track" aria-label={`نسبة جاهزية الإطلاق ${progress}%`}><span style={{ width: `${progress}%` }} /></div>
                  <div className="launch-dates"><span><CalendarClock size={14} /> يبدأ {formatDate(launch.starts_at)}</span><span>ينتهي {formatDate(launch.ends_at)}</span></div>
                </div>

                {(blockedCount || overdueCount) ? <p className="launch-risk"><AlertTriangle size={15} /> يوجد {blockedCount ? `${blockedCount} متوقف` : ""}{blockedCount && overdueCount ? " و" : ""}{overdueCount ? `${overdueCount} متأخر` : ""}. قرار Go / No-Go لن يفتح قبل إغلاق الاعتماديات.</p> : null}

                <ol className="launch-gates" aria-label="بوابات جاهزية الإطلاق">
                  {launchGates.map((gate) => {
                    const task = launchTasks.find((candidate) => candidate.launch_gate === gate);
                    const active = task ? ["ready", "in_progress", "review", "blocked"].includes(task.status) : false;
                    return (
                      <li className={`${task?.status === "done" ? "done" : ""} ${active ? "active" : ""} ${task?.status === "blocked" ? "blocked" : ""}`} key={gate}>
                        <span>{task?.status === "done" ? <CheckCircle2 size={14} /> : launchGateConfig[gate].order}</span>
                        <strong>{launchGateConfig[gate].shortLabel}</strong>
                        <small>{task ? peopleById.get(task.owner_id)?.name ?? "عضو فريق" : "—"}</small>
                      </li>
                    );
                  })}
                </ol>

                <section className="launch-execution-section">
                  <div className="launch-execution-heading"><div><p className="overline">مخرجات البوابات</p><h4>هنا تُحفظ الاستراتيجية وباقي قرارات الإطلاق</h4><p>كل تسليم يبقى داخل الكورس بإصداره وحالته ورابطه؛ إكمال مهمة البوابة يتطلب وجود مخرج محفوظ.</p></div>{canSaveGateOutput ? <Button type="button" variant="secondary" onClick={() => setDocumentFormId(documentFormId === launch.id ? null : launch.id)}><FileText size={14} /> إضافة مخرج بوابة</Button> : null}</div>
                  {documentFormId === launch.id && canSaveGateOutput ? <form className="launch-inline-form" onSubmit={(event) => void saveGateDocument(event, launch)}>
                    <label><span>البوابة</span><select name="gate" defaultValue="strategy">{launchGates.map((gate) => <option value={gate} key={gate}>{launchGateConfig[gate].label}</option>)}</select></label>
                    <label><span>حالة المخرج</span><select name="status" defaultValue={platformAdmin ? "approved" : "submitted"}>{(Object.keys(launchDocumentStatusConfig) as LaunchDocumentStatus[]).filter((status) => platformAdmin || status !== "approved").map((status) => <option value={status} key={status}>{launchDocumentStatusConfig[status].label}</option>)}</select></label>
                    <label className="wide"><span>عنوان المخرج</span><input name="title" minLength={3} maxLength={180} required placeholder="مثال: الاستراتيجية التسويقية المعتمدة لإطلاق كورس أيمن" /></label>
                    <label className="wide"><span>القرار والملخص التنفيذي</span><textarea name="summary" minLength={5} maxLength={10000} rows={4} required placeholder="الرسالة، الجمهور، الزوايا، القنوات، الأهداف والقرارات التي سيعمل عليها الفريق…" /></label>
                    <label className="wide"><span>رابط الملف أو المستند — اختياري</span><input name="document_url" type="url" dir="ltr" maxLength={2000} placeholder="https://drive.google.com/..." /></label>
                    <div className="form-actions"><Button type="submit" disabled={working}><Upload size={14} /> حفظ داخل الإطلاق</Button><button className="text-button" type="button" onClick={() => setDocumentFormId(null)}>إلغاء</button></div>
                  </form> : null}
                  {launchDocuments.length ? <div className="launch-document-list">{launchDocuments.map((document) => <article key={document.id}><header><div><strong>{document.title}</strong><small>{launchGateConfig[document.gate].label} · إصدار {document.version}</small></div><StatusBadge tone={launchDocumentStatusConfig[document.status].tone}>{launchDocumentStatusConfig[document.status].label}</StatusBadge></header><p>{document.summary}</p><footer><span>{peopleById.get(document.created_by)?.name ?? "عضو فريق"} · {formatDate(document.created_at)}</span>{document.document_url ? <a href={document.document_url} target="_blank" rel="noreferrer">فتح الملف <Link2 size={12} /></a> : null}</footer></article>)}</div> : <p className="launch-assets-empty">لم يُحفظ مخرج للاستراتيجية أو لأي بوابة بعد. ابدأ بالاستراتيجية حتى يعرف الفريق ما الذي سينفذه.</p>}
                </section>

                <section className="launch-execution-section">
                  <div className="launch-execution-heading"><div><p className="overline">الخطة التنفيذية</p><h4>الكميات والمواعيد والميزانية والاعتماديات</h4><p>{launchDeliverables.length ? `اكتمل ${executionDone} من ${launchDeliverables.length} بنود تنفيذية.` : "حوّل الاستراتيجية إلى مخرجات قابلة للتسليم؛ كل بند ينشئ مهمة تلقائيًا."}</p></div>{canPlanMore ? <Button type="button" onClick={() => setDeliverableFormId(deliverableFormId === launch.id ? null : launch.id)}><Plus size={14} /> إضافة بند تنفيذي</Button> : null}</div>
                  {quantitySummary.length || budgetSummary.length ? <div className="launch-execution-kpis"><div><ListChecks size={16} /><span>{quantitySummary.map(([kind, quantity]) => `${quantity} ${launchDeliverableKindConfig[kind as LaunchDeliverableKind].label}`).join(" · ")}</span></div><div><Banknote size={16} /><span>{budgetSummary.map(([currency, amount]) => formatTarget(amount, currency)).join(" · ") || "لا توجد ميزانية مرصودة"}</span></div></div> : null}
                  {deliverableFormId === launch.id && canPlanMore ? <form className="launch-inline-form launch-deliverable-form" onSubmit={(event) => void createDeliverable(event, launch)}>
                    <label><span>نوع المخرج</span><select name="kind" value={selectedDeliverableKind} onChange={(event) => setDeliverableKindsByLaunch((current) => ({ ...current, [launch.id]: event.target.value as LaunchDeliverableKind }))}>{(Object.keys(launchDeliverableKindConfig) as LaunchDeliverableKind[]).map((kind) => <option value={kind} key={kind}>{launchDeliverableKindConfig[kind].label}</option>)}</select></label>
                    <label><span>الكمية المطلوبة</span><input name="planned_quantity" type="number" min="1" max={selectedDeliverableKind === "social_post" ? 60 : 500} step="1" defaultValue="1" required /></label>
                    <label className="wide"><span>عنوان البند</span><input name="title" minLength={3} maxLength={180} required placeholder="مثال: ريلز التسجيل المبكر للكورس" /></label>
                    {selectedDeliverableKind !== "social_post" ? <label><span>القناة</span><input name="channel" minLength={2} maxLength={120} placeholder="Instagram / Telegram / Meta" /></label> : null}
                    <label><span>مكان النشر أو التسليم</span><input name="destination" minLength={2} maxLength={500} placeholder="حساب Instagram أو فولدر Drive" /></label>
                    <label><span>{selectedDeliverableKind === "social_post" ? "مسؤول الدفعة" : "المسؤول"}</span><select name="owner_id" defaultValue={session.user.id}>{workingPeople.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
                    {selectedDeliverableKind === "social_post" ? <label><span>أول موعد نشر</span><input name="first_publish_at" type="datetime-local" defaultValue={suggestedFirstPublish} required /></label> : null}
                    <label><span>{selectedDeliverableKind === "social_post" ? "آخر موعد نشر" : "الموعد النهائي"}</span><input name="due_at" type="datetime-local" defaultValue={suggestedDue} required /></label>
                    <label><span>نوع التكلفة</span><select name="budget_category" defaultValue="production">{(Object.keys(launchBudgetCategoryConfig) as LaunchBudgetCategory[]).map((category) => <option value={category} key={category}>{launchBudgetCategoryConfig[category].label}</option>)}</select></label>
                    <label><span>الميزانية</span><input name="budget_amount" type="number" min="0" step="0.01" defaultValue="0" required /></label>
                    <label><span>العملة</span><input name="currency" defaultValue={launch.currency} minLength={3} maxLength={3} pattern="[A-Za-z]{3}" dir="ltr" required /></label>
                    <label><span>يعتمد على — اختياري</span><select name="depends_on_deliverable_id"><option value="">لا يعتمد على بند سابق</option>{launchDeliverables.map((deliverable) => <option value={deliverable.id} key={deliverable.id}>{deliverable.title}</option>)}</select></label>
                    <label className="wide"><span>التفاصيل ومعيار التسليم</span><textarea name="brief" minLength={5} maxLength={5000} rows={4} required placeholder="الفكرة، الرسالة، المطلوب، المقاسات، المراجع، ما الذي يعتبر تسليمًا مقبولًا…" /></label>
                    {selectedDeliverableKind === "social_post" ? <>
                      <div className="wide social-workflow-note"><Sparkles size={16} /><div><strong>السيستم هيفك البند تلقائيًا</strong><p>لكل بوست: Brief ← الكابشن والتصميم بالتوازي ← الجدولة ← النشر والتوثيق. كل تسليم يفتح ما يليه بدون انتظار المدير.</p></div></div>
                      <label className="wide"><span>هدف البوستات</span><textarea name="goal" minLength={5} maxLength={1000} rows={2} required placeholder="ما النتيجة التي نريدها من هذه الدفعة؟" /></label>
                      <label><span>الـHook الأساسي</span><textarea name="hook" minLength={3} maxLength={1000} rows={2} required placeholder="الجملة التي توقف العميل" /></label>
                      <label><span>الـCTA</span><textarea name="cta" minLength={2} maxLength={500} rows={2} required placeholder="الإجراء المطلوب من العميل" /></label>
                      <label className="wide"><span>تعليمات كتابة الكابشن</span><textarea name="copy_brief" minLength={10} maxLength={8000} rows={4} required placeholder="النبرة، النقاط الأساسية، الكلمات الممنوعة، الهاشتاجات، طول النص…" /></label>
                      <label className="wide"><span>تعليمات التصميم</span><textarea name="design_brief" minLength={10} maxLength={8000} rows={4} required placeholder="الفكرة البصرية، المقاس، النص على التصميم، المراجع وما يجب تجنبه…" /></label>
                      <fieldset className="wide platform-picker"><legend>منصات النشر</legend>{[
                        ["instagram", "Instagram"], ["facebook", "Facebook"], ["tiktok", "TikTok"],
                        ["linkedin", "LinkedIn"], ["telegram", "Telegram"], ["youtube", "YouTube"],
                      ].map(([value, label]) => <label key={value}><input type="checkbox" name="platforms" value={value} defaultChecked={value === "instagram" || value === "facebook"} /><span>{label}</span></label>)}</fieldset>
                      <div className="wide assignment-block"><div><p className="overline">توزيع التنفيذ</p><h5>مسؤول كل مرحلة</h5></div><div className="assignment-grid">
                        {[
                          ["brief_owner_id", "تجهيز الـBrief"], ["caption_owner_id", "كتابة الكابشن"],
                          ["design_owner_id", "التصميم"],
                          ["scheduling_owner_id", "الجدولة"], ["publishing_owner_id", "النشر"],
                        ].map(([name, label]) => <label key={name}><span>{label}</span><select name={name} defaultValue={session.user.id} required>{workingPeople.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>)}
                      </div></div>
                    </> : null}
                    <div className="form-actions"><Button type="submit" disabled={working}><Sparkles size={14} /> {selectedDeliverableKind === "social_post" ? "إنشاء البند ومصنع البوستات" : "إنشاء البند والمهمة"}</Button><button className="text-button" type="button" onClick={() => setDeliverableFormId(null)}>إلغاء</button></div>
                  </form> : null}
                  {launchDeliverables.length ? <div className="launch-deliverable-list">{launchDeliverables.map((deliverable) => {
                    const task = deliverableTaskById.get(deliverable.id);
                    const dependencies = (dependenciesByDeliverable.get(deliverable.id) ?? []).map((dependency) => deliverableById.get(dependency.depends_on_deliverable_id)).filter((item): item is LaunchDeliverable => Boolean(item));
                    const canSubmit = platformAdmin || deliverable.owner_id === session.user.id;
                    const submittable = task && ["ready", "in_progress", "review"].includes(task.status);
                    const generatedItems = contentLinks
                      .filter((link) => link.launch_deliverable_id === deliverable.id)
                      .map((link) => contentById.get(link.content_item_id))
                      .filter((item): item is ContentItem => Boolean(item));
                    const publishedItems = generatedItems.filter((item) => item.status === "published").length;
                    return <article key={deliverable.id} id={`deliverable-${deliverable.id}`} data-direct-target={linkedDeliverableId === deliverable.id || undefined} tabIndex={linkedDeliverableId === deliverable.id ? -1 : undefined}><header><div><span className="launch-deliverable-kind">{deliverable.planned_quantity} × {launchDeliverableKindConfig[deliverable.kind].label}</span><h5>{deliverable.title}</h5>{linkedDeliverableId === deliverable.id ? <span className="direct-target-label"><Route size={11} /> ده البند المطلوب</span> : null}</div>{task ? <StatusBadge tone={taskStatusConfig[task.status].tone}>{taskStatusConfig[task.status].label}</StatusBadge> : null}</header><p>{deliverable.brief}</p><dl><div><dt>المسؤول</dt><dd>{peopleById.get(deliverable.owner_id)?.name ?? "عضو فريق"}</dd></div><div><dt>الموعد</dt><dd>{formatDate(deliverable.due_at)}</dd></div><div><dt>القناة / المكان</dt><dd>{[deliverable.channel, deliverable.destination].filter(Boolean).join(" · ") || "غير محدد"}</dd></div><div><dt>{launchBudgetCategoryConfig[deliverable.budget_category].label}</dt><dd>{formatTarget(Number(deliverable.budget_amount), deliverable.currency)}</dd></div></dl>{deliverable.workflow_template === "social_post" ? <div className="generated-content-summary"><div><strong>{publishedItems}/{generatedItems.length}</strong><span>بوستات منشورة</span></div><div className="content-progress-track"><span style={{ width: `${generatedItems.length ? Math.round((publishedItems / generatedItems.length) * 100) : 0}%` }} /></div><div className="generated-content-links">{generatedItems.map((item) => <a href={`/content?content=${item.id}#content-${item.id}`} key={item.id}>{item.title} <Link2 size={11} /></a>)}</div><small>{task?.status === "backlog" ? "اعتماد الدفعة يفتح تلقائيًا بعد نشر وتوثيق كل البوستات." : "كل كروت البوستات منشورة؛ الدفعة جاهزة للاعتماد."}</small></div> : null}{dependencies.length ? <p className="launch-dependency-note"><Route size={12} /> يبدأ بعد: {dependencies.map((dependency) => dependency.title).join(" + ")}</p> : null}{deliverable.delivered_at ? <div className="launch-delivery-result"><strong>التسليم المحفوظ</strong>{deliverable.result_note ? <p>{deliverable.result_note}</p> : null}{deliverable.result_url ? <a href={deliverable.result_url} target="_blank" rel="noreferrer">فتح التسليم <Link2 size={12} /></a> : null}<small>{formatDate(deliverable.delivered_at)}</small></div> : null}{canSubmit && submittable ? <button className="text-button" type="button" onClick={() => setSubmissionFormId(submissionFormId === deliverable.id ? null : deliverable.id)}><Upload size={12} /> {deliverable.delivered_at ? "تحديث التسليم" : deliverable.workflow_template === "social_post" ? "اعتماد دفعة البوستات" : "تسليم النتيجة"}</button> : null}{submissionFormId === deliverable.id && canSubmit && submittable ? <form className="launch-submission-form" onSubmit={(event) => void submitDeliverable(event, deliverable)}><label><span>ملاحظة النتيجة</span><textarea name="result_note" maxLength={5000} rows={3} placeholder="ما الذي تم؟ وما الذي يجب أن يراجعه المدير؟" /></label><label><span>رابط التسليم — اختياري إذا كتبت ملاحظة</span><input name="result_url" type="url" dir="ltr" maxLength={2000} placeholder="https://drive.google.com/..." /></label><div className="form-actions"><Button type="submit" disabled={working}>حفظ وإرسال للمراجعة</Button><button className="text-button" type="button" onClick={() => setSubmissionFormId(null)}>إلغاء</button></div></form> : null}</article>;
                  })}</div> : <p className="launch-assets-empty">لا توجد بنود تنفيذية بعد. مثال مناسب للبداية: 6 ريلز + 12 ستوري + 4 تصميمات + 3 إعلانات، لكن الأرقام تعتمد على الاستراتيجية التي تعتمدها أنت.</p>}
                </section>

                <div className="launch-lower-grid">
                  <section className="launch-target-panel">
                    <div className="launch-subheading"><div><p className="overline">مستهدفات الخطة</p><h4>كيف نعرّف النجاح؟</h4></div><StatusBadge tone="warning">الفعلي غير مربوط بعد</StatusBadge></div>
                    <div className="target-chip-list">{targets.map((target) => <div key={target.label}><small>{target.label}</small><strong>{target.value}</strong></div>)}</div>
                    <p>ربط Meta والموقع والمبيعات مرحلة تكامل مستقلة. لن يعرض النظام نتيجة فعلية قبل وصول رقم موثوق.</p>
                  </section>

                  <section className="launch-assets-panel">
                    <div className="launch-subheading"><div><p className="overline">أصول الحملة</p><h4>{linkedItems.length ? `${linkedItems.length} أصل محتوى مرتبط` : "لا يوجد محتوى مرتبط"}</h4></div><a className="text-link" href="/content">فتح المصنع <Link2 size={13} /></a></div>
                    {linkedItems.length ? <ul className="linked-content-list">{linkedItems.map((item) => <li key={item.id}><div><Film size={14} /><span>{item.title}</span></div>{manager ? <button type="button" disabled={working} onClick={() => void changeContentLink(launch.id, item.id, false)}>إزالة الربط</button> : null}</li>)}</ul> : <p className="launch-assets-empty">أنشئ أصلًا من مصنع المحتوى، ثم اربطه هنا بالخطة.</p>}
                    {manager && availableContent.length ? <div className="content-link-control"><select aria-label={`اختر محتوى لحملة ${launch.title}`} value={contentSelection[launch.id] ?? ""} onChange={(event) => setContentSelection((current) => ({ ...current, [launch.id]: event.target.value }))}><option value="">اختر أصل محتوى…</option>{availableContent.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select><Button type="button" variant="secondary" disabled={working || !contentSelection[launch.id]} onClick={() => void changeContentLink(launch.id, contentSelection[launch.id], true)}><Link2 size={14} /> ربط</Button></div> : null}
                  </section>
                </div>

                <footer>
                  <div>{activeTasks.length ? <><CircleUserRound size={15} /><span>النشط الآن: <strong>{activeTasks.map((task) => task.launch_gate ? launchGateConfig[task.launch_gate].shortLabel : task.title).join(" + ")}</strong></span></> : <><CheckCircle2 size={15} /><span>لا توجد بوابة نشطة الآن.</span></>}</div>
                  <a className="text-link" href="/tasks">فتح مهام الإطلاق <Link2 size={13} /></a>
                </footer>
              </article>
            );
          })}
        </div>
      ) : (
        <section className="panel empty-state">
          <span className="empty-visual"><Route size={20} /></span>
          <div><h2>{launchView === "archive" ? "أرشيف الحملات فارغ" : "لا توجد إطلاقات حالية"}</h2><p>{launchView === "archive" ? "أي إطلاق مكتمل أو ملغي سيُحفظ هنا بدلًا من مزاحمة الشغل الحالي." : "أنشئ أول إطلاق، أو افتح الأرشيف لمراجعة الحملات المكتملة والملغاة."}</p></div>
          <span className="empty-proof"><CheckCircle2 size={15} /> {launchView === "archive" ? "لا يُحذف تاريخ التنفيذ" : "متصلة بالمهام والمحتوى"}</span>
        </section>
      )}

      <aside className="automation-note"><LockKeyhole size={17} /><div><strong>الحالة والجاهزية لا تتغيران يدويًا</strong><p>إكمال مهام البوابات هو الذي يفتح المرحلة التالية ويحدّث حالة الإطلاق. البيانات الفعلية من Meta والموقع والدفع لم تُربط بعد، لذلك تظهر المستهدفات فقط من دون أرقام مصطنعة.</p></div></aside>
    </section>
  );
}
