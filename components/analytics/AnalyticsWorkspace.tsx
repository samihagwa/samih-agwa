"use client";

import type { Session } from "@supabase/supabase-js";
import { AlertTriangle, BarChart3, CheckCircle2, Clock3, LoaderCircle, LockKeyhole, Radio, RefreshCw, Send, UsersRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Tables } from "../../lib/supabase/database.types";
import { useWorkspaceAuth } from "../../lib/supabase/use-workspace-auth";
import { Button } from "../ui/Button";
import { StatusBadge } from "../ui/StatusBadge";

type Membership = Tables<"memberships">;
type Organization = Tables<"organizations">;
type Workspace = { organization: Organization; membership: Membership };
type Snapshot = {
  generated_at: string;
  range_days: number;
  tasks: { completed: number; completed_on_time: number; completed_late: number; open_overdue: number };
  content: { published: number; in_production: number };
  telegram: { published: number; failed: number; unknown: number };
  crm: { active: number; new: number; won: number; follow_up_overdue: number };
};

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeSnapshot(value: unknown): Snapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const tasks = (row.tasks ?? {}) as Record<string, unknown>;
  const content = (row.content ?? {}) as Record<string, unknown>;
  const telegram = (row.telegram ?? {}) as Record<string, unknown>;
  const crm = (row.crm ?? {}) as Record<string, unknown>;
  return {
    generated_at: String(row.generated_at ?? ""),
    range_days: number(row.range_days),
    tasks: { completed: number(tasks.completed), completed_on_time: number(tasks.completed_on_time), completed_late: number(tasks.completed_late), open_overdue: number(tasks.open_overdue) },
    content: { published: number(content.published), in_production: number(content.in_production) },
    telegram: { published: number(telegram.published), failed: number(telegram.failed), unknown: number(telegram.unknown) },
    crm: { active: number(crm.active), new: number(crm.new), won: number(crm.won), follow_up_overdue: number(crm.follow_up_overdue) },
  };
}

export function AnalyticsWorkspace() {
  const configured = isSupabaseConfigured();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [rangeDays, setRangeDays] = useState(30);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(configured);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(configured ? null : "لم يتم إعداد اتصال Supabase لهذه النسخة.");

  const clearWorkspace = useCallback(() => {
    setWorkspace(null);
    setSnapshot(null);
  }, []);

  const loadWorkspace = useCallback(async (activeSession: Session) => {
    const supabase = getSupabaseBrowserClient();
    setLoading(true);
    setError(null);
    try {
      const { data: membership, error: membershipError } = await supabase.from("memberships").select("*").eq("user_id", activeSession.user.id).eq("status", "active").limit(1).maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) return clearWorkspace();
      const { data: organization, error: organizationError } = await supabase.from("organizations").select("*").eq("id", membership.organization_id).single();
      if (organizationError) throw organizationError;
      setWorkspace({ organization, membership });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذّر تحميل مساحة التحليلات.");
    } finally {
      setLoading(false);
    }
  }, [clearWorkspace]);

  const session = useWorkspaceAuth({ configured, loadWorkspace, clearWorkspace, setLoading });

  const refresh = useCallback(async () => {
    if (!workspace) return;
    setRefreshing(true);
    setError(null);
    const { data, error: analyticsError } = await getSupabaseBrowserClient().rpc("get_operational_analytics", {
      target_organization_id: workspace.organization.id,
      target_range_days: rangeDays,
    });
    if (analyticsError) {
      setError(analyticsError.message);
      setSnapshot(null);
    } else {
      setSnapshot(normalizeSnapshot(data));
    }
    setRefreshing(false);
  }, [rangeDays, workspace]);

  useEffect(() => {
    if (!workspace) return;
    const timeout = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timeout);
  }, [refresh, workspace]);

  const onTimeRate = useMemo(() => {
    if (!snapshot?.tasks.completed) return null;
    return Math.round(snapshot.tasks.completed_on_time / snapshot.tasks.completed * 100);
  }, [snapshot]);

  if (loading) return <section className="workspace-state" aria-live="polite"><LoaderCircle className="spin" size={24} /><div><h2>جارٍ تحميل النتائج</h2><p>نقرأ بيانات التشغيل الحقيقية من النظام.</p></div></section>;
  if (!session) return <section className="workspace-state workspace-onboarding"><LockKeyhole size={27} /><div><h2>سجّل الدخول أولًا</h2><p>النتائج الداخلية لا تظهر خارج الفريق.</p></div><Button href="/login">تسجيل الدخول</Button></section>;
  if (!workspace) return <section className="workspace-state workspace-onboarding"><BarChart3 size={27} /><div><h2>صلاحية النتائج مطلوبة</h2><p>هذا الحساب غير مرتبط بمساحة عمل نشطة.</p></div></section>;

  return <section className="analytics-workspace">
    <div className="workspace-toolbar">
      <div><p className="overline">{workspace.organization.name}</p><h2>نتائج تشغيل قابلة للمراجعة</h2><p>لا توجد أرقام تجميلية: كل قيمة هنا ناتجة عن مهمة أو نشر أو ملف عميل مسجل.</p></div>
      <div className="toolbar-actions"><div className="segmented-control" aria-label="فترة التحليل">{[7, 30, 90].map((days) => <button type="button" className={rangeDays === days ? "active" : ""} onClick={() => setRangeDays(days)} key={days}>{days} يوم</button>)}</div><button className="icon-button" type="button" aria-label="تحديث النتائج" disabled={refreshing} onClick={() => void refresh()}><RefreshCw className={refreshing ? "spin" : ""} size={17} /></button></div>
    </div>
    {error ? <p className="form-notice error" role="alert">{error}</p> : null}
    {snapshot ? <>
      <div className="analytics-kpi-grid">
        <article><span><CheckCircle2 size={18} /></span><small>مهام اكتملت</small><strong>{snapshot.tasks.completed.toLocaleString("ar-EG")}</strong><p>{onTimeRate === null ? "لا توجد مهام مكتملة في الفترة" : `${onTimeRate.toLocaleString("ar-EG")}% في الموعد`}</p></article>
        <article className={snapshot.tasks.open_overdue ? "attention" : ""}><span><Clock3 size={18} /></span><small>مفتوحة ومتأخرة الآن</small><strong>{snapshot.tasks.open_overdue.toLocaleString("ar-EG")}</strong><p>{snapshot.tasks.completed_late.toLocaleString("ar-EG")} اكتملت بعد الموعد</p></article>
        <article><span><Radio size={18} /></span><small>محتوى منشور</small><strong>{snapshot.content.published.toLocaleString("ar-EG")}</strong><p>{snapshot.content.in_production.toLocaleString("ar-EG")} داخل التنفيذ الآن</p></article>
        <article className={snapshot.telegram.failed || snapshot.telegram.unknown ? "attention" : ""}><span><Send size={18} /></span><small>نشر Telegram ناجح</small><strong>{snapshot.telegram.published.toLocaleString("ar-EG")}</strong><p>{snapshot.telegram.failed.toLocaleString("ar-EG")} فشل · {snapshot.telegram.unknown.toLocaleString("ar-EG")} نتيجة غير مؤكدة</p></article>
        <article className={snapshot.crm.follow_up_overdue ? "attention" : ""}><span><UsersRound size={18} /></span><small>عملاء نشطون</small><strong>{snapshot.crm.active.toLocaleString("ar-EG")}</strong><p>{snapshot.crm.follow_up_overdue.toLocaleString("ar-EG")} متابعة متأخرة · {snapshot.crm.won.toLocaleString("ar-EG")} صفقة بالفترة</p></article>
      </div>
      <section className="panel analytics-source-status"><div className="section-heading"><div><p className="overline">مصدر كل رقم</p><h2>حالة ربط البيانات</h2></div></div><div><span><CheckCircle2 size={17} /><strong>التشغيل الداخلي</strong><small>المهام وCRM والمحتوى والنشر التلقائي متصلون.</small><StatusBadge tone="success">متصل</StatusBadge></span><span><AlertTriangle size={17} /><strong>Instagram / Meta</strong><small>الوصول والمشاهدات والتفاعل لن تظهر حتى ربط API أو إدخال نتائج موثّق.</small><StatusBadge tone="warning">غير مربوط</StatusBadge></span></div></section>
    </> : !refreshing ? <div className="task-filter-empty"><BarChart3 size={24} /><div><strong>لا توجد لقطة نتائج متاحة</strong><p>حدّث الصفحة أو راجع صلاحية قسم النتائج.</p></div></div> : null}
  </section>;
}
