"use client";

import type { Session } from "@supabase/supabase-js";
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ContactRound, FileClock, Filter, FolderOpen, LoaderCircle, LockKeyhole, Plus, RefreshCw, Route, Search, ShieldCheck, Sparkles, X } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { crmInterestConfig, crmLeadStageConfig, crmLeadStages, crmSourceConfig, crmTradingExperienceConfig, type CrmInterest, type CrmLeadStage, type CrmSource, type CrmTradingExperience } from "../../lib/crm";
import { crmContactDeepLink, taskDeepLink } from "../../lib/deep-links";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Database, Tables } from "../../lib/supabase/database.types";
import { useWorkspaceAuth } from "../../lib/supabase/use-workspace-auth";
import { canManageTasks } from "../../lib/tasks";
import { Button } from "../ui/Button";
import { SegmentedProgress, type SegmentedProgressStep } from "../ui/SegmentedProgress";
import { StatusBadge } from "../ui/StatusBadge";

type Contact = Tables<"crm_contacts">;
type Identity = Tables<"crm_identities">;
type Task = Tables<"tasks">;
type Membership = Tables<"memberships">;
type Organization = Tables<"organizations">;
type TeamPerson = { id: string; name: string; role: Membership["role"] };
type Workspace = { organization: Organization; membership: Membership; people: TeamPerson[] };
type OwnerPerformance = Database["public"]["Functions"]["get_crm_owner_performance_v2"]["Returns"][number];
type ScopeFilter = "all" | "mine" | "overdue";
type ViewFilter = "all" | "current" | "archive";
type QueueFilter = "all" | "new" | "today" | "overdue" | "waiting" | "interested" | "converted" | "lost";
type PriorityFilter = "all" | "high";
type LeadSegment = "all" | "indicator" | "cashback" | "other";
type PrimaryView = "new" | "today" | "current" | "indicator" | "cashback" | "all";

const PAGE_SIZE = 25;
const crmProgressStages: Array<{ id: CrmLeadStage; label: string }> = [
  { id: "new", label: "جديد" },
  { id: "contacted", label: "تواصل" },
  { id: "follow_up", label: "مهتم" },
  { id: "qualified", label: "مؤهل" },
  { id: "won", label: "عميل حالي" },
];
const primaryViews: Array<{ id: PrimaryView; label: string }> = [
  { id: "new", label: "عملاء جدد" },
  { id: "today", label: "متابعة اليوم" },
  { id: "current", label: "عملاء حاليون" },
  { id: "indicator", label: "عملاء المؤشر" },
  { id: "cashback", label: "عملاء الكاش باك" },
  { id: "all", label: "كل العملاء" },
];

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) return String(error.message);
  return "حدث خطأ غير متوقع.";
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function CrmCustomerDirectory() {
  const configured = isSupabaseConfigured();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(configured);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<CrmSource | "">("");
  const [interestFilter, setInterestFilter] = useState<CrmInterest | "">("");
  const [tradingExperienceFilter, setTradingExperienceFilter] = useState<CrmTradingExperience | "">("");
  const [stageFilter, setStageFilter] = useState<CrmLeadStage | "">("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [salesOwnerIds, setSalesOwnerIds] = useState<string[]>([]);
  const [ownerPerformance, setOwnerPerformance] = useState<OwnerPerformance[]>([]);
  const [priorities, setPriorities] = useState(new Map<string, { score: number; reason: string }>());
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [viewFilter, setViewFilter] = useState<ViewFilter>("all");
  const [primaryView, setPrimaryView] = useState<PrimaryView>("new");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [expandedContactId, setExpandedContactId] = useState<string | null>(null);
  const filterCloseRef = useRef<HTMLButtonElement>(null);
  const [page, setPage] = useState(0);
  const [renderNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(configured ? null : "لم يتم إعداد اتصال Supabase لهذه النسخة.");

  const clearData = useCallback(() => {
    setContacts([]);
    setIdentities([]);
    setTasks([]);
    setTotalCount(0);
    setOwnerPerformance([]);
    setPriorities(new Map());
  }, []);

  const clearWorkspace = useCallback(() => {
    setWorkspace(null);
    setSalesOwnerIds([]);
    clearData();
  }, [clearData]);

  const loadWorkspace = useCallback(async (activeSession: Session) => {
    const supabase = getSupabaseBrowserClient();
    setLoading(true);
    setError(null);
    try {
      const { data: membership, error: membershipError } = await supabase.from("memberships").select("*").eq("user_id", activeSession.user.id).eq("status", "active").limit(1).maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) return clearWorkspace();
      const [organizationResult, membersResult] = await Promise.all([
        supabase.from("organizations").select("*").eq("id", membership.organization_id).single(),
        supabase.from("memberships").select("user_id, role").eq("organization_id", membership.organization_id).eq("status", "active"),
      ]);
      if (organizationResult.error) throw organizationResult.error;
      if (membersResult.error) throw membersResult.error;
      const memberIds = (membersResult.data ?? []).map((member) => member.user_id);
      const profilesResult = memberIds.length ? await supabase.from("profiles").select("id, full_name").in("id", memberIds) : { data: [], error: null };
      if (profilesResult.error) throw profilesResult.error;
      setWorkspace({
        organization: organizationResult.data,
        membership,
        people: (membersResult.data ?? []).map((member) => ({
          id: member.user_id,
          role: member.role,
          name: profilesResult.data?.find((profile) => profile.id === member.user_id)?.full_name ?? (member.user_id === activeSession.user.id ? activeSession.user.email : null) ?? "عضو فريق",
        })),
      });
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [clearWorkspace]);

  const session = useWorkspaceAuth({ configured, loadWorkspace, clearWorkspace, setLoading });
  const manager = Boolean(workspace && canManageTasks(workspace.membership.role));
  const queueFilter: QueueFilter = primaryView === "new" ? "new" : primaryView === "today" ? "today" : primaryView === "current" ? "converted" : "all";
  const leadSegment: LeadSegment = primaryView === "indicator" ? "indicator" : primaryView === "cashback" ? "cashback" : "all";

  const refreshDirectory = useCallback(async (organizationId: string) => {
    const supabase = getSupabaseBrowserClient();
    setDirectoryLoading(true);
    setError(null);
    try {
      const [searchResult, performanceResult] = await Promise.all([supabase.rpc("search_crm_contacts_v8", {
        target_organization_id: organizationId,
        search_query: searchQuery,
        target_owner_id: (ownerFilter || null) as unknown as string,
        target_stage: (stageFilter || null) as unknown as CrmLeadStage,
        target_source: (sourceFilter || null) as unknown as CrmSource,
        target_interest: (interestFilter || null) as unknown as CrmInterest,
        target_trading_experience: (tradingExperienceFilter || null) as unknown as CrmTradingExperience,
        target_scope: scopeFilter,
        target_view: viewFilter,
        target_queue: queueFilter,
        target_priority: priorityFilter,
        target_segment: leadSegment,
        result_limit: PAGE_SIZE,
        result_offset: page * PAGE_SIZE,
      }), manager
        ? supabase.rpc("get_crm_owner_performance_v2", { target_organization_id: organizationId, target_range_days: 30 })
        : Promise.resolve({ data: [] as OwnerPerformance[], error: null })]);
      if (searchResult.error) throw searchResult.error;
      if (performanceResult.error) throw performanceResult.error;
      const nextSalesOwnerIds = (performanceResult.data ?? []).map((metric) => metric.owner_id);
      setOwnerPerformance(performanceResult.data ?? []);
      setSalesOwnerIds(nextSalesOwnerIds);
      setOwnerFilter((current) => current && !nextSalesOwnerIds.includes(current) ? "" : current);
      const matches = searchResult.data ?? [];
      const contactIds = matches.map((match) => match.contact_id);
      setPriorities(new Map(matches.map((match) => [match.contact_id, { score: Number(match.priority_score), reason: match.priority_reason }])));
      setTotalCount(Number(matches[0]?.total_count ?? 0));
      if (!contactIds.length) {
        clearData();
        if (page > 0) setPage(0);
        return;
      }
      const [contactsResult, identitiesResult, tasksResult] = await Promise.all([
        supabase.from("crm_contacts").select("*").in("id", contactIds),
        supabase.from("crm_identities").select("*").in("contact_id", contactIds).order("is_primary", { ascending: false }),
        supabase.from("tasks").select("*").eq("organization_id", organizationId).in("crm_contact_id", contactIds).order("due_at", { ascending: true }),
      ]);
      for (const result of [contactsResult, identitiesResult, tasksResult]) if (result.error) throw result.error;
      const order = new Map(contactIds.map((id, index) => [id, index]));
      setContacts([...(contactsResult.data ?? [])].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)));
      setIdentities(identitiesResult.data ?? []);
      setTasks(tasksResult.data ?? []);
    } catch (directoryError) {
      setError(getErrorMessage(directoryError));
    } finally {
      setDirectoryLoading(false);
    }
  }, [clearData, interestFilter, leadSegment, manager, ownerFilter, page, priorityFilter, queueFilter, scopeFilter, searchQuery, sourceFilter, stageFilter, tradingExperienceFilter, viewFilter]);

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
    const timeout = window.setTimeout(() => void refreshDirectory(workspace.organization.id), 0);
    return () => window.clearTimeout(timeout);
  }, [refreshDirectory, workspace]);

  useEffect(() => {
    if (!showFilters) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    filterCloseRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowFilters(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [showFilters]);

  useEffect(() => {
    if (!workspace) return;
    const supabase = getSupabaseBrowserClient();
    const refresh = () => void refreshDirectory(workspace.organization.id);
    let channel = supabase.channel(`crm-directory:${workspace.organization.id}`);
    for (const table of ["crm_contacts", "crm_identities", "tasks"] as const) channel = channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `organization_id=eq.${workspace.organization.id}` }, refresh);
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refreshDirectory, workspace]);

  const identitiesByContact = useMemo(() => {
    const grouped = new Map<string, Identity[]>();
    for (const identity of identities) grouped.set(identity.contact_id, [...(grouped.get(identity.contact_id) ?? []), identity]);
    return grouped;
  }, [identities]);
  const tasksByContact = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    for (const task of tasks) if (task.crm_contact_id) grouped.set(task.crm_contact_id, [...(grouped.get(task.crm_contact_id) ?? []), task]);
    return grouped;
  }, [tasks]);

  if (loading) return <section className="workspace-state" aria-live="polite"><LoaderCircle aria-hidden="true" className="spin" size={24} /><div><h2>جارٍ تحميل دليل العملاء</h2><p>نتحقق من الحساب والصلاحيات.</p></div></section>;
  if (!session) return <section className="workspace-state workspace-onboarding"><LockKeyhole aria-hidden="true" size={27} /><div><p className="overline">دخول موحد</p><h2>سجّل الدخول أولًا</h2><p>بيانات العملاء لا تظهر دون جلسة موثقة.</p></div><Button href="/login"><Route aria-hidden="true" size={16} /> تسجيل الدخول</Button></section>;
  if (!workspace) return <section className="workspace-state workspace-onboarding"><ShieldCheck aria-hidden="true" size={27} /><div><p className="overline">صلاحية CRM مطلوبة</p><h2>الحساب غير مرتبط بمساحة عمل نشطة</h2></div></section>;

  const peopleById = new Map(workspace.people.map((person) => [person.id, person]));
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const hasFilters = Boolean(searchQuery || sourceFilter || interestFilter || tradingExperienceFilter || stageFilter || ownerFilter || scopeFilter !== "all" || viewFilter !== "all" || primaryView !== "new" || priorityFilter !== "all");
  const visibleSalesOwnerIds = new Set([...salesOwnerIds, ...(manager ? [session.user.id] : [])]);
  const salesPeople = workspace.people.filter((person) => visibleSalesOwnerIds.has(person.id));
  const firstVisible = totalCount ? page * PAGE_SIZE + 1 : 0;
  const lastVisible = Math.min(totalCount, page * PAGE_SIZE + contacts.length);
  const visibleStages = crmLeadStages.filter((stage) => viewFilter === "all"
    || (viewFilter === "current" ? crmLeadStageConfig[stage].active : !crmLeadStageConfig[stage].active));
  const activeFilterCount = [sourceFilter, interestFilter, tradingExperienceFilter, stageFilter, ownerFilter].filter(Boolean).length
    + (scopeFilter !== "all" ? 1 : 0)
    + (viewFilter !== "all" ? 1 : 0)
    + (priorityFilter !== "all" ? 1 : 0);

  function resetFilters() {
    setSourceFilter("");
    setInterestFilter("");
    setTradingExperienceFilter("");
    setStageFilter("");
    setOwnerFilter("");
    setScopeFilter("all");
    setViewFilter("all");
    setPriorityFilter("all");
    setPrimaryView("new");
    setPage(0);
  }

  return <section className="crm-directory-workspace">
    <div className="workspace-toolbar">
      <div><p className="overline">{workspace.organization.name}</p><h1>العملاء</h1><p>{directoryLoading ? "جارٍ تحديث القائمة…" : `${totalCount.toLocaleString("ar-EG")} عميل مطابق ضمن صلاحية حسابك.`}</p></div>
      <div className="toolbar-actions"><button className="icon-button" type="button" aria-label="تحديث دليل العملاء" disabled={directoryLoading} onClick={() => void refreshDirectory(workspace.organization.id)}><RefreshCw aria-hidden="true" className={directoryLoading ? "spin" : ""} size={17} /></button>{workspace.membership.role !== "viewer" ? <Button href="/crm/operations?add=1"><Plus aria-hidden="true" size={15} /> عميل جديد</Button> : null}<Button href="/crm/operations" variant="secondary"><Route aria-hidden="true" size={15} /> إعداد المتابعة</Button></div>
    </div>
    {error ? <p className="form-notice error" role="alert">{error}</p> : null}

    <nav className="crm-queue-tabs crm-primary-customer-views" aria-label="قوائم العملاء الأساسية">
      {primaryViews.map((view) => <button type="button" className={primaryView === view.id ? "active" : ""} aria-current={primaryView === view.id ? "page" : undefined} onClick={() => { setPrimaryView(view.id); setInterestFilter(""); setStageFilter(""); setViewFilter("all"); setPage(0); }} key={view.id}>{view.label}{primaryView === view.id ? <span>{totalCount.toLocaleString("ar-EG")}</span> : null}</button>)}
    </nav>

    {manager && ownerPerformance.length ? <section className="crm-sales-scoreboard" aria-label="ملخص أداء فريق السيلز">{ownerPerformance.map((metric) => {
      const person = peopleById.get(metric.owner_id);
      const total = Number(metric.total_contacts);
      const won = Number(metric.won_contacts);
      const completed = Number(metric.completed_follow_ups);
      const onTime = Number(metric.on_time_follow_ups);
      return <article key={metric.owner_id}><header><strong>{person?.name ?? "مسؤول سيلز"}</strong><button type="button" onClick={() => { setOwnerFilter(metric.owner_id); setPage(0); }}>عرض العملاء</button></header><dl><div><dt>العملاء</dt><dd>{total}</dd></div><div><dt>عملاء حاليون</dt><dd>{won}</dd></div><div><dt>لم يشتروا</dt><dd>{metric.lost_contacts}</dd></div><div><dt>التزام المتابعة</dt><dd>{completed ? `${Math.round(onTime / completed * 100)}%` : "—"}</dd></div><div><dt>متوسط أول رد</dt><dd>{metric.average_first_response_minutes == null ? "—" : `${Math.round(Number(metric.average_first_response_minutes))} د`}</dd></div></dl></article>;
    })}</section> : null}

    <section className="crm-report-toolbar" aria-label="البحث وأدوات دليل العملاء">
      <label className="crm-search-field"><Search aria-hidden="true" size={16} /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="ابحث بالاسم، الهاتف، البريد، TradingView أو نتيجة التواصل…" aria-label="البحث في دليل العملاء" />{searchInput ? <button type="button" onClick={() => setSearchInput("")}>مسح</button> : null}</label>
      <button className="crm-filter-trigger" type="button" aria-expanded={showFilters} aria-controls="crm-filter-dialog" onClick={() => setShowFilters(true)}><Filter aria-hidden="true" size={16} /> تصفية {activeFilterCount ? <span>{activeFilterCount}</span> : null}</button>
      <p>{searchInput.trim().length === 1 ? "اكتب حرفين على الأقل لبدء البحث." : `يعرض ${firstVisible.toLocaleString("ar-EG")}–${lastVisible.toLocaleString("ar-EG")} من ${totalCount.toLocaleString("ar-EG")} نتيجة.`}</p>
    </section>

    {showFilters ? <div className="crm-filter-backdrop" role="presentation">
      <button className="crm-filter-dismiss" type="button" aria-label="إغلاق التصفية" onClick={() => setShowFilters(false)} />
      <section id="crm-filter-dialog" className="crm-filter-dialog" role="dialog" aria-modal="true" aria-labelledby="crm-filter-title">
        <header><h2 id="crm-filter-title">تصفية</h2><button ref={filterCloseRef} type="button" aria-label="إغلاق" onClick={() => setShowFilters(false)}><X aria-hidden="true" size={20} /></button></header>
        <div className="crm-directory-filter-grid">
        <label><span>المصدر</span><select value={sourceFilter} onChange={(event) => { setSourceFilter(event.target.value as CrmSource | ""); setPage(0); }}><option value="">كل المصادر</option>{(Object.keys(crmSourceConfig) as CrmSource[]).map((source) => <option value={source} key={source}>{crmSourceConfig[source].label}</option>)}</select></label>
        <label><span>الاهتمام</span><select value={interestFilter} onChange={(event) => { setInterestFilter(event.target.value as CrmInterest | ""); setPage(0); }}><option value="">كل الاهتمامات</option>{(Object.keys(crmInterestConfig) as CrmInterest[]).map((interest) => <option value={interest} key={interest}>{crmInterestConfig[interest].label}</option>)}</select></label>
        <label><span>خبرة التداول</span><select value={tradingExperienceFilter} onChange={(event) => { setTradingExperienceFilter(event.target.value as CrmTradingExperience | ""); setPage(0); }}><option value="">كل مستويات الخبرة</option>{(Object.keys(crmTradingExperienceConfig) as CrmTradingExperience[]).map((experience) => <option value={experience} key={experience}>{crmTradingExperienceConfig[experience].label}</option>)}</select></label>
        <label><span>المرحلة</span><select value={stageFilter} onChange={(event) => { setStageFilter(event.target.value as CrmLeadStage | ""); setPage(0); }}><option value="">كل المراحل</option>{visibleStages.map((stage) => <option value={stage} key={stage}>{crmLeadStageConfig[stage].label}</option>)}</select></label>
        {manager ? <label><span>مسؤول السيلز</span><select value={ownerFilter} onChange={(event) => { setOwnerFilter(event.target.value); setPage(0); }}><option value="">كل العملاء</option>{salesPeople.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label> : null}
        <label><span>نطاق المسؤولية</span><select value={scopeFilter} onChange={(event) => { setScopeFilter(event.target.value as ScopeFilter); setPage(0); }}><option value="all">كل المتاح</option><option value="mine">عملائي فقط</option><option value="overdue">متابعة متأخرة</option></select></label>
        <label><span>حالة الملف</span><select value={viewFilter} onChange={(event) => { const nextView = event.target.value as ViewFilter; setViewFilter(nextView); setStageFilter(""); if (nextView === "archive" && scopeFilter === "overdue") setScopeFilter("all"); setPage(0); }}><option value="all">الحالي والأرشيف</option><option value="current">المتابعات الحالية</option><option value="archive">الملفات المحسومة</option></select></label>
        <label><span>الأولوية المقترحة</span><select value={priorityFilter} onChange={(event) => { setPriorityFilter(event.target.value as PriorityFilter); setPage(0); }}><option value="all">كل الأولويات</option><option value="high">الأعلى للتواصل الآن</option></select></label>
        </div>
        <footer><Button type="button" onClick={() => setShowFilters(false)}>تطبيق</Button><Button type="button" variant="secondary" onClick={resetFilters}>إزالة المرشحات</Button></footer>
      </section>
    </div> : null}

    {contacts.length ? <div className="crm-directory-table-wrap" role="region" aria-label="جدول العملاء"><table className="crm-directory-table"><thead><tr><th>#</th><th>العميل</th><th>المصدر</th><th>خبرة التداول</th><th>المسؤول</th><th>المرحلة</th><th>الأولوية</th><th>مستوى التقدم</th><th>المتابعة التالية</th><th>آخر تواصل</th><th><span className="sr-only">فتح الملف</span></th></tr></thead><tbody>{contacts.map((contact, index) => {
      const contactIdentities = identitiesByContact.get(contact.id) ?? [];
      const openTask = (tasksByContact.get(contact.id) ?? []).find((task) => !["done", "cancelled"].includes(task.status));
      const overdue = Boolean(contact.next_follow_up_at && new Date(contact.next_follow_up_at).getTime() < renderNow && crmLeadStageConfig[contact.stage].active);
      const stageIndex = crmProgressStages.findIndex((stage) => stage.id === contact.stage);
      const progressSteps: SegmentedProgressStep[] = crmProgressStages.map((stage, progressIndex) => ({
        id: stage.id,
        label: stage.label,
        state: contact.stage === "lost" || contact.stage === "do_not_contact"
          ? "upcoming"
          : progressIndex < stageIndex ? "done" : progressIndex === stageIndex ? "current" : "upcoming",
      }));
      const expanded = expandedContactId === contact.id;
      const priority = priorities.get(contact.id);
      return <Fragment key={contact.id}><tr className={`${overdue ? "overdue" : ""} ${expanded ? "expanded" : ""}`}>
        <td data-label="#"><strong className="crm-directory-row-number">{page * PAGE_SIZE + index + 1}</strong></td>
        <td data-label="العميل"><a className="crm-directory-customer-link" href={crmContactDeepLink(contact.id)}><strong>{contact.full_name}</strong><small>{crmInterestConfig[contact.interest].label}</small></a><div className="crm-directory-identities">{contactIdentities.slice(0, 1).map((identity) => <span key={identity.id}><b dir="ltr">{identity.value}</b></span>)}</div></td>
        <td data-label="المصدر"><strong>{crmSourceConfig[contact.source].label}</strong>{contact.source_detail ? <small>{contact.source_detail}</small> : null}</td>
        <td data-label="خبرة التداول"><strong>{crmTradingExperienceConfig[contact.trading_experience].label}</strong></td>
        <td data-label="المسؤول"><strong>{peopleById.get(contact.owner_id)?.name ?? "غير مسند للسيلز الحالي"}</strong></td>
        <td data-label="المرحلة"><StatusBadge tone={crmLeadStageConfig[contact.stage].tone}>{crmLeadStageConfig[contact.stage].shortLabel}</StatusBadge></td>
        <td data-label="الأولوية">{priority && priority.score >= 55 ? <span className="crm-priority-chip" title={priority.reason}><Sparkles aria-hidden="true" size={12} /> تواصل الآن</span> : <span className="crm-directory-muted">عادية</span>}</td>
        <td data-label="مستوى التقدم"><SegmentedProgress steps={progressSteps} compact ariaLabel={`مستوى تقدم ${contact.full_name}`} /></td>
        <td data-label="المتابعة التالية">{contact.next_follow_up_at ? <a href={openTask ? taskDeepLink(openTask.id) : crmContactDeepLink(contact.id)} className={overdue ? "crm-directory-overdue" : "crm-directory-next"}>{overdue ? <AlertTriangle aria-hidden="true" size={12} /> : <CalendarClock aria-hidden="true" size={12} />}<strong>{formatDate(contact.next_follow_up_at)}</strong></a> : <span className="crm-directory-muted"><FileClock aria-hidden="true" size={12} /> لا يوجد موعد</span>}</td>
        <td data-label="آخر تواصل">{contact.last_contacted_at ? <strong dir="ltr">{formatDate(contact.last_contacted_at)}</strong> : <span className="crm-directory-muted">لم يبدأ</span>}</td>
        <td data-label="التفاصيل"><button className="crm-row-expand" type="button" aria-expanded={expanded} aria-controls={`crm-row-${contact.id}`} aria-label={`${expanded ? "إغلاق" : "عرض"} تفاصيل ${contact.full_name}`} onClick={() => setExpandedContactId(expanded ? null : contact.id)}><ChevronDown aria-hidden="true" size={17} /></button></td>
      </tr>{expanded ? <tr className="crm-directory-expanded-row"><td colSpan={11}><section id={`crm-row-${contact.id}`} className="crm-directory-expanded-content">
        <div className="crm-expanded-facts"><div><span>بيانات التواصل</span>{contactIdentities.length ? contactIdentities.map((identity) => <strong dir="ltr" key={identity.id}>{identity.value}</strong>) : <strong>لا توجد بيانات</strong>}</div><div><span>المصدر والاهتمام</span><strong>{crmSourceConfig[contact.source].label} · {crmInterestConfig[contact.interest].label}</strong>{contact.source_detail ? <small>{contact.source_detail}</small> : null}</div><div><span>خبرة التداول</span><strong>{crmTradingExperienceConfig[contact.trading_experience].label}</strong></div><div><span>المسؤول</span><strong>{peopleById.get(contact.owner_id)?.name ?? "غير مسند للسيلز الحالي"}</strong></div><div><span>المتابعة</span><strong>{contact.next_follow_up_at ? formatDate(contact.next_follow_up_at) : "لا يوجد موعد"}</strong>{priority ? <small>{priority.reason}</small> : null}</div></div>
        <div className="crm-expanded-actions">{openTask ? <Button href={taskDeepLink(openTask.id)} variant="secondary"><CalendarClock aria-hidden="true" size={14} /> فتح مهمة المتابعة</Button> : <span className="crm-directory-no-task"><CheckCircle2 aria-hidden="true" size={14} /> لا توجد متابعة مفتوحة</span>}<Button href={crmContactDeepLink(contact.id)}><FolderOpen aria-hidden="true" size={15} /> فتح ملف العميل</Button></div>
      </section></td></tr> : null}</Fragment>;
    })}</tbody></table></div> : <section className="panel empty-state"><span className="empty-visual"><ContactRound aria-hidden="true" size={20} /></span><div><h2>{hasFilters ? "لا توجد نتائج مطابقة" : "لا يوجد عملاء متاحون"}</h2><p>{hasFilters ? "غيّر البحث أو المصدر أو المرحلة أو المسؤول." : "سيظهر العملاء هنا بمجرد إضافتهم أو وصولهم من أحد المصادر المربوطة."}</p></div></section>}

    {totalCount > PAGE_SIZE ? <nav className="crm-pagination" aria-label="صفحات دليل العملاء"><button type="button" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}><ChevronRight aria-hidden="true" size={15} /> السابق</button><span>صفحة {page + 1} من {totalPages}</span><button type="button" disabled={page + 1 >= totalPages} onClick={() => setPage((value) => value + 1)}>التالي <ChevronLeft aria-hidden="true" size={15} /></button></nav> : null}
  </section>;
}
