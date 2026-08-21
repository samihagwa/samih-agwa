"use client";

import type { Session } from "@supabase/supabase-js";
import { Activity, CalendarDays, CheckCircle2, Clock3, LoaderCircle, LockKeyhole, RefreshCw, ShieldCheck, UsersRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Database, Tables } from "../../lib/supabase/database.types";
import { useWorkspaceAuth } from "../../lib/supabase/use-workspace-auth";
import { canManageTasks } from "../../lib/tasks";
import { Button } from "../ui/Button";
import { StatusBadge } from "../ui/StatusBadge";

type Membership = Tables<"memberships">;
type Organization = Tables<"organizations">;
type Presence = Tables<"member_presence">;
type TeamReport = Database["public"]["Functions"]["get_team_task_performance"]["Returns"][number];
type Person = { id: string; name: string; role: Membership["role"] };
type Workspace = { organization: Organization; membership: Membership; people: Person[] };
type RangePreset = "week" | "month" | "custom";

const sectionLabels: Record<string, string> = {
  dashboard: "مركز القيادة", tasks: "مهام الفريق", content: "مصنع المحتوى",
  scripts: "استوديو الاسكريبتات", publishing: "النشر التلقائي", brand: "مركز البراند", campaigns: "الحملات", crm: "العملاء",
  analytics: "التحليلات", team: "الفريق", settings: "الإعدادات",
};

function dateInput(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function formatDate(value: string | null) {
  if (!value) return "لا يوجد نشاط مسجل";
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Cairo",
  }).format(new Date(value));
}

function formatLastSeen(value: string | null, now: number) {
  if (!value) return "لا يوجد ظهور مسجل";
  const elapsedMinutes = Math.max(0, Math.floor((now - new Date(value).getTime()) / 60_000));
  const relative = elapsedMinutes < 1
    ? "منذ أقل من دقيقة"
    : elapsedMinutes < 60
      ? `منذ ${elapsedMinutes.toLocaleString("ar-EG")} دقيقة`
      : elapsedMinutes < 24 * 60
        ? `منذ ${Math.floor(elapsedMinutes / 60).toLocaleString("ar-EG")} ساعة`
        : `منذ ${Math.floor(elapsedMinutes / (24 * 60)).toLocaleString("ar-EG")} يوم`;
  return `${formatDate(value)} · ${relative}`;
}

function roleLabel(role: Membership["role"]) {
  return role === "owner" ? "مالك" : role === "admin" ? "مدير نظام" : role === "manager" ? "مدير" : role === "member" ? "عضو" : "مشاهد";
}

export function TeamWorkspace() {
  const configured = isSupabaseConfigured();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [presence, setPresence] = useState<Presence[]>([]);
  const [report, setReport] = useState<TeamReport[]>([]);
  const [loading, setLoading] = useState(configured);
  const [reportLoading, setReportLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState<RangePreset>("week");
  const [customStart, setCustomStart] = useState(() => dateInput(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)));
  const [customEnd, setCustomEnd] = useState(() => dateInput(new Date()));
  const [now, setNow] = useState(() => Date.now());

  const range = useMemo(() => {
    const end = preset === "custom" ? new Date(`${customEnd}T23:59:59.999`) : new Date();
    const start = preset === "custom"
      ? new Date(`${customStart}T00:00:00`)
      : new Date(end.getTime() - (preset === "month" ? 30 : 7) * 24 * 60 * 60 * 1000);
    return { start, end };
  }, [customEnd, customStart, preset]);

  const clearWorkspace = useCallback(() => { setWorkspace(null); setPresence([]); setReport([]); }, []);
  const clearTransientState = useCallback(() => setError(null), []);

  const refreshPresence = useCallback(async (organizationId: string) => {
    const { data, error: presenceError } = await getSupabaseBrowserClient().from("member_presence")
      .select("*").eq("organization_id", organizationId).order("last_seen_at", { ascending: false });
    if (presenceError) throw presenceError;
    setPresence(data ?? []);
  }, []);

  const loadWorkspace = useCallback(async (activeSession: Session) => {
    const supabase = getSupabaseBrowserClient();
    setLoading(true);
    try {
      const { data: membership, error: membershipError } = await supabase.from("memberships")
        .select("*").eq("user_id", activeSession.user.id).eq("status", "active").limit(1).maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) { clearWorkspace(); return; }
      const [organizationResult, membershipResult] = await Promise.all([
        supabase.from("organizations").select("*").eq("id", membership.organization_id).single(),
        supabase.from("memberships").select("*").eq("organization_id", membership.organization_id).eq("status", "active"),
      ]);
      if (organizationResult.error) throw organizationResult.error;
      if (membershipResult.error) throw membershipResult.error;
      const memberIds = (membershipResult.data ?? []).map((row) => row.user_id);
      const { data: profiles, error: profilesError } = memberIds.length
        ? await supabase.from("profiles").select("id, full_name").in("id", memberIds)
        : { data: [], error: null };
      if (profilesError) throw profilesError;
      const people = (membershipResult.data ?? []).map((row) => ({
        id: row.user_id,
        role: row.role,
        name: profiles?.find((profile) => profile.id === row.user_id)?.full_name
          ?? (row.user_id === activeSession.user.id ? activeSession.user.email : null)
          ?? "عضو فريق",
      }));
      setWorkspace({ organization: organizationResult.data, membership, people });
      await refreshPresence(membership.organization_id);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذّر تحميل بيانات الفريق.");
    } finally {
      setLoading(false);
    }
  }, [clearWorkspace, refreshPresence]);

  const session = useWorkspaceAuth({ configured, loadWorkspace, clearWorkspace, setLoading, clearTransientState });

  const refreshReport = useCallback(async () => {
    if (!workspace || !canManageTasks(workspace.membership.role) || Number.isNaN(range.start.getTime()) || Number.isNaN(range.end.getTime())) return;
    setReportLoading(true);
    setError(null);
    const { data, error: reportError } = await getSupabaseBrowserClient().rpc("get_team_task_performance", {
      target_organization_id: workspace.organization.id,
      range_starts_at: range.start.toISOString(),
      range_ends_at: range.end.toISOString(),
    });
    setReportLoading(false);
    if (reportError) setError(reportError.message);
    else setReport(data ?? []);
  }, [range.end, range.start, workspace]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void refreshReport(), 0);
    return () => window.clearTimeout(timeout);
  }, [refreshReport]);
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);
  useEffect(() => {
    if (!workspace) return;
    const supabase = getSupabaseBrowserClient();
    const channel = supabase.channel(`team-presence:${workspace.organization.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "member_presence", filter: `organization_id=eq.${workspace.organization.id}` }, () => void refreshPresence(workspace.organization.id))
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refreshPresence, workspace]);

  if (loading) return <section className="workspace-state"><LoaderCircle className="spin" size={24} /><div><h2>جارٍ تحميل الفريق</h2><p>نجمع الأدوار والحضور والأداء المسجل.</p></div></section>;
  if (!session) return <section className="workspace-state workspace-onboarding"><LockKeyhole size={27} /><div><h2>سجّل الدخول أولًا</h2><p>تقارير الفريق محمية بنفس صلاحيات مساحة العمل.</p></div><Button href="/tasks">تسجيل الدخول</Button></section>;
  if (!workspace) return <section className="workspace-state"><UsersRound size={27} /><div><h2>لا توجد مساحة فريق مرتبطة</h2><p>أنشئ مساحة الشركة من قسم المهام أولًا.</p></div></section>;

  const manager = canManageTasks(workspace.membership.role);
  const reportByUser = new Map(report.map((row) => [row.user_id, row]));
  const presenceByUser = new Map(presence.map((row) => [row.user_id, row]));

  return <section className="team-workspace">
    {error ? <p className="form-notice error">{error}</p> : null}
    <aside className="presence-privacy-note"><ShieldCheck size={17} /><div><strong>حضور تشغيلي واضح للفريق</strong><p>نسجل القسم الحالي وآخر نبضة كل دقيقة فقط. لا نسجل نقرات أو كتابة أو محتوى شخصيًا، وهذه البيانات ظاهرة كجزء من سياسة العمل وليست مراقبة خفية.</p></div></aside>

    <section className="panel team-presence-panel">
      <div className="section-heading"><div><p className="overline">الحضور الآن</p><h2>مين فاتح المنصة وآخر ظهور؟</h2></div><button className="icon-button" type="button" aria-label="تحديث الحضور" onClick={() => void refreshPresence(workspace.organization.id)}><RefreshCw size={16} /></button></div>
      <div className="presence-grid">{workspace.people.map((person) => {
        const memberPresence = presenceByUser.get(person.id);
        const active = memberPresence ? now - new Date(memberPresence.last_seen_at).getTime() <= 2 * 60_000 : false;
        return <article key={person.id}><header><span className={`presence-dot ${active ? "online" : ""}`} /><div><strong>{person.name}</strong><small>{roleLabel(person.role)}</small></div><StatusBadge tone={active ? "success" : "neutral"}>{active ? "متصل الآن" : "غير متصل"}</StatusBadge></header><dl><div><dt>آخر قسم</dt><dd>{memberPresence ? sectionLabels[memberPresence.current_section] ?? memberPresence.current_section : "لم يدخل بعد"}</dd></div><div><dt>آخر ظهور على المنصة</dt><dd>{formatLastSeen(memberPresence?.last_seen_at ?? null, now)}</dd></div><div><dt>بداية الجلسة</dt><dd>{formatDate(memberPresence?.session_started_at ?? null)}</dd></div></dl></article>;
      })}</div>
    </section>

    <section className="panel team-report-panel">
      <div className="team-report-heading"><div><p className="overline">تقرير مبني على السجل</p><h2>ما طُلب وما نُفذ والالتزام بالموعد</h2><p>أرقام واقعية بلا تقييم شخصي. «آخر حركة شغل» تعني مهمة أو مراجعة مسجلة، ولا تتغير بمجرد فتح المنصة.</p></div>{reportLoading ? <LoaderCircle className="spin" size={20} /> : <Activity size={20} />}</div>
      {manager ? <>
        <div className="team-range-controls"><div className="segmented-control">{(["week", "month", "custom"] as RangePreset[]).map((value) => <button type="button" key={value} className={preset === value ? "active" : ""} onClick={() => setPreset(value)}>{value === "week" ? "آخر أسبوع" : value === "month" ? "آخر 30 يوم" : "مدة محددة"}</button>)}</div>{preset === "custom" ? <div className="custom-range"><label><span>من</span><input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label><label><span>إلى</span><input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label></div> : null}<span><CalendarDays size={13} /> {formatDate(range.start.toISOString())} — {formatDate(range.end.toISOString())}</span></div>
        <div className="team-report-table-wrap"><table className="team-report-table"><thead><tr><th>العضو</th><th>طلب مهام</th><th>أُسند له</th><th>أكمل</th><th>قبل الموعد</th><th>بعد الموعد</th><th>متأخر مفتوح</th><th>أرسل للمراجعة</th><th>طلب تعديلات</th><th>استلم تعديلات</th><th>آخر حركة شغل</th></tr></thead><tbody>{workspace.people.filter((person) => person.role !== "viewer").map((person) => {
          const row = reportByUser.get(person.id);
          return <tr key={person.id}><th><strong>{person.name}</strong><small>{roleLabel(person.role)}</small></th><td>{row?.tasks_requested ?? 0}</td><td>{row?.tasks_assigned ?? 0}</td><td>{row?.tasks_completed ?? 0}</td><td className="positive-cell"><CheckCircle2 size={12} /> {row?.completed_on_time ?? 0}</td><td className="warning-cell"><Clock3 size={12} /> {row?.completed_late ?? 0}</td><td className="danger-cell">{row?.overdue_open ?? 0}</td><td>{row?.review_submissions ?? 0}</td><td>{row?.revisions_requested ?? 0}</td><td>{row?.revisions_received ?? 0}</td><td>{formatDate(row?.last_activity_at ?? null)}</td></tr>;
        })}</tbody></table></div>
      </> : <p className="team-report-guard"><ShieldCheck size={15} /> التقرير الشامل متاح للمالك والمدير فقط. العضو يرى مهامه من بورد التنفيذ.</p>}
    </section>
  </section>;
}
