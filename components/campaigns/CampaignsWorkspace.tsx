"use client";

import type { Session } from "@supabase/supabase-js";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CircleUserRound,
  Film,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RefreshCw,
  Route,
  Sparkles,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  launchGateConfig,
  launchGates,
  launchStatusConfig,
  launchTypeConfig,
  type LaunchGate,
  type LaunchType,
} from "../../lib/launches";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Tables } from "../../lib/supabase/database.types";
import { canManageTasks } from "../../lib/tasks";
import { Button } from "../ui/Button";
import { StatusBadge } from "../ui/StatusBadge";

type Launch = Tables<"launches">;
type LaunchContentLink = Tables<"launch_content_items">;
type ContentItem = Tables<"content_items">;
type Task = Tables<"tasks">;
type Membership = Tables<"memberships">;
type Organization = Tables<"organizations">;

type TeamPerson = {
  id: string;
  name: string;
  role: Membership["role"];
};

type Workspace = {
  organization: Organization;
  membership: Membership;
  people: TeamPerson[];
};

const assignmentFields: Array<{ gate: LaunchGate; name: string }> = [
  { gate: "strategy", name: "strategy_owner_id" },
  { gate: "offer", name: "offer_owner_id" },
  { gate: "registration", name: "registration_owner_id" },
  { gate: "delivery", name: "delivery_owner_id" },
  { gate: "promotion", name: "promotion_owner_id" },
  { gate: "tracking", name: "tracking_owner_id" },
  { gate: "go_no_go", name: "go_no_go_owner_id" },
  { gate: "launch_day", name: "launch_day_owner_id" },
];

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) return String(error.message);
  return "حدث خطأ غير متوقع.";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function toLocalDateTimeInput(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function optionalNumber(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text === "" ? null : Number(text);
}

function formatTarget(value: number, unit: string) {
  return new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 }).format(value) + ` ${unit}`;
}

export function CampaignsWorkspace() {
  const configured = isSupabaseConfigured();
  const [session, setSession] = useState<Session | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [launches, setLaunches] = useState<Launch[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [contentItems, setContentItems] = useState<ContentItem[]>([]);
  const [contentLinks, setContentLinks] = useState<LaunchContentLink[]>([]);
  const [contentSelection, setContentSelection] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(configured);
  const [working, setWorking] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(configured ? null : "لم يتم إعداد اتصال Supabase لهذه النسخة.");
  const [notice, setNotice] = useState<string | null>(null);
  const [renderNow] = useState(() => Date.now());
  const [defaultStart] = useState(() => toLocalDateTimeInput(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)));
  const [defaultEnd] = useState(() => toLocalDateTimeInput(new Date(Date.now() + (30 * 24 + 2) * 60 * 60 * 1000)));

  const refreshLaunches = useCallback(async (organizationId: string) => {
    const supabase = getSupabaseBrowserClient();
    const [launchResult, taskResult, contentResult, linkResult] = await Promise.all([
      supabase
        .from("launches")
        .select("*")
        .eq("organization_id", organizationId)
        .order("starts_at", { ascending: true }),
      supabase
        .from("tasks")
        .select("*")
        .eq("organization_id", organizationId)
        .not("launch_id", "is", null)
        .order("due_at", { ascending: true }),
      supabase
        .from("content_items")
        .select("*")
        .eq("organization_id", organizationId)
        .order("publish_at", { ascending: true }),
      supabase
        .from("launch_content_items")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: true }),
    ]);

    if (launchResult.error) throw launchResult.error;
    if (taskResult.error) throw taskResult.error;
    if (contentResult.error) throw contentResult.error;
    if (linkResult.error) throw linkResult.error;

    setLaunches(launchResult.data ?? []);
    setTasks(taskResult.data ?? []);
    setContentItems(contentResult.data ?? []);
    setContentLinks(linkResult.data ?? []);
  }, []);

  const loadWorkspace = useCallback(async (activeSession: Session) => {
    const supabase = getSupabaseBrowserClient();
    setLoading(true);
    setError(null);

    try {
      const { data: membership, error: membershipError } = await supabase
        .from("memberships")
        .select("*")
        .eq("user_id", activeSession.user.id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();

      if (membershipError) throw membershipError;
      if (!membership) {
        setWorkspace(null);
        setLaunches([]);
        setTasks([]);
        setContentItems([]);
        setContentLinks([]);
        return;
      }

      const [organizationResult, membersResult] = await Promise.all([
        supabase.from("organizations").select("*").eq("id", membership.organization_id).single(),
        supabase
          .from("memberships")
          .select("user_id, role")
          .eq("organization_id", membership.organization_id)
          .eq("status", "active"),
      ]);

      if (organizationResult.error) throw organizationResult.error;
      if (membersResult.error) throw membersResult.error;

      const memberIds = (membersResult.data ?? []).map((member) => member.user_id);
      const { data: profiles, error: profilesError } = memberIds.length
        ? await supabase.from("profiles").select("id, full_name").in("id", memberIds)
        : { data: [], error: null };

      if (profilesError) throw profilesError;

      const people = (membersResult.data ?? []).map((member) => ({
        id: member.user_id,
        role: member.role,
        name:
          profiles?.find((profile) => profile.id === member.user_id)?.full_name
          ?? (member.user_id === activeSession.user.id ? activeSession.user.email : null)
          ?? "عضو فريق",
      }));

      setWorkspace({
        organization: organizationResult.data,
        membership,
        people,
      });
      await refreshLaunches(membership.organization_id);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [refreshLaunches]);

  useEffect(() => {
    if (!configured) return;
    const supabase = getSupabaseBrowserClient();

    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) void loadWorkspace(data.session);
      else setLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setNotice(null);
      if (nextSession) void loadWorkspace(nextSession);
      else {
        setWorkspace(null);
        setLaunches([]);
        setTasks([]);
        setContentItems([]);
        setContentLinks([]);
        setLoading(false);
      }
    });

    return () => data.subscription.unsubscribe();
  }, [configured, loadWorkspace]);

  useEffect(() => {
    if (!workspace) return;
    const supabase = getSupabaseBrowserClient();
    const refresh = () => void refreshLaunches(workspace.organization.id);
    const channel = supabase
      .channel(`launches:${workspace.organization.id}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "launches",
        filter: `organization_id=eq.${workspace.organization.id}`,
      }, refresh)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "tasks",
        filter: `organization_id=eq.${workspace.organization.id}`,
      }, refresh)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "launch_content_items",
        filter: `organization_id=eq.${workspace.organization.id}`,
      }, refresh)
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refreshLaunches, workspace]);

  const tasksByLaunch = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    for (const task of tasks) {
      if (!task.launch_id) continue;
      const group = grouped.get(task.launch_id) ?? [];
      group.push(task);
      grouped.set(task.launch_id, group);
    }
    return grouped;
  }, [tasks]);

  const linksByLaunch = useMemo(() => {
    const grouped = new Map<string, LaunchContentLink[]>();
    for (const link of contentLinks) {
      const group = grouped.get(link.launch_id) ?? [];
      group.push(link);
      grouped.set(link.launch_id, group);
    }
    return grouped;
  }, [contentLinks]);

  async function createLaunch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace) return;

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const startsAt = new Date(String(form.get("starts_at") ?? ""));
    const endsAt = new Date(String(form.get("ends_at") ?? ""));
    const leadTarget = optionalNumber(form.get("lead_target"));
    const salesTarget = optionalNumber(form.get("sales_target"));
    const revenueTarget = optionalNumber(form.get("revenue_target"));

    if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= Date.now() + 24 * 60 * 60 * 1000) {
      setError("بداية الإطلاق يجب أن تكون بعد 24 ساعة على الأقل.");
      return;
    }
    if (Number.isNaN(endsAt.getTime()) || endsAt.getTime() <= startsAt.getTime()) {
      setError("نهاية الإطلاق يجب أن تكون بعد بدايته.");
      return;
    }
    if ((leadTarget !== null && !Number.isInteger(leadTarget)) || (salesTarget !== null && !Number.isInteger(salesTarget))) {
      setError("مستهدف العملاء والمبيعات يجب أن يكون عددًا صحيحًا.");
      return;
    }
    if ((leadTarget ?? 0) <= 0 && (salesTarget ?? 0) <= 0 && (revenueTarget ?? 0) <= 0) {
      setError("ضع مستهدفًا موجبًا واحدًا على الأقل حتى يمكن تقييم الإطلاق.");
      return;
    }

    setWorking(true);
    setError(null);
    setNotice(null);

    const body: Record<string, unknown> = {
      action: "create",
      target_organization_id: workspace.organization.id,
      launch_title: String(form.get("title") ?? "").trim(),
      launch_kind: String(form.get("type") ?? "") as LaunchType,
      launch_objective: String(form.get("objective") ?? "").trim(),
      launch_audience: String(form.get("audience") ?? "").trim(),
      launch_offer: String(form.get("offer") ?? "").trim(),
      launch_cta: String(form.get("cta") ?? "").trim(),
      launch_starts_at: startsAt.toISOString(),
      launch_ends_at: endsAt.toISOString(),
      launch_lead_target: leadTarget,
      launch_sales_target: salesTarget,
      launch_revenue_target: revenueTarget,
      launch_currency: String(form.get("currency") ?? "EGP").trim().toUpperCase(),
    };

    for (const { name } of assignmentFields) body[name] = String(form.get(name) ?? "");

    const { error: commandError } = await getSupabaseBrowserClient().functions.invoke("launch-commands", { body });
    setWorking(false);

    if (commandError) {
      setError(commandError.message);
      return;
    }

    formElement.reset();
    setShowCreate(false);
    setNotice("تم إنشاء الإطلاق و8 بوابات مترابطة. بوابة الاستراتيجية فقط جاهزة الآن.");
    await refreshLaunches(workspace.organization.id);
  }

  async function changeContentLink(launchId: string, contentItemId: string, attach: boolean) {
    if (!workspace || !contentItemId) return;
    setWorking(true);
    setError(null);
    setNotice(null);

    const { error: commandError } = await getSupabaseBrowserClient().functions.invoke("launch-commands", {
      body: {
        action: attach ? "attach_content" : "detach_content",
        launch_id: launchId,
        content_item_id: contentItemId,
      },
    });

    setWorking(false);
    if (commandError) {
      setError(commandError.message);
      return;
    }

    setContentSelection((current) => ({ ...current, [launchId]: "" }));
    setNotice(attach ? "تم ربط أصل المحتوى بالإطلاق." : "تمت إزالة الرابط فقط؛ أصل المحتوى لم يُحذف.");
    await refreshLaunches(workspace.organization.id);
  }

  if (loading) {
    return <section className="workspace-state" aria-live="polite"><LoaderCircle className="spin" size={24} /><div><h2>جارٍ تحميل غرفة الإطلاق</h2><p>نجمع الخطة والبوابات والمهام والأصول المرتبطة من المصدر الحقيقي.</p></div></section>;
  }

  if (!session) {
    return (
      <section className="workspace-state workspace-onboarding">
        <LockKeyhole size={27} />
        <div><p className="overline">دخول موحد</p><h2>سجّل الدخول أولًا من قسم المهام</h2><p>الحملات تستخدم نفس الحساب والصلاحيات وسجل التدقيق، ولا يوجد دخول منفصل.</p></div>
        <Button href="/tasks"><Link2 size={16} /> الانتقال لتسجيل الدخول</Button>
      </section>
    );
  }

  if (!workspace) {
    return (
      <section className="workspace-state workspace-onboarding">
        <Route size={27} />
        <div><p className="overline">مساحة العمل مطلوبة</p><h2>أنشئ مساحة الشركة مرة واحدة</h2><p>ابدأ من قسم المهام، ثم ارجع هنا لبناء أول إطلاق حقيقي.</p></div>
        <Button href="/tasks"><Link2 size={16} /> فتح قسم المهام</Button>
      </section>
    );
  }

  const manager = canManageTasks(workspace.membership.role);
  const peopleById = new Map(workspace.people.map((person) => [person.id, person]));
  const contentById = new Map(contentItems.map((item) => [item.id, item]));

  return (
    <section className="campaigns-workspace">
      <div className="workspace-toolbar">
        <div><p className="overline">{workspace.organization.name}</p><h2>غرفة الإطلاق</h2><p>{launches.length ? `${launches.length} إطلاق حقيقي مسجل` : "لا توجد إطلاقات حقيقية بعد — أنشئ الأول عندما تتحدد الخطة والأهداف."}</p></div>
        <div className="toolbar-actions">
          <button className="icon-button" type="button" aria-label="تحديث الحملات" onClick={() => void refreshLaunches(workspace.organization.id)}><RefreshCw size={17} /></button>
          <Button href="/tasks" variant="secondary"><Route size={16} /> كل المهام</Button>
          <Button href="/content" variant="secondary"><Film size={16} /> مصنع المحتوى</Button>
          {manager ? <Button type="button" onClick={() => setShowCreate((value) => !value)}><Plus size={16} /> إطلاق جديد</Button> : null}
        </div>
      </div>

      {notice ? <p className="form-notice success" role="status">{notice}</p> : null}
      {error ? <p className="form-notice error" role="alert">{error}</p> : null}

      {showCreate && manager ? (
        <form className="panel launch-create-form" onSubmit={createLaunch}>
          <div className="section-heading"><div><p className="overline">قرار تجاري قبل جدول مهام</p><h2>Brief الإطلاق والخطة العكسية</h2></div><button className="text-button" type="button" onClick={() => setShowCreate(false)}>إغلاق</button></div>

          <div className="form-grid">
            <label><span>اسم الإطلاق</span><input name="title" minLength={3} maxLength={180} required placeholder="مثال: إطلاق كورس إدارة المخاطر" /></label>
            <label><span>النوع</span><select name="type" defaultValue="course">{(Object.keys(launchTypeConfig) as LaunchType[]).map((type) => <option value={type} key={type}>{launchTypeConfig[type].label}</option>)}</select></label>
            <label><span>بداية الإطلاق</span><input name="starts_at" type="datetime-local" defaultValue={defaultStart} required /></label>
            <label><span>نهاية الإطلاق</span><input name="ends_at" type="datetime-local" defaultValue={defaultEnd} required /></label>
            <label className="full-field"><span>الهدف الاستراتيجي</span><textarea name="objective" minLength={5} maxLength={1500} rows={2} required placeholder="ما النتيجة التي يجب أن يحققها الإطلاق ولماذا الآن؟" /></label>
            <label className="full-field"><span>الجمهور المحدد</span><textarea name="audience" minLength={3} maxLength={1000} rows={2} required placeholder="لمن هذا العرض تحديدًا، وما المشكلة التي يحاول حلها؟" /></label>
            <label className="full-field"><span>العرض</span><textarea name="offer" minLength={3} maxLength={1500} rows={2} required placeholder="المنتج، السعر، النتيجة الموعودة، الضمان والمكافآت إن وُجدت" /></label>
            <label className="full-field"><span>الـCTA الرئيسي</span><textarea name="cta" minLength={2} maxLength={500} rows={2} required placeholder="الفعل الواحد المطلوب من الجمهور" /></label>
          </div>

          <div className="launch-targets">
            <div><p className="overline">تعريف النجاح</p><h3>ضع مستهدفًا واحدًا على الأقل</h3><p>هذه أرقام الخطة فقط. الفعلي لن يظهر حتى يصل من مصدر موثوق أو إدخال معتمد.</p></div>
            <div className="launch-target-grid">
              <label><span>مستهدف العملاء المحتملين</span><input name="lead_target" type="number" min="0" step="1" inputMode="numeric" placeholder="اختياري" /></label>
              <label><span>مستهدف المبيعات</span><input name="sales_target" type="number" min="0" step="1" inputMode="numeric" placeholder="اختياري" /></label>
              <label><span>مستهدف الإيراد</span><input name="revenue_target" type="number" min="0" step="0.01" inputMode="decimal" placeholder="اختياري" /></label>
              <label><span>العملة</span><input name="currency" defaultValue="EGP" minLength={3} maxLength={3} pattern="[A-Za-z]{3}" dir="ltr" required /></label>
            </div>
          </div>

          <div className="assignment-block">
            <div><p className="overline">المساءلة</p><h3>مالك واحد لكل بوابة</h3><p>أثناء اختبارك الشخصي يمكن أن يكون حسابك مالكًا لكل البوابات. التوزيع جاهز عندما تقرر إدخال الفريق لاحقًا.</p></div>
            <div className="assignment-grid launch-assignment-grid">
              {assignmentFields.map(({ gate, name }) => (
                <label key={gate}><span>{launchGateConfig[gate].label}</span><select name={name} defaultValue={session.user.id} required>{workspace.people.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
              ))}
            </div>
          </div>

          <div className="form-actions"><Button type="submit" disabled={working}>{working ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />} إنشاء غرفة الإطلاق</Button><small>العملية ذرّية: الحملة و8 المهام و10 اعتماديات تُحفظ معًا أو لا يُحفظ شيء.</small></div>
        </form>
      ) : null}

      {launches.length ? (
        <div className="launch-list">
          {launches.map((launch) => {
            const launchTasks = [...(tasksByLaunch.get(launch.id) ?? [])].sort((a, b) => {
              const aOrder = a.launch_gate ? launchGateConfig[a.launch_gate].order : 99;
              const bOrder = b.launch_gate ? launchGateConfig[b.launch_gate].order : 99;
              return aOrder - bOrder;
            });
            const linkedItems = (linksByLaunch.get(launch.id) ?? [])
              .map((link) => contentById.get(link.content_item_id))
              .filter((item): item is ContentItem => Boolean(item));
            const linkedIds = new Set(linkedItems.map((item) => item.id));
            const availableContent = contentItems.filter((item) => !linkedIds.has(item.id));
            const doneCount = launchTasks.filter((task) => task.status === "done").length;
            const progress = launchTasks.length ? Math.round((doneCount / launchTasks.length) * 100) : 0;
            const activeTasks = launchTasks.filter((task) => ["ready", "in_progress", "review", "blocked"].includes(task.status));
            const blockedCount = launchTasks.filter((task) => task.status === "blocked").length;
            const overdueCount = launchTasks.filter((task) => !["done", "cancelled"].includes(task.status) && new Date(task.due_at).getTime() < renderNow).length;
            const targets = [
              launch.lead_target === null ? null : { label: "عملاء محتملون", value: formatTarget(launch.lead_target, "Lead") },
              launch.sales_target === null ? null : { label: "مبيعات", value: formatTarget(launch.sales_target, "Sale") },
              launch.revenue_target === null ? null : { label: "إيراد", value: formatTarget(launch.revenue_target, launch.currency) },
            ].filter((target): target is { label: string; value: string } => Boolean(target));

            return (
              <article className="panel launch-card" key={launch.id}>
                <header>
                  <div className="content-card-title"><span className="icon-tile"><Route size={17} /></span><div><p className="overline">{launchTypeConfig[launch.type].label} · v{launch.version}</p><h3>{launch.title}</h3></div></div>
                  <StatusBadge tone={launchStatusConfig[launch.status].tone}>{launchStatusConfig[launch.status].label}</StatusBadge>
                </header>

                <div className="launch-summary-grid">
                  <div><small>الهدف</small><p>{launch.objective}</p></div>
                  <div><small>الجمهور</small><p>{launch.audience}</p></div>
                  <div><small>العرض</small><p>{launch.offer}</p></div>
                  <div><small>الـCTA</small><p>{launch.primary_cta}</p></div>
                </div>

                <div className="launch-control-strip">
                  <div><strong>{progress}%</strong><span>اكتمل {doneCount} من {launchTasks.length} بوابات</span></div>
                  <div className="content-progress-track" aria-label={`نسبة جاهزية الإطلاق ${progress}%`}><span style={{ width: `${progress}%` }} /></div>
                  <div className="launch-dates"><span><CalendarClock size={14} /> يبدأ {formatDate(launch.starts_at)}</span><span>ينتهي {formatDate(launch.ends_at)}</span></div>
                </div>

                {(blockedCount || overdueCount) ? <p className="launch-risk"><AlertTriangle size={15} /> يوجد {blockedCount ? `${blockedCount} متوقف` : ""}{blockedCount && overdueCount ? " و" : ""}{overdueCount ? `${overdueCount} متأخر` : ""}. قرار Go / No-Go لن يفتح قبل إغلاق الاعتماديات.</p> : null}

                <ol className="launch-gates" aria-label="بوابات جاهزية الإطلاق">
                  {launchGates.map((gate) => {
                    const task = launchTasks.find((candidate) => candidate.launch_gate === gate);
                    const active = task ? ["ready", "in_progress", "review", "blocked"].includes(task.status) : false;
                    return (
                      <li className={`${task?.status === "done" ? "done" : ""} ${active ? "active" : ""} ${task?.status === "blocked" ? "blocked" : ""}`} key={gate}>
                        <span>{task?.status === "done" ? <CheckCircle2 size={14} /> : launchGateConfig[gate].order}</span>
                        <strong>{launchGateConfig[gate].shortLabel}</strong>
                        <small>{task ? peopleById.get(task.owner_id)?.name ?? "عضو فريق" : "—"}</small>
                      </li>
                    );
                  })}
                </ol>

                <div className="launch-lower-grid">
                  <section className="launch-target-panel">
                    <div className="launch-subheading"><div><p className="overline">مستهدفات الخطة</p><h4>كيف نعرّف النجاح؟</h4></div><StatusBadge tone="warning">الفعلي غير مربوط بعد</StatusBadge></div>
                    <div className="target-chip-list">{targets.map((target) => <div key={target.label}><small>{target.label}</small><strong>{target.value}</strong></div>)}</div>
                    <p>ربط Meta والموقع والمبيعات مرحلة تكامل مستقلة. لن يعرض النظام نتيجة فعلية قبل وصول رقم موثوق.</p>
                  </section>

                  <section className="launch-assets-panel">
                    <div className="launch-subheading"><div><p className="overline">أصول الحملة</p><h4>{linkedItems.length ? `${linkedItems.length} أصل محتوى مرتبط` : "لا يوجد محتوى مرتبط"}</h4></div><a className="text-link" href="/content">فتح المصنع <Link2 size={13} /></a></div>
                    {linkedItems.length ? <ul className="linked-content-list">{linkedItems.map((item) => <li key={item.id}><div><Film size={14} /><span>{item.title}</span></div>{manager ? <button type="button" disabled={working} onClick={() => void changeContentLink(launch.id, item.id, false)}>إزالة الربط</button> : null}</li>)}</ul> : <p className="launch-assets-empty">أنشئ أصلًا من مصنع المحتوى، ثم اربطه هنا بالخطة.</p>}
                    {manager && availableContent.length ? <div className="content-link-control"><select aria-label={`اختر محتوى لحملة ${launch.title}`} value={contentSelection[launch.id] ?? ""} onChange={(event) => setContentSelection((current) => ({ ...current, [launch.id]: event.target.value }))}><option value="">اختر أصل محتوى…</option>{availableContent.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select><Button type="button" variant="secondary" disabled={working || !contentSelection[launch.id]} onClick={() => void changeContentLink(launch.id, contentSelection[launch.id], true)}><Link2 size={14} /> ربط</Button></div> : null}
                  </section>
                </div>

                <footer>
                  <div>{activeTasks.length ? <><CircleUserRound size={15} /><span>النشط الآن: <strong>{activeTasks.map((task) => task.launch_gate ? launchGateConfig[task.launch_gate].shortLabel : task.title).join(" + ")}</strong></span></> : <><CheckCircle2 size={15} /><span>لا توجد بوابة نشطة الآن.</span></>}</div>
                  <a className="text-link" href="/tasks">فتح مهام الإطلاق <Link2 size={13} /></a>
                </footer>
              </article>
            );
          })}
        </div>
      ) : (
        <section className="panel empty-state">
          <span className="empty-visual"><Route size={20} /></span>
          <div><h2>غرفة الإطلاق جاهزة بدون حملات وهمية</h2><p>عندما تنشئ أول إطلاق سيظهر هنا ومعه الخطة العكسية والبوابات والمسؤولون والمواعيد والأصول.</p></div>
          <span className="empty-proof"><CheckCircle2 size={15} /> متصلة بالمهام والمحتوى</span>
        </section>
      )}

      <aside className="automation-note"><LockKeyhole size={17} /><div><strong>الحالة والجاهزية لا تتغيران يدويًا</strong><p>إكمال مهام البوابات هو الذي يفتح المرحلة التالية ويحدّث حالة الإطلاق. البيانات الفعلية من Meta والموقع والدفع لم تُربط بعد، لذلك تظهر المستهدفات فقط من دون أرقام مصطنعة.</p></div></aside>
    </section>
  );
}
