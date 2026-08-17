"use client";

import type { Session } from "@supabase/supabase-js";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CircleUserRound,
  ContactRound,
  ExternalLink,
  FileClock,
  History,
  Link2,
  LoaderCircle,
  LockKeyhole,
  MessageSquareText,
  Plus,
  RefreshCw,
  Route,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  allowedCrmTransitions,
  crmActivityKindConfig,
  crmConsentConfig,
  crmConversationChannelConfig,
  crmIdentityKindConfig,
  crmInterestConfig,
  crmLeadStageConfig,
  crmLeadStages,
  crmSourceConfig,
  type CrmActivityKind,
  type CrmConversationChannel,
  type CrmIdentityKind,
  type CrmInterest,
  type CrmLeadStage,
  type CrmSource,
} from "../../lib/crm";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Tables } from "../../lib/supabase/database.types";
import { getSupabaseFunctionErrorMessage } from "../../lib/supabase/function-errors";
import { canManageTasks, taskStatusConfig } from "../../lib/tasks";
import { Button } from "../ui/Button";
import { StatusBadge } from "../ui/StatusBadge";

type Contact = Tables<"crm_contacts">;
type Identity = Tables<"crm_identities">;
type Activity = Tables<"crm_activities">;
type ConversationLink = Tables<"crm_conversation_links">;
type Task = Tables<"tasks">;
type Membership = Tables<"memberships">;
type Organization = Tables<"organizations">;

type TeamPerson = { id: string; name: string; role: Membership["role"] };
type Workspace = { organization: Organization; membership: Membership; people: TeamPerson[] };
type Filter = "all" | "mine" | "overdue";

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) return String(error.message);
  return "حدث خطأ غير متوقع.";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function toLocalDateTimeInput(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formText(form: FormData, name: string) {
  return String(form.get(name) ?? "").trim();
}

function futureDateIso(value: string) {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) && date.getTime() > Date.now()
    ? date.toISOString()
    : null;
}

export function CrmWorkspace() {
  const configured = isSupabaseConfigured();
  const [session, setSession] = useState<Session | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [conversationLinks, setConversationLinks] = useState<ConversationLink[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(configured);
  const [working, setWorking] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [activityFormId, setActivityFormId] = useState<string | null>(null);
  const [activityStage, setActivityStage] = useState<CrmLeadStage>("new");
  const [identityKind, setIdentityKind] = useState<CrmIdentityKind>("phone");
  const [source, setSource] = useState<CrmSource>("manual");
  const [interest, setInterest] = useState<CrmInterest>("indicator");
  const [conversationChannel, setConversationChannel] = useState<CrmConversationChannel | "">("");
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(configured ? null : "لم يتم إعداد اتصال Supabase لهذه النسخة.");
  const [notice, setNotice] = useState<string | null>(null);
  const [renderNow] = useState(() => Date.now());
  const [defaultFollowUp] = useState(() => toLocalDateTimeInput(new Date(Date.now() + 24 * 60 * 60 * 1000)));

  const clearData = useCallback(() => {
    setContacts([]);
    setIdentities([]);
    setActivities([]);
    setConversationLinks([]);
    setTasks([]);
    setActivityFormId(null);
  }, []);

  const refreshCrm = useCallback(async (organizationId: string) => {
    const supabase = getSupabaseBrowserClient();
    const [contactsResult, identitiesResult, activitiesResult, linksResult, tasksResult] = await Promise.all([
      supabase.from("crm_contacts").select("*").eq("organization_id", organizationId).order("next_follow_up_at", { ascending: true, nullsFirst: false }),
      supabase.from("crm_identities").select("*").eq("organization_id", organizationId).order("is_primary", { ascending: false }),
      supabase.from("crm_activities").select("*").eq("organization_id", organizationId).order("occurred_at", { ascending: false }),
      supabase.from("crm_conversation_links").select("*").eq("organization_id", organizationId).order("is_primary", { ascending: false }),
      supabase.from("tasks").select("*").eq("organization_id", organizationId).not("crm_contact_id", "is", null).order("due_at", { ascending: true }),
    ]);

    if (contactsResult.error) throw contactsResult.error;
    if (identitiesResult.error) throw identitiesResult.error;
    if (activitiesResult.error) throw activitiesResult.error;
    if (linksResult.error) throw linksResult.error;
    if (tasksResult.error) throw tasksResult.error;
    setContacts(contactsResult.data ?? []);
    setIdentities(identitiesResult.data ?? []);
    setActivities(activitiesResult.data ?? []);
    setConversationLinks(linksResult.data ?? []);
    setTasks(tasksResult.data ?? []);
  }, []);

  const loadWorkspace = useCallback(async (activeSession: Session) => {
    const supabase = getSupabaseBrowserClient();
    setLoading(true);
    setError(null);
    try {
      const { data: membership, error: membershipError } = await supabase
        .from("memberships").select("*").eq("user_id", activeSession.user.id).eq("status", "active").limit(1).maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) {
        setWorkspace(null);
        clearData();
        return;
      }

      const [organizationResult, membersResult] = await Promise.all([
        supabase.from("organizations").select("*").eq("id", membership.organization_id).single(),
        supabase.from("memberships").select("user_id, role").eq("organization_id", membership.organization_id).eq("status", "active"),
      ]);
      if (organizationResult.error) throw organizationResult.error;
      if (membersResult.error) throw membersResult.error;

      const memberIds = (membersResult.data ?? []).map((member) => member.user_id);
      const profilesResult = memberIds.length
        ? await supabase.from("profiles").select("id, full_name").in("id", memberIds)
        : { data: [], error: null };
      if (profilesResult.error) throw profilesResult.error;

      const people = (membersResult.data ?? []).map((member) => ({
        id: member.user_id,
        role: member.role,
        name: profilesResult.data?.find((profile) => profile.id === member.user_id)?.full_name
          ?? (member.user_id === activeSession.user.id ? activeSession.user.email : null)
          ?? "عضو فريق",
      }));
      setWorkspace({ organization: organizationResult.data, membership, people });
      await refreshCrm(membership.organization_id);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [clearData, refreshCrm]);

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
        clearData();
        setLoading(false);
      }
    });
    return () => data.subscription.unsubscribe();
  }, [clearData, configured, loadWorkspace]);

  useEffect(() => {
    if (!workspace) return;
    const supabase = getSupabaseBrowserClient();
    const refresh = () => void refreshCrm(workspace.organization.id);
    let channel = supabase.channel(`crm:${workspace.organization.id}`);
    for (const table of ["crm_contacts", "crm_identities", "crm_activities", "crm_conversation_links", "tasks"] as const) {
      channel = channel.on("postgres_changes", {
        event: "*", schema: "public", table, filter: `organization_id=eq.${workspace.organization.id}`,
      }, refresh);
    }
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refreshCrm, workspace]);

  const identitiesByContact = useMemo(() => {
    const grouped = new Map<string, Identity[]>();
    for (const identity of identities) grouped.set(identity.contact_id, [...(grouped.get(identity.contact_id) ?? []), identity]);
    return grouped;
  }, [identities]);

  const activitiesByContact = useMemo(() => {
    const grouped = new Map<string, Activity[]>();
    for (const activity of activities) grouped.set(activity.contact_id, [...(grouped.get(activity.contact_id) ?? []), activity]);
    return grouped;
  }, [activities]);

  const conversationLinksByContact = useMemo(() => {
    const grouped = new Map<string, ConversationLink[]>();
    for (const link of conversationLinks) grouped.set(link.contact_id, [...(grouped.get(link.contact_id) ?? []), link]);
    return grouped;
  }, [conversationLinks]);

  const tasksByContact = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    for (const task of tasks) {
      if (task.crm_contact_id) grouped.set(task.crm_contact_id, [...(grouped.get(task.crm_contact_id) ?? []), task]);
    }
    return grouped;
  }, [tasks]);

  const filteredContacts = useMemo(() => {
    if (!session) return [];
    if (filter === "mine") return contacts.filter((contact) => contact.owner_id === session.user.id);
    if (filter === "overdue") return contacts.filter((contact) => contact.next_follow_up_at && new Date(contact.next_follow_up_at).getTime() < renderNow);
    return contacts;
  }, [contacts, filter, renderNow, session]);

  async function invokeCrm(body: Record<string, unknown>, successMessage: string) {
    if (!workspace) return false;
    setWorking(true);
    setError(null);
    setNotice(null);
    const { error: commandError } = await getSupabaseBrowserClient().functions.invoke("crm-commands", { body });
    setWorking(false);
    if (commandError) {
      setError(await getSupabaseFunctionErrorMessage(commandError, "تعذّر تنفيذ أمر CRM. لم يتم حفظ أي جزء من العملية."));
      return false;
    }
    setNotice(successMessage);
    await refreshCrm(workspace.organization.id);
    return true;
  }

  async function createLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || !session) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const followUpAt = futureDateIso(formText(form, "follow_up_at"));
    if (!followUpAt) {
      setError("حدد موعد متابعة صحيحًا في المستقبل.");
      return;
    }
    const created = await invokeCrm({
      action: "create_lead",
      organization_id: workspace.organization.id,
      full_name: formText(form, "full_name"),
      source: formText(form, "source"),
      source_detail: formText(form, "source_detail"),
      interest: formText(form, "interest"),
      interest_detail: formText(form, "interest_detail"),
      owner_id: formText(form, "owner_id") || session.user.id,
      consent_status: formText(form, "consent_status"),
      identity_kind: formText(form, "identity_kind"),
      identity_value: formText(form, "identity_value"),
      follow_up_at: followUpAt,
      notes: formText(form, "notes"),
      conversation_channel: formText(form, "conversation_channel"),
      conversation_url: formText(form, "conversation_url"),
      conversation_label: formText(form, "conversation_label"),
    }, "تم إنشاء ملف العميل ومهمة المتابعة معًا.");
    if (created) {
      formElement.reset();
      setIdentityKind("phone");
      setSource("manual");
      setInterest("indicator");
      setConversationChannel("");
      setShowCreate(false);
    }
  }

  async function recordActivity(event: FormEvent<HTMLFormElement>, contact: Contact) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const nextFollowUp = crmLeadStageConfig[activityStage].active ? formText(form, "next_follow_up_at") : "";
    const nextFollowUpIso = nextFollowUp ? futureDateIso(nextFollowUp) : null;
    if (nextFollowUp && !nextFollowUpIso) {
      setError("حدد موعد المتابعة التالية في المستقبل.");
      return;
    }
    const recorded = await invokeCrm({
      action: "record_activity",
      contact_id: contact.id,
      kind: formText(form, "kind"),
      next_stage: activityStage,
      summary: formText(form, "summary"),
      next_follow_up_at: nextFollowUpIso,
    }, crmLeadStageConfig[activityStage].active
      ? "تم تسجيل النتيجة وإنشاء مهمة المتابعة التالية."
      : "تم تسجيل النتيجة وإغلاق المتابعة المفتوحة.");
    if (recorded) {
      formElement.reset();
      setActivityFormId(null);
    }
  }

  if (loading) return <section className="workspace-state" aria-live="polite"><LoaderCircle className="spin" size={24} /><div><h2>جارٍ تحميل CRM</h2><p>نتحقق من الصلاحيات وملفات العملاء ومهام المتابعة.</p></div></section>;

  if (!session) return (
    <section className="workspace-state workspace-onboarding">
      <LockKeyhole size={27} /><div><p className="overline">دخول موحد</p><h2>سجّل الدخول أولًا من قسم المهام</h2><p>بيانات العملاء لا تظهر دون جلسة موثقة وصلاحية داخل الشركة.</p></div>
      <Button href="/tasks"><Link2 size={16} /> الانتقال لتسجيل الدخول</Button>
    </section>
  );

  if (!workspace) return (
    <section className="workspace-state workspace-onboarding">
      <Route size={27} /><div><p className="overline">مساحة العمل مطلوبة</p><h2>أنشئ مساحة الشركة مرة واحدة</h2><p>ابدأ من قسم المهام، ثم ارجع هنا لإدارة المتابعات.</p></div>
      <Button href="/tasks"><Link2 size={16} /> فتح قسم المهام</Button>
    </section>
  );

  const manager = canManageTasks(workspace.membership.role);
  const canCreate = workspace.membership.role !== "viewer";
  const peopleById = new Map(workspace.people.map((person) => [person.id, person]));
  const overdueCount = contacts.filter((contact) => contact.next_follow_up_at && new Date(contact.next_follow_up_at).getTime() < renderNow).length;
  const wonCount = contacts.filter((contact) => contact.stage === "won").length;
  const newCount = contacts.filter((contact) => contact.stage === "new").length;

  return (
    <section className="crm-workspace">
      <div className="workspace-toolbar">
        <div><p className="overline">{workspace.organization.name}</p><h2>خط متابعة العملاء</h2><p>{contacts.length ? `${contacts.length} ملف متاح لصلاحيتك` : "لا توجد ملفات عملاء بعد — ابدأ بإدخال شخصي واحد عند الجاهزية."}</p></div>
        <div className="toolbar-actions">
          <button className="icon-button" type="button" aria-label="تحديث CRM" onClick={() => void refreshCrm(workspace.organization.id)}><RefreshCw size={17} /></button>
          <Button href="/tasks" variant="secondary"><Route size={16} /> مهام المتابعة</Button>
          {canCreate ? <Button type="button" onClick={() => setShowCreate((value) => !value)}><Plus size={16} /> عميل محتمل جديد</Button> : null}
        </div>
      </div>

      {notice ? <p className="form-notice success" role="status">{notice}</p> : null}
      {error ? <p className="form-notice error" role="alert">{error}</p> : null}

      <div className="crm-kpi-strip" aria-label="ملخص CRM الحقيقي">
        <div><ContactRound size={17} /><span>المتاح لصلاحيتك</span><strong>{contacts.length}</strong></div>
        <div className={overdueCount ? "attention" : ""}><AlertTriangle size={17} /><span>متابعة مستحقة الآن</span><strong>{overdueCount}</strong></div>
        <div><FileClock size={17} /><span>عملاء جدد</span><strong>{newCount}</strong></div>
        <div><CheckCircle2 size={17} /><span>تم تحويلهم لعملاء</span><strong>{wonCount}</strong></div>
      </div>

      <div className="crm-filter-row" role="group" aria-label="تصفية العملاء">
        {(["all", "mine", "overdue"] as Filter[]).map((value) => <button className={filter === value ? "active" : ""} type="button" key={value} onClick={() => setFilter(value)}>{value === "all" ? "كل المتاح" : value === "mine" ? "مسؤوليتي" : "متابعة متأخرة"}</button>)}
      </div>

      {showCreate && canCreate ? <form className="panel crm-create-form" onSubmit={(event) => void createLead(event)}>
        <div className="section-heading"><div><p className="overline">ملف + متابعة + مهمة</p><h2>إضافة عميل محتمل يدويًا</h2></div><button className="text-button" type="button" onClick={() => setShowCreate(false)}>إغلاق</button></div>
        <div className="crm-safety-note"><ShieldCheck size={18} /><div><strong>لن تُرسل أي رسالة</strong><p>هذا الإدخال يحفظ الملف ويضيف مهمة متابعة فقط. الاستيراد والتواصل التلقائي غير مفعّلين.</p></div></div>
        <div className="form-grid">
          <label><span>اسم العميل المحتمل</span><input name="full_name" minLength={2} maxLength={160} required placeholder="الاسم كما تعرفه" /></label>
          <label><span>مصدر التسجيل</span><select name="source" value={source} onChange={(event) => setSource(event.target.value as CrmSource)}>{(Object.keys(crmSourceConfig) as CrmSource[]).map((option) => <option value={option} key={option}>{crmSourceConfig[option].label}</option>)}</select><small>اختر «مصدر مخصص» لإضافة أي مصدر جديد غير موجود بالقائمة.</small></label>
          {source === "other" ? <label><span>اسم المصدر الجديد</span><input name="source_detail" minLength={2} maxLength={160} required placeholder="مثال: Webinar أغسطس أو Instagram Organic" /></label> : null}
          <label><span>سبب التسجيل / الاهتمام</span><select name="interest" value={interest} onChange={(event) => setInterest(event.target.value as CrmInterest)}>{(Object.keys(crmInterestConfig) as CrmInterest[]).map((option) => <option value={option} key={option}>{crmInterestConfig[option].label}</option>)}</select><small>اختر «سبب آخر» لكتابة أي خدمة أو حملة جديدة.</small></label>
          {interest === "other" ? <label><span>سبب التسجيل الجديد</span><input name="interest_detail" minLength={2} maxLength={160} required placeholder="مثال: حضور ويبنار التحليل الفني" /></label> : null}
          <label><span>حالة الموافقة على التواصل</span><select name="consent_status" defaultValue="unknown"><option value="unknown">غير معروفة</option><option value="granted">وافق</option></select><small>إذا رفض لاحقًا، اختر «عدم تواصل» عند تسجيل النتيجة ليُغلق الملف والمهمة.</small></label>
          <label><span>وسيلة التواصل الأساسية</span><select name="identity_kind" value={identityKind} onChange={(event) => setIdentityKind(event.target.value as CrmIdentityKind)}>{(Object.keys(crmIdentityKindConfig) as CrmIdentityKind[]).map((kind) => <option value={kind} key={kind}>{crmIdentityKindConfig[kind].label}</option>)}</select></label>
          <label><span>{crmIdentityKindConfig[identityKind].label}</span><input name="identity_value" type={crmIdentityKindConfig[identityKind].inputType} dir="ltr" minLength={3} maxLength={320} required placeholder={crmIdentityKindConfig[identityKind].placeholder} /><small>{identityKind === "telegram" ? "اكتب @username هنا، وليس لينك الشات." : "تُستخدم لمنع تكرار نفس العميل في CRM."}</small></label>
          <label><span>منصة المحادثة المباشرة — اختياري</span><select name="conversation_channel" value={conversationChannel} onChange={(event) => setConversationChannel(event.target.value as CrmConversationChannel | "")}><option value="">بدون لينك حاليًا</option>{(Object.keys(crmConversationChannelConfig) as CrmConversationChannel[]).map((channel) => <option value={channel} key={channel}>{crmConversationChannelConfig[channel].label}</option>)}</select><small>يمكن فتح الشات لاحقًا بضغطة واحدة من كارت العميل.</small></label>
          {conversationChannel ? <label><span>لينك شات {crmConversationChannelConfig[conversationChannel].label}</span><input name="conversation_url" type="url" dir="ltr" maxLength={2000} required placeholder={crmConversationChannelConfig[conversationChannel].placeholder} /><small>الصق لينكًا كاملًا يبدأ بـ https://</small></label> : null}
          {manager ? <label><span>مسؤول المتابعة</span><select name="owner_id" defaultValue={session.user.id}>{workspace.people.filter((person) => person.role !== "viewer").map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label> : <input name="owner_id" type="hidden" value={session.user.id} />}
          <label><span>موعد أول متابعة</span><input name="follow_up_at" type="datetime-local" defaultValue={defaultFollowUp} required /></label>
          <label className="full-field"><span>سياق مهم قبل التواصل — اختياري</span><textarea name="notes" maxLength={5000} rows={3} placeholder="ماذا طلب؟ ما الذي سجّل فيه؟ وما الذي يجب أن يعرفه مسؤول المتابعة؟" /></label>
        </div>
        <div className="form-actions"><Button type="submit" disabled={working}>{working ? <LoaderCircle className="spin" size={16} /> : <UserRoundCheck size={16} />} حفظ وإنشاء مهمة المتابعة</Button><small>إذا كانت وسيلة التواصل مسجلة من قبل، سيرفض النظام إنشاء نسخة مكررة.</small></div>
      </form> : null}

      {contacts.length ? <div className="crm-pipeline" aria-label="خط مبيعات العملاء المحتملين">{crmLeadStages.map((stage) => {
        const stageContacts = filteredContacts.filter((contact) => contact.stage === stage);
        return <section className="crm-stage-column" key={stage} aria-labelledby={`crm-stage-${stage}`}>
          <header><StatusBadge tone={crmLeadStageConfig[stage].tone}>{crmLeadStageConfig[stage].shortLabel}</StatusBadge><strong id={`crm-stage-${stage}`}>{stageContacts.length}</strong></header>
          <div className="crm-stage-stack">{stageContacts.map((contact) => {
            const contactIdentities = identitiesByContact.get(contact.id) ?? [];
            const primaryIdentity = contactIdentities.find((identity) => identity.is_primary) ?? contactIdentities[0];
            const contactActivities = activitiesByContact.get(contact.id) ?? [];
            const contactConversationLinks = conversationLinksByContact.get(contact.id) ?? [];
            const contactTasks = tasksByContact.get(contact.id) ?? [];
            const openTask = contactTasks.find((task) => !["done", "cancelled"].includes(task.status));
            const canAct = manager || contact.owner_id === session.user.id;
            const overdue = Boolean(contact.next_follow_up_at && new Date(contact.next_follow_up_at).getTime() < renderNow);
            const nextOptions = [contact.stage, ...allowedCrmTransitions[contact.stage]];
            return <article className={`crm-contact-card ${overdue ? "overdue" : ""}`} id={`lead-${contact.id}`} key={contact.id}>
              <div className="crm-contact-top"><div><p className="overline">{contact.source_detail ?? crmSourceConfig[contact.source].label}</p><h3>{contact.full_name}</h3></div><StatusBadge tone={crmConsentConfig[contact.consent_status].tone}>{crmConsentConfig[contact.consent_status].label}</StatusBadge></div>
              <dl className="crm-contact-meta">
                <div><dt>سبب التسجيل</dt><dd>{contact.interest_detail ?? crmInterestConfig[contact.interest].label}</dd></div>
                <div><dt>التواصل</dt><dd dir="ltr">{primaryIdentity ? `${crmIdentityKindConfig[primaryIdentity.kind].label}: ${primaryIdentity.value}` : "—"}</dd></div>
                <div><dt><CircleUserRound size={13} /> المسؤول</dt><dd>{peopleById.get(contact.owner_id)?.name ?? "عضو فريق"}</dd></div>
                {contact.next_follow_up_at ? <div><dt><CalendarClock size={13} /> المتابعة</dt><dd>{formatDate(contact.next_follow_up_at)}</dd></div> : null}
              </dl>
              {contactConversationLinks.length ? <div className="crm-chat-links">{contactConversationLinks.map((link) => <a href={link.url} target="_blank" rel="noreferrer" key={link.id}><ExternalLink size={12} /> فتح شات {link.label ?? crmConversationChannelConfig[link.channel].label}</a>)}</div> : null}
              {contact.notes ? <p className="crm-contact-notes">{contact.notes}</p> : null}
              {overdue ? <span className="overdue-label"><AlertTriangle size={13} /> المتابعة متأخرة</span> : null}
              {openTask ? <a className="crm-task-link" href="/tasks"><Route size={12} /> المهمة: {taskStatusConfig[openTask.status].label}</a> : <span className="crm-task-complete"><CheckCircle2 size={12} /> لا توجد متابعة مفتوحة</span>}
              {contactActivities.length ? <details className="crm-history"><summary><History size={13} /> آخر الأنشطة ({contactActivities.length})</summary><ol>{contactActivities.slice(0, 4).map((activity) => <li key={activity.id}><strong>{activity.kind === "created" ? "إنشاء الملف" : crmActivityKindConfig[activity.kind].label}</strong><p>{activity.summary}</p><small>{formatDate(activity.occurred_at)} · {crmLeadStageConfig[activity.to_stage].label}</small></li>)}</ol></details> : null}
              {canAct && allowedCrmTransitions[contact.stage].length ? <button className="text-button crm-action-button" type="button" onClick={() => { const opening = activityFormId !== contact.id; setActivityFormId(opening ? contact.id : null); setActivityStage(contact.stage); }}><MessageSquareText size={13} /> تسجيل نتيجة متابعة</button> : null}
              {activityFormId === contact.id && canAct ? <form className="crm-activity-form" onSubmit={(event) => void recordActivity(event, contact)}>
                <label><span>طريقة المتابعة</span><select name="kind" defaultValue="message">{(Object.keys(crmActivityKindConfig) as Exclude<CrmActivityKind, "created">[]).map((kind) => <option value={kind} key={kind}>{crmActivityKindConfig[kind].label}</option>)}</select></label>
                <label><span>المرحلة بعد المتابعة</span><select value={activityStage} onChange={(event) => setActivityStage(event.target.value as CrmLeadStage)}>{nextOptions.map((option) => <option value={option} key={option}>{crmLeadStageConfig[option].label}</option>)}</select></label>
                <label><span>{["lost", "do_not_contact"].includes(activityStage) ? "سبب الإغلاق" : "نتيجة التواصل"}</span><textarea name="summary" minLength={3} maxLength={["lost", "do_not_contact"].includes(activityStage) ? 1000 : 4000} rows={3} required placeholder="ما الذي حدث؟ وما القرار أو الخطوة التالية؟" /></label>
                {crmLeadStageConfig[activityStage].active ? <label><span>موعد المتابعة التالية</span><input name="next_follow_up_at" type="datetime-local" defaultValue={defaultFollowUp} required /></label> : <p className="crm-close-note">سيتم إغلاق مهمة المتابعة الحالية ولن تُنشأ مهمة جديدة.</p>}
                <div className="form-actions"><Button type="submit" disabled={working}>{working ? <LoaderCircle className="spin" size={14} /> : <CheckCircle2 size={14} />} حفظ النتيجة</Button><button className="text-button" type="button" onClick={() => setActivityFormId(null)}>إلغاء</button></div>
              </form> : null}
            </article>;
          })}{!stageContacts.length ? <div className="column-empty"><span>—</span><p>لا يوجد</p></div> : null}</div>
        </section>;
      })}</div> : <section className="panel empty-state"><span className="empty-visual"><ContactRound size={20} /></span><div><h2>CRM جاهز بدون بيانات وهمية</h2><p>أدخل ملفًا واحدًا بنفسك عند الجاهزية، وسيظهر معه موعد المتابعة ومهمته في البورد.</p></div><span className="empty-proof"><ShieldCheck size={15} /> لا يوجد استيراد تلقائي</span></section>}

      <aside className="automation-note"><LockKeyhole size={17} /><div><strong>التكاملات والرسائل غير مفعّلة</strong><p>Whales Zone وMeta وTelegram والتطبيق مصادر معرفة داخل الملف فقط الآن. لن نستورد أو نراسل أي عميل قبل اعتماد الملكية والموافقة والاختبار.</p></div></aside>
    </section>
  );
}
