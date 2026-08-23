"use client";

import type { Session } from "@supabase/supabase-js";
import {
  AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, CircleUserRound,
  ContactRound, ExternalLink, FileClock, History, Link2, LoaderCircle,
  Mail, MessageSquareText, Phone, Plus, Route, Save, Tag, UserRoundCheck,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  allowedCrmTransitions, crmActivityKindConfig, crmConversationChannelConfig,
  crmIdentityKindConfig, crmInterestConfig, crmLeadStageConfig, crmSourceConfig,
  type CrmActivityKind, type CrmConversationChannel, type CrmIdentityKind,
  type CrmLeadStage,
} from "../../lib/crm";
import { crmContactReference, taskDeepLink, taskReference } from "../../lib/deep-links";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Tables } from "../../lib/supabase/database.types";
import { getSupabaseFunctionErrorMessage } from "../../lib/supabase/function-errors";
import { useWorkspaceAuth } from "../../lib/supabase/use-workspace-auth";
import { canManageTasks, taskStatusConfig } from "../../lib/tasks";
import { Button } from "../ui/Button";
import { StatusBadge } from "../ui/StatusBadge";

type Contact = Tables<"crm_contacts">;
type Identity = Tables<"crm_identities">;
type Activity = Tables<"crm_activities">;
type ConversationLink = Tables<"crm_conversation_links">;
type SalesProfile = Tables<"crm_sales_profiles">;
type Task = Tables<"tasks">;
type Membership = Tables<"memberships">;
type Organization = Tables<"organizations">;
type Person = { id: string; name: string; role: Membership["role"] };
type Workspace = { organization: Organization; membership: Membership; people: Person[] };
type CustomerData = {
  contact: Contact;
  identities: Identity[];
  activities: Activity[];
  conversationLinks: ConversationLink[];
  tasks: Task[];
  salesProfile: SalesProfile | null;
};
type LeadTemperature = "cold" | "warm" | "hot";

const temperatureConfig: Record<LeadTemperature, { label: string; tone: "neutral" | "warning" | "success" }> = {
  cold: { label: "اهتمام منخفض", tone: "neutral" },
  warm: { label: "مهتم", tone: "warning" },
  hot: { label: "جاهز للمتابعة", tone: "success" },
};

const preferredMethodLabels: Record<string, string> = {
  phone: "هاتف", email: "بريد إلكتروني", telegram: "Telegram", whatsapp: "WhatsApp",
  instagram: "Instagram", facebook: "Facebook", messenger: "Messenger", other: "أخرى",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function toLocalDateTimeInput(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function futureDateIso(value: string) {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) && date.getTime() > Date.now() ? date.toISOString() : null;
}

function formText(form: FormData, name: string) {
  return String(form.get(name) ?? "").trim();
}

function identityHref(identity: Identity) {
  if (identity.kind === "phone") return `tel:${identity.normalized_value}`;
  if (identity.kind === "email") return `mailto:${identity.value}`;
  if (identity.kind === "telegram") return `https://t.me/${identity.normalized_value}`;
  return null;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) return String(error.message);
  return "حدث خطأ غير متوقع.";
}

export function CrmCustomerWorkspace({ contactId }: { contactId: string }) {
  const configured = isSupabaseConfigured();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [data, setData] = useState<CustomerData | null>(null);
  const [loading, setLoading] = useState(configured);
  const [working, setWorking] = useState<"activity" | "profile" | "identity" | "link" | null>(null);
  const [error, setError] = useState<string | null>(configured ? null : "لم يتم إعداد اتصال Supabase لهذه النسخة.");
  const [notice, setNotice] = useState<string | null>(null);
  const [activityStage, setActivityStage] = useState<CrmLeadStage>("new");
  const [showIdentityForm, setShowIdentityForm] = useState(false);
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [renderNow] = useState(() => Date.now());
  const [defaultFollowUp] = useState(() => toLocalDateTimeInput(new Date(Date.now() + 24 * 60 * 60 * 1000)));

  const clearWorkspace = useCallback(() => { setWorkspace(null); setData(null); }, []);
  const clearTransientState = useCallback(() => { setError(null); setNotice(null); }, []);

  const loadCustomer = useCallback(async (activeWorkspace: Workspace) => {
    const supabase = getSupabaseBrowserClient();
    const [contactResult, identitiesResult, activitiesResult, linksResult, tasksResult, profileResult] = await Promise.all([
      supabase.from("crm_contacts").select("*").eq("organization_id", activeWorkspace.organization.id).eq("id", contactId).maybeSingle(),
      supabase.from("crm_identities").select("*").eq("contact_id", contactId).order("is_primary", { ascending: false }),
      supabase.from("crm_activities").select("*").eq("contact_id", contactId).order("occurred_at", { ascending: false }).limit(100),
      supabase.from("crm_conversation_links").select("*").eq("contact_id", contactId).order("is_primary", { ascending: false }),
      supabase.from("tasks").select("*").eq("organization_id", activeWorkspace.organization.id).eq("crm_contact_id", contactId).order("created_at", { ascending: false }).limit(50),
      supabase.from("crm_sales_profiles").select("*").eq("contact_id", contactId).maybeSingle(),
    ]);
    for (const result of [contactResult, identitiesResult, activitiesResult, linksResult, tasksResult, profileResult]) {
      if (result.error) throw result.error;
    }
    if (!contactResult.data) throw new Error("العميل غير موجود أو ليس لديك صلاحية لفتح ملفه.");
    setData({
      contact: contactResult.data,
      identities: identitiesResult.data ?? [],
      activities: activitiesResult.data ?? [],
      conversationLinks: linksResult.data ?? [],
      tasks: tasksResult.data ?? [],
      salesProfile: profileResult.data,
    });
    setActivityStage(contactResult.data.stage);
  }, [contactId]);

  const loadWorkspace = useCallback(async (activeSession: Session) => {
    const supabase = getSupabaseBrowserClient();
    setLoading(true);
    try {
      const { data: membership, error: membershipError } = await supabase.from("memberships").select("*").eq("user_id", activeSession.user.id).eq("status", "active").limit(1).maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) { clearWorkspace(); return; }
      const [organizationResult, membershipsResult] = await Promise.all([
        supabase.from("organizations").select("*").eq("id", membership.organization_id).single(),
        supabase.from("memberships").select("user_id, role").eq("organization_id", membership.organization_id).eq("status", "active"),
      ]);
      if (organizationResult.error) throw organizationResult.error;
      if (membershipsResult.error) throw membershipsResult.error;
      const memberIds = (membershipsResult.data ?? []).map((member) => member.user_id);
      const profilesResult = memberIds.length
        ? await supabase.from("profiles").select("id, full_name").in("id", memberIds)
        : { data: [], error: null };
      if (profilesResult.error) throw profilesResult.error;
      const people = (membershipsResult.data ?? []).map((member) => ({
        id: member.user_id,
        role: member.role,
        name: profilesResult.data?.find((profile) => profile.id === member.user_id)?.full_name
          ?? (member.user_id === activeSession.user.id ? activeSession.user.email : null)
          ?? "عضو فريق",
      }));
      const nextWorkspace = { organization: organizationResult.data, membership, people };
      setWorkspace(nextWorkspace);
      await loadCustomer(nextWorkspace);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [clearWorkspace, loadCustomer]);

  const session = useWorkspaceAuth({ configured, loadWorkspace, clearWorkspace, setLoading, clearTransientState });
  const refresh = useCallback(async () => {
    if (!workspace) return;
    try { await loadCustomer(workspace); }
    catch (refreshError) { setError(getErrorMessage(refreshError)); }
  }, [loadCustomer, workspace]);

  useEffect(() => {
    if (!workspace) return;
    const supabase = getSupabaseBrowserClient();
    const refreshCustomer = () => void refresh();
    let channel = supabase.channel(`crm-customer:${contactId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_contacts", filter: `id=eq.${contactId}` }, refreshCustomer);
    for (const table of ["crm_identities", "crm_activities", "crm_conversation_links", "crm_sales_profiles"] as const) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `contact_id=eq.${contactId}` }, refreshCustomer);
    }
    channel = channel.on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `crm_contact_id=eq.${contactId}` }, refreshCustomer);
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [contactId, refresh, workspace]);

  async function invokeCrm(body: Record<string, unknown>, successMessage: string, mode: typeof working) {
    setWorking(mode); setError(null); setNotice(null);
    const { data: responseData, error: commandError } = await getSupabaseBrowserClient().functions.invoke("crm-commands", { body });
    if (commandError) {
      setWorking(null);
      setError(await getSupabaseFunctionErrorMessage(commandError, "تعذّر حفظ التغيير. لم يتم حفظ أي جزء من العملية."));
      return null;
    }
    setNotice(successMessage);
    await refresh();
    setWorking(null);
    return responseData as Record<string, unknown> | null;
  }

  async function recordActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const activeStage = crmLeadStageConfig[activityStage].active;
    const nextFollowUp = activeStage ? futureDateIso(formText(form, "next_follow_up_at")) : null;
    if (activeStage && !nextFollowUp) { setError("حدد موعد المتابعة التالية في المستقبل."); return; }
    const result = await invokeCrm({
      action: "record_activity",
      contact_id: data.contact.id,
      expected_version: data.contact.version,
      kind: formText(form, "kind"),
      next_stage: activityStage,
      summary: formText(form, "summary"),
      next_follow_up_at: nextFollowUp,
    }, activeStage ? "تم حفظ النتيجة، إغلاق المتابعة السابقة، وإنشاء مهمة المتابعة الجديدة." : "تم حفظ النتيجة وإغلاق المتابعة المفتوحة.", "activity");
    if (result) formElement.reset();
  }

  async function saveSalesProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data) return;
    const form = new FormData(event.currentTarget);
    await invokeCrm({
      action: "save_sales_profile",
      contact_id: data.contact.id,
      expected_version: data.salesProfile?.version ?? 0,
      lead_temperature: formText(form, "lead_temperature"),
      preferred_contact_method: formText(form, "preferred_contact_method"),
      preferred_contact_time: formText(form, "preferred_contact_time"),
      needs: formText(form, "needs"),
      objections: formText(form, "objections"),
      next_action: formText(form, "next_action"),
      tags: formText(form, "tags").split(/[،,\n]/).map((tag) => tag.trim()).filter(Boolean),
    }, "تم حفظ ملخص السيلز.", "profile");
  }

  async function addIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const result = await invokeCrm({
      action: "add_identity", contact_id: data.contact.id,
      identity_kind: formText(form, "identity_kind"), identity_value: formText(form, "identity_value"),
      make_primary: form.get("make_primary") === "on",
    }, "تمت إضافة وسيلة التواصل.", "identity");
    if (result) { formElement.reset(); setShowIdentityForm(false); }
  }

  async function addConversationLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const result = await invokeCrm({
      action: "add_conversation_link", contact_id: data.contact.id,
      channel: formText(form, "channel"), url: formText(form, "url"), label: formText(form, "label"),
      make_primary: form.get("make_primary") === "on",
    }, "تمت إضافة لينك المحادثة.", "link");
    if (result) { formElement.reset(); setShowLinkForm(false); }
  }

  const peopleById = useMemo(() => new Map(workspace?.people.map((person) => [person.id, person]) ?? []), [workspace?.people]);
  if (loading) return <section className="panel empty-state"><LoaderCircle className="spin" size={20} /><div><h2>جارٍ فتح ملف العميل</h2><p>نحمّل بيانات التواصل والمهام والسجل.</p></div></section>;
  if (!session || !workspace || !data) return <section className="panel empty-state"><AlertTriangle size={20} /><div><h2>تعذّر فتح ملف العميل</h2><p>{error ?? "العميل غير موجود أو خارج صلاحيات حسابك."}</p></div><Button href="/crm" variant="secondary">العودة للعملاء</Button></section>;

  const { contact, identities, activities, conversationLinks, tasks, salesProfile } = data;
  const canAct = canManageTasks(workspace.membership.role) || contact.owner_id === session.user.id;
  const nextStages = [contact.stage, ...allowedCrmTransitions[contact.stage].filter((stage) => stage !== contact.stage)];
  const openTask = tasks.find((task) => task.status !== "done");
  const overdue = Boolean(contact.next_follow_up_at && crmLeadStageConfig[contact.stage].active && new Date(contact.next_follow_up_at).getTime() < renderNow);
  const directIdentity = identities.find((identity) => identity.is_primary && identityHref(identity)) ?? identities.find((identity) => identityHref(identity));
  const directLink = conversationLinks.find((link) => link.is_primary) ?? conversationLinks[0];
  const directHref = directLink?.url ?? (directIdentity ? identityHref(directIdentity) : null);
  const remainingKinds = (["phone", "email", "telegram", "tradingview"] as CrmIdentityKind[]).filter((kind) => !identities.some((identity) => identity.kind === kind));
  return <section className="crm-customer-workspace">
    <div className="crm-customer-toolbar">
      <Button href="/crm" variant="ghost"><ArrowRight size={15} /> العودة للعملاء</Button>
      <span>{crmContactReference(contact.id)}</span>
    </div>

    <section className="panel crm-customer-header">
      <div><p className="overline">{crmSourceConfig[contact.source].label} · {crmInterestConfig[contact.interest].label}</p><h2>{contact.full_name}</h2><p>ملف العميل يجمع التواصل والمتابعة والمهام في مكان واحد.</p></div>
      <div className="crm-customer-header-status"><StatusBadge tone={crmLeadStageConfig[contact.stage].tone}>{crmLeadStageConfig[contact.stage].label}</StatusBadge><span><CircleUserRound size={14} /> {peopleById.get(contact.owner_id)?.name ?? "عضو فريق"}</span></div>
    </section>

    {error ? <p className="form-notice error" role="alert">{error}</p> : null}
    {notice ? <p className="form-notice success" role="status"><CheckCircle2 size={14} /> {notice}</p> : null}

    <div className="crm-customer-layout">
      <aside className={`panel crm-next-action ${overdue ? "overdue" : ""}`}>
        <div className="section-heading compact"><div><p className="overline">الخطوة التالية</p><h2>المتابعة الحالية</h2></div><CalendarClock size={19} /></div>
        {contact.next_follow_up_at ? <div className="crm-next-date"><span>{overdue ? "متأخرة" : "موعد المتابعة"}</span><strong>{formatDate(contact.next_follow_up_at)}</strong></div> : <p className="empty-proof">{contact.follow_up_required ? "لا يوجد موعد واضح" : "سجل تاريخي بدون متابعة مفتوحة"}</p>}
        {openTask ? <a className="crm-task-link" href={taskDeepLink(openTask.id)}><Route size={13} /> {taskReference(openTask.id)} · {taskStatusConfig[openTask.status].label}</a> : <span className="crm-task-complete"><CheckCircle2 size={13} /> لا توجد مهمة مفتوحة</span>}
        {directHref ? <a className="button button-primary crm-primary-contact" href={directHref} target={directHref.startsWith("http") ? "_blank" : undefined} rel={directHref.startsWith("http") ? "noreferrer" : undefined}>{directIdentity?.kind === "email" ? <Mail size={15} /> : <Phone size={15} />} تواصل الآن</a> : null}
      </aside>

      <div className="crm-customer-main">
        <section className="panel crm-customer-section">
          <div className="section-heading compact"><div><p className="overline">بيانات العميل</p><h2>التواصل والتسجيل</h2></div><ContactRound size={19} /></div>
          <dl className="crm-customer-facts">
            {identities.map((identity) => <div key={identity.id}><dt>{crmIdentityKindConfig[identity.kind].label}{identity.is_primary ? " · أساسية" : ""}</dt><dd dir="ltr">{identity.value}</dd></div>)}
            <div><dt><CircleUserRound size={13} /> المسؤول</dt><dd>{peopleById.get(contact.owner_id)?.name ?? "عضو فريق"}</dd></div>
            <div><dt><FileClock size={13} /> تاريخ التسجيل</dt><dd>{formatDate(contact.source_registered_at ?? contact.created_at)}</dd></div>
          </dl>
          {conversationLinks.length ? <div className="crm-chat-links">{conversationLinks.map((link) => <a href={link.url} target="_blank" rel="noreferrer" key={link.id}><ExternalLink size={12} /> {link.label ?? crmConversationChannelConfig[link.channel].label}</a>)}</div> : null}
          {contact.notes ? <p className="crm-contact-notes">{contact.notes}</p> : null}
          {canAct ? <div className="crm-card-actions">
            {remainingKinds.length ? <button className="text-button" type="button" onClick={() => setShowIdentityForm((value) => !value)}><Plus size={13} /> إضافة وسيلة</button> : null}
            <button className="text-button" type="button" onClick={() => setShowLinkForm((value) => !value)}><Link2 size={13} /> إضافة لينك محادثة</button>
          </div> : null}
          {showIdentityForm && remainingKinds.length ? <form className="crm-activity-form crm-inline-tool" onSubmit={(event) => void addIdentity(event)}><label><span>نوع الوسيلة</span><select name="identity_kind">{remainingKinds.map((kind) => <option value={kind} key={kind}>{crmIdentityKindConfig[kind].label}</option>)}</select></label><label><span>القيمة</span><input name="identity_value" dir="ltr" required minLength={3} maxLength={320} /></label><label className="crm-checkbox"><input name="make_primary" type="checkbox" /><span>وسيلة أساسية</span></label><Button type="submit" disabled={working !== null}>{working === "identity" ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />} حفظ</Button></form> : null}
          {showLinkForm ? <form className="crm-activity-form crm-inline-tool" onSubmit={(event) => void addConversationLink(event)}><label><span>المنصة</span><select name="channel">{(Object.keys(crmConversationChannelConfig) as CrmConversationChannel[]).map((channel) => <option value={channel} key={channel}>{crmConversationChannelConfig[channel].label}</option>)}</select></label><label><span>لينك المحادثة</span><input name="url" type="url" dir="ltr" required placeholder="https://..." /></label><label><span>اسم اختياري</span><input name="label" maxLength={80} /></label><label className="crm-checkbox"><input name="make_primary" type="checkbox" /><span>لينك أساسي</span></label><Button type="submit" disabled={working !== null}>{working === "link" ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />} حفظ</Button></form> : null}
        </section>

        {canAct && nextStages.length ? <section className="panel crm-customer-section crm-result-section">
          <div className="section-heading compact"><div><p className="overline">نتيجة التواصل</p><h2>سجّل ما حدث وحدد المتابعة</h2><p>الحفظ يقفل المهمة الحالية ويُنشئ التالية في نفس العملية.</p></div><MessageSquareText size={19} /></div>
          <form className="crm-customer-result-form" onSubmit={(event) => void recordActivity(event)}>
            <label><span>طريقة التواصل</span><select name="kind" defaultValue="message">{(Object.keys(crmActivityKindConfig) as Exclude<CrmActivityKind, "created">[]).map((kind) => <option value={kind} key={kind}>{crmActivityKindConfig[kind].label}</option>)}</select></label>
            <label><span>المرحلة بعد التواصل</span><select value={activityStage} onChange={(event) => setActivityStage(event.target.value as CrmLeadStage)}>{nextStages.map((stage) => <option value={stage} key={stage}>{crmLeadStageConfig[stage].label}</option>)}</select></label>
            <label className="wide"><span>{["lost", "do_not_contact"].includes(activityStage) ? "سبب الإغلاق" : "نتيجة التواصل والخطوة المتفق عليها"}</span><textarea name="summary" required minLength={3} maxLength={["lost", "do_not_contact"].includes(activityStage) ? 1000 : 4000} rows={4} placeholder="اكتب ما حدث بوضوح عشان أي عضو يفتح الملف يفهم آخر موقف." /></label>
            {crmLeadStageConfig[activityStage].active ? <label><span>موعد المتابعة التالية</span><input name="next_follow_up_at" type="datetime-local" defaultValue={defaultFollowUp} required /></label> : <p className="crm-close-note">لن تُنشأ مهمة جديدة لهذه المرحلة.</p>}
            <div className="form-actions wide"><Button type="submit" disabled={working !== null}>{working === "activity" ? <LoaderCircle className="spin" size={14} /> : <CheckCircle2 size={14} />} حفظ النتيجة والمتابعة</Button></div>
          </form>
        </section> : null}

        <section className="panel crm-customer-section">
          <div className="section-heading compact"><div><p className="overline">ملخص السيلز</p><h2>المعلومة التي يحتاجها المسؤول</h2><p>حقول قليلة فقط تمنع ضياع الاحتياج والاعتراض والخطوة التالية.</p></div><UserRoundCheck size={19} /></div>
          {canAct ? <form className="crm-sales-profile-form" key={salesProfile?.version ?? 0} onSubmit={(event) => void saveSalesProfile(event)}>
            <label><span>درجة الاهتمام</span><select name="lead_temperature" defaultValue={salesProfile?.lead_temperature ?? "warm"}>{(Object.keys(temperatureConfig) as LeadTemperature[]).map((temperature) => <option value={temperature} key={temperature}>{temperatureConfig[temperature].label}</option>)}</select></label>
            <label><span>طريقة التواصل المفضلة</span><select name="preferred_contact_method" defaultValue={salesProfile?.preferred_contact_method ?? ""}><option value="">غير محددة</option>{Object.entries(preferredMethodLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label><span>الوقت المفضل</span><input name="preferred_contact_time" maxLength={120} defaultValue={salesProfile?.preferred_contact_time ?? ""} placeholder="مثال: بعد 6 مساءً" /></label>
            <label className="wide"><span>احتياج العميل</span><textarea name="needs" rows={3} maxLength={4000} defaultValue={salesProfile?.needs ?? ""} /></label>
            <label className="wide"><span>الاعتراض الحالي</span><textarea name="objections" rows={3} maxLength={4000} defaultValue={salesProfile?.objections ?? ""} /></label>
            <label className="wide"><span>الخطوة التالية</span><textarea name="next_action" rows={2} maxLength={1000} defaultValue={salesProfile?.next_action ?? ""} /></label>
            <label className="wide"><span><Tag size={13} /> تصنيفات — افصل بفاصلة</span><input name="tags" maxLength={820} defaultValue={salesProfile?.tags.join("، ") ?? ""} /></label>
            <div className="form-actions wide"><Button type="submit" disabled={working !== null}>{working === "profile" ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />} حفظ الملخص</Button></div>
          </form> : <p className="empty-proof">ملخص السيلز متاح لمسؤول العميل والإدارة فقط.</p>}
        </section>
      </div>
    </div>

    <div className="crm-customer-bottom-grid">
      <section className="panel crm-customer-section">
        <div className="section-heading compact"><div><p className="overline">المهام المرتبطة</p><h2>متابعات العميل</h2></div><StatusBadge tone="neutral">{tasks.length}</StatusBadge></div>
        {tasks.length ? <div className="crm-customer-task-list">{tasks.map((task) => <a href={taskDeepLink(task.id)} key={task.id}><div><strong>{task.title}</strong><small>{taskReference(task.id)} · {formatDate(task.due_at)}</small></div><StatusBadge tone={taskStatusConfig[task.status].tone}>{taskStatusConfig[task.status].label}</StatusBadge></a>)}</div> : <p className="empty-proof"><CheckCircle2 size={14} /> لا توجد مهام مرتبطة.</p>}
      </section>
      <section className="panel crm-customer-section">
        <div className="section-heading compact"><div><p className="overline">سجل التواصل</p><h2>كل ما حدث بالترتيب</h2></div><History size={19} /></div>
        {activities.length ? <ol className="crm-customer-timeline">{activities.map((activity) => <li key={activity.id}><span aria-hidden="true" /><div><strong>{activity.kind === "created" ? "إنشاء الملف" : crmActivityKindConfig[activity.kind].label}</strong><p>{activity.summary}</p><small>{formatDate(activity.occurred_at)} · {crmLeadStageConfig[activity.to_stage].label}</small></div></li>)}</ol> : <p className="empty-proof">لا يوجد نشاط مسجل.</p>}
      </section>
    </div>
  </section>;
}
