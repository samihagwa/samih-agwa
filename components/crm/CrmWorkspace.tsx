"use client";

import type { Session } from "@supabase/supabase-js";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  ContactRound,
  Database as DatabaseIcon,
  Download,
  ExternalLink,
  FileClock,
  History,
  Link2,
  LoaderCircle,
  LockKeyhole,
  MessageSquareText,
  Plus,
  RefreshCw,
  Route,
  Search,
  SearchCheck,
  ShieldCheck,
  Undo2,
  Upload,
  UserRoundCheck,
} from "lucide-react";
import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  allowedCrmTransitions,
  crmActivityKindConfig,
  crmConversationChannelConfig,
  crmIdentityKinds,
  crmIdentityKindConfig,
  crmInterestConfig,
  crmLeadStageConfig,
  crmLeadStages,
  crmSourceConfig,
  type CrmActivityKind,
  type CrmConversationChannel,
  type CrmIdentityKind,
  type CrmInterest,
  type CrmLeadStage,
  type CrmSource,
} from "../../lib/crm";
import { parseTelegramCustomerImport, type TelegramImportPreview, type TelegramImportSignal } from "../../lib/crm-import";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Database, Tables } from "../../lib/supabase/database.types";
import { getSupabaseFunctionErrorMessage } from "../../lib/supabase/function-errors";
import { useWorkspaceAuth } from "../../lib/supabase/use-workspace-auth";
import { canManageAllTaskExecution, canManageTasks, taskStatusConfig } from "../../lib/tasks";
import { Button } from "../ui/Button";
import { StatusBadge } from "../ui/StatusBadge";

type Contact = Tables<"crm_contacts">;
type Identity = Tables<"crm_identities">;
type Activity = Tables<"crm_activities">;
type ConversationLink = Tables<"crm_conversation_links">;
type Task = Tables<"tasks">;
type Membership = Tables<"memberships">;
type Organization = Tables<"organizations">;
type ImportBatch = Tables<"crm_import_batches">;
type ImportRow = Tables<"crm_import_rows">;
type OwnerPerformance = Database["public"]["Functions"]["get_crm_owner_performance"]["Returns"][number];
type BrokerLookupResult = Database["public"]["Functions"]["lookup_exness_account"]["Returns"][number];
type TeamPerson = { id: string; name: string; role: Membership["role"] };
type Workspace = { organization: Organization; membership: Membership; people: TeamPerson[] };
type Filter = "all" | "mine" | "overdue";
type BoardView = "current" | "archive";

const PAGE_SIZE = 60;

const importSignalConfig: Record<TelegramImportSignal, { label: string; tone: "neutral" | "info" | "success" | "warning" }> = {
  pending: { label: "بانتظار المتابعة", tone: "neutral" },
  contacted: { label: "تواصلت أسماء", tone: "info" },
  activated: { label: "فعّله أيمن", tone: "success" },
  needs_account_correction: { label: "حساب يحتاج تصحيح", tone: "warning" },
};

const importBatchStatusConfig: Record<ImportBatch["status"], { label: string; tone: "neutral" | "info" | "success" | "warning" }> = {
  processing: { label: "قيد المعالجة", tone: "info" },
  completed: { label: "مكتملة", tone: "success" },
  rolled_back: { label: "تم التراجع", tone: "neutral" },
  partially_rolled_back: { label: "تراجع جزئي", tone: "warning" },
};

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

function futureDateIso(value: string) {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) && date.getTime() > Date.now() ? date.toISOString() : null;
}

export function CrmWorkspace() {
  const configured = isSupabaseConfigured();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [conversationLinks, setConversationLinks] = useState<ConversationLink[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [ownerPerformance, setOwnerPerformance] = useState<OwnerPerformance[]>([]);
  const [importBatches, setImportBatches] = useState<ImportBatch[]>([]);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(configured);
  const [crmLoading, setCrmLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importSourceText, setImportSourceText] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [importPreview, setImportPreview] = useState<TelegramImportPreview | null>(null);
  const [importDefaultOwner, setImportDefaultOwner] = useState("");
  const [importReviewed, setImportReviewed] = useState(false);
  const [brokerLookupInput, setBrokerLookupInput] = useState("");
  const [brokerLookupResult, setBrokerLookupResult] = useState<BrokerLookupResult | null>(null);
  const [brokerLookupWorking, setBrokerLookupWorking] = useState(false);
  const [activityFormId, setActivityFormId] = useState<string | null>(null);
  const [identityFormId, setIdentityFormId] = useState<string | null>(null);
  const [activityStage, setActivityStage] = useState<CrmLeadStage>("new");
  const [primaryIdentityKind, setPrimaryIdentityKind] = useState<CrmIdentityKind>("phone");
  const [source, setSource] = useState<CrmSource>("manual");
  const [interest, setInterest] = useState<CrmInterest>("indicator");
  const [conversationChannel, setConversationChannel] = useState<CrmConversationChannel | "">("");
  const [filter, setFilter] = useState<Filter>("all");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [stageFilter, setStageFilter] = useState<CrmLeadStage | "">("");
  const [boardView, setBoardView] = useState<BoardView>("current");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(0);
  const [performanceRange, setPerformanceRange] = useState(30);
  const [error, setError] = useState<string | null>(configured ? null : "لم يتم إعداد اتصال Supabase لهذه النسخة.");
  const [notice, setNotice] = useState<string | null>(null);
  const [renderNow] = useState(() => Date.now());
  const [defaultFollowUp] = useState(() => toLocalDateTimeInput(new Date(Date.now() + 24 * 60 * 60 * 1000)));
  const createNameInputRef = useRef<HTMLInputElement>(null);
  const manager = Boolean(workspace && canManageTasks(workspace.membership.role));
  const platformAdmin = Boolean(workspace && canManageAllTaskExecution(workspace.membership.role));

  const clearData = useCallback(() => {
    setContacts([]);
    setIdentities([]);
    setActivities([]);
    setConversationLinks([]);
    setTasks([]);
    setOwnerPerformance([]);
    setImportBatches([]);
    setImportRows([]);
    setTotalCount(0);
    setActivityFormId(null);
    setIdentityFormId(null);
  }, []);

  const clearWorkspace = useCallback(() => {
    setWorkspace(null);
    clearData();
  }, [clearData]);

  const clearTransientState = useCallback(() => setNotice(null), []);

  const refreshCrm = useCallback(async (organizationId: string) => {
    const supabase = getSupabaseBrowserClient();
    setCrmLoading(true);
    try {
      const [searchResult, performanceResult, batchesResult] = await Promise.all([
        supabase.rpc("search_crm_contacts_v2", {
          target_organization_id: organizationId,
          search_query: searchQuery,
          target_owner_id: (ownerFilter || null) as unknown as string,
          target_stage: (stageFilter || null) as unknown as CrmLeadStage,
          target_scope: filter,
          target_view: boardView,
          result_limit: PAGE_SIZE,
          result_offset: page * PAGE_SIZE,
        }),
        manager
          ? supabase.rpc("get_crm_owner_performance", { target_organization_id: organizationId, target_range_days: performanceRange })
          : Promise.resolve({ data: [] as OwnerPerformance[], error: null }),
        platformAdmin
          ? supabase.from("crm_import_batches").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(12)
          : Promise.resolve({ data: [] as ImportBatch[], error: null }),
      ]);
      if (searchResult.error) throw searchResult.error;
      if (performanceResult.error) throw performanceResult.error;
      if (batchesResult.error) throw batchesResult.error;

      const matches = searchResult.data ?? [];
      const contactIds = matches.map((match) => match.contact_id);
      setTotalCount(Number(matches[0]?.total_count ?? 0));
      setOwnerPerformance(performanceResult.data ?? []);
      const batches = batchesResult.data ?? [];
      setImportBatches(batches);
      if (platformAdmin && batches.length) {
        const rowsResult = await supabase.from("crm_import_rows").select("*").eq("organization_id", organizationId).in("batch_id", batches.map((batch) => batch.id)).order("id", { ascending: true });
        if (rowsResult.error) throw rowsResult.error;
        setImportRows(rowsResult.data ?? []);
      } else setImportRows([]);
      if (!contactIds.length) {
        setContacts([]);
        setIdentities([]);
        setActivities([]);
        setConversationLinks([]);
        setTasks([]);
        return;
      }

      const [contactsResult, identitiesResult, activitiesResult, linksResult, tasksResult] = await Promise.all([
        supabase.from("crm_contacts").select("*").in("id", contactIds),
        supabase.from("crm_identities").select("*").in("contact_id", contactIds).order("is_primary", { ascending: false }),
        supabase.from("crm_activities").select("*").in("contact_id", contactIds).order("occurred_at", { ascending: false }).limit(PAGE_SIZE * 8),
        supabase.from("crm_conversation_links").select("*").in("contact_id", contactIds).order("is_primary", { ascending: false }),
        supabase.from("tasks").select("*").eq("organization_id", organizationId).in("crm_contact_id", contactIds).order("due_at", { ascending: true }),
      ]);
      for (const result of [contactsResult, identitiesResult, activitiesResult, linksResult, tasksResult]) {
        if (result.error) throw result.error;
      }
      const order = new Map(contactIds.map((id, index) => [id, index]));
      setContacts([...(contactsResult.data ?? [])].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)));
      setIdentities(identitiesResult.data ?? []);
      setActivities(activitiesResult.data ?? []);
      setConversationLinks(linksResult.data ?? []);
      setTasks(tasksResult.data ?? []);
    } finally {
      setCrmLoading(false);
    }
  }, [boardView, filter, manager, ownerFilter, page, performanceRange, platformAdmin, searchQuery, stageFilter]);

  const refreshSafely = useCallback(async (organizationId: string) => {
    try {
      await refreshCrm(organizationId);
    } catch (refreshError) {
      setError(getErrorMessage(refreshError));
    }
  }, [refreshCrm]);

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
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [clearData]);

  const session = useWorkspaceAuth({
    configured,
    loadWorkspace,
    clearWorkspace,
    setLoading,
    clearTransientState,
  });

  useEffect(() => {
    const clean = searchInput.trim();
    const timeout = window.setTimeout(() => {
      setSearchQuery(clean.length >= 2 ? clean : "");
      setPage(0);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    if (!workspace) return;
    const timeout = window.setTimeout(() => void refreshSafely(workspace.organization.id), 0);
    return () => window.clearTimeout(timeout);
  }, [refreshSafely, workspace]);

  useEffect(() => {
    if (!workspace) return;
    const supabase = getSupabaseBrowserClient();
    const refresh = () => void refreshSafely(workspace.organization.id);
    let channel = supabase.channel(`crm:${workspace.organization.id}`);
    for (const table of ["crm_contacts", "crm_identities", "crm_activities", "crm_conversation_links", "tasks"] as const) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `organization_id=eq.${workspace.organization.id}` }, refresh);
    }
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refreshSafely, workspace]);

  useEffect(() => {
    if (!showCreate && !showImport) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setShowCreate(false); setShowImport(false); }
    };
    const focusFrame = window.requestAnimationFrame(() => createNameInputRef.current?.focus());
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [showCreate, showImport]);

  const identitiesByContact = useMemo(() => {
    const grouped = new Map<string, Identity[]>();
    for (const identity of identities) grouped.set(identity.contact_id, [...(grouped.get(identity.contact_id) ?? []), identity]);
    return grouped;
  }, [identities]);
  const activitiesByContact = useMemo(() => {
    const grouped = new Map<string, Activity[]>();
    for (const activity of activities) grouped.set(activity.contact_id, [...(grouped.get(activity.contact_id) ?? []), activity]);
    return grouped;
  }, [activities]);
  const conversationLinksByContact = useMemo(() => {
    const grouped = new Map<string, ConversationLink[]>();
    for (const link of conversationLinks) grouped.set(link.contact_id, [...(grouped.get(link.contact_id) ?? []), link]);
    return grouped;
  }, [conversationLinks]);
  const tasksByContact = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    for (const task of tasks) if (task.crm_contact_id) grouped.set(task.crm_contact_id, [...(grouped.get(task.crm_contact_id) ?? []), task]);
    return grouped;
  }, [tasks]);

  async function invokeCrm(body: Record<string, unknown>, successMessage: string) {
    if (!workspace) return false;
    setWorking(true);
    setError(null);
    setNotice(null);
    const { error: commandError } = await getSupabaseBrowserClient().functions.invoke("crm-commands", { body });
    setWorking(false);
    if (commandError) {
      setError(await getSupabaseFunctionErrorMessage(commandError, "تعذّر تنفيذ أمر CRM. لم يتم حفظ أي جزء من العملية."));
      return false;
    }
    setNotice(successMessage);
    await refreshSafely(workspace.organization.id);
    return true;
  }

  async function createLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || !session) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const followUpAt = futureDateIso(formText(form, "follow_up_at"));
    if (!followUpAt) return setError("حدد موعد متابعة صحيحًا في المستقبل.");
    const identities = crmIdentityKinds
      .map((kind) => ({ kind, value: formText(form, `identity_${kind}`) }))
      .filter((identity) => identity.value);
    if (!identities.length) return setError("أضف وسيلة تواصل واحدة على الأقل: هاتف أو بريد أو Telegram أو TradingView.");
    if (!identities.some((identity) => identity.kind === primaryIdentityKind)) {
      return setError(`املأ ${crmIdentityKindConfig[primaryIdentityKind].label} أو اختر وسيلة أخرى كأساسية.`);
    }
    const created = await invokeCrm({
      action: "create_lead",
      organization_id: workspace.organization.id,
      full_name: formText(form, "full_name"),
      source: formText(form, "source"),
      source_detail: formText(form, "source_detail"),
      interest: formText(form, "interest"),
      interest_detail: formText(form, "interest_detail"),
      owner_id: formText(form, "owner_id") || session.user.id,
      consent_status: formText(form, "consent_status"),
      identities,
      primary_identity_kind: primaryIdentityKind,
      follow_up_at: followUpAt,
      notes: formText(form, "notes"),
      conversation_channel: formText(form, "conversation_channel"),
      conversation_url: formText(form, "conversation_url"),
      conversation_label: formText(form, "conversation_label"),
    }, "تم إنشاء ملف العميل بكل وسائل التواصل ومهمة المتابعة معًا.");
    if (created) {
      formElement.reset();
      setPrimaryIdentityKind("phone");
      setSource("manual");
      setInterest("indicator");
      setConversationChannel("");
      setShowCreate(false);
    }
  }

  async function addIdentity(event: FormEvent<HTMLFormElement>, contact: Contact) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const added = await invokeCrm({
      action: "add_identity",
      contact_id: contact.id,
      identity_kind: formText(form, "identity_kind"),
      identity_value: formText(form, "identity_value"),
      make_primary: form.get("make_primary") === "on",
    }, "تمت إضافة وسيلة التواصل للعميل.");
    if (added) {
      formElement.reset();
      setIdentityFormId(null);
    }
  }

  async function recordActivity(event: FormEvent<HTMLFormElement>, contact: Contact) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const nextFollowUp = crmLeadStageConfig[activityStage].active ? formText(form, "next_follow_up_at") : "";
    const nextFollowUpIso = nextFollowUp ? futureDateIso(nextFollowUp) : null;
    if (nextFollowUp && !nextFollowUpIso) return setError("حدد موعد المتابعة التالية في المستقبل.");
    const recorded = await invokeCrm({
      action: "record_activity",
      contact_id: contact.id,
      kind: formText(form, "kind"),
      next_stage: activityStage,
      summary: formText(form, "summary"),
      next_follow_up_at: nextFollowUpIso,
    }, crmLeadStageConfig[activityStage].active ? "تم تسجيل النتيجة وإنشاء مهمة المتابعة التالية." : "تم تسجيل النتيجة وإغلاق المتابعة المفتوحة.");
    if (recorded) {
      formElement.reset();
      setActivityFormId(null);
    }
  }

  function resetImportDraft() {
    setImportSourceText("");
    setImportFileName("");
    setImportPreview(null);
    setImportReviewed(false);
  }

  async function readImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("ملف الاستيراد أكبر من 5MB. صدّر موضوع العملاء فقط أو قسّمه إلى دفعات أصغر.");
      event.target.value = "";
      return;
    }
    try {
      const source = await file.text();
      setImportSourceText(source);
      setImportFileName(file.name);
      setImportPreview(parseTelegramCustomerImport(source));
      setImportReviewed(false);
      setError(null);
    } catch (fileError) {
      setError(getErrorMessage(fileError));
    } finally {
      event.target.value = "";
    }
  }

  function analyzeImportSource() {
    const preview = parseTelegramCustomerImport(importSourceText);
    setImportPreview(preview);
    setImportReviewed(false);
    setError(preview.rows.length ? null : "لم أجد أي عميل في النص أو الملف. استخدم قالب الأعمدة الموضح أو ملف Telegram JSON.");
  }

  function downloadImportTemplate() {
    const columns = "message_id,full_name,phone,email,tradingview,registered_at,signal\n";
    const example = "9507,اسم العميل,+201000000000,name@example.com,tradingview_user,2026-08-22T12:00:00+03:00,pending\n";
    const url = URL.createObjectURL(new Blob([columns, example], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "telegram-customers-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importTelegramCustomers() {
    if (!workspace || !importPreview) return;
    if (importPreview.invalid_count || !importPreview.valid_rows.length) {
      setError("أصلح الصفوف المعلّمة أولًا. الدفعة لن تُحفظ جزئيًا من شاشة المعاينة.");
      return;
    }
    if (!importDefaultOwner) {
      setError("اختر مسؤول المتابعة الافتراضي للعملاء الجدد.");
      return;
    }
    if (!importReviewed) {
      setError("أكد أنك راجعت المعاينة قبل اعتماد الدفعة.");
      return;
    }
    const imported = await invokeCrm({
      action: "import_telegram_batch",
      organization_id: workspace.organization.id,
      default_owner_id: importDefaultOwner,
      rows: importPreview.valid_rows,
    }, `تم اعتماد دفعة من ${importPreview.valid_rows.length} عميل. راجع النتيجة في سجل الاستيراد.`);
    if (imported) resetImportDraft();
  }

  async function rollbackImport(batch: ImportBatch) {
    const confirmed = window.confirm(`سيحاول النظام حذف ${batch.created_rows} ملفًا أنشأتها هذه الدفعة فقط. أي ملف تم تعديله بعد الاستيراد سيبقى محفوظًا. هل تريد المتابعة؟`);
    if (!confirmed) return;
    await invokeCrm({ action: "rollback_import_batch", batch_id: batch.id }, "اكتمل فحص التراجع. الملفات المعدلة يدويًا لم تُحذف.");
  }

  async function lookupBrokerAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace) return;
    const clean = brokerLookupInput.trim();
    if (!/^[A-Za-z0-9._-]{3,160}$/.test(clean)) {
      setError("اكتب رقم حساب Exness أو المعرّف التعريفي للعميل بشكل صحيح.");
      return;
    }
    setBrokerLookupWorking(true);
    setBrokerLookupResult(null);
    setError(null);
    const { data, error: lookupError } = await getSupabaseBrowserClient().functions.invoke("broker-commands", { body: { action: "lookup_exness_account", organization_id: workspace.organization.id, lookup_value: clean } });
    setBrokerLookupWorking(false);
    if (lookupError) {
      setError(await getSupabaseFunctionErrorMessage(lookupError, "تعذّر فحص حساب Exness."));
      return;
    }
    setBrokerLookupResult(data as BrokerLookupResult);
  }

  if (loading) return <section className="workspace-state" aria-live="polite"><LoaderCircle className="spin" size={24} /><div><h2>جارٍ تحميل CRM</h2><p>نتحقق من الصلاحيات وملفات العملاء ومهام المتابعة.</p></div></section>;
  if (!session) return <section className="workspace-state workspace-onboarding"><LockKeyhole size={27} /><div><p className="overline">دخول موحد</p><h2>سجّل الدخول أولًا من قسم المهام</h2><p>بيانات العملاء لا تظهر دون جلسة موثقة وصلاحية داخل الشركة.</p></div><Button href="/tasks"><Link2 size={16} /> الانتقال لتسجيل الدخول</Button></section>;
  if (!workspace) return <section className="workspace-state workspace-onboarding"><Route size={27} /><div><p className="overline">مساحة العمل مطلوبة</p><h2>أنشئ مساحة الشركة مرة واحدة</h2><p>ابدأ من قسم المهام، ثم ارجع هنا لإدارة المتابعات.</p></div><Button href="/tasks"><Link2 size={16} /> فتح قسم المهام</Button></section>;

  const canCreate = workspace.membership.role !== "viewer";
  const peopleById = new Map(workspace.people.map((person) => [person.id, person]));
  const totals = ownerPerformance.reduce((sum, metric) => ({
    all: sum.all + Number(metric.total_contacts),
    overdue: sum.overdue + Number(metric.overdue_contacts),
    fresh: sum.fresh + Number(metric.new_contacts),
    won: sum.won + Number(metric.won_contacts),
  }), { all: 0, overdue: 0, fresh: 0, won: 0 });
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const hasFilters = Boolean(searchQuery || ownerFilter || stageFilter || filter !== "all");
  const visibleStages = crmLeadStages.filter((stage) => boardView === "current" ? crmLeadStageConfig[stage].active : !crmLeadStageConfig[stage].active);

  return <section className="crm-workspace">
    <div className="workspace-toolbar">
      <div><p className="overline">{workspace.organization.name}</p><h2>خط متابعة العملاء</h2><p>{crmLoading ? "جارٍ تحديث النتائج…" : `${totalCount} نتيجة مطابقة — البحث والفلاتر يعملان على كل بيانات CRM المتاحة لصلاحيتك.`}</p></div>
      <div className="toolbar-actions">
        <button className="icon-button" type="button" aria-label="تحديث CRM" disabled={crmLoading} onClick={() => void refreshSafely(workspace.organization.id)}><RefreshCw className={crmLoading ? "spin" : ""} size={17} /></button>
        <Button href="/tasks" variant="secondary"><Route size={16} /> مهام المتابعة</Button>
        {platformAdmin ? <Button type="button" variant="secondary" onClick={() => { setImportDefaultOwner(importDefaultOwner || session.user.id); setShowImport(true); }}><Upload size={16} /> استيراد عملاء Telegram</Button> : null}
        {canCreate ? <Button type="button" aria-expanded={showCreate} aria-controls="crm-create-dialog" onClick={() => setShowCreate(true)}><Plus size={16} /> عميل محتمل جديد</Button> : null}
      </div>
    </div>

    {notice ? <p className="form-notice success" role="status">{notice}</p> : null}
    {error ? <p className="form-notice error" role="alert">{error}</p> : null}

    <div className="workspace-view-switch">
      <div><p className="overline">تنظيم العملاء</p><strong>الملفات المحسومة لا تزاحم المتابعات الحالية، وتظل محفوظة وقابلة للبحث.</strong></div>
      <div className="segmented-control" aria-label="عرض ملفات العملاء"><button type="button" className={boardView === "current" ? "active" : ""} onClick={() => { setBoardView("current"); setStageFilter(""); setPage(0); }}>الحالي</button><button type="button" className={boardView === "archive" ? "active" : ""} onClick={() => { setBoardView("archive"); setStageFilter(""); setFilter("all"); setPage(0); }}>الأرشيف</button></div>
    </div>

    <div className="crm-kpi-strip" aria-label="ملخص CRM الحقيقي">
      <div><ContactRound size={17} /><span>إجمالي المتاح</span><strong>{manager ? totals.all : totalCount}</strong></div>
      <div className={totals.overdue ? "attention" : ""}><AlertTriangle size={17} /><span>متابعات متأخرة</span><strong>{manager ? totals.overdue : contacts.filter((contact) => contact.next_follow_up_at && new Date(contact.next_follow_up_at).getTime() < renderNow).length}</strong></div>
      <div><FileClock size={17} /><span>عملاء جدد</span><strong>{manager ? totals.fresh : contacts.filter((contact) => contact.stage === "new").length}</strong></div>
      <div><CheckCircle2 size={17} /><span>صفقات ناجحة</span><strong>{manager ? totals.won : contacts.filter((contact) => contact.stage === "won").length}</strong></div>
    </div>

    <section className="crm-search-panel" aria-label="البحث وفلترة العملاء">
      <label className="crm-search-field"><Search size={16} /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="ابحث بالاسم، الهاتف، البريد، TradingView، Telegram، المصدر، لينك الشات أو نتيجة متابعة…" aria-label="البحث في كل بيانات العملاء" />{searchInput ? <button type="button" onClick={() => setSearchInput("")}>مسح</button> : null}</label>
      {manager ? <label><span>المسؤول</span><select value={ownerFilter} onChange={(event) => { setOwnerFilter(event.target.value); setPage(0); }}><option value="">كل المسؤولين</option>{workspace.people.filter((person) => person.role !== "viewer").map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label> : null}
      <label><span>المرحلة</span><select value={stageFilter} onChange={(event) => { setStageFilter(event.target.value as CrmLeadStage | ""); setPage(0); }}><option value="">كل المراحل</option>{visibleStages.map((stage) => <option value={stage} key={stage}>{crmLeadStageConfig[stage].label}</option>)}</select></label>
      <div className="crm-filter-row" role="group" aria-label="نطاق العملاء">{(["all", "mine", ...(boardView === "current" ? ["overdue"] : [])] as Filter[]).map((value) => <button className={filter === value ? "active" : ""} type="button" key={value} onClick={() => { setFilter(value); setPage(0); }}>{value === "all" ? "كل المتاح" : value === "mine" ? "مسؤوليتي" : "متابعة متأخرة"}</button>)}</div>
      <p>{searchInput.trim().length === 1 ? "اكتب حرفين على الأقل لبدء البحث." : `يعرض ${contacts.length} من ${totalCount} نتيجة مطابقة.`}</p>
    </section>

    {canCreate ? <form className="broker-lookup-panel" onSubmit={(event) => void lookupBrokerAccount(event)}><span className="broker-lookup-icon"><Building2 size={18} /></span><div><p className="overline">Exness agency lookup</p><strong>فحص سريع بدون كشف بيانات الوكالة</strong><small>النتيجة للـSales: موجود أو غير موجود، ونشط أو غير نشط فقط.</small></div><label><span>رقم الحساب أو معرّف العميل</span><input dir="ltr" value={brokerLookupInput} onChange={(event) => { setBrokerLookupInput(event.target.value); setBrokerLookupResult(null); }} minLength={3} maxLength={160} placeholder="Account / Client ID" /></label><Button type="submit" variant="secondary" disabled={brokerLookupWorking}>{brokerLookupWorking ? <LoaderCircle className="spin" size={15} /> : <SearchCheck size={15} />} فحص</Button>{brokerLookupResult ? <div className={`broker-lookup-result ${!brokerLookupResult.integration_ready ? "pending" : brokerLookupResult.under_agency ? "found" : "missing"}`}>{!brokerLookupResult.integration_ready ? <><AlertTriangle size={15} /><span><strong>المزامنة غير مفعّلة بعد</strong><small>لا تعتبر الحساب غير موجود قبل إكمال ربط Exness.</small></span></> : brokerLookupResult.under_agency ? <><CheckCircle2 size={15} /><span><strong>العميل تحت الوكالة</strong><small>{brokerLookupResult.is_active ? "الحساب نشط" : "الحساب غير نشط حاليًا"}</small></span></> : <><AlertTriangle size={15} /><span><strong>غير موجود في آخر مزامنة</strong><small>راجع رقم الحساب قبل التواصل مع العميل.</small></span></>}</div> : null}</form> : null}

    {manager ? <section className="panel crm-performance-panel">
      <div className="section-heading"><div><p className="overline">أرقام قابلة للمراجعة</p><h2>أداء مسؤولي العملاء</h2><p>لا يوجد تقييم شخصي؛ الأرقام مبنية على الصفقات والأنشطة والمواعيد المسجلة.</p></div><label><span>الفترة</span><select value={performanceRange} onChange={(event) => setPerformanceRange(Number(event.target.value))}><option value={7}>7 أيام</option><option value={30}>30 يومًا</option><option value={90}>90 يومًا</option></select></label></div>
      <div className="crm-owner-grid">{ownerPerformance.map((metric) => {
        const person = peopleById.get(metric.owner_id);
        const completed = Number(metric.completed_follow_ups);
        const onTime = Number(metric.on_time_follow_ups);
        const onTimeRate = completed ? Math.round(onTime / completed * 100) : null;
        const needsAttention = Number(metric.overdue_contacts) > 0 || (Number(metric.active_contacts) > 0 && Number(metric.activities_in_period) === 0);
        return <article className={needsAttention ? "needs-attention" : ""} key={metric.owner_id}>
          <header><div><CircleUserRound size={17} /><strong>{person?.name ?? "عضو فريق"}</strong></div><span>{needsAttention ? "يحتاج مراجعة" : "متابع بانتظام"}</span></header>
          <dl><div><dt>ملفات نشطة</dt><dd>{metric.active_contacts}</dd></div><div><dt>صفقات خلال الفترة</dt><dd>{metric.won_in_period}</dd></div><div><dt>أنشطة مسجلة</dt><dd>{metric.activities_in_period}</dd></div><div><dt>متابعات مكتملة</dt><dd>{completed}</dd></div><div><dt>في الموعد</dt><dd>{onTimeRate === null ? "—" : `${onTimeRate}%`}</dd></div><div><dt>متأخر الآن</dt><dd>{metric.overdue_contacts}</dd></div></dl>
          <footer><span>{metric.last_activity_at ? `آخر نشاط ${formatDate(metric.last_activity_at)}` : "لا يوجد نشاط متابعة مسجل"}</span><button type="button" onClick={() => { setOwnerFilter(metric.owner_id); setPage(0); }}>عرض عملائه</button></footer>
        </article>;
      })}</div>
    </section> : null}

    {showCreate && canCreate ? <div className="crm-create-dialog-backdrop">
      <button className="crm-create-dialog-dismiss" type="button" aria-label="إغلاق نافذة إضافة العميل" onClick={() => setShowCreate(false)} />
      <form id="crm-create-dialog" className="panel crm-create-form" role="dialog" aria-modal="true" aria-labelledby="crm-create-dialog-title" onSubmit={(event) => void createLead(event)}>
      <div className="section-heading"><div><p className="overline">ملف + وسائل تواصل + مهمة</p><h2 id="crm-create-dialog-title">إضافة عميل محتمل يدويًا</h2></div><button className="text-button" type="button" onClick={() => setShowCreate(false)}>إغلاق</button></div>
      <div className="crm-safety-note"><ShieldCheck size={18} /><div><strong>لن تُرسل أي رسالة</strong><p>هذا الإدخال يحفظ الملف ويضيف مهمة متابعة فقط. الاستيراد والتواصل التلقائي غير مفعّلين.</p></div></div>
      <div className="form-grid">
        <label><span>اسم العميل المحتمل</span><input ref={createNameInputRef} name="full_name" minLength={2} maxLength={160} required placeholder="الاسم كما تعرفه" /></label>
        <label><span>مصدر التسجيل</span><select name="source" value={source} onChange={(event) => setSource(event.target.value as CrmSource)}>{(Object.keys(crmSourceConfig) as CrmSource[]).map((option) => <option value={option} key={option}>{crmSourceConfig[option].label}</option>)}</select><small>اختر «مصدر مخصص» لإضافة أي مصدر جديد.</small></label>
        {source === "other" ? <label><span>اسم المصدر الجديد</span><input name="source_detail" minLength={2} maxLength={160} required placeholder="مثال: Webinar أغسطس" /></label> : null}
        <label><span>سبب التسجيل / الاهتمام</span><select name="interest" value={interest} onChange={(event) => setInterest(event.target.value as CrmInterest)}>{(Object.keys(crmInterestConfig) as CrmInterest[]).map((option) => <option value={option} key={option}>{crmInterestConfig[option].label}</option>)}</select><small>اختر «سبب آخر» لكتابة خدمة أو حملة جديدة.</small></label>
        {interest === "other" ? <label><span>سبب التسجيل الجديد</span><input name="interest_detail" minLength={2} maxLength={160} required placeholder="مثال: حضور ويبنار التحليل الفني" /></label> : null}
        <label><span>حالة الموافقة على التواصل</span><select name="consent_status" defaultValue="unknown"><option value="unknown">غير معروفة</option><option value="granted">وافق</option></select><small>إذا رفض لاحقًا، أغلقه بنتيجة «عدم تواصل».</small></label>
        <fieldset className="crm-identities-fieldset full-field"><legend>وسائل التواصل والحسابات — املأ واحدة أو أكثر</legend><div>{crmIdentityKinds.map((kind) => <label key={kind}><span>{crmIdentityKindConfig[kind].label}</span><input name={`identity_${kind}`} type={crmIdentityKindConfig[kind].inputType} dir="ltr" minLength={3} maxLength={kind === "tradingview" ? 100 : 320} placeholder={crmIdentityKindConfig[kind].placeholder} /></label>)}</div><label className="crm-primary-select"><span>وسيلة التواصل الأساسية</span><select value={primaryIdentityKind} onChange={(event) => setPrimaryIdentityKind(event.target.value as CrmIdentityKind)}>{crmIdentityKinds.map((kind) => <option value={kind} key={kind}>{crmIdentityKindConfig[kind].label}</option>)}</select></label><small>الأساسية تظهر أولًا، وجميع القيم—including TradingView—تدخل في البحث ومنع التكرار.</small></fieldset>
        <label><span>منصة المحادثة المباشرة — اختياري</span><select name="conversation_channel" value={conversationChannel} onChange={(event) => setConversationChannel(event.target.value as CrmConversationChannel | "")}><option value="">بدون لينك حاليًا</option>{(Object.keys(crmConversationChannelConfig) as CrmConversationChannel[]).map((channel) => <option value={channel} key={channel}>{crmConversationChannelConfig[channel].label}</option>)}</select></label>
        {conversationChannel ? <label><span>لينك شات {crmConversationChannelConfig[conversationChannel].label}</span><input name="conversation_url" type="url" dir="ltr" maxLength={2000} required placeholder={crmConversationChannelConfig[conversationChannel].placeholder} /><small>الصق لينكًا كاملًا يبدأ بـ https://</small></label> : null}
        {manager ? <label><span>مسؤول المتابعة</span><select name="owner_id" defaultValue={session.user.id}>{workspace.people.filter((person) => person.role !== "viewer").map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label> : <input name="owner_id" type="hidden" value={session.user.id} />}
        <label><span>موعد أول متابعة</span><input name="follow_up_at" type="datetime-local" defaultValue={defaultFollowUp} required /></label>
        <label className="full-field"><span>سياق مهم قبل التواصل — اختياري</span><textarea name="notes" maxLength={5000} rows={3} placeholder="ماذا طلب؟ ما الذي سجّل فيه؟ وما الذي يجب أن يعرفه المسؤول؟" /></label>
      </div>
      <div className="form-actions"><Button type="submit" disabled={working}>{working ? <LoaderCircle className="spin" size={16} /> : <UserRoundCheck size={16} />} حفظ وإنشاء مهمة المتابعة</Button><small>إذا كانت أي وسيلة مسجلة من قبل، سيرفض النظام الملف المكرر كله.</small></div>
      </form>
    </div> : null}

    {showImport && platformAdmin ? <div className="crm-create-dialog-backdrop">
      <button className="crm-create-dialog-dismiss" type="button" aria-label="إغلاق نافذة استيراد العملاء" onClick={() => setShowImport(false)} />
      <section className="panel crm-create-form crm-import-dialog" role="dialog" aria-modal="true" aria-labelledby="crm-import-dialog-title">
        <div className="section-heading"><div><p className="overline">مراجعة محلية + دفعة قابلة للتراجع</p><h2 id="crm-import-dialog-title">استيراد عملاء «أدمن الحيتان»</h2><p>اقرأ ملف Telegram JSON أو CSV أو الصق الرسائل كما هي. لن يخرج الملف الخام من جهازك؛ السيرفر يستقبل الصفوف التي وافقت عليها فقط.</p></div><button className="text-button" type="button" onClick={() => setShowImport(false)}>إغلاق</button></div>
        <div className="crm-safety-note"><ShieldCheck size={18} /><div><strong>لا رسائل ولا تفعيل تلقائي</strong><p>الاستيراد ينشئ ملفات CRM ومهام متابعة فقط، ويمنع التكرار بالهاتف والبريد وTradingView ومعرّف رسالة Telegram.</p></div></div>
        <div className="crm-import-source-grid">
          <label className="crm-import-file"><Upload size={18} /><span><strong>{importFileName || "اختر ملف Telegram أو CSV"}</strong><small>JSON / CSV / TSV / TXT — حد أقصى 5MB</small></span><input type="file" accept=".json,.csv,.tsv,.txt,application/json,text/csv,text/plain" onChange={(event) => void readImportFile(event)} /></label>
          <button className="crm-template-button" type="button" onClick={downloadImportTemplate}><Download size={16} /><span><strong>تنزيل قالب CSV</strong><small>لو ستجهّز الدفعة يدويًا</small></span></button>
        </div>
        <label className="crm-import-paste"><span>أو الصق رسائل العملاء / بيانات الأعمدة</span><textarea rows={7} value={importSourceText} onChange={(event) => { setImportSourceText(event.target.value); setImportFileName(""); setImportPreview(null); setImportReviewed(false); }} placeholder={"الاسم: محمد أحمد\nرقم الهاتف: +2010…\nالبريد الإلكتروني: name@example.com\nحساب TradingView: username\nتاريخ التسجيل: 2026-08-20"} /></label>
        <div className="form-actions crm-import-analyze"><Button type="button" variant="secondary" disabled={!importSourceText.trim()} onClick={analyzeImportSource}><Search size={15} /> تحليل ومعاينة</Button>{importSourceText ? <button className="text-button" type="button" onClick={resetImportDraft}>مسح المسودة</button> : null}</div>

        {importPreview ? <section className="crm-import-preview" aria-label="معاينة دفعة العملاء">
          <div className="crm-import-summary"><div><strong>{importPreview.rows.length}</strong><span>إجمالي الصفوف</span></div><div><strong>{importPreview.valid_rows.length}</strong><span>صالحة</span></div><div className={importPreview.invalid_count ? "attention" : ""}><strong>{importPreview.invalid_count}</strong><span>تحتاج تصحيحًا</span></div><div><strong>{importPreview.duplicate_count}</strong><span>مكررة داخل الملف</span></div></div>
          <div className="crm-import-signals">{(Object.keys(importSignalConfig) as TelegramImportSignal[]).map((signal) => <span key={signal}><StatusBadge tone={importSignalConfig[signal].tone}>{importSignalConfig[signal].label}</StatusBadge><strong>{importPreview.signal_counts[signal]}</strong></span>)}</div>
          <div className="crm-import-table-wrap"><table><thead><tr><th>#</th><th>العميل</th><th>الهاتف والبريد</th><th>TradingView</th><th>حالة Telegram</th><th>الفحص</th></tr></thead><tbody>{importPreview.rows.slice(0, 500).map((row) => <tr className={row.errors.length ? "invalid" : "valid"} key={`${row.message_id}-${row.row_number}`}><td>{row.row_number}</td><td><strong>{row.full_name || "—"}</strong><small>رسالة {row.message_id || "—"}</small></td><td dir="ltr"><span>{row.phone || "—"}</span><small>{row.email || "—"}</small></td><td dir="ltr">{row.tradingview || "—"}</td><td><StatusBadge tone={importSignalConfig[row.signal].tone}>{importSignalConfig[row.signal].label}</StatusBadge></td><td>{row.errors.length ? <ul>{row.errors.map((rowError) => <li key={rowError}>{rowError}</li>)}</ul> : <span className="crm-import-valid"><CheckCircle2 size={14} /> صالح</span>}</td></tr>)}</tbody></table></div>
          <div className="crm-import-approval"><label><span>مسؤول المتابعة الافتراضي</span><select value={importDefaultOwner} onChange={(event) => setImportDefaultOwner(event.target.value)}>{workspace.people.filter((person) => person.role !== "viewer").map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label><label className="crm-checkbox"><input type="checkbox" checked={importReviewed} onChange={(event) => setImportReviewed(event.target.checked)} /><span>راجعت الصفوف والحالات، وأفهم أن العملية لا ترسل أي رسالة للعميل.</span></label><Button type="button" disabled={working || Boolean(importPreview.invalid_count) || !importPreview.valid_rows.length || !importReviewed} onClick={() => void importTelegramCustomers()}>{working ? <LoaderCircle className="spin" size={15} /> : <DatabaseIcon size={15} />} اعتماد {importPreview.valid_rows.length} عميل</Button></div>
        </section> : null}

        <section className="crm-import-history"><div className="section-heading"><div><p className="overline">سجل تدقيق لا يُمحى</p><h3>آخر دفعات الاستيراد</h3></div><StatusBadge tone="neutral">{importBatches.length} دفعة</StatusBadge></div>{importBatches.length ? <div>{importBatches.map((batch) => {
          const batchRows = importRows.filter((row) => row.batch_id === batch.id);
          const status = importBatchStatusConfig[batch.status];
          return <details key={batch.id}><summary><div><strong>{formatDate(batch.created_at)}</strong><span>{batch.created_rows} جديد · {batch.duplicate_rows} مكرر · {batch.error_rows} خطأ</span></div><StatusBadge tone={status?.tone ?? "neutral"}>{status?.label ?? batch.status}</StatusBadge></summary><div className="crm-import-batch-body"><ul>{batchRows.map((row) => <li key={row.id}><span>رسالة {row.external_id}</span><strong>{row.result === "created" ? "تم الإنشاء" : row.result === "duplicate" ? "مكرر" : row.result === "rolled_back" ? "تم التراجع" : row.result === "rollback_blocked" ? "محفوظ لأنه عُدّل" : "خطأ"}</strong>{row.error_message ? <small>{row.error_message}</small> : null}</li>)}</ul>{batch.status === "completed" && batch.created_rows > 0 ? <Button type="button" variant="secondary" className="crm-import-rollback" disabled={working} onClick={() => void rollbackImport(batch)}><Undo2 size={14} /> التراجع الآمن عن الدفعة</Button> : null}</div></details>;
        })}</div> : <p className="empty-proof"><DatabaseIcon size={15} /> لم تُعتمد أي دفعة حتى الآن.</p>}</section>
      </section>
    </div> : null}

    {contacts.length ? <div className="crm-pipeline" aria-label="خط مبيعات العملاء المحتملين">{visibleStages.map((stage) => {
      const stageContacts = contacts.filter((contact) => contact.stage === stage);
      return <section className="crm-stage-column" key={stage} aria-labelledby={`crm-stage-${stage}`}><header><StatusBadge tone={crmLeadStageConfig[stage].tone}>{crmLeadStageConfig[stage].shortLabel}</StatusBadge><strong id={`crm-stage-${stage}`}>{stageContacts.length}</strong></header><div className="crm-stage-stack workflow-entity-list">{stageContacts.map((contact) => {
        const contactIdentities = identitiesByContact.get(contact.id) ?? [];
        const contactActivities = activitiesByContact.get(contact.id) ?? [];
        const contactConversationLinks = conversationLinksByContact.get(contact.id) ?? [];
        const openTask = (tasksByContact.get(contact.id) ?? []).find((task) => task.status !== "done");
        const overdue = Boolean(contact.next_follow_up_at && new Date(contact.next_follow_up_at).getTime() < renderNow && crmLeadStageConfig[contact.stage].active);
        const canAct = manager || contact.owner_id === session.user.id;
        const nextOptions = allowedCrmTransitions[contact.stage];
        const remainingIdentityKinds = (["phone", "email", "telegram"] as CrmIdentityKind[]).filter((kind) => !contactIdentities.some((identity) => identity.kind === kind));
        return <article className={`crm-contact-card workflow-entity-card ${overdue ? "overdue" : ""}`} data-card-state={overdue ? "overdue" : contact.stage} key={contact.id} id={`crm-${contact.id}`}><div className="crm-contact-top"><div><p className="overline">{crmSourceConfig[contact.source].label} · {crmInterestConfig[contact.interest].label}</p><h3 className="workflow-card-heading">{contact.full_name}</h3></div><StatusBadge tone={crmLeadStageConfig[contact.stage].tone}>{crmLeadStageConfig[contact.stage].shortLabel}</StatusBadge></div>
          <dl className="crm-contact-meta">
            {contactIdentities.map((identity) => <div key={identity.id}><dt>{crmIdentityKindConfig[identity.kind].label}{identity.is_primary ? " · أساسية" : ""}</dt><dd dir="ltr">{identity.value}</dd></div>)}
            <div><dt><CircleUserRound size={13} /> المسؤول</dt><dd>{peopleById.get(contact.owner_id)?.name ?? "عضو فريق"}</dd></div>
            {contact.next_follow_up_at ? <div><dt><CalendarClock size={13} /> المتابعة</dt><dd>{formatDate(contact.next_follow_up_at)}</dd></div> : null}
            {contact.source_registered_at ? <div><dt><FileClock size={13} /> تاريخ التسجيل</dt><dd>{formatDate(contact.source_registered_at)}</dd></div> : null}
          </dl>
          {contactConversationLinks.length ? <div className="crm-chat-links">{contactConversationLinks.map((link) => <a href={link.url} target="_blank" rel="noreferrer" key={link.id}><ExternalLink size={12} /> فتح شات {link.label ?? crmConversationChannelConfig[link.channel].label}</a>)}</div> : null}
          {contact.notes ? <p className="crm-contact-notes">{contact.notes}</p> : null}
          {overdue ? <span className="overdue-label"><AlertTriangle size={13} /> المتابعة متأخرة</span> : null}
          {openTask ? <a className="crm-task-link" href="/tasks"><Route size={12} /> المهمة: {taskStatusConfig[openTask.status].label}</a> : <span className="crm-task-complete"><CheckCircle2 size={12} /> لا توجد متابعة مفتوحة</span>}
          <div className="crm-card-actions">{canAct && remainingIdentityKinds.length ? <button className="text-button" type="button" onClick={() => setIdentityFormId(identityFormId === contact.id ? null : contact.id)}><Plus size={13} /> إضافة وسيلة تواصل</button> : null}{canAct && nextOptions.length ? <button className="text-button" type="button" onClick={() => { const opening = activityFormId !== contact.id; setActivityFormId(opening ? contact.id : null); setActivityStage(contact.stage); }}><MessageSquareText size={13} /> تسجيل نتيجة متابعة</button> : null}</div>
          {identityFormId === contact.id && canAct && remainingIdentityKinds.length ? <form className="crm-activity-form" onSubmit={(event) => void addIdentity(event, contact)}><label><span>نوع الوسيلة الجديدة</span><select name="identity_kind">{remainingIdentityKinds.map((kind) => <option value={kind} key={kind}>{crmIdentityKindConfig[kind].label}</option>)}</select></label><label><span>القيمة</span><input name="identity_value" dir="ltr" minLength={3} maxLength={320} required placeholder="أدخل الهاتف أو البريد أو اسم Telegram" /></label><label className="crm-checkbox"><input name="make_primary" type="checkbox" /><span>اجعلها وسيلة التواصل الأساسية</span></label><div className="form-actions"><Button type="submit" disabled={working}>حفظ الوسيلة</Button><button className="text-button" type="button" onClick={() => setIdentityFormId(null)}>إلغاء</button></div></form> : null}
          {contactActivities.length ? <details className="crm-history"><summary><History size={13} /> أحدث الأنشطة المسجلة</summary><ol>{contactActivities.slice(0, 4).map((activity) => <li key={activity.id}><strong>{activity.kind === "created" ? "إنشاء الملف" : crmActivityKindConfig[activity.kind].label}</strong><p>{activity.summary}</p><small>{formatDate(activity.occurred_at)} · {crmLeadStageConfig[activity.to_stage].label}</small></li>)}</ol></details> : null}
          {activityFormId === contact.id && canAct ? <form className="crm-activity-form" onSubmit={(event) => void recordActivity(event, contact)}><label><span>طريقة المتابعة</span><select name="kind" defaultValue="message">{(Object.keys(crmActivityKindConfig) as Exclude<CrmActivityKind, "created">[]).map((kind) => <option value={kind} key={kind}>{crmActivityKindConfig[kind].label}</option>)}</select></label><label><span>المرحلة بعد المتابعة</span><select value={activityStage} onChange={(event) => setActivityStage(event.target.value as CrmLeadStage)}>{nextOptions.map((option) => <option value={option} key={option}>{crmLeadStageConfig[option].label}</option>)}</select></label><label><span>{["lost", "do_not_contact"].includes(activityStage) ? "سبب الإغلاق" : "نتيجة التواصل"}</span><textarea name="summary" minLength={3} maxLength={["lost", "do_not_contact"].includes(activityStage) ? 1000 : 4000} rows={3} required placeholder="ما الذي حدث؟ وما القرار أو الخطوة التالية؟" /></label>{crmLeadStageConfig[activityStage].active ? <label><span>موعد المتابعة التالية</span><input name="next_follow_up_at" type="datetime-local" defaultValue={defaultFollowUp} required /></label> : <p className="crm-close-note">سيتم إغلاق مهمة المتابعة الحالية ولن تُنشأ مهمة جديدة.</p>}<div className="form-actions"><Button type="submit" disabled={working}>{working ? <LoaderCircle className="spin" size={14} /> : <CheckCircle2 size={14} />} حفظ النتيجة</Button><button className="text-button" type="button" onClick={() => setActivityFormId(null)}>إلغاء</button></div></form> : null}
        </article>;
      })}{!stageContacts.length ? <div className="column-empty"><span>—</span><p>لا يوجد</p></div> : null}</div></section>;
    })}</div> : <section className="panel empty-state"><span className="empty-visual">{hasFilters ? <Search size={20} /> : <ContactRound size={20} />}</span><div><h2>{hasFilters ? "لا توجد نتائج مطابقة" : "CRM جاهز بدون بيانات وهمية"}</h2><p>{hasFilters ? "غيّر كلمة البحث أو المسؤول أو المرحلة أو نطاق المتابعة." : "أدخل ملفًا واحدًا بنفسك عند الجاهزية، وسيظهر معه موعد المتابعة ومهمته في البورد."}</p></div><span className="empty-proof"><ShieldCheck size={15} /> لا يوجد استيراد تلقائي</span></section>}

    {totalCount > PAGE_SIZE ? <nav className="crm-pagination" aria-label="صفحات نتائج العملاء"><button type="button" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}><ChevronRight size={15} /> السابق</button><span>صفحة {page + 1} من {totalPages}</span><button type="button" disabled={page + 1 >= totalPages} onClick={() => setPage((value) => value + 1)}>التالي <ChevronLeft size={15} /></button></nav> : null}
    <aside className="automation-note"><LockKeyhole size={17} /><div><strong>{platformAdmin ? "استيراد Telegram متاح لك وحدك من زر أعلى الصفحة" : "التكاملات تحت تحكم إدارة المنصة"}</strong><p>{platformAdmin ? "حلّل الملف، راجع كل صف، ثم اعتمد الدفعة. السجل يحفظ نتيجة كل عميل ويتيح تراجعًا آمنًا." : "لن تظهر لك أدوات الاستيراد أو مفاتيح التكامل؛ ترى فقط العملاء المسموح لك بمتابعتهم."}</p></div></aside>
  </section>;
}
