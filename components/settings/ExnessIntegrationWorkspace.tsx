"use client";

import type { Session } from "@supabase/supabase-js";
import { Activity, Building2, CheckCircle2, Database, ExternalLink, KeyRound, LoaderCircle, LockKeyhole, SearchCheck, ShieldCheck } from "lucide-react";
import { useCallback, useState } from "react";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Tables } from "../../lib/supabase/database.types";
import { useWorkspaceAuth } from "../../lib/supabase/use-workspace-auth";
import { StatusBadge } from "../ui/StatusBadge";

type Organization = Tables<"organizations">;
type Membership = Tables<"memberships">;
type Integration = Tables<"broker_integrations">;
type SyncRun = Tables<"broker_sync_runs">;
type Workspace = { organization: Organization; membership: Membership; integration: Integration | null; accountCount: number; syncRuns: SyncRun[] };

function formatDate(value: string | null) {
  if (!value) return "لم تتم مزامنة بعد";
  return new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Cairo" }).format(new Date(value));
}

export function ExnessIntegrationWorkspace() {
  const configured = isSupabaseConfigured();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState<string | null>(null);

  const clearWorkspace = useCallback(() => setWorkspace(null), []);
  const clearTransientState = useCallback(() => setError(null), []);

  const loadWorkspace = useCallback(async (activeSession: Session) => {
    const supabase = getSupabaseBrowserClient();
    setLoading(true);
    setError(null);
    try {
      const { data: membership, error: membershipError } = await supabase.from("memberships")
        .select("*").eq("user_id", activeSession.user.id).eq("status", "active").limit(1).maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) { clearWorkspace(); return; }
      const { data: organization, error: organizationError } = await supabase.from("organizations")
        .select("*").eq("id", membership.organization_id).single();
      if (organizationError) throw organizationError;
      if (membership.role !== "owner") {
        setWorkspace({ organization, membership, integration: null, accountCount: 0, syncRuns: [] });
        return;
      }
      const [integrationResult, accountsResult, syncRunsResult] = await Promise.all([
        supabase.from("broker_integrations").select("*").eq("organization_id", membership.organization_id).eq("provider", "exness").maybeSingle(),
        supabase.from("broker_client_accounts").select("id", { count: "exact", head: true }).eq("organization_id", membership.organization_id),
        supabase.from("broker_sync_runs").select("*").eq("organization_id", membership.organization_id).order("started_at", { ascending: false }).limit(5),
      ]);
      const firstError = [integrationResult.error, accountsResult.error, syncRunsResult.error].find(Boolean);
      if (firstError) throw firstError;
      setWorkspace({ organization, membership, integration: integrationResult.data, accountCount: accountsResult.count ?? 0, syncRuns: syncRunsResult.data ?? [] });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذّر تحميل حالة تكامل Exness.");
    } finally {
      setLoading(false);
    }
  }, [clearWorkspace]);

  useWorkspaceAuth({ configured, loadWorkspace, clearWorkspace, setLoading, clearTransientState });

  if (loading) return <section className="workspace-state"><LoaderCircle className="spin" size={22} /><div><h2>جارٍ فحص تكامل Exness</h2><p>نتحقق من حالة الاتصال بدون كشف أي بيانات مالية.</p></div></section>;
  if (!workspace || workspace.membership.role !== "owner") return null;

  const ready = workspace.integration?.status === "ready" && workspace.integration.account_lookup_enabled;
  return <section className="panel exness-integration-panel">
    <div className="section-heading"><div><p className="overline">Brokerage data — Owner only</p><h2>تكامل وكالة Exness</h2><p>طبقة مستقلة عن CRM: المالك فقط يرى الملف واللوتات والعمولة، بينما موظف الـSales المصرّح له بالـCRM يحصل لاحقًا على إجابة «تحت الوكالة / نشط» فقط.</p></div><StatusBadge tone={ready ? "success" : "warning"}>{ready ? "متصل" : "بانتظار عقد الـAPI"}</StatusBadge></div>
    {error ? <p className="form-notice error">{error}</p> : null}
    <div className="exness-integration-grid">
      <article><span><Building2 size={18} /></span><div><small>حالة المصدر</small><strong>{workspace.integration?.status === "error" ? "آخر مزامنة فشلت" : ready ? "جاهز للمزامنة" : "غير مربوط"}</strong><p>{workspace.integration?.last_error ?? "لن يتم إدخال مفتاح أو تشغيل مزامنة قبل مراجعة توثيق Exness الخاص بحساب الوكالة."}</p></div></article>
      <article><span><Database size={18} /></span><div><small>الحسابات المتزامنة</small><strong>{workspace.accountCount}</strong><p>الجدول المالي محمي بصلاحية المالك فقط، ولا يظهر عبر بحث CRM العادي.</p></div></article>
      <article><span><Activity size={18} /></span><div><small>آخر مزامنة</small><strong>{formatDate(workspace.integration?.last_sync_at ?? null)}</strong><p>{workspace.syncRuns.length ? `${workspace.syncRuns.length} عمليات محفوظة في سجل المزامنة الأخير.` : "لا يوجد سجل مزامنة حتى الآن."}</p></div></article>
    </div>
    <div className="exness-permission-map">
      <div><ShieldCheck size={17} /><span><strong>المالك</strong><small>الملف التعريفي، رقم الحساب، النشاط، اللوتات، العمولة، وإجماليات الوكالة.</small></span></div>
      <div><SearchCheck size={17} /><span><strong>Sales بصلاحية CRM</strong><small>بحث برقم الحساب أو معرّف العميل، والنتيجة فقط: موجود/غير موجود + نشط/غير نشط.</small></span></div>
      <div><LockKeyhole size={17} /><span><strong>باقي الفريق</strong><small>لا صفحة ولا أرقام ولا إمكانية بحث، حتى لو عرف رابط القسم.</small></span></div>
    </div>
    <details className="exness-api-requirements"><summary><KeyRound size={16} /> المطلوب مرة واحدة لإكمال الاتصال الحقيقي</summary><ol><li>Base URL الرسمي من صفحة Exness Partner API الخاصة بحسابك.</li><li>طريقة المصادقة وبياناتها؛ لا تُرسل في الشات، وستُحفظ لاحقًا في Supabase Vault.</li><li>مسار جلب العملاء والحسابات والـpagination والـrate limits.</li><li>مثال JSON واحد بعد إخفاء البيانات الشخصية لتثبيت خريطة الحقول.</li></ol><a href="https://www.exnessaffiliates.com/marketing-tools/" target="_blank" rel="noreferrer"><ExternalLink size={13} /> صفحة Exness الرسمية التي توضح توفر Partnership API للـIB</a></details>
    <aside className="exness-integration-guard"><CheckCircle2 size={17} /><p><strong>الأساس المنفذ الآن:</strong> جداول الحسابات وسجل المزامنة وRLS ودالة البحث المحدودة جاهزة ومختبرة. المتبقي ليس برمجة تخمينية؛ هو إدخال عقد API الحقيقي ثم بناء الـadapter عليه.</p></aside>
  </section>;
}
