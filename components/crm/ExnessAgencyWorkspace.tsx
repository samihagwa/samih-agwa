"use client";

import type { Session } from "@supabase/supabase-js";
import { AlertTriangle, CheckCircle2, ChevronDown, CircleX, LoaderCircle, LockKeyhole, Search, ShieldCheck } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Tables } from "../../lib/supabase/database.types";
import { getSupabaseFunctionErrorMessage } from "../../lib/supabase/function-errors";
import { useWorkspaceAuth } from "../../lib/supabase/use-workspace-auth";
import { Button } from "../ui/Button";
import { StatusBadge } from "../ui/StatusBadge";

type Membership = Tables<"memberships">;
type Organization = Tables<"organizations">;
type LookupResult = {
  integration_ready: boolean;
  under_agency: boolean;
  is_active: boolean;
  last_synced_at: string | null;
  external_client_id: string | null;
  accounts: Array<{ account_number: string; registered_at: string | null; last_activity_at: string | null; is_active: boolean }>;
};
type Workspace = { membership: Membership; organization: Organization };

const LOOKUP_PATTERN = /^[A-Za-z0-9._-]{3,160}$/;

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Cairo" }).format(new Date(value));
}

export function ExnessAgencyWorkspace() {
  const configured = isSupabaseConfigured();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(configured);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookupInput, setLookupInput] = useState("");
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  const [showRelatedAccounts, setShowRelatedAccounts] = useState(false);

  const clearWorkspace = useCallback(() => setWorkspace(null), []);
  const clearTransientState = useCallback(() => {
    setError(null);
    setLookupResult(null);
    setShowRelatedAccounts(false);
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

  async function lookupAccount() {
    if (!workspace) return;
    const clean = lookupInput.trim();
    setLookupResult(null);
    setShowRelatedAccounts(false);
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
      setError(await getSupabaseFunctionErrorMessage(invokeError, "تعذّر فحص الحساب الآن. حاول مجددًا."));
      return;
    }
    setLookupResult(data);
  }

  const lookupState = useMemo(() => {
    if (!lookupResult) return null;
    if (!lookupResult.integration_ready) return { tone: "warning" as const, icon: AlertTriangle, title: "ربط Exness غير جاهز", description: "اطلب من مسؤول النظام إكمال ربط حساب الشراكة." };
    if (!lookupResult.under_agency) return { tone: "danger" as const, icon: CircleX, title: "الحساب غير موجود تحت الوكالة", description: "تم الفحص مباشرةً من Exness الآن. راجع الرقم أو اطلب من العميل التسجيل من رابط الوكالة." };
    return lookupResult.is_active
      ? { tone: "success" as const, icon: CheckCircle2, title: "الحساب موجود تحت الوكالة", description: "تم تحديث بيانات الحساب من Exness وحفظ نتيجة الفحص في النظام." }
      : { tone: "warning" as const, icon: AlertTriangle, title: "الحساب موجود لكنه غير نشط", description: "تم تحديث بيانات الحساب من Exness. تواصل مع العميل لمعرفة سبب عدم النشاط." };
  }, [lookupResult]);

  if (loading) return <section className="workspace-state" aria-live="polite"><LoaderCircle aria-hidden="true" className="spin" size={24} /><div><h2>جارٍ فتح فحص Exness</h2><p>نتحقق من الحساب والصلاحيات.</p></div></section>;
  if (!activeSession) return <section className="workspace-state workspace-onboarding"><LockKeyhole aria-hidden="true" size={27} /><div><h2>سجّل الدخول أولًا</h2><p>فحص حسابات الوكالة لا يعمل دون جلسة موثقة.</p></div><Button href="/login">تسجيل الدخول</Button></section>;
  if (!workspace) return <section className="workspace-state workspace-onboarding"><ShieldCheck aria-hidden="true" size={27} /><div><h2>صلاحية CRM مطلوبة</h2><p>هذا الحساب غير مصرح له بفحص عملاء الوكالة.</p></div></section>;

  return <section className="exness-agency-workspace">
    <header className="exness-agency-header">
      <p className="overline">{workspace.organization.name} · Exness</p>
      <h1>فحص حساب الوكالة</h1>
    </header>

    {error ? <p className="form-notice error" role="alert">{error}</p> : null}

    <section className="exness-lookup-panel" aria-labelledby="exness-lookup-title">
      <div><p className="overline">Live client check</p><h2 id="exness-lookup-title">هل الحساب تحت وكالتنا؟</h2><p>ابحث برقم حساب Exness أو Client UID. كل بحث يراجع Exness مباشرةً ويحدّث قاعدة البيانات.</p></div>
      <form onSubmit={(event) => { event.preventDefault(); void lookupAccount(); }}>
        <label><span className="sr-only">رقم الحساب أو Client UID</span><Search aria-hidden="true" size={17} /><input dir="ltr" inputMode="text" autoComplete="off" value={lookupInput} onChange={(event) => { setLookupInput(event.target.value); setLookupResult(null); setShowRelatedAccounts(false); }} placeholder="Account number / Client UID" /></label>
        <Button type="submit" disabled={lookupLoading}>{lookupLoading ? <LoaderCircle aria-hidden="true" className="spin" size={16} /> : <Search aria-hidden="true" size={16} />} فحص الحساب</Button>
      </form>
      {lookupState ? <article className={`exness-lookup-result ${lookupState.tone}`}><lookupState.icon aria-hidden="true" size={22} /><div><strong>{lookupState.title}</strong><p>{lookupState.description}</p>{lookupResult?.last_synced_at ? <small dir="ltr">Live check: {formatDate(lookupResult.last_synced_at)}</small> : null}</div></article> : null}
      {lookupResult?.under_agency && lookupResult.accounts.length ? <>
        <button className="exness-linked-toggle" type="button" aria-expanded={showRelatedAccounts} aria-controls="exness-linked-accounts" onClick={() => setShowRelatedAccounts((visible) => !visible)}>
          <span>{showRelatedAccounts ? "إخفاء حسابات العميل" : `إظهار كل حسابات العميل (${lookupResult.accounts.length})`}</span>
          <ChevronDown aria-hidden="true" className={showRelatedAccounts ? "expanded" : ""} size={18} />
        </button>
        {showRelatedAccounts ? <div id="exness-linked-accounts" className="exness-related-accounts" role="region" aria-label="الحسابات المرتبطة بنفس العميل">
          <div><p className="overline">Linked accounts</p><h3>الحسابات المرتبطة بنفس العميل</h3>{lookupResult.external_client_id ? <small dir="ltr">Client UID: {lookupResult.external_client_id}</small> : null}</div>
          <div className="exness-account-table-wrap"><table className="exness-account-table exness-sales-table"><thead><tr><th>رقم الحساب</th><th>تاريخ التسجيل</th><th>آخر صفقة</th><th>الحالة</th></tr></thead><tbody>{lookupResult.accounts.map((account) => <tr key={account.account_number}>
            <td data-label="رقم الحساب"><strong dir="ltr">{account.account_number}</strong></td>
            <td data-label="تاريخ التسجيل"><strong dir="ltr">{formatDate(account.registered_at)}</strong></td>
            <td data-label="آخر صفقة"><strong dir="ltr">{formatDate(account.last_activity_at)}</strong></td>
            <td data-label="الحالة"><StatusBadge tone={account.is_active ? "success" : "danger"}>{account.is_active ? "مرتبط" : "غير نشط"}</StatusBadge></td>
          </tr>)}</tbody></table></div>
        </div> : null}
      </> : null}
    </section>
  </section>;
}
