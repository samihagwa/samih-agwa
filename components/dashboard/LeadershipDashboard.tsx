"use client";

import type { Session } from "@supabase/supabase-js";
import {
  AlertTriangle, CalendarRange, CheckCircle2, CircleDashed, Clapperboard,
  LoaderCircle, LockKeyhole, Rocket, ShieldCheck, UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Tables } from "../../lib/supabase/database.types";
import { useWorkspaceAuth } from "../../lib/supabase/use-workspace-auth";
import { Button } from "../ui/Button";
import { StatCard } from "../ui/StatCard";
import { StatusBadge } from "../ui/StatusBadge";

type Organization = Tables<"organizations">;
type Membership = Tables<"memberships">;
type Task = Tables<"tasks">;
type ContentItem = Tables<"content_items">;
type Launch = Tables<"launches">;
type CrmContact = Tables<"crm_contacts">;
type Plan = Tables<"content_plans">;
type PlanItem = Tables<"content_plan_items">;
type ReadinessRow = { check_key: string; label: string; ready: boolean; detail: string; href: string; blocking: boolean };
type DashboardData = {
  organization: Organization;
  membership: Membership;
  tasks: Task[];
  content: ContentItem[];
  launches: Launch[];
  contacts: CrmContact[];
  plans: Plan[];
  planItems: PlanItem[];
  readiness: ReadinessRow[];
  activeMembers: number;
};

const leadershipRoles = new Set<Membership["role"]>(["owner", "admin", "manager"]);
const activeCrmStages = new Set<CrmContact["stage"]>(["new", "contacted", "qualified", "follow_up"]);

export function LeadershipDashboard() {
  const configured = isSupabaseConfigured();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const clearWorkspace = useCallback(() => setData(null), []);
  const clearTransientState = useCallback(() => setError(null), []);

  const loadDashboard = useCallback(async (activeSession: Session) => {
    const supabase = getSupabaseBrowserClient();
    setLoading(true);
    try {
      const { data: membership, error: membershipError } = await supabase.from("memberships")
        .select("*").eq("user_id", activeSession.user.id).eq("status", "active").limit(1).maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) { clearWorkspace(); return; }
      const manager = leadershipRoles.has(membership.role);
      const [organizationResult, tasksResult, contentResult, launchesResult, contactsResult, plansResult, planItemsResult, membersResult, readinessResult] = await Promise.all([
        supabase.from("organizations").select("*").eq("id", membership.organization_id).single(),
        supabase.from("tasks").select("*").eq("organization_id", membership.organization_id),
        supabase.from("content_items").select("*").eq("organization_id", membership.organization_id),
        supabase.from("launches").select("*").eq("organization_id", membership.organization_id),
        supabase.from("crm_contacts").select("*").eq("organization_id", membership.organization_id),
        supabase.from("content_plans").select("*").eq("organization_id", membership.organization_id).order("starts_on", { ascending: false }),
        supabase.from("content_plan_items").select("*").eq("organization_id", membership.organization_id),
        supabase.from("memberships").select("id", { count: "exact", head: true }).eq("organization_id", membership.organization_id).eq("status", "active"),
        manager ? supabase.rpc("get_workspace_readiness", { target_organization_id: membership.organization_id }) : Promise.resolve({ data: [], error: null }),
      ]);
      const firstError = [organizationResult.error, tasksResult.error, contentResult.error, launchesResult.error, contactsResult.error, plansResult.error, planItemsResult.error, membersResult.error, readinessResult.error].find(Boolean);
      if (firstError) throw firstError;
      if (!organizationResult.data) throw new Error("مساحة الشركة غير موجودة.");
      setData({
        organization: organizationResult.data,
        membership,
        tasks: tasksResult.data ?? [],
        content: contentResult.data ?? [],
        launches: launchesResult.data ?? [],
        contacts: contactsResult.data ?? [],
        plans: plansResult.data ?? [],
        planItems: planItemsResult.data ?? [],
        readiness: (readinessResult.data ?? []) as ReadinessRow[],
        activeMembers: membersResult.count ?? 0,
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذّر تحميل مركز القيادة.");
    } finally {
      setLoading(false);
    }
  }, [clearWorkspace]);

  const session = useWorkspaceAuth({ configured, loadWorkspace: loadDashboard, clearWorkspace, setLoading, clearTransientState });
  const refresh = useCallback(async () => { if (session) await loadDashboard(session); }, [loadDashboard, session]);

  useEffect(() => {
    const updateClock = () => setCurrentTime(Date.now());
    updateClock();
    const timer = window.setInterval(updateClock, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!data || !session) return;
    const supabase = getSupabaseBrowserClient();
    const reload = () => void refresh();
    let channel = supabase.channel(`leadership-dashboard:${data.organization.id}`);
    for (const table of ["tasks", "content_items", "launches", "crm_contacts", "content_plans", "content_plan_items", "memberships"] as const) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `organization_id=eq.${data.organization.id}` }, reload);
    }
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [data, refresh, session]);

  const metrics = useMemo(() => {
    const visibleTasks = data?.membership.role && leadershipRoles.has(data.membership.role)
      ? data.tasks
      : data?.tasks.filter((task) => task.owner_id === session?.user.id) ?? [];
    return {
      openTasks: visibleTasks.filter((task) => !["done", "cancelled"].includes(task.status) && task.is_work_item).length,
      overdueTasks: visibleTasks.filter((task) => currentTime > 0 && !["done", "cancelled"].includes(task.status) && new Date(task.due_at).getTime() < currentTime).length,
      activeContent: data?.content.filter((item) => ["production", "review", "scheduled"].includes(item.status)).length ?? 0,
      activeLaunches: data?.launches.filter((launch) => !["completed", "cancelled"].includes(launch.status)).length ?? 0,
      crmDue: data?.contacts.filter((contact) => currentTime > 0 && activeCrmStages.has(contact.stage) && contact.next_follow_up_at && new Date(contact.next_follow_up_at).getTime() < currentTime).length ?? 0,
    };
  }, [currentTime, data, session]);

  if (loading) return <section className="workspace-state"><LoaderCircle className="spin" size={24} /><div><h2>جارٍ تجهيز مركز القيادة</h2><p>نقرأ المخاطر والخطة والعمل الحالي من البيانات الحقيقية.</p></div></section>;
  if (!session) return <section className="panel dashboard-signin"><LockKeyhole size={27} /><div><p className="overline">مساحة خاصة</p><h2>سجّل الدخول لرؤية وضع التشغيل الحقيقي</h2><p>لن نعرض أرقامًا تجميلية أو بيانات فريق قبل جلسة موثقة.</p></div><Button href="/tasks">تسجيل الدخول</Button></section>;
  if (!data) return <section className="panel dashboard-signin"><ShieldCheck size={27} /><div><h2>أنشئ مساحة الشركة أولًا</h2><p>{error ?? "ابدأ من قسم المهام، ثم سيصبح مركز القيادة حيًا."}</p></div><Button href="/tasks">فتح المهام</Button></section>;

  const manager = leadershipRoles.has(data.membership.role);
  const activePlan = data.plans.find((plan) => plan.status === "active") ?? null;
  const activePlanItems = activePlan ? data.planItems.filter((item) => item.plan_id === activePlan.id && item.status !== "cancelled") : [];
  const publishedPlanItems = activePlanItems.filter((item) => item.status === "published").length;
  const planProgress = activePlanItems.length ? Math.round((publishedPlanItems / activePlanItems.length) * 100) : 0;
  const blockingChecks = data.readiness.filter((check) => check.blocking);
  const passedBlocking = blockingChecks.filter((check) => check.ready).length;

  return <section className="leadership-dashboard">
    <div className="stats-grid dashboard-live-stats" aria-label="مؤشرات التشغيل الحالية">
      <StatCard label={manager ? "مهام مفتوحة" : "مهامي المفتوحة"} value={String(metrics.openTasks)} note="مهام تنفيذ فعلية الآن" />
      <StatCard label="متأخر عن الموعد" value={String(metrics.overdueTasks)} note={metrics.overdueTasks ? "يحتاج قرارًا أو إعادة توزيع" : "لا يوجد خطر موعد حاليًا"} tone={metrics.overdueTasks ? "warning" : "default"} />
      <StatCard label="محتوى داخل المصنع" value={String(metrics.activeContent)} note="إنتاج أو مراجعة أو جدولة" />
      <StatCard label="متابعات CRM متأخرة" value={String(metrics.crmDue)} note="من السجل الحقيقي فقط" tone={metrics.crmDue ? "warning" : "default"} />
    </div>

    <div className="dashboard-decision-grid">
      <article className="panel dashboard-plan-card">
        <header><div><p className="overline">الخطة الحالية</p><h2>{activePlan?.name ?? "لا توجد خطة فعّالة"}</h2></div><CalendarRange size={22} /></header>
        {activePlan ? <><div className="dashboard-plan-progress"><strong>{planProgress}%</strong><div className="content-progress-track"><span style={{ width: `${planProgress}%` }} /></div><small>{publishedPlanItems} منشور من {activePlanItems.length} بند</small></div><p>{activePlan.objective}</p></> : <p>أنشئ الخطة والأعمدة وأول أسبوع؛ بعدها المصنع ينفذ بدل ما نختار محتوى يومًا بيوم.</p>}
        <Button href="/planning" variant={activePlan ? "secondary" : "primary"}>{activePlan ? "فتح التقويم" : "بناء أول خطة"}</Button>
      </article>

      <article className="panel dashboard-risk-card">
        <header><div><p className="overline">المخاطر الآن</p><h2>ما الذي يحتاج تدخلك؟</h2></div>{metrics.overdueTasks || metrics.crmDue ? <AlertTriangle size={22} /> : <CheckCircle2 size={22} />}</header>
        <div className="dashboard-risk-list"><a href="/tasks?filter=overdue"><span><AlertTriangle size={15} /> مهام متأخرة</span><strong>{metrics.overdueTasks}</strong></a><a href="/crm"><span><UsersRound size={15} /> متابعات عملاء متأخرة</span><strong>{metrics.crmDue}</strong></a><a href="/campaigns"><span><Rocket size={15} /> إطلاقات مفتوحة</span><strong>{metrics.activeLaunches}</strong></a><a href="/content"><span><Clapperboard size={15} /> محتوى داخل التنفيذ</span><strong>{metrics.activeContent}</strong></a></div>
      </article>
    </div>

    {manager ? <section className="panel readiness-panel">
      <div className="section-heading"><div><p className="overline">Team readiness</p><h2>هل النظام جاهز لدخول الفريق؟</h2><p>بوابة حقيقية من البيانات، وليست نسبة شكلية. البنود غير التقنية تظل واضحة لتراجعها بنفسك.</p></div><StatusBadge tone={passedBlocking === blockingChecks.length && blockingChecks.length ? "success" : "warning"}>{passedBlocking}/{blockingChecks.length} شروط أساسية</StatusBadge></div>
      <div className="readiness-progress"><div className="content-progress-track"><span style={{ width: `${blockingChecks.length ? Math.round((passedBlocking / blockingChecks.length) * 100) : 0}%` }} /></div><small>{data.activeMembers} حساب فعّال داخل مساحة الشركة</small></div>
      <div className="readiness-grid">{data.readiness.map((check) => <a className={check.ready ? "ready" : "pending"} href={check.href} key={check.check_key}>{check.ready ? <CheckCircle2 size={18} /> : <CircleDashed size={18} />}<div><strong>{check.label}</strong><p>{check.detail}</p></div><StatusBadge tone={check.ready ? "success" : check.blocking ? "warning" : "info"}>{check.ready ? "جاهز" : check.blocking ? "مطلوب" : "تحسين"}</StatusBadge></a>)}</div>
      <aside className="readiness-external-note"><ShieldCheck size={17} /><p><strong>قرار إدخال الفريق يعتمد على البيانات أعلاه:</strong> اختبر عضوًا محدود الصلاحيات، اعتمد مراجع البراند، فعّل خطة الأسبوع الأول، ونظّف أي مهمة اختبار متأخرة. تكامل Exness ليس شرطًا لبدء إدارة المهام والمحتوى.</p></aside>
    </section> : null}
  </section>;
}
