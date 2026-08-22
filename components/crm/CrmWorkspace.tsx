"use client";

import type { Session } from "@supabase/supabase-js";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  ContactRound,
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
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  allowedCrmTransitions,
  crmActivityKindConfig,
  crmConversationChannelConfig,
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
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Database, Tables } from "../../lib/supabase/database.types";
import { getSupabaseFunctionErrorMessage } from "../../lib/supabase/function-errors";
import { useWorkspaceAuth } from "../../lib/supabase/use-workspace-auth";
import { canManageTasks, taskStatusConfig } from "../../lib/tasks";
import { Button } from "../ui/Button";
import { StatusBadge } from "../ui/StatusBadge";

type Contact = Tables<"crm_contacts">;
type Identity = Tables<"crm_identities">;
type Activity = Tables<"crm_activities">;
type ConversationLink = Tables<"crm_conversation_links">;
type Task = Tables<"tasks">;
type Membership = Tables<"memberships">;
type Organization = Tables<"organizations">;
type OwnerPerformance = Database["public"]["Functions"]["get_crm_owner_performance"]["Returns"][number];
type TeamPerson = { id: string; name: string; role: Membership["role"] };
type Workspace = { organization: Organization; membership: Membership; people: TeamPerson[] };
type Filter = "all" | "mine" | "overdue";

const PAGE_SIZE = 60;

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
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(configured);
  const [crmLoading, setCrmLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
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

  const clearData = useCallback(() => {
    setContacts([]);
    setIdentities([]);
    setActivities([]);
    setConversationLinks([]);
    setTasks([]);
    setOwnerPerformance([]);
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
      const [searchResult, performanceResult] = await Promise.all([
        supabase.rpc("search_crm_contacts", {
          target_organization_id: organizationId,
          search_query: searchQuery,
          target_owner_id: (ownerFilter || null) as unknown as string,
          target_stage: (stageFilter || null) as unknown as CrmLeadStage,
          target_scope: filter,
          result_limit: PAGE_SIZE,
          result_offset: page * PAGE_SIZE,
        }),
        manager
          ? supabase.rpc("get_crm_owner_performance", { target_organization_id: organizationId, target_range_days: performanceRange })
          : Promise.resolve({ data: [] as OwnerPerformance[], error: null }),
      ]);
      if (searchResult.error) throw searchResult.error;
      if (performanceResult.error) throw performanceResult.error;

      const matches = searchResult.data ?? [];
      const contactIds = matches.map((match) => match.contact_id);
      setTotalCount(Number(matches[0]?.total_count ?? 0));
      setOwnerPerformance(performanceResult.data ?? []);
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
  }, [filter, manager, ownerFilter, page, performanceRange, searchQuery, stageFilter]);

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
    if (!showCreate) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowCreate(false);
    };
    const focusFrame = window.requestAnimationFrame(() => createNameInputRef.current?.focus());
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [showCreate]);

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
    const identities = (["phone", "email", "telegram"] as CrmIdentityKind[])
      .map((kind) => ({ kind, value: formText(form, `identity_${kind}`) }))
      .filter((identity) => identity.value);
    if (!identities.length) return setError("أضف وسيلة تواصل واحدة على الأقل: هاتف أو بريد أو Telegram.");
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

  return <section className="crm-workspace">
    <div className="workspace-toolbar">
      <div><p className="overline">{workspace.organization.name}</p><h2>خط متابعة العملاء</h2><p>{crmLoading ? "جارٍ تحديث النتائج…" : `${totalCount} نتيجة مطابقة — البحث والفلاتر يعملان على كل بيانات CRM المتاحة لصلاحيتك.`}</p></div>
      <div className="toolbar-actions">
        <button className="icon-button" type="button" aria-label="تحديث CRM" disabled={crmLoading} onClick={() => void refreshSafely(workspace.organization.id)}><RefreshCw className={crmLoading ? "spin" : ""} size={17} /></button>
        <Button href="/tasks" variant="secondary"><Route size={16} /> مهام المتابعة</Button>
        {canCreate ? <Button type="button" aria-expanded={showCreate} aria-controls="crm-create-dialog" onClick={() => setShowCreate(true)}><Plus size={16} /> عميل محتمل جديد</Button> : null}
      </div>
    </div>

    {notice ? <p className="form-notice success" role="status">{notice}</p> : null}
    {error ? <p className="form-notice error" role="alert">{error}</p> : null}

    <div className="crm-kpi-strip" aria-label="ملخص CRM الحقيقي">
      <div><ContactRound size={17} /><span>إجمالي المتاح</span><strong>{manager ? totals.all : totalCount}</strong></div>
      <div className={totals.overdue ? "attention" : ""}><AlertTriangle size={17} /><span>متابعات متأخرة</span><strong>{manager ? totals.overdue : contacts.filter((contact) => contact.next_follow_up_at && new Date(contact.next_follow_up_at).getTime() < renderNow).length}</strong></div>
      <div><FileClock size={17} /><span>عملاء جدد</span><strong>{manager ? totals.fresh : contacts.filter((contact) => contact.stage === "new").length}</strong></div>
      <div><CheckCircle2 size={17} /><span>صفقات ناجحة</span><strong>{manager ? totals.won : contacts.filter((contact) => contact.stage === "won").length}</strong></div>
    </div>

    <section className="crm-search-panel" aria-label="البحث وفلترة العملاء">
      <label className="crm-search-field"><Search size={16} /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="ابحث بالاسم، الهاتف، البريد، Telegram، المصدر، الملاحظات، لينك الشات أو نتيجة متابعة…" aria-label="البحث في كل بيانات العملاء" />{searchInput ? <button type="button" onClick={() => setSearchInput("")}>مسح</button> : null}</label>
      {manager ? <label><span>المسؤول</span><select value={ownerFilter} onChange={(event) => { setOwnerFilter(event.target.value); setPage(0); }}><option value="">كل المسؤولين</option>{workspace.people.filter((person) => person.role !== "viewer").map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label> : null}
      <label><span>المرحلة</span><select value={stageFilter} onChange={(event) => { setStageFilter(event.target.value as CrmLeadStage | ""); setPage(0); }}><option value="">كل المراحل</option>{crmLeadStages.map((stage) => <option value={stage} key={stage}>{crmLeadStageConfig[stage].label}</option>)}</select></label>
      <div className="crm-filter-row" role="group" aria-label="نطاق العملاء">{(["all", "mine", "overdue"] as Filter[]).map((value) => <button className={filter === value ? "active" : ""} type="button" key={value} onClick={() => { setFilter(value); setPage(0); }}>{value === "all" ? "كل المتاح" : value === "mine" ? "مسؤوليتي" : "متابعة متأخرة"}</button>)}</div>
      <p>{searchInput.trim().length === 1 ? "اكتب حرفين على الأقل لبدء البحث." : `يعرض ${contacts.length} من ${totalCount} نتيجة مطابقة.`}</p>
    </section>

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
        <fieldset className="crm-identities-fieldset full-field"><legend>وسائل التواصل — املأ واحدة أو أكثر</legend><div>{(["phone", "email", "telegram"] as CrmIdentityKind[]).map((kind) => <label key={kind}><span>{crmIdentityKindConfig[kind].label}</span><input name={`identity_${kind}`} type={crmIdentityKindConfig[kind].inputType} dir="ltr" minLength={3} maxLength={320} placeholder={crmIdentityKindConfig[kind].placeholder} /></label>)}</div><label className="crm-primary-select"><span>وسيلة التواصل الأساسية</span><select value={primaryIdentityKind} onChange={(event) => setPrimaryIdentityKind(event.target.value as CrmIdentityKind)}>{(["phone", "email", "telegram"] as CrmIdentityKind[]).map((kind) => <option value={kind} key={kind}>{crmIdentityKindConfig[kind].label}</option>)}</select></label><small>الأساسية هي التي تظهر أولًا؛ جميع الوسائل تمنع تكرار نفس العميل.</small></fieldset>
        <label><span>منصة المحادثة المباشرة — اختياري</span><select name="conversation_channel" value={conversationChannel} onChange={(event) => setConversationChannel(event.target.value as CrmConversationChannel | "")}><option value="">بدون لينك حاليًا</option>{(Object.keys(crmConversationChannelConfig) as CrmConversationChannel[]).map((channel) => <option value={channel} key={channel}>{crmConversationChannelConfig[channel].label}</option>)}</select></label>
        {conversationChannel ? <label><span>لينك شات {crmConversationChannelConfig[conversationChannel].label}</span><input name="conversation_url" type="url" dir="ltr" maxLength={2000} required placeholder={crmConversationChannelConfig[conversationChannel].placeholder} /><small>الصق لينكًا كاملًا يبدأ بـ https://</small></label> : null}
        {manager ? <label><span>مسؤول المتابعة</span><select name="owner_id" defaultValue={session.user.id}>{workspace.people.filter((person) => person.role !== "viewer").map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label> : <input name="owner_id" type="hidden" value={session.user.id} />}
        <label><span>موعد أول متابعة</span><input name="follow_up_at" type="datetime-local" defaultValue={defaultFollowUp} required /></label>
        <label className="full-field"><span>سياق مهم قبل التواصل — اختياري</span><textarea name="notes" maxLength={5000} rows={3} placeholder="ماذا طلب؟ ما الذي سجّل فيه؟ وما الذي يجب أن يعرفه المسؤول؟" /></label>
      </div>
      <div className="form-actions"><Button type="submit" disabled={working}>{working ? <LoaderCircle className="spin" size={16} /> : <UserRoundCheck size={16} />} حفظ وإنشاء مهمة المتابعة</Button><small>إذا كانت أي وسيلة مسجلة من قبل، سيرفض النظام الملف المكرر كله.</small></div>
      </form>
    </div> : null}

    {contacts.length ? <div className="crm-pipeline" aria-label="خط مبيعات العملاء المحتملين">{crmLeadStages.map((stage) => {
      const stageContacts = contacts.filter((contact) => contact.stage === stage);
      return <section className="crm-stage-column" key={stage} aria-labelledby={`crm-stage-${stage}`}><header><StatusBadge tone={crmLeadStageConfig[stage].tone}>{crmLeadStageConfig[stage].shortLabel}</StatusBadge><strong id={`crm-stage-${stage}`}>{stageContacts.length}</strong></header><div className="crm-stage-stack">{stageContacts.map((contact) => {
        const contactIdentities = identitiesByContact.get(contact.id) ?? [];
        const contactActivities = activitiesByContact.get(contact.id) ?? [];
        const contactConversationLinks = conversationLinksByContact.get(contact.id) ?? [];
        const openTask = (tasksByContact.get(contact.id) ?? []).find((task) => task.status !== "done");
        const overdue = Boolean(contact.next_follow_up_at && new Date(contact.next_follow_up_at).getTime() < renderNow && crmLeadStageConfig[contact.stage].active);
        const canAct = manager || contact.owner_id === session.user.id;
        const nextOptions = allowedCrmTransitions[contact.stage];
        const remainingIdentityKinds = (["phone", "email", "telegram"] as CrmIdentityKind[]).filter((kind) => !contactIdentities.some((identity) => identity.kind === kind));
        return <article className={`crm-contact-card ${overdue ? "overdue" : ""}`} key={contact.id} id={`crm-${contact.id}`}><div className="crm-contact-top"><div><p className="overline">{crmSourceConfig[contact.source].label} · {crmInterestConfig[contact.interest].label}</p><h3>{contact.full_name}</h3></div><StatusBadge tone={crmLeadStageConfig[contact.stage].tone}>{crmLeadStageConfig[contact.stage].shortLabel}</StatusBadge></div>
          <dl className="crm-contact-meta">
            {contactIdentities.map((identity) => <div key={identity.id}><dt>{crmIdentityKindConfig[identity.kind].label}{identity.is_primary ? " · أساسية" : ""}</dt><dd dir="ltr">{identity.value}</dd></div>)}
            <div><dt><CircleUserRound size={13} /> المسؤول</dt><dd>{peopleById.get(contact.owner_id)?.name ?? "عضو فريق"}</dd></div>
            {contact.next_follow_up_at ? <div><dt><CalendarClock size={13} /> المتابعة</dt><dd>{formatDate(contact.next_follow_up_at)}</dd></div> : null}
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
    <aside className="automation-note"><LockKeyhole size={17} /><div><strong>التكاملات والرسائل غير مفعّلة</strong><p>Whales Zone وMeta وTelegram والتطبيق مصادر معرفة داخل الملف فقط الآن. لن نستورد أو نراسل أي عميل قبل اعتماد الملكية والموافقة والاختبار.</p></div></aside>
  </section>;
}
