"use client";

import type { Session } from "@supabase/supabase-js";
import { Activity, AlertTriangle, BadgeDollarSign, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleX, Database as DatabaseIcon, LoaderCircle, LockKeyhole, RefreshCw, Search, ShieldCheck, UsersRound } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Database, Json, Tables } from "../../lib/supabase/database.types";
import { getSupabaseFunctionErrorMessage } from "../../lib/supabase/function-errors";
import { useWorkspaceAuth } from "../../lib/supabase/use-workspace-auth";
import { Button } from "../ui/Button";
import { StatusBadge } from "../ui/StatusBadge";

type Membership = Tables<"memberships">;
type Organization = Tables<"organizations">;
type Account = Tables<"broker_client_accounts">;
type SyncRun = Tables<"broker_sync_runs">;
type LookupResult = {
  integration_ready: boolean;
  under_agency: boolean;
  is_active: boolean;
  last_synced_at: string | null;
  external_client_id: string | null;
  accounts: Array<{ account_number: string; registered_at: string | null; last_activity_at: string | null; is_active: boolean }>;
};
type AgencySummary = Database["public"]["Functions"]["get_exness_agency_summary"]["Returns"][number];
type Workspace = { membership: Membership; organization: Organization };
type InvokePayload = { message?: string; retry_after_seconds?: number; sync?: SyncRun & { fetched_clients?: number }; replayed?: boolean };

const PAGE_SIZE = 25;
const LOOKUP_PATTERN = /^[A-Za-z0-9._-]{3,160}$/;

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Cairo" }).format(new Date(value));
}

function formatNumber(value: number | string, maximumFractionDigits = 2) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(Number(value) || 0);
}

function profile(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, Json | undefined> : {};
}

function profileText(value: Json | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : "—";
}

function syncStatus(run: SyncRun["status"]) {
  if (run === "completed") return { label: "اكتملت", tone: "success" as const };
  if (run === "failed") return { label: "فشلت", tone: "danger" as const };
  if (run === "running") return { label: "جارية", tone: "info" as const };
  return { label: "غير محسومة", tone: "warning" as const };
}

export function ExnessAgencyWorkspace() {
  const configured = isSupabaseConfigured();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(configured);
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lookupInput, setLookupInput] = useState("");
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  const [summary, setSummary] = useState<AgencySummary | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [syncRuns, setSyncRuns] = useState<SyncRun[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [page, setPage] = useState(0);
  const [expandedAccountId, setExpandedAccountId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const clearWorkspace = useCallback(() => {
    setWorkspace(null);
    setSummary(null);
    setAccounts([]);
    setSyncRuns([]);
    setTotalCount(0);
  }, []);
  const clearTransientState = useCallback(() => {
    setError(null);
    setNotice(null);
    setLookupResult(null);
  }, []);

  const loadWorkspace = useCallback(async (activeSession: Session) => {
    const supabase = getSupabaseBrowserClient();
    setLoading(true);
    setError(null);
    try {
      const { data: membership, error: membershipError } = await supabase.from("memberships")
        .select("*").eq("user_id", activeSession.user.id).eq("status", "active").limit(1).maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership || (membership.role !== "owner" && !membership.allowed_sections.includes("crm"))) {
        clearWorkspace();
        return;
      }
      const { data: organization, error: organizationError } = await supabase.from("organizations")
        .select("*").eq("id", membership.organization_id).single();
      if (organizationError) throw organizationError;
      setWorkspace({ membership, organization });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذّر تحميل مساحة وكالة Exness.");
    } finally {
      setLoading(false);
    }
  }, [clearWorkspace]);

  const activeSession = useWorkspaceAuth({ configured, loadWorkspace, clearWorkspace, setLoading, clearTransientState });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const clean = searchInput.trim();
    const timer = window.setTimeout(() => {
      setSearchQuery(LOOKUP_PATTERN.test(clean) ? clean : "");
      setPage(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const loadOwnerData = useCallback(async (organizationId: string) => {
    const supabase = getSupabaseBrowserClient();
    setOwnerLoading(true);
    setError(null);
    try {
      const overviewPromise = supabase.functions.invoke<AgencySummary>("broker-commands", {
        body: { action: "get_exness_overview", organization_id: organizationId },
      });
      let accountsQuery = supabase.from("broker_client_accounts").select("*", { count: "exact" })
        .eq("organization_id", organizationId).order("last_synced_at", { ascending: false })
        .order("account_number", { ascending: true }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (statusFilter !== "all") accountsQuery = accountsQuery.eq("is_active", statusFilter === "active");
      if (searchQuery) accountsQuery = accountsQuery.or(`account_number.ilike.%${searchQuery}%,external_client_id.ilike.%${searchQuery}%`);
      const [overviewResult, accountsResult, syncResult] = await Promise.all([
        overviewPromise,
        accountsQuery,
        supabase.from("broker_sync_runs").select("*").eq("organization_id", organizationId).order("started_at", { ascending: false }).limit(5),
      ]);
      if (overviewResult.error) throw overviewResult.error;
      if (accountsResult.error) throw accountsResult.error;
      if (syncResult.error) throw syncResult.error;
      setSummary(overviewResult.data);
      setAccounts(accountsResult.data ?? []);
      setTotalCount(accountsResult.count ?? 0);
      setSyncRuns(syncResult.data ?? []);
      if (page > 0 && !accountsResult.data?.length) setPage(0);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذّر تحميل بيانات وكالة Exness.");
    } finally {
      setOwnerLoading(false);
    }
  }, [page, searchQuery, statusFilter]);

  useEffect(() => {
    if (!workspace || workspace.membership.role !== "owner") return;
    const timer = window.setTimeout(() => void loadOwnerData(workspace.organization.id), 0);
    return () => window.clearTimeout(timer);
  }, [loadOwnerData, workspace]);

  async function lookupAccount() {
    if (!workspace) return;
    const clean = lookupInput.trim();
    setLookupResult(null);
    setNotice(null);
    if (!LOOKUP_PATTERN.test(clean)) {
      setError("اكتب رقم حساب Exness أو Client UID صحيحًا.");
      return;
    }
    setLookupLoading(true);
    setError(null);
    const { data, error: invokeError } = await getSupabaseBrowserClient().functions.invoke<LookupResult>("broker-commands", {
      body: { action: "lookup_exness_account", organization_id: workspace.organization.id, lookup_value: clean },
    });
    setLookupLoading(false);
    if (invokeError) {
      setError(await getSupabaseFunctionErrorMessage(invokeError, "تعذّر فحص الحساب الآن. تأكد أن المزامنة مكتملة ثم حاول مجددًا."));
      return;
    }
    setLookupResult(data);
  }

  async function syncAccounts() {
    if (!workspace || workspace.membership.role !== "owner") return;
    setSyncing(true);
    setError(null);
    setNotice(null);
    const { data, error: invokeError } = await getSupabaseBrowserClient().functions.invoke<InvokePayload>("broker-commands", {
      body: { action: "sync_exness_official", organization_id: workspace.organization.id, request_key: crypto.randomUUID() },
    });
    setSyncing(false);
    if (invokeError) {
      setError(data?.message ?? await getSupabaseFunctionErrorMessage(invokeError, "تعذّرت مزامنة حسابات Exness."));
      return;
    }
    setNotice(data?.replayed
      ? "تم استرجاع نتيجة عملية المزامنة السابقة بأمان."
      : `اكتملت المزامنة الرسمية: ${data?.sync?.upserted_rows ?? 0} حساب محفوظ أو محدث.`);
    await loadOwnerData(workspace.organization.id);
  }

  const isOwner = workspace?.membership.role === "owner";
  const lastSyncMs = summary?.last_sync_at ? new Date(summary.last_sync_at).getTime() : 0;
  const cooldownSeconds = Math.max(0, Math.ceil((lastSyncMs + 5 * 60 * 1000 - now) / 1000));
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const firstVisible = totalCount ? page * PAGE_SIZE + 1 : 0;
  const lastVisible = Math.min(totalCount, page * PAGE_SIZE + accounts.length);
  const summaryCurrency = summary?.commission_currency === "MIXED" ? "عملات متعددة" : summary?.commission_currency ?? "USD";
  const lookupState = useMemo(() => {
    if (!lookupResult) return null;
    if (!lookupResult.integration_ready) return { tone: "warning" as const, icon: AlertTriangle, title: "المزامنة غير جاهزة", description: "يجب أن يكمل المالك مزامنة حسابات الوكالة أولًا." };
    if (!lookupResult.under_agency) return { tone: "danger" as const, icon: CircleX, title: "الحساب غير موجود تحت الوكالة", description: "راجع الرقم أو اطلب من العميل التسجيل من رابط الوكالة." };
    return lookupResult.is_active
      ? { tone: "success" as const, icon: CheckCircle2, title: "الحساب موجود ونشط", description: "يمكن لفريق السيلز متابعة العميل دون الاطلاع على بياناته المالية." }
      : { tone: "warning" as const, icon: AlertTriangle, title: "الحساب موجود لكنه غير نشط", description: "تواصل مع العميل لمعرفة سبب عدم النشاط." };
  }, [lookupResult]);

  if (loading) return <section className="workspace-state" aria-live="polite"><LoaderCircle aria-hidden="true" className="spin" size={24} /><div><h2>جارٍ فتح وكالة Exness</h2><p>نتحقق من الحساب والصلاحيات.</p></div></section>;
  if (!activeSession) return <section className="workspace-state workspace-onboarding"><LockKeyhole aria-hidden="true" size={27} /><div><h2>سجّل الدخول أولًا</h2><p>فحص حسابات الوكالة لا يعمل دون جلسة موثقة.</p></div><Button href="/login">تسجيل الدخول</Button></section>;
  if (!workspace) return <section className="workspace-state workspace-onboarding"><ShieldCheck aria-hidden="true" size={27} /><div><h2>صلاحية CRM مطلوبة</h2><p>هذا الحساب غير مصرح له بفحص عملاء الوكالة.</p></div></section>;

  return <section className="exness-agency-workspace">
    <header className="workspace-toolbar exness-agency-header">
      <div><p className="overline">{workspace.organization.name} · Exness</p><h1>حسابات الوكالة</h1><p>فحص فوري للسيلز، وتقرير الحسابات والعمولات للمالك فقط.</p></div>
      {isOwner ? <div className="toolbar-actions"><button className="icon-button" type="button" aria-label="تحديث الصفحة" disabled={ownerLoading} onClick={() => void loadOwnerData(workspace.organization.id)}><RefreshCw aria-hidden="true" className={ownerLoading ? "spin" : ""} size={17} /></button><Button type="button" disabled={syncing || cooldownSeconds > 0} onClick={() => void syncAccounts()}>{syncing ? <LoaderCircle aria-hidden="true" className="spin" size={16} /> : <DatabaseIcon aria-hidden="true" size={16} />}{cooldownSeconds > 0 ? `محدثة · ${Math.floor(cooldownSeconds / 60)}:${String(cooldownSeconds % 60).padStart(2, "0")}` : "مزامنة الآن"}</Button></div> : null}
    </header>

    {error ? <p className="form-notice error" role="alert">{error}</p> : null}
    {notice ? <p className="form-notice success" role="status">{notice}</p> : null}

    <section className="exness-lookup-panel" aria-labelledby="exness-lookup-title">
      <div><p className="overline">Live client check</p><h2 id="exness-lookup-title">هل الحساب تحت وكالتنا؟</h2><p>اكتب رقم حساب Exness أو Client UID. كل بحث يتأكد مباشرة من Exness ويحدّث ملف العميل دون إظهار أي لوتات أو عمولات للسيلز.</p></div>
      <form onSubmit={(event) => { event.preventDefault(); void lookupAccount(); }}>
        <label><span className="sr-only">رقم الحساب أو Client UID</span><Search aria-hidden="true" size={17} /><input dir="ltr" inputMode="text" autoComplete="off" value={lookupInput} onChange={(event) => setLookupInput(event.target.value)} placeholder="Account number / Client UID" /></label>
        <Button type="submit" disabled={lookupLoading}>{lookupLoading ? <LoaderCircle aria-hidden="true" className="spin" size={16} /> : <Search aria-hidden="true" size={16} />} تحديث وفحص الحساب</Button>
      </form>
      {lookupState ? <article className={`exness-lookup-result ${lookupState.tone}`}><lookupState.icon aria-hidden="true" size={22} /><div><strong>{lookupState.title}</strong><p>{lookupState.description}</p>{lookupResult?.last_synced_at ? <small dir="ltr">Live check: {formatDate(lookupResult.last_synced_at)}</small> : null}</div></article> : null}
      {lookupResult?.under_agency && lookupResult.accounts.length ? <div className="exness-related-accounts" role="region" aria-label="الحسابات المرتبطة بنفس العميل">
        <div><p className="overline">Linked accounts</p><h3>كل حسابات العميل المرتبطة</h3>{lookupResult.external_client_id ? <small dir="ltr">Client UID: {lookupResult.external_client_id}</small> : null}</div>
        <div className="exness-account-table-wrap"><table className="exness-account-table exness-sales-table"><thead><tr><th>رقم الحساب</th><th>تاريخ التسجيل</th><th>آخر صفقة</th><th>الحالة</th></tr></thead><tbody>{lookupResult.accounts.map((account) => <tr key={account.account_number}>
          <td data-label="رقم الحساب"><strong dir="ltr">{account.account_number}</strong></td>
          <td data-label="تاريخ التسجيل"><strong dir="ltr">{formatDate(account.registered_at)}</strong></td>
          <td data-label="آخر صفقة"><strong dir="ltr">{formatDate(account.last_activity_at)}</strong></td>
          <td data-label="الحالة"><StatusBadge tone={account.is_active ? "success" : "danger"}>{account.is_active ? "مرتبط" : "غير نشط"}</StatusBadge></td>
        </tr>)}</tbody></table></div>
      </div> : null}
    </section>

    {isOwner ? <>
      <section className="exness-summary-grid" aria-label="ملخص حسابات وكالة Exness">
        <article><UsersRound aria-hidden="true" size={19} /><span>كل الحسابات</span><strong>{formatNumber(summary?.total_accounts ?? 0, 0)}</strong></article>
        <article><Activity aria-hidden="true" size={19} /><span>الحسابات النشطة</span><strong>{formatNumber(summary?.active_accounts ?? 0, 0)}</strong></article>
        <article><DatabaseIcon aria-hidden="true" size={19} /><span>حجم التداول</span><strong>{formatNumber(summary?.total_lots ?? 0, 4)} <small>lots</small></strong></article>
        <article><BadgeDollarSign aria-hidden="true" size={19} /><span>إجمالي العمولة</span><strong>{formatNumber(summary?.total_commission ?? 0)} <small>{summaryCurrency}</small></strong></article>
      </section>

      <section className="exness-report-toolbar" aria-label="البحث وتصفية حسابات الوكالة">
        <label><Search aria-hidden="true" size={16} /><input dir="ltr" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search account / Client UID" />{searchInput ? <button type="button" onClick={() => setSearchInput("")}>مسح</button> : null}</label>
        <div role="group" aria-label="حالة الحساب">{(["all", "active", "inactive"] as const).map((status) => <button type="button" className={statusFilter === status ? "active" : ""} onClick={() => { setStatusFilter(status); setPage(0); }} key={status}>{status === "all" ? "الكل" : status === "active" ? "نشط" : "غير نشط"}</button>)}</div>
        <p dir="ltr">{firstVisible}–{lastVisible} of {totalCount}</p>
      </section>

      {accounts.length ? <div className="exness-account-table-wrap" role="region" aria-label="جدول حسابات الوكالة"><table className="exness-account-table"><thead><tr><th>رقم الحساب</th><th>Client UID</th><th>الدولة</th><th>نوع الحساب</th><th>الحجم (Lots)</th><th>العمولة</th><th>الحالة</th><th><span className="sr-only">تفاصيل</span></th></tr></thead><tbody>{accounts.map((account) => {
        const clientProfile = profile(account.client_profile);
        const expanded = expandedAccountId === account.id;
        return <Fragment key={account.id}><tr className={expanded ? "expanded" : ""}>
          <td data-label="رقم الحساب"><strong dir="ltr">{account.account_number}</strong></td>
          <td data-label="Client UID"><strong dir="ltr">{account.external_client_id}</strong></td>
          <td data-label="الدولة">{profileText(clientProfile.country)}</td>
          <td data-label="نوع الحساب">{profileText(clientProfile.account_type)}</td>
          <td data-label="الحجم (Lots)"><strong dir="ltr">{formatNumber(account.lots, 4)}</strong></td>
          <td data-label="العمولة"><strong dir="ltr">{formatNumber(account.commission)} {account.commission_currency}</strong></td>
          <td data-label="الحالة"><StatusBadge tone={account.is_active ? "success" : "danger"}>{account.is_active ? "نشط" : "غير نشط"}</StatusBadge></td>
          <td data-label="التفاصيل"><button className="crm-row-expand" type="button" aria-expanded={expanded} aria-controls={`exness-account-${account.id}`} aria-label={`${expanded ? "إغلاق" : "عرض"} تفاصيل الحساب ${account.account_number}`} onClick={() => setExpandedAccountId(expanded ? null : account.id)}><ChevronDown aria-hidden="true" size={17} /></button></td>
        </tr>{expanded ? <tr className="exness-account-expanded"><td colSpan={8}><div id={`exness-account-${account.id}`}>
          <dl><div><dt>حساب الشريك</dt><dd dir="ltr">{profileText(clientProfile.partner_account)}</dd></div><div><dt>اسم حساب الشريك</dt><dd>{profileText(clientProfile.partner_account_name)}</dd></div><div><dt>تاريخ التسجيل</dt><dd dir="ltr">{formatDate(account.registered_at)}</dd></div><div><dt>آخر نشاط</dt><dd dir="ltr">{formatDate(account.last_activity_at)}</dd></div><div><dt>حجم USD</dt><dd dir="ltr">{formatNumber(typeof clientProfile.volume_mln_usd === "number" ? clientProfile.volume_mln_usd : 0, 4)}M</dd></div><div><dt>آخر مزامنة</dt><dd dir="ltr">{formatDate(account.last_synced_at)}</dd></div></dl>
        </div></td></tr> : null}</Fragment>;
      })}</tbody></table></div> : <section className="panel empty-state"><span className="empty-visual"><DatabaseIcon aria-hidden="true" size={20} /></span><div><h2>{ownerLoading ? "جارٍ تحميل الحسابات" : "لا توجد حسابات مطابقة"}</h2><p>{summary?.integration_status === "not_configured" ? "اضغط «مزامنة الآن» بعد ضبط بيانات حساب الشراكة في أسرار الخادم." : "غيّر البحث أو حالة الحساب."}</p></div></section>}

      {totalCount > PAGE_SIZE ? <nav className="crm-pagination" aria-label="صفحات حسابات الوكالة"><button type="button" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}><ChevronRight aria-hidden="true" size={15} /> السابق</button><span>صفحة {page + 1} من {totalPages}</span><button type="button" disabled={page + 1 >= totalPages} onClick={() => setPage((value) => value + 1)}>التالي <ChevronLeft aria-hidden="true" size={15} /></button></nav> : null}

      <details className="exness-sync-history"><summary><Activity aria-hidden="true" size={16} /> سجل المزامنة</summary>{syncRuns.length ? <ul>{syncRuns.map((run) => { const state = syncStatus(run.status); return <li key={run.id}><StatusBadge tone={state.tone}>{state.label}</StatusBadge><strong dir="ltr">{formatDate(run.started_at)}</strong><span>{run.upserted_rows} محفوظ · {run.error_rows} متجاهل</span>{run.error_message ? <small>{run.error_message}</small> : null}</li>; })}</ul> : <p>لا توجد عمليات مزامنة مسجلة.</p>}</details>
    </> : null}
  </section>;
}
