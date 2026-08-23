"use client";

import type { Session } from "@supabase/supabase-js";
import { AlertTriangle, CalendarClock, ChevronLeft, ChevronRight, ContactRound, FileClock, FolderOpen, LoaderCircle, LockKeyhole, RefreshCw, Route, Search, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { crmIdentityKindConfig, crmInterestConfig, crmLeadStageConfig, crmLeadStages, crmSourceConfig, type CrmLeadStage, type CrmSource } from "../../lib/crm";
import { crmContactDeepLink, taskDeepLink, taskReference } from "../../lib/deep-links";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Tables } from "../../lib/supabase/database.types";
import { useWorkspaceAuth } from "../../lib/supabase/use-workspace-auth";
import { canManageTasks, taskStatusConfig } from "../../lib/tasks";
import { Button } from "../ui/Button";
import { StatusBadge } from "../ui/StatusBadge";

type Contact = Tables<"crm_contacts">;
type Identity = Tables<"crm_identities">;
type Task = Tables<"tasks">;
type Membership = Tables<"memberships">;
type Organization = Tables<"organizations">;
type TeamPerson = { id: string; name: string; role: Membership["role"] };
type Workspace = { organization: Organization; membership: Membership; people: TeamPerson[] };
type ScopeFilter = "all" | "mine" | "overdue";
type ViewFilter = "all" | "current" | "archive";

const PAGE_SIZE = 100;

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) return String(error.message);
  return "حدث خطأ غير متوقع.";
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
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
  const [stageFilter, setStageFilter] = useState<CrmLeadStage | "">("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [viewFilter, setViewFilter] = useState<ViewFilter>("all");
  const [page, setPage] = useState(0);
  const [renderNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(configured ? null : "لم يتم إعداد اتصال Supabase لهذه النسخة.");

  const clearData = useCallback(() => {
    setContacts([]);
    setIdentities([]);
    setTasks([]);
    setTotalCount(0);
  }, []);

  const clearWorkspace = useCallback(() => {
    setWorkspace(null);
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

  const refreshDirectory = useCallback(async (organizationId: string) => {
    const supabase = getSupabaseBrowserClient();
    setDirectoryLoading(true);
    setError(null);
    try {
      const searchResult = await supabase.rpc("search_crm_contacts_v3", {
        target_organization_id: organizationId,
        search_query: searchQuery,
        target_owner_id: (ownerFilter || null) as unknown as string,
        target_stage: (stageFilter || null) as unknown as CrmLeadStage,
        target_source: (sourceFilter || null) as unknown as CrmSource,
        target_scope: scopeFilter,
        target_view: viewFilter,
        result_limit: PAGE_SIZE,
        result_offset: page * PAGE_SIZE,
      });
      if (searchResult.error) throw searchResult.error;
      const matches = searchResult.data ?? [];
      const contactIds = matches.map((match) => match.contact_id);
      setTotalCount(Number(matches[0]?.total_count ?? 0));
      if (!contactIds.length) return clearData();
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
  }, [clearData, ownerFilter, page, scopeFilter, searchQuery, sourceFilter, stageFilter, viewFilter]);

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
  const hasFilters = Boolean(searchQuery || sourceFilter || stageFilter || ownerFilter || scopeFilter !== "all" || viewFilter !== "all");

  return <section className="crm-directory-workspace">
    <div className="workspace-toolbar">
      <div><p className="overline">{workspace.organization.name}</p><h2>دليل العملاء</h2><p>{directoryLoading ? "جارٍ تحديث القائمة…" : `${totalCount.toLocaleString("ar-EG")} عميل مطابق ضمن صلاحية حسابك.`}</p></div>
      <div className="toolbar-actions"><button className="icon-button" type="button" aria-label="تحديث دليل العملاء" disabled={directoryLoading} onClick={() => void refreshDirectory(workspace.organization.id)}><RefreshCw aria-hidden="true" className={directoryLoading ? "spin" : ""} size={17} /></button><Button href="/crm" variant="secondary"><Route aria-hidden="true" size={15} /> لوحة المتابعة</Button></div>
    </div>
    {error ? <p className="form-notice error" role="alert">{error}</p> : null}

    <section className="crm-directory-filters panel" aria-label="البحث وفلترة دليل العملاء">
      <label className="crm-search-field"><Search aria-hidden="true" size={16} /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="ابحث بالاسم، الهاتف، البريد، TradingView أو نتيجة التواصل…" aria-label="البحث في دليل العملاء" />{searchInput ? <button type="button" onClick={() => setSearchInput("")}>مسح</button> : null}</label>
      <div className="crm-directory-filter-grid">
        <label><span>المصدر</span><select value={sourceFilter} onChange={(event) => { setSourceFilter(event.target.value as CrmSource | ""); setPage(0); }}><option value="">كل المصادر</option>{(Object.keys(crmSourceConfig) as CrmSource[]).map((source) => <option value={source} key={source}>{crmSourceConfig[source].label}</option>)}</select></label>
        <label><span>المرحلة</span><select value={stageFilter} onChange={(event) => { setStageFilter(event.target.value as CrmLeadStage | ""); setPage(0); }}><option value="">كل المراحل</option>{crmLeadStages.map((stage) => <option value={stage} key={stage}>{crmLeadStageConfig[stage].label}</option>)}</select></label>
        {manager ? <label><span>المسؤول</span><select value={ownerFilter} onChange={(event) => { setOwnerFilter(event.target.value); setPage(0); }}><option value="">كل المسؤولين</option>{workspace.people.filter((person) => person.role !== "viewer").map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label> : null}
        <label><span>حالة الملف</span><select value={viewFilter} onChange={(event) => { setViewFilter(event.target.value as ViewFilter); setPage(0); }}><option value="all">الحالي والأرشيف</option><option value="current">المتابعات الحالية</option><option value="archive">الملفات المحسومة</option></select></label>
      </div>
      <div className="crm-filter-row" role="group" aria-label="نطاق دليل العملاء">{(["all", "mine", "overdue"] as ScopeFilter[]).map((scope) => <button className={scopeFilter === scope ? "active" : ""} type="button" key={scope} onClick={() => { setScopeFilter(scope); setPage(0); }}>{scope === "all" ? "كل المتاح" : scope === "mine" ? "مسؤوليتي" : "متابعة متأخرة"}</button>)}</div>
      <p>{searchInput.trim().length === 1 ? "اكتب حرفين على الأقل لبدء البحث." : `يعرض ${contacts.length.toLocaleString("ar-EG")} من ${totalCount.toLocaleString("ar-EG")} نتيجة.`}</p>
    </section>

    {contacts.length ? <div className="crm-directory-table-wrap" role="region" aria-label="جدول العملاء، يمكن تمريره أفقيًا عند الحاجة"><table className="crm-directory-table"><thead><tr><th>العميل</th><th>المصدر</th><th>التواصل</th><th>الاهتمام</th><th>المرحلة</th><th>المسؤول</th><th>المتابعة</th><th>المهمة</th><th><span className="sr-only">فتح الملف</span></th></tr></thead><tbody>{contacts.map((contact) => {
      const contactIdentities = identitiesByContact.get(contact.id) ?? [];
      const openTask = (tasksByContact.get(contact.id) ?? []).find((task) => !["done", "cancelled"].includes(task.status));
      const overdue = Boolean(contact.next_follow_up_at && new Date(contact.next_follow_up_at).getTime() < renderNow && crmLeadStageConfig[contact.stage].active);
      return <tr className={overdue ? "overdue" : ""} key={contact.id}>
        <td><a className="crm-directory-customer-link" href={crmContactDeepLink(contact.id)}><strong>{contact.full_name}</strong><small dir="ltr">{contact.id.slice(0, 8).toUpperCase()}</small></a></td>
        <td><strong>{crmSourceConfig[contact.source].label}</strong>{contact.source_detail ? <small>{contact.source_detail}</small> : null}</td>
        <td><div className="crm-directory-identities">{contactIdentities.length ? contactIdentities.slice(0, 2).map((identity) => <span key={identity.id}><small>{crmIdentityKindConfig[identity.kind].label}</small><b dir="ltr">{identity.value}</b></span>) : <span><small>لا توجد وسيلة محفوظة</small></span>}</div></td>
        <td><strong>{crmInterestConfig[contact.interest].label}</strong>{contact.interest_detail ? <small>{contact.interest_detail}</small> : null}</td>
        <td><StatusBadge tone={crmLeadStageConfig[contact.stage].tone}>{crmLeadStageConfig[contact.stage].shortLabel}</StatusBadge></td>
        <td><strong>{peopleById.get(contact.owner_id)?.name ?? "عضو فريق"}</strong></td>
        <td>{contact.next_follow_up_at ? <span className={overdue ? "crm-directory-overdue" : ""}>{overdue ? <AlertTriangle aria-hidden="true" size={12} /> : <CalendarClock aria-hidden="true" size={12} />}<strong>{formatDate(contact.next_follow_up_at)}</strong></span> : <span className="crm-directory-muted"><FileClock aria-hidden="true" size={12} /> لا يوجد موعد</span>}</td>
        <td>{openTask ? <a className="crm-directory-task-link" href={taskDeepLink(openTask.id)}><Route aria-hidden="true" size={12} /><span><strong>{taskReference(openTask.id)}</strong><small>{taskStatusConfig[openTask.status].shortLabel}</small></span></a> : <span className="crm-directory-muted">لا توجد مهمة مفتوحة</span>}</td>
        <td><a className="icon-button" href={crmContactDeepLink(contact.id)} aria-label={`فتح ملف ${contact.full_name}`}><FolderOpen aria-hidden="true" size={15} /></a></td>
      </tr>;
    })}</tbody></table></div> : <section className="panel empty-state"><span className="empty-visual"><ContactRound aria-hidden="true" size={20} /></span><div><h2>{hasFilters ? "لا توجد نتائج مطابقة" : "لا يوجد عملاء متاحون"}</h2><p>{hasFilters ? "غيّر البحث أو المصدر أو المرحلة أو المسؤول." : "سيظهر العملاء هنا بمجرد إضافتهم أو وصولهم من أحد المصادر المربوطة."}</p></div></section>}

    {totalCount > PAGE_SIZE ? <nav className="crm-pagination" aria-label="صفحات دليل العملاء"><button type="button" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}><ChevronRight aria-hidden="true" size={15} /> السابق</button><span>صفحة {page + 1} من {totalPages}</span><button type="button" disabled={page + 1 >= totalPages} onClick={() => setPage((value) => value + 1)}>التالي <ChevronLeft aria-hidden="true" size={15} /></button></nav> : null}
  </section>;
}
