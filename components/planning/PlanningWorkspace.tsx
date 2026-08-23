"use client";

import type { Session } from "@supabase/supabase-js";
import {
  ArrowUpLeft, CalendarDays, CheckCircle2, CircleSlash2, FilePlus2,
  Link2, LoaderCircle, LockKeyhole, PencilLine, Plus, RefreshCw,
  Route, ShieldCheck, Target, UsersRound,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  contentPlanItemKindConfig, contentPlanItemKinds, contentPlanItemStatusConfig,
  contentPlanStatusConfig, type ContentPlanItemKind, type ContentPlanStatus,
} from "../../lib/planning";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Tables } from "../../lib/supabase/database.types";
import { useWorkspaceAuth } from "../../lib/supabase/use-workspace-auth";
import { Button } from "../ui/Button";
import { StatusBadge } from "../ui/StatusBadge";

type Organization = Tables<"organizations">;
type Membership = Tables<"memberships">;
type Plan = Tables<"content_plans">;
type Pillar = Tables<"content_plan_pillars">;
type PlanItem = Tables<"content_plan_items">;
type ContentItem = Tables<"content_items">;
type Person = { id: string; name: string; role: Membership["role"] };
type Workspace = {
  organization: Organization;
  membership: Membership;
  people: Person[];
  plans: Plan[];
  pillars: Pillar[];
  items: PlanItem[];
  contentItems: ContentItem[];
};

const leadershipRoles = new Set<Membership["role"]>(["owner", "admin", "manager"]);

function isoDate(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function defaultQuarter() {
  const now = new Date();
  const firstMonth = Math.floor(now.getMonth() / 3) * 3;
  return {
    startsOn: isoDate(new Date(now.getFullYear(), firstMonth, 1)),
    endsOn: isoDate(new Date(now.getFullYear(), firstMonth + 3, 0)),
  };
}

function formatDate(value: string, withTime = false) {
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" as const } : {}),
    timeZone: "Africa/Cairo",
  }).format(new Date(value));
}

function planItemInputDate(plan: Plan) {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const start = new Date(`${plan.starts_on}T18:00:00`);
  const end = new Date(`${plan.ends_on}T18:00:00`);
  const candidate = tomorrow < start ? start : tomorrow > end ? end : tomorrow;
  const local = new Date(candidate.getTime() - candidate.getTimezoneOffset() * 60_000);
  local.setHours(18, 0, 0, 0);
  return local.toISOString().slice(0, 16);
}

function contentMatchesPlanKind(content: ContentItem, kind: ContentPlanItemKind) {
  if (kind === "reel") return content.format === "reel";
  if (kind === "social_post") return content.format === "post" || content.format === "carousel";
  if (kind === "story") return content.format === "story";
  if (kind === "live" || kind === "webinar") return content.format === "live" || content.format === "long_video";
  if (kind === "email") return content.format === "email";
  return true;
}

export function PlanningWorkspace() {
  const configured = isSupabaseConfigured();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(configured);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [showPillarForm, setShowPillarForm] = useState(false);
  const [showItemForm, setShowItemForm] = useState(false);
  const [selectedKind, setSelectedKind] = useState<ContentPlanItemKind>("reel");

  const clearWorkspace = useCallback(() => setWorkspace(null), []);
  const clearTransientState = useCallback(() => { setError(null); setNotice(null); }, []);

  const loadWorkspace = useCallback(async (activeSession: Session) => {
    const supabase = getSupabaseBrowserClient();
    setLoading(true);
    try {
      const { data: membership, error: membershipError } = await supabase.from("memberships")
        .select("*").eq("user_id", activeSession.user.id).eq("status", "active").limit(1).maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) { clearWorkspace(); return; }

      const [organizationResult, membershipsResult, plansResult, pillarsResult, itemsResult, contentResult] = await Promise.all([
        supabase.from("organizations").select("*").eq("id", membership.organization_id).single(),
        supabase.from("memberships").select("user_id, role").eq("organization_id", membership.organization_id).eq("status", "active").neq("role", "viewer"),
        supabase.from("content_plans").select("*").eq("organization_id", membership.organization_id).order("starts_on", { ascending: false }),
        supabase.from("content_plan_pillars").select("*").eq("organization_id", membership.organization_id).order("sort_order", { ascending: true }),
        supabase.from("content_plan_items").select("*").eq("organization_id", membership.organization_id).order("publish_at", { ascending: true }),
        supabase.from("content_items").select("*").eq("organization_id", membership.organization_id).neq("status", "cancelled").order("publish_at", { ascending: true }),
      ]);
      const firstError = [organizationResult.error, membershipsResult.error, plansResult.error, pillarsResult.error, itemsResult.error, contentResult.error].find(Boolean);
      if (firstError) throw firstError;
      if (!organizationResult.data) throw new Error("مساحة الشركة غير موجودة.");
      const memberRows = membershipsResult.data ?? [];
      const memberIds = memberRows.map((row) => row.user_id);
      const profilesResult = memberIds.length
        ? await supabase.from("profiles").select("id, full_name").in("id", memberIds)
        : { data: [], error: null };
      if (profilesResult.error) throw profilesResult.error;
      const names = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile.full_name ?? "عضو فريق"]));
      const people = memberRows.map((row) => ({ id: row.user_id, role: row.role, name: names.get(row.user_id) ?? "عضو فريق" }));
      const plans = plansResult.data ?? [];
      setWorkspace({
        organization: organizationResult.data,
        membership,
        people,
        plans,
        pillars: pillarsResult.data ?? [],
        items: itemsResult.data ?? [],
        contentItems: contentResult.data ?? [],
      });
      setSelectedPlanId((current) => plans.some((plan) => plan.id === current)
        ? current
        : plans.find((plan) => plan.status === "active")?.id ?? plans[0]?.id ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذّر تحميل خطة المحتوى.");
    } finally {
      setLoading(false);
    }
  }, [clearWorkspace]);

  const session = useWorkspaceAuth({ configured, loadWorkspace, clearWorkspace, setLoading, clearTransientState });
  const manager = Boolean(workspace && leadershipRoles.has(workspace.membership.role));
  const selectedPlan = workspace?.plans.find((plan) => plan.id === selectedPlanId) ?? null;
  const selectedPillars = useMemo(() => workspace?.pillars.filter((pillar) => pillar.plan_id === selectedPlanId) ?? [], [selectedPlanId, workspace?.pillars]);
  const selectedItems = useMemo(() => workspace?.items.filter((item) => item.plan_id === selectedPlanId) ?? [], [selectedPlanId, workspace?.items]);
  const linkedContentIds = useMemo(() => new Set(workspace?.items.flatMap((item) => item.content_item_id ? [item.content_item_id] : []) ?? []), [workspace?.items]);
  const peopleById = useMemo(() => new Map(workspace?.people.map((person) => [person.id, person]) ?? []), [workspace?.people]);
  const pillarsById = useMemo(() => new Map(selectedPillars.map((pillar) => [pillar.id, pillar])), [selectedPillars]);
  const contentById = useMemo(() => new Map(workspace?.contentItems.map((item) => [item.id, item]) ?? []), [workspace?.contentItems]);
  const counts = useMemo(() => selectedItems.reduce<Record<string, number>>((summary, item) => {
    summary[item.status] = (summary[item.status] ?? 0) + 1;
    return summary;
  }, {}), [selectedItems]);
  const progress = selectedItems.length ? Math.round(((counts.published ?? 0) / selectedItems.filter((item) => item.status !== "cancelled").length) * 100) || 0 : 0;

  const refresh = useCallback(async () => { if (session) await loadWorkspace(session); }, [loadWorkspace, session]);

  useEffect(() => {
    if (!workspace || !session) return;
    const supabase = getSupabaseBrowserClient();
    const reload = () => void refresh();
    let channel = supabase.channel(`content-planning:${workspace.organization.id}`);
    for (const table of ["content_plans", "content_plan_pillars", "content_plan_items", "content_items"] as const) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `organization_id=eq.${workspace.organization.id}` }, reload);
    }
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refresh, session, workspace]);

  async function createPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || !session) return;
    const form = new FormData(event.currentTarget);
    setWorking(true); clearTransientState();
    const { error: insertError } = await getSupabaseBrowserClient().from("content_plans").insert({
      organization_id: workspace.organization.id,
      name: String(form.get("name") ?? ""),
      starts_on: String(form.get("starts_on") ?? ""),
      ends_on: String(form.get("ends_on") ?? ""),
      objective: String(form.get("objective") ?? ""),
      audience: String(form.get("audience") ?? ""),
      offer: String(form.get("offer") ?? "") || null,
      primary_metric: String(form.get("primary_metric") ?? "") || null,
      status: "draft",
      created_by: session.user.id,
      updated_by: session.user.id,
    });
    setWorking(false);
    if (insertError) { setError(insertError.message); return; }
    setShowPlanForm(false); setNotice("تم حفظ الخطة كمسودة. أضف الأعمدة وأول أسبوع ثم فعّلها.");
    await refresh();
  }

  async function changePlanStatus(status: ContentPlanStatus) {
    if (!selectedPlan) return;
    setWorking(true); clearTransientState();
    const { error: updateError } = await getSupabaseBrowserClient().from("content_plans")
      .update({ status }).eq("id", selectedPlan.id).eq("version", selectedPlan.version);
    setWorking(false);
    if (updateError) { setError(updateError.message); return; }
    setNotice(status === "active" ? "أصبحت هذه خطة المحتوى الفعّالة." : status === "completed" ? "تم إغلاق الخطة مع الاحتفاظ بكل سجلها." : "تم تحديث حالة الخطة.");
    await refresh();
  }

  async function addPillar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || !selectedPlan || !session) return;
    const form = new FormData(event.currentTarget);
    setWorking(true); clearTransientState();
    const { error: insertError } = await getSupabaseBrowserClient().from("content_plan_pillars").insert({
      organization_id: workspace.organization.id,
      plan_id: selectedPlan.id,
      title: String(form.get("title") ?? ""),
      purpose: String(form.get("purpose") ?? ""),
      target_quantity: Number(form.get("target_quantity") ?? 1),
      sort_order: selectedPillars.length,
      created_by: session.user.id,
      updated_by: session.user.id,
    });
    setWorking(false);
    if (insertError) { setError(insertError.message); return; }
    event.currentTarget.reset(); setShowPillarForm(false); setNotice("تمت إضافة عمود المحتوى للخطة.");
    await refresh();
  }

  async function addPlanItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || !selectedPlan || !session) return;
    const form = new FormData(event.currentTarget);
    const publishDate = new Date(String(form.get("publish_at") ?? ""));
    const platforms = String(form.get("platforms") ?? "").split(/[،,]/).map((value) => value.trim()).filter(Boolean);
    setWorking(true); clearTransientState();
    const { error: insertError } = await getSupabaseBrowserClient().from("content_plan_items").insert({
      organization_id: workspace.organization.id,
      plan_id: selectedPlan.id,
      pillar_id: String(form.get("pillar_id") ?? "") || null,
      kind: String(form.get("kind") ?? "reel") as ContentPlanItemKind,
      title: String(form.get("title") ?? ""),
      objective: String(form.get("objective") ?? ""),
      hook_direction: String(form.get("hook_direction") ?? "") || null,
      cta: String(form.get("cta") ?? "") || null,
      platforms,
      owner_id: String(form.get("owner_id") ?? ""),
      publish_at: publishDate.toISOString(),
      status: "planned",
      created_by: session.user.id,
      updated_by: session.user.id,
    });
    setWorking(false);
    if (insertError) { setError(insertError.message); return; }
    event.currentTarget.reset(); setShowItemForm(false); setSelectedKind("reel");
    setNotice("دخل المحتوى التقويم بمسؤول وموعد واضحين.");
    await refresh();
  }

  async function linkContent(item: PlanItem, contentItemId: string) {
    setWorking(true); clearTransientState();
    const { error: updateError } = await getSupabaseBrowserClient().from("content_plan_items")
      .update({ content_item_id: contentItemId || null, ...(contentItemId ? {} : { status: "planned" as const }) })
      .eq("id", item.id).eq("version", item.version);
    setWorking(false);
    if (updateError) { setError(updateError.message); return; }
    setNotice(contentItemId ? "تم ربط بند الخطة بمصنع المحتوى؛ حالته ستتحدث تلقائيًا." : "تم فك الربط مع الاحتفاظ ببند الخطة.");
    await refresh();
  }

  async function setItemCancelled(item: PlanItem, cancelled: boolean) {
    setWorking(true); clearTransientState();
    const { error: updateError } = await getSupabaseBrowserClient().from("content_plan_items")
      .update({ status: cancelled ? "cancelled" : "planned" })
      .eq("id", item.id).eq("version", item.version).is("content_item_id", null);
    setWorking(false);
    if (updateError) { setError(updateError.message); return; }
    setNotice(cancelled ? "تم إلغاء البند بدون حذف سجله." : "عاد البند إلى التقويم.");
    await refresh();
  }

  if (loading) return <section className="workspace-state"><LoaderCircle className="spin" size={24} /><div><h2>جارٍ تحميل خطة المحتوى</h2><p>نجمع الخطة والأعمدة والتقويم من المصدر الحقيقي.</p></div></section>;
  if (!session) return <section className="workspace-state workspace-onboarding"><LockKeyhole size={27} /><div><h2>سجّل الدخول أولًا</h2><p>الخطة جزء من مساحة الشركة وليست صفحة عامة.</p></div><Button href="/tasks">فتح تسجيل الدخول</Button></section>;
  if (!workspace) return <section className="workspace-state workspace-onboarding"><ShieldCheck size={27} /><div><h2>أنشئ مساحة الشركة أولًا</h2><p>ابدأ من قسم المهام ثم ارجع لبناء الخطة.</p></div><Button href="/tasks">فتح المهام</Button></section>;

  const quarter = defaultQuarter();
  return <section className="planning-workspace">
    <header className="panel planning-toolbar">
      <div><p className="overline">{workspace.organization.name}</p><h2>الخطة الربع سنوية وتقويم المحتوى</h2><p>الهدف والأعمدة ومواعيد النشر في مكان واحد، والتنفيذ الفعلي يظل داخل مصنع المحتوى.</p></div>
      <div className="toolbar-actions"><button className="icon-button" type="button" aria-label="تحديث الخطة" onClick={() => void refresh()}><RefreshCw size={17} /></button>{manager ? <Button type="button" onClick={() => setShowPlanForm((value) => !value)}><Plus size={15} /> خطة جديدة</Button> : null}</div>
    </header>

    {error ? <p className="form-notice error">{error}</p> : null}
    {notice ? <p className="form-notice success">{notice}</p> : null}

    {showPlanForm && manager ? <form className="panel planning-form" onSubmit={(event) => void createPlan(event)}>
      <div className="section-heading"><div><p className="overline">Strategic brief</p><h2>خطة واحدة تقود التنفيذ</h2></div><button className="text-button" type="button" onClick={() => setShowPlanForm(false)}>إغلاق</button></div>
      <div className="planning-form-grid">
        <label><span>اسم الخطة</span><input name="name" minLength={3} maxLength={160} required placeholder="مثال: الربع الرابع — بناء الثقة" /></label>
        <label><span>المؤشر الرئيسي — اختياري</span><input name="primary_metric" maxLength={500} placeholder="مثال: 500 تسجيل مؤهل" /></label>
        <label><span>تاريخ البداية</span><input name="starts_on" type="date" defaultValue={quarter.startsOn} required /></label>
        <label><span>تاريخ النهاية</span><input name="ends_on" type="date" defaultValue={quarter.endsOn} required /></label>
        <label className="span-2"><span>الهدف التجاري أو التسويقي</span><textarea name="objective" minLength={10} maxLength={3000} rows={3} required placeholder="ما النتيجة التي يجب أن يحققها المحتوى خلال الفترة؟" /></label>
        <label><span>الجمهور</span><textarea name="audience" minLength={3} maxLength={2000} rows={3} required placeholder="من نخاطب؟ وما مشكلته الحالية؟" /></label>
        <label><span>العرض أو المنتج — اختياري</span><textarea name="offer" maxLength={1000} rows={3} placeholder="الكورس أو الخدمة أو القناة التي تخدمها الخطة" /></label>
      </div>
      <div className="form-actions"><Button type="submit" disabled={working}>{working ? <LoaderCircle className="spin" size={14} /> : <FilePlus2 size={14} />} حفظ كمسودة</Button><small>لن تُنشأ أي مهام تلقائيًا قبل إضافة بنود التقويم وربطها بالتنفيذ.</small></div>
    </form> : null}

    {workspace.plans.length ? <div className="planning-plan-switcher" role="tablist" aria-label="خطط المحتوى">{workspace.plans.map((plan) => <button type="button" role="tab" aria-selected={plan.id === selectedPlanId} className={plan.id === selectedPlanId ? "active" : ""} key={plan.id} onClick={() => setSelectedPlanId(plan.id)}><span>{plan.name}</span><small>{formatDate(plan.starts_on)} — {formatDate(plan.ends_on)}</small></button>)}</div> : null}

    {selectedPlan ? <>
      <section className="panel planning-strategy-card">
        <header><div><p className="overline">v{selectedPlan.version} · {formatDate(selectedPlan.starts_on)} — {formatDate(selectedPlan.ends_on)}</p><h2>{selectedPlan.name}</h2></div><StatusBadge tone={contentPlanStatusConfig[selectedPlan.status].tone}>{contentPlanStatusConfig[selectedPlan.status].label}</StatusBadge></header>
        <div className="planning-strategy-grid"><div><Target size={17} /><span>الهدف</span><p>{selectedPlan.objective}</p></div><div><UsersRound size={17} /><span>الجمهور</span><p>{selectedPlan.audience}</p></div>{selectedPlan.offer ? <div><Route size={17} /><span>العرض</span><p>{selectedPlan.offer}</p></div> : null}{selectedPlan.primary_metric ? <div><CheckCircle2 size={17} /><span>المؤشر الرئيسي</span><p>{selectedPlan.primary_metric}</p></div> : null}</div>
        <div className="planning-progress"><div><strong>{progress}%</strong><span>من البنود منشور</span></div><div className="content-progress-track"><span style={{ width: `${progress}%` }} /></div><small>{selectedItems.length} بند · {counts.in_production ?? 0} إنتاج · {counts.scheduled ?? 0} مجدول · {counts.published ?? 0} منشور</small></div>
        {manager && selectedPlan.status !== "archived" ? <footer className="planning-actions">{selectedPlan.status === "draft" ? <Button type="button" disabled={working} onClick={() => void changePlanStatus("active")}><CheckCircle2 size={14} /> تفعيل الخطة</Button> : null}{selectedPlan.status === "active" ? <Button type="button" variant="secondary" disabled={working} onClick={() => void changePlanStatus("completed")}>إغلاق الفترة كمكتملة</Button> : null}{selectedPlan.status === "completed" ? <Button type="button" variant="ghost" disabled={working} onClick={() => void changePlanStatus("archived")}>أرشفة</Button> : null}</footer> : null}
      </section>

      <section className="panel planning-pillars-panel">
        <div className="section-heading"><div><p className="overline">Content pillars</p><h2>أعمدة المحتوى</h2><p>كل عمود له دور وكمية مستهدفة؛ البنود الفعلية تحته تبيّن إن كانت الخطة متوازنة.</p></div>{manager ? <Button type="button" variant="secondary" onClick={() => setShowPillarForm((value) => !value)}><Plus size={14} /> إضافة عمود</Button> : null}</div>
        {showPillarForm && manager ? <form className="planning-inline-form" onSubmit={(event) => void addPillar(event)}><label><span>اسم العمود</span><input name="title" minLength={2} maxLength={120} required placeholder="تعليمي / ثقة / قصص / بيع" /></label><label><span>الكمية المستهدفة</span><input name="target_quantity" type="number" min="1" max="1000" defaultValue="4" required /></label><label className="span-2"><span>وظيفته في الخطة</span><textarea name="purpose" minLength={5} maxLength={1500} rows={2} required placeholder="ما الرسالة أو القرار الذي يخدمه هذا العمود؟" /></label><div className="form-actions span-2"><Button type="submit" disabled={working}>حفظ العمود</Button><button className="text-button" type="button" onClick={() => setShowPillarForm(false)}>إلغاء</button></div></form> : null}
        <div className="planning-pillars-grid">{selectedPillars.map((pillar) => { const pillarItems = selectedItems.filter((item) => item.pillar_id === pillar.id && item.status !== "cancelled"); return <article key={pillar.id}><header><strong>{pillar.title}</strong><span>{pillarItems.length}/{pillar.target_quantity}</span></header><p>{pillar.purpose}</p><div className="content-progress-track"><span style={{ width: `${Math.min(100, Math.round((pillarItems.length / pillar.target_quantity) * 100))}%` }} /></div></article>; })}{!selectedPillars.length ? <div className="planning-empty-inline"><Target size={20} /><p>لا توجد أعمدة بعد. أضف 3–5 أعمدة تخدم الهدف بدل قائمة أفكار عشوائية.</p></div> : null}</div>
      </section>

      <section className="panel planning-calendar-panel">
        <div className="section-heading"><div><p className="overline">Execution calendar</p><h2>تقويم التنفيذ والنشر</h2><p>كل بند مسؤول وموعد وهدف؛ ربطه بمصنع المحتوى يجعل حالته تتحرك تلقائيًا.</p></div>{manager ? <Button type="button" onClick={() => setShowItemForm((value) => !value)}><Plus size={14} /> إضافة محتوى للخطة</Button> : null}</div>
        {showItemForm && manager ? <form className="planning-form planning-item-form" onSubmit={(event) => void addPlanItem(event)}>
          <div className="planning-form-grid">
            <label><span>نوع المحتوى</span><select name="kind" value={selectedKind} onChange={(event) => setSelectedKind(event.target.value as ContentPlanItemKind)}>{contentPlanItemKinds.map((kind) => <option value={kind} key={kind}>{contentPlanItemKindConfig[kind].label}</option>)}</select></label>
            <label><span>عنوان واضح</span><input name="title" minLength={3} maxLength={180} required placeholder="عنوان الفكرة أو الوعد الرئيسي" /></label>
            <label><span>عمود المحتوى — اختياري</span><select name="pillar_id" defaultValue=""><option value="">بدون عمود مؤقتًا</option>{selectedPillars.map((pillar) => <option value={pillar.id} key={pillar.id}>{pillar.title}</option>)}</select></label>
            <label><span>المسؤول عن تحريكها</span><select name="owner_id" defaultValue={workspace.people[0]?.id} required>{workspace.people.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
            <label><span>موعد النشر — القاهرة</span><input name="publish_at" type="datetime-local" defaultValue={planItemInputDate(selectedPlan)} required /></label>
            <label><span>المنصات</span><input name="platforms" minLength={2} required defaultValue={selectedKind === "telegram_post" ? "Telegram" : "Instagram"} placeholder="Instagram, Facebook" /></label>
            <label className="span-2"><span>هدف القطعة</span><textarea name="objective" minLength={5} maxLength={2000} rows={2} required placeholder="ما الفهم أو القرار المطلوب من الجمهور؟" /></label>
            <label><span>اتجاه الهوك — اختياري</span><textarea name="hook_direction" maxLength={2000} rows={2} placeholder="الخطر أو الموقف أو السؤال الذي نبدأ منه" /></label>
            <label><span>CTA — اختياري</span><textarea name="cta" maxLength={1000} rows={2} placeholder="الإجراء المطلوب من المشاهد" /></label>
          </div>
          <div className="form-actions"><Button type="submit" disabled={working}>إضافة للتقويم</Button><button className="text-button" type="button" onClick={() => setShowItemForm(false)}>إلغاء</button></div>
        </form> : null}

        <div className="planning-calendar-list">{selectedItems.map((item) => {
          const linked = item.content_item_id ? contentById.get(item.content_item_id) : null;
          const availableContent = workspace.contentItems.filter((content) => !linkedContentIds.has(content.id) && contentMatchesPlanKind(content, item.kind));
          return <article className={`planning-calendar-item ${item.status === "cancelled" ? "cancelled" : ""}`} key={item.id}>
            <div className="planning-date-tile"><CalendarDays size={17} /><strong>{new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "short", timeZone: "Africa/Cairo" }).format(new Date(item.publish_at))}</strong><small>{new Intl.DateTimeFormat("ar-EG", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "Africa/Cairo" }).format(new Date(item.publish_at))}</small></div>
            <div className="planning-item-copy"><div><span>{contentPlanItemKindConfig[item.kind].label}{item.pillar_id ? ` · ${pillarsById.get(item.pillar_id)?.title ?? "عمود"}` : ""}</span><h3>{item.title}</h3></div><p>{item.objective}</p><small>{peopleById.get(item.owner_id)?.name ?? "عضو فريق"} · {item.platforms.join("، ")}</small></div>
            <div className="planning-item-state"><StatusBadge tone={contentPlanItemStatusConfig[item.status].tone}>{contentPlanItemStatusConfig[item.status].label}</StatusBadge>{linked ? <a href={`/content?content=${linked.id}#content-${linked.id}`}>فتح التنفيذ <ArrowUpLeft size={12} /></a> : null}</div>
            {manager && item.status !== "published" ? <div className="planning-item-actions">{linked ? <button className="text-button" type="button" disabled={working} onClick={() => void linkContent(item, "")}><Link2 size={12} /> فك الربط</button> : <><label><span>ربط بمصنع المحتوى</span><select defaultValue="" disabled={working} onChange={(event) => { if (event.target.value) void linkContent(item, event.target.value); }}><option value="">اختر أصلًا منفذًا</option>{availableContent.map((content) => <option value={content.id} key={content.id}>{content.title}</option>)}</select></label><button className="text-button" type="button" disabled={working} onClick={() => void setItemCancelled(item, item.status !== "cancelled")}>{item.status === "cancelled" ? <RefreshCw size={12} /> : <CircleSlash2 size={12} />} {item.status === "cancelled" ? "إعادة للخطة" : "إلغاء البند"}</button></>}</div> : null}
          </article>;
        })}{!selectedItems.length ? <div className="scripts-empty"><CalendarDays size={26} /><strong>التقويم فارغ</strong><p>ابدأ بأول أسبوع فقط: أربع قطع موزعة على الأعمدة، ثم راقب القدرة الفعلية للفريق.</p>{manager ? <Button type="button" onClick={() => setShowItemForm(true)}><PencilLine size={14} /> خطط أول محتوى</Button> : null}</div> : null}</div>
      </section>
    </> : <section className="panel scripts-empty"><Target size={28} /><strong>لا توجد خطة محتوى حتى الآن</strong><p>أنشئ أول خطة كمسودة. لن يحفظ النظام أرقامًا أو مهامًا وهمية.</p>{manager ? <Button type="button" onClick={() => setShowPlanForm(true)}><Plus size={15} /> إنشاء أول خطة</Button> : null}</section>}
  </section>;
}
