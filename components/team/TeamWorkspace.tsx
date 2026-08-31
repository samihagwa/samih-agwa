"use client";

import type { Session } from "@supabase/supabase-js";
import {
  Activity, Ban, BookOpenCheck, CalendarDays, CheckCircle2, ClipboardCheck,
  Clock3, Copy, Link2, LoaderCircle, LockKeyhole, RefreshCw, RotateCcw,
  ShieldCheck, UserCog, UserPlus, UsersRound,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { currentUuidDeepLink } from "../../lib/deep-links";
import {
  defaultSectionsByRole,
  normalizeWorkspaceSections,
  workspaceSectionDefinitions,
  type WorkspaceSection,
} from "../../lib/access";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Database, Json, Tables } from "../../lib/supabase/database.types";
import { getSupabaseFunctionErrorMessage } from "../../lib/supabase/function-errors";
import { useWorkspaceAuth } from "../../lib/supabase/use-workspace-auth";
import { canManageTasks } from "../../lib/tasks";
import { Button } from "../ui/Button";
import { StatusBadge } from "../ui/StatusBadge";

type Membership = Tables<"memberships">;
type Organization = Tables<"organizations">;
type Presence = Tables<"member_presence">;
type Invitation = Tables<"team_invitations">;
type TeamReport = Database["public"]["Functions"]["get_team_task_performance"]["Returns"][number];
type Person = {
  id: string;
  name: string;
  role: Membership["role"];
  status: Membership["status"];
  joinedAt: string | null;
  onboardingAcknowledgements: Json;
  onboardingCompletedAt: string | null;
  allowedSections: WorkspaceSection[];
};
type Workspace = { organization: Organization; membership: Membership; people: Person[]; invitations: Invitation[] };
type RangePreset = "week" | "month" | "custom";
type OnboardingStep = "role" | "workflow" | "brand";

const sectionLabels: Record<string, string> = Object.fromEntries(workspaceSectionDefinitions.map((section) => [section.id, section.label]));

const manageableRoles: Array<Exclude<Membership["role"], "owner">> = ["admin", "manager", "member", "viewer"];
const roleDescriptions: Record<Membership["role"], string> = {
  owner: "تحكم كامل واعتماد الإعدادات الحساسة.",
  admin: "إدارة النظام والتشغيل دون تغيير المالك.",
  manager: "إنشاء المهام، الإسناد، ومتابعة تقارير التنفيذ.",
  member: "تنفيذ وتسليم المهام المسندة إليه.",
  viewer: "قراءة ما تسمح به الأقسام دون تنفيذ أو تعديل.",
};

function dateInput(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function formatDate(value: string | null) {
  if (!value) return "لا يوجد نشاط مسجل";
  return new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Cairo" }).format(new Date(value));
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
  return role === "owner" ? "مالك" : role === "admin" ? "مدير نظام" : role === "manager" ? "مدير تشغيل" : role === "member" ? "منفّذ" : "مشاهد";
}

function acknowledgements(value: Json): Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item === true]));
}

function SectionPicker({ value, onChange, disabled = false }: { value: WorkspaceSection[]; onChange: (value: WorkspaceSection[]) => void; disabled?: boolean }) {
  const selected = new Set(value);
  return <fieldset className="section-access-picker" disabled={disabled}>
    <legend>الأقسام المسموحة</legend>
    <div>{workspaceSectionDefinitions.map((section) => <label key={section.id}>
      <input type="checkbox" checked={selected.has(section.id)} onChange={(event) => onChange(event.target.checked ? normalizeWorkspaceSections([...value, section.id]) : value.filter((item) => item !== section.id))} />
      <span>{section.label}</span>
    </label>)}</div>
    {!value.length ? <small role="alert">اختر قسمًا واحدًا على الأقل.</small> : null}
  </fieldset>;
}

function MemberSectionEditor({ person, working, onSave }: { person: Person; working: boolean; onSave: (sections: WorkspaceSection[]) => Promise<void> }) {
  const [sections, setSections] = useState(person.allowedSections);
  const changed = sections.join("|") !== person.allowedSections.join("|");
  return <details className="member-section-editor">
    <summary>الأقسام المسموحة ({person.allowedSections.length})</summary>
    <SectionPicker value={sections} onChange={setSections} disabled={working || person.status === "suspended"} />
    <Button type="button" variant="secondary" disabled={working || !sections.length || !changed} onClick={() => void onSave(sections)}>حفظ الأقسام</Button>
  </details>;
}

export function TeamWorkspace() {
  const configured = isSupabaseConfigured();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [presence, setPresence] = useState<Presence[]>([]);
  const [report, setReport] = useState<TeamReport[]>([]);
  const [loading, setLoading] = useState(configured);
  const [reportLoading, setReportLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [invitationLink, setInvitationLink] = useState<string | null>(null);
  const [inviteRole, setInviteRole] = useState<Exclude<Membership["role"], "owner">>("member");
  const [inviteSections, setInviteSections] = useState<WorkspaceSection[]>(defaultSectionsByRole.member);
  const [preset, setPreset] = useState<RangePreset>("week");
  const [customStart, setCustomStart] = useState(() => dateInput(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)));
  const [customEnd, setCustomEnd] = useState(() => dateInput(new Date()));
  const [now, setNow] = useState(() => Date.now());
  const [linkedMemberId] = useState(() => currentUuidDeepLink("member", "member"));
  const openedMemberLink = useRef<string | null>(null);

  useEffect(() => {
    if (!workspace || !linkedMemberId || openedMemberLink.current === linkedMemberId) return;
    if (!workspace.people.some((person) => person.id === linkedMemberId)) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(`member-${linkedMemberId}`);
      if (!target) return;
      openedMemberLink.current = linkedMemberId;
      target.scrollIntoView({ block: "center" });
      target.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [linkedMemberId, workspace]);

  const range = useMemo(() => {
    const end = preset === "custom" ? new Date(`${customEnd}T23:59:59.999`) : new Date();
    const start = preset === "custom" ? new Date(`${customStart}T00:00:00`) : new Date(end.getTime() - (preset === "month" ? 30 : 7) * 24 * 60 * 60 * 1000);
    return { start, end };
  }, [customEnd, customStart, preset]);

  const clearWorkspace = useCallback(() => { setWorkspace(null); setPresence([]); setReport([]); }, []);
  const clearTransientState = useCallback(() => { setError(null); setNotice(null); }, []);

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

      const membershipQuery = supabase.from("memberships").select("*").eq("organization_id", membership.organization_id);
      const [organizationResult, membershipResult, invitationResult] = await Promise.all([
        supabase.from("organizations").select("*").eq("id", membership.organization_id).single(),
        membership.role === "owner" ? membershipQuery.order("created_at") : membershipQuery.eq("status", "active").order("created_at"),
        membership.role === "owner"
          ? supabase.from("team_invitations").select("*").eq("organization_id", membership.organization_id).eq("status", "pending").order("created_at", { ascending: false })
          : Promise.resolve({ data: [] as Invitation[], error: null }),
      ]);
      if (organizationResult.error) throw organizationResult.error;
      if (membershipResult.error) throw membershipResult.error;
      if (invitationResult.error) throw invitationResult.error;
      const memberIds = (membershipResult.data ?? []).map((row) => row.user_id);
      const { data: profiles, error: profilesError } = memberIds.length
        ? await supabase.from("profiles").select("id, full_name").in("id", memberIds)
        : { data: [], error: null };
      if (profilesError) throw profilesError;
      const people = (membershipResult.data ?? []).map((row) => ({
        id: row.user_id,
        role: row.role,
        status: row.status,
        joinedAt: row.joined_at,
        onboardingAcknowledgements: row.onboarding_acknowledgements,
        onboardingCompletedAt: row.onboarding_completed_at,
        allowedSections: normalizeWorkspaceSections(row.allowed_sections),
        name: profiles?.find((profile) => profile.id === row.user_id)?.full_name
          ?? (row.user_id === activeSession.user.id ? activeSession.user.email : null)
          ?? "عضو فريق",
      }));
      setWorkspace({ organization: organizationResult.data, membership, people, invitations: invitationResult.data ?? [] });
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

  useEffect(() => { const timeout = window.setTimeout(() => void refreshReport(), 0); return () => window.clearTimeout(timeout); }, [refreshReport]);
  useEffect(() => { const interval = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(interval); }, []);
  useEffect(() => {
    if (!workspace) return;
    const supabase = getSupabaseBrowserClient();
    const channel = supabase.channel(`team-presence:${workspace.organization.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "member_presence", filter: `organization_id=eq.${workspace.organization.id}` }, () => void refreshPresence(workspace.organization.id))
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refreshPresence, workspace]);

  async function runTeamCommand(body: Record<string, unknown>, fallback: string) {
    setWorking(true);
    setError(null);
    setNotice(null);
    const result = await getSupabaseBrowserClient().functions.invoke("team-commands", { body });
    setWorking(false);
    if (result.error) {
      setError(await getSupabaseFunctionErrorMessage(result.error, fallback));
      return null;
    }
    return result.data as Record<string, unknown>;
  }

  async function createInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || !session) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const result = await runTeamCommand({
      action: "create_invitation", organization_id: workspace.organization.id,
      full_name: String(form.get("full_name") ?? ""), email: String(form.get("email") ?? ""),
      role: inviteRole, allowed_sections: inviteSections,
      expires_in_days: Number(form.get("expires_in_days") ?? 7),
    }, "تعذّر إنشاء رابط الدعوة.");
    if (!result || typeof result.token !== "string") return;
    setInvitationLink(`${window.location.origin}/join?code=${encodeURIComponent(result.token)}`);
    setNotice("تم إنشاء رابط آمن فقط. لم نرسل بريدًا أو رسالة لأي شخص.");
    formElement.reset();
    setInviteRole("member");
    setInviteSections(defaultSectionsByRole.member);
    await loadWorkspace(session);
  }

  async function revokeInvitation(invitation: Invitation) {
    if (!workspace || !session || !window.confirm(`إلغاء رابط دعوة ${invitation.full_name}؟`)) return;
    const result = await runTeamCommand({ action: "revoke_invitation", invitation_id: invitation.id }, "تعذّر إلغاء الدعوة.");
    if (!result) return;
    setNotice("تم إلغاء الرابط. يمكن إنشاء رابط جديد لاحقًا.");
    setInvitationLink(null);
    await loadWorkspace(session);
  }

  async function updateMember(person: Person, role: Membership["role"], status: Membership["status"], allowedSections = person.allowedSections) {
    if (!workspace || !session || role === "owner" || status === "invited") return;
    if (status === "suspended" && !window.confirm(`إيقاف وصول ${person.name}؟ سيُرفض لو لديه شغل مفتوح حتى لا تضيع المسؤولية.`)) return;
    const result = await runTeamCommand({ action: "update_member", organization_id: workspace.organization.id, user_id: person.id, role, status, allowed_sections: allowedSections }, "تعذّر تحديث صلاحية العضو.");
    if (!result) return;
    setNotice(status === "suspended" ? "تم إيقاف الوصول بعد التحقق من عدم وجود شغل مفتوح." : "تم تحديث صلاحية العضو وتسجيل التغيير.");
    await loadWorkspace(session);
  }

  async function acknowledgeOnboarding(step: OnboardingStep) {
    if (!workspace || !session) return;
    const result = await runTeamCommand({ action: "acknowledge_onboarding", organization_id: workspace.organization.id, step }, "تعذّر حفظ خطوة التعريف.");
    if (!result) return;
    setNotice("تم حفظ الخطوة في ملف انضمامك.");
    await loadWorkspace(session);
  }

  async function copyInvitationLink() {
    if (!invitationLink) return;
    await navigator.clipboard.writeText(invitationLink);
    setNotice("تم نسخ الرابط. لا ترسله إلا لصاحب البريد المحدد.");
  }

  if (loading) return <section className="workspace-state"><LoaderCircle className="spin" size={24} /><div><h2>جارٍ تحميل الفريق</h2><p>نجمع الأدوار والحضور والأداء المسجل.</p></div></section>;
  if (!session) return <section className="workspace-state workspace-onboarding"><LockKeyhole size={27} /><div><h2>سجّل الدخول أولًا</h2><p>تقارير الفريق محمية بنفس صلاحيات مساحة العمل.</p></div><Button href="/tasks">تسجيل الدخول</Button></section>;
  if (!workspace) return <section className="workspace-state"><UsersRound size={27} /><div><h2>لا توجد مساحة فريق مرتبطة</h2><p>أنشئ مساحة الشركة من قسم المهام أولًا، أو افتح رابط الدعوة الذي أرسله لك المالك.</p></div></section>;

  const manager = canManageTasks(workspace.membership.role);
  const owner = workspace.membership.role === "owner";
  const activePeople = workspace.people.filter((person) => person.status === "active");
  const reportByUser = new Map(report.map((row) => [row.user_id, row]));
  const presenceByUser = new Map(presence.map((row) => [row.user_id, row]));
  const onboardingState = acknowledgements(workspace.membership.onboarding_acknowledgements);

  return <section className="team-workspace">
    {error ? <p className="form-notice error" role="alert">{error}</p> : null}
    {notice ? <p className="form-notice success" role="status">{notice}</p> : null}
    {linkedMemberId && workspace.people.some((person) => person.id === linkedMemberId) ? <p className="direct-link-notice" role="status"><UsersRound size={15} /> تم فتح العضو المطلوب مباشرة.</p> : linkedMemberId ? <p className="form-notice error" role="alert">العضو المطلوب غير موجود أو ليس ضمن صلاحيات حسابك.</p> : null}

    {!workspace.membership.onboarding_completed_at ? <section className="panel team-onboarding-panel">
      <div className="section-heading"><div><p className="overline">أول يوم على السيستم</p><h2>3 اتفاقات قبل استلام الشغل</h2><p>كل خطوة تُحفظ على حسابك؛ الهدف فهم طريقة التشغيل، مش تكميل checklist شكلي.</p></div><StatusBadge tone="warning">{Object.values(onboardingState).filter(Boolean).length}/3</StatusBadge></div>
      <div className="onboarding-step-grid">
        <article className={onboardingState.role ? "complete" : ""}><UserCog size={20} /><div><strong>افهم دورك وحدود صلاحيتك</strong><p>{roleLabel(workspace.membership.role)} — {roleDescriptions[workspace.membership.role]}</p></div><Button type="button" variant="secondary" disabled={working || onboardingState.role} onClick={() => void acknowledgeOnboarding("role")}>{onboardingState.role ? <CheckCircle2 size={15} /> : null}{onboardingState.role ? "تم" : "فهمت دوري"}</Button></article>
        <article className={onboardingState.workflow ? "complete" : ""}><ClipboardCheck size={20} /><div><strong>المهمة تُسلّم من مكانها</strong><p>ابدأ من «مهامي»، أرفق النتيجة أو الرابط، واطلب تعديلًا داخل نفس ملف العمل.</p><a href="/tasks">افتح بورد المهام <Link2 size={12} /></a></div><Button type="button" variant="secondary" disabled={working || onboardingState.workflow} onClick={() => void acknowledgeOnboarding("workflow")}>{onboardingState.workflow ? <CheckCircle2 size={15} /> : null}{onboardingState.workflow ? "تم" : "فهمت التسليم"}</Button></article>
        <article className={onboardingState.brand ? "complete" : ""}><BookOpenCheck size={20} /><div><strong>البراند هو المرجع</strong><p>راجع القواعد المعتمدة قبل التصميم أو المونتاج؛ الخامات بأي رابط موثوق، وTelegram للتنبيه، والموقع هو حالة الشغل.</p><a href="/brand">افتح مركز البراند <Link2 size={12} /></a></div><Button type="button" variant="secondary" disabled={working || onboardingState.brand} onClick={() => void acknowledgeOnboarding("brand")}>{onboardingState.brand ? <CheckCircle2 size={15} /> : null}{onboardingState.brand ? "تم" : "راجعت القاعدة"}</Button></article>
      </div>
    </section> : null}

    {owner ? <section className="panel team-access-panel">
      <div className="section-heading"><div><p className="overline">دخول محكوم من المالك</p><h2>جهّز رابط عضو جديد بدون إرسال أي دعوة</h2><p>ننشئ رابطًا يستخدم مرة واحدة ومربوطًا ببريد محدد. أنت الذي تنسخه وترسله يدويًا عندما تقرر بدء الفريق.</p></div><StatusBadge tone="success">لا إرسال تلقائي</StatusBadge></div>
      <form className="team-invite-form" onSubmit={createInvitation}>
        <label><span>اسم العضو</span><input name="full_name" minLength={2} maxLength={120} required placeholder="الاسم الذي سيظهر للفريق" /></label>
        <label><span>البريد</span><input name="email" type="email" required placeholder="name@company.com" /></label>
        <label><span>الدور</span><select name="role" value={inviteRole} onChange={(event) => { const role = event.target.value as Exclude<Membership["role"], "owner">; setInviteRole(role); setInviteSections(defaultSectionsByRole[role]); }}>{manageableRoles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}</select></label>
        <label><span>صلاحية الرابط</span><select name="expires_in_days" defaultValue="7"><option value="1">يوم واحد</option><option value="3">3 أيام</option><option value="7">7 أيام</option><option value="14">14 يومًا</option></select></label>
        <SectionPicker value={inviteSections} onChange={setInviteSections} disabled={working} />
        <Button type="submit" disabled={working || !inviteSections.length}>{working ? <LoaderCircle className="spin" size={16} /> : <UserPlus size={16} />} اعتماد البريد وإنشاء الرابط</Button>
      </form>
      {invitationLink ? <div className="generated-invite-link"><div><strong>هذا الرابط يظهر الآن فقط</strong><small>لو ضاع، ألغِ الدعوة وأنشئ واحدًا جديدًا. لا نخزن الرمز الأصلي.</small></div><code dir="ltr">{invitationLink}</code><Button type="button" variant="secondary" onClick={() => void copyInvitationLink()}><Copy size={15} /> نسخ الرابط</Button></div> : null}
      {workspace.invitations.length ? <div className="pending-invitations"><h3>روابط في انتظار الاستخدام</h3>{workspace.invitations.map((invitation) => {
        const expired = new Date(invitation.expires_at).getTime() <= now;
        return <article key={invitation.id}><div><strong>{invitation.full_name}</strong><small>{invitation.email} · {roleLabel(invitation.role)}</small><small>{normalizeWorkspaceSections(invitation.allowed_sections).map((section) => sectionLabels[section]).join(" · ")}</small></div><StatusBadge tone={expired ? "danger" : "warning"}>{expired ? "منتهي" : `ينتهي ${formatDate(invitation.expires_at)}`}</StatusBadge><button type="button" className="text-button danger-text" disabled={working} onClick={() => void revokeInvitation(invitation)}><Ban size={14} /> إلغاء</button></article>;
      })}</div> : null}
    </section> : null}

    {owner ? <section className="panel team-members-panel">
      <div className="section-heading"><div><p className="overline">أقل صلاحية لازمة</p><h2>الأعضاء والوصول</h2><p>إيقاف عضو لن يتم لو عنده مهام أو اسكريبتات أو عملاء مفتوحون؛ انقل المسؤولية أولًا.</p></div><StatusBadge tone="info">{activePeople.length} فعّال</StatusBadge></div>
      <div className="team-member-list">{workspace.people.map((person) => <article id={`member-${person.id}`} data-direct-target={linkedMemberId === person.id || undefined} tabIndex={linkedMemberId === person.id ? -1 : undefined} key={person.id} className={person.status === "suspended" ? "suspended" : ""}>
        <div className="team-member-identity"><span>{person.name.slice(0, 1)}</span><div><strong>{person.name}</strong><small>{person.joinedAt ? `انضم ${formatDate(person.joinedAt)}` : "لم يكتمل الانضمام"}</small></div></div>
        <div className="team-member-role"><StatusBadge tone={person.status === "suspended" ? "danger" : person.role === "owner" ? "success" : "info"}>{person.status === "suspended" ? "موقوف" : roleLabel(person.role)}</StatusBadge><small>{roleDescriptions[person.role]}</small></div>
        {person.role === "owner" ? <div className="owner-lock"><ShieldCheck size={15} /><span><strong>مالك + مدير المنصة</strong><small>وصول كامل ومحمي لكل الأقسام</small></span></div> : <div className="team-member-actions"><label><span>الصلاحية</span><select value={person.role} disabled={working || person.status === "suspended"} onChange={(event) => void updateMember(person, event.target.value as Membership["role"], "active")}>{manageableRoles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}</select></label><MemberSectionEditor key={`${person.id}:${person.allowedSections.join("|")}`} person={person} working={working} onSave={(sections) => updateMember(person, person.role, "active", sections)} />{person.status === "suspended" ? <Button type="button" variant="secondary" disabled={working} onClick={() => void updateMember(person, person.role, "active")}><RotateCcw size={14} /> إعادة الوصول</Button> : <button type="button" className="text-button danger-text" disabled={working} onClick={() => void updateMember(person, person.role, "suspended")}><Ban size={14} /> إيقاف الوصول</button>}</div>}
      </article>)}</div>
    </section> : null}

    <aside className="presence-privacy-note"><ShieldCheck size={17} /><div><strong>حضور تشغيلي واضح للفريق</strong><p>نسجل القسم الحالي وآخر نبضة كل دقيقة فقط. لا نسجل نقرات أو كتابة أو محتوى شخصيًا، وهذه البيانات ظاهرة كجزء من سياسة العمل وليست مراقبة خفية.</p></div></aside>

    <section className="panel team-presence-panel">
      <div className="section-heading"><div><p className="overline">الحضور الآن</p><h2>مين فاتح المنصة وآخر ظهور؟</h2></div><button className="icon-button" type="button" aria-label="تحديث الحضور" onClick={() => void refreshPresence(workspace.organization.id)}><RefreshCw size={16} /></button></div>
      <div className="presence-grid">{activePeople.map((person) => {
        const memberPresence = presenceByUser.get(person.id);
        const active = memberPresence ? now - new Date(memberPresence.last_seen_at).getTime() <= 2 * 60_000 : false;
        return <article id={!owner ? `member-${person.id}` : undefined} data-direct-target={!owner && linkedMemberId === person.id || undefined} tabIndex={!owner && linkedMemberId === person.id ? -1 : undefined} key={person.id}><header><span className={`presence-dot ${active ? "online" : ""}`} /><div><strong>{person.name}</strong><small>{roleLabel(person.role)}</small></div><StatusBadge tone={active ? "success" : "neutral"}>{active ? "متصل الآن" : "غير متصل"}</StatusBadge></header><dl><div><dt>آخر قسم</dt><dd>{memberPresence ? sectionLabels[memberPresence.current_section] ?? memberPresence.current_section : "لم يدخل بعد"}</dd></div><div><dt>آخر ظهور على المنصة</dt><dd>{formatLastSeen(memberPresence?.last_seen_at ?? null, now)}</dd></div><div><dt>بداية الجلسة</dt><dd>{formatDate(memberPresence?.session_started_at ?? null)}</dd></div></dl></article>;
      })}</div>
    </section>

    <section className="panel team-report-panel">
      <div className="team-report-heading"><div><p className="overline">تقرير مبني على السجل</p><h2>ما طُلب وما نُفذ والالتزام بالموعد</h2><p>أرقام واقعية بلا تقييم شخصي. «آخر حركة شغل» تعني مهمة أو مراجعة مسجلة، ولا تتغير بمجرد فتح المنصة.</p></div>{reportLoading ? <LoaderCircle className="spin" size={20} /> : <Activity size={20} />}</div>
      {manager ? <>
        <div className="team-range-controls"><div className="segmented-control">{(["week", "month", "custom"] as RangePreset[]).map((value) => <button type="button" key={value} className={preset === value ? "active" : ""} onClick={() => setPreset(value)}>{value === "week" ? "آخر أسبوع" : value === "month" ? "آخر 30 يوم" : "مدة محددة"}</button>)}</div>{preset === "custom" ? <div className="custom-range"><label><span>من</span><input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label><label><span>إلى</span><input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label></div> : null}<span><CalendarDays size={13} /> {formatDate(range.start.toISOString())} — {formatDate(range.end.toISOString())}</span></div>
        <div className="team-report-table-wrap"><table className="team-report-table"><thead><tr><th>العضو</th><th>طلب مهام</th><th>أُسند له</th><th>أكمل</th><th>قبل الموعد</th><th>بعد الموعد</th><th>متأخر مفتوح</th><th>أرسل للمراجعة</th><th>طلب تعديلات</th><th>استلم تعديلات</th><th>آخر حركة شغل</th></tr></thead><tbody>{activePeople.filter((person) => person.role !== "viewer").map((person) => {
          const row = reportByUser.get(person.id);
          return <tr key={person.id}><th><strong>{person.name}</strong><small>{roleLabel(person.role)}</small></th><td>{row?.tasks_requested ?? 0}</td><td>{row?.tasks_assigned ?? 0}</td><td>{row?.tasks_completed ?? 0}</td><td className="positive-cell"><CheckCircle2 size={12} /> {row?.completed_on_time ?? 0}</td><td className="warning-cell"><Clock3 size={12} /> {row?.completed_late ?? 0}</td><td className="danger-cell">{row?.overdue_open ?? 0}</td><td>{row?.review_submissions ?? 0}</td><td>{row?.revisions_requested ?? 0}</td><td>{row?.revisions_received ?? 0}</td><td>{formatDate(row?.last_activity_at ?? null)}</td></tr>;
        })}</tbody></table></div>
      </> : <p className="team-report-guard"><ShieldCheck size={15} /> التقرير الشامل متاح للمالك والمدير فقط. العضو يرى المطلوب منه في «مهامي».</p>}
    </section>
  </section>;
}
