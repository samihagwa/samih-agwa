"use client";

import type { Session } from "@supabase/supabase-js";
import { Archive, Bot, FilePenLine, Lightbulb, LoaderCircle, LockKeyhole, Plus, Radar, Search, ShieldCheck, Sparkles, UserRound, UsersRound } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { formatScriptDate, lines, scriptInputModeConfig, scriptResearchKindConfig, scriptStatusConfig } from "../../lib/scripts";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Tables } from "../../lib/supabase/database.types";
import { useWorkspaceAuth } from "../../lib/supabase/use-workspace-auth";
import { Button } from "../ui/Button";
import { StatusBadge } from "../ui/StatusBadge";

type Membership = Tables<"memberships">;
type Organization = Tables<"organizations">;
type Script = Tables<"scripts">;
type Research = Tables<"script_research_items">;
type VoiceProfile = Tables<"script_voice_profiles">;
type Person = { id: string; name: string; role: Membership["role"] };
type Workspace = {
  organization: Organization;
  membership: Membership;
  people: Person[];
  scripts: Script[];
  research: Research[];
  voice: VoiceProfile | null;
};
type Tab = "scripts" | "radar" | "voice";

const initialScriptForm = {
  title: "", input_mode: "idea", source_url: "", source_text: "", objective: "",
  audience: "متداولون عرب", platform: "instagram", duration_seconds: "60", content_pillar: "",
};

function personName(people: Person[], id: string) {
  return people.find((person) => person.id === id)?.name ?? "عضو فريق";
}

function emptyState(icon: typeof FilePenLine, title: string, body: string) {
  const Icon = icon;
  return <div className="scripts-empty"><Icon size={25} /><strong>{title}</strong><p>{body}</p></div>;
}

async function invokeCommand(body: Record<string, unknown>) {
  const { data, error } = await getSupabaseBrowserClient().functions.invoke("script-commands", { body });
  if (error) {
    const context = error.context as Response | undefined;
    if (context) {
      try { const payload = await context.clone().json() as { message?: string }; if (payload.message) throw new Error(payload.message); } catch (parseError) { if (parseError instanceof Error && parseError.message !== "Unexpected end of JSON input") throw parseError; }
    }
    throw error;
  }
  return data as Record<string, unknown>;
}

function VoiceProfileForm({ profile, owner, organizationId, onSaved }: { profile: VoiceProfile | null; owner: boolean; organizationId: string; onSaved: () => Promise<void> }) {
  const [summary, setSummary] = useState(profile?.voice_summary ?? "");
  const [rules, setRules] = useState((profile?.writing_rules ?? []).join("\n"));
  const [banned, setBanned] = useState((profile?.banned_phrases ?? []).join("\n"));
  const [stories, setStories] = useState((profile?.story_bank ?? []).join("\n"));
  const [examples, setExamples] = useState(profile?.approved_examples ?? "");
  const [notes, setNotes] = useState(profile?.source_notes ?? "");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!owner) return;
    setSaving(true); setNotice(null);
    try {
      await invokeCommand({
        action: "save_voice", organization_id: organizationId, expected_edit_version: profile?.edit_version ?? 0,
        voice_summary: summary, writing_rules: lines(rules), banned_phrases: lines(banned), story_bank: lines(stories),
        approved_examples: examples, source_notes: notes,
      });
      setNotice("تم حفظ بصمة الكتابة. ستدخل تلقائيًا في أي توليد AI جديد.");
      await onSaved();
    } catch (error) { setNotice(error instanceof Error ? error.message : "تعذّر حفظ بصمة الكتابة."); }
    finally { setSaving(false); }
  }

  return <section className="panel voice-profile-panel">
    <div className="section-heading"><div><p className="overline">بصمتي</p><h2>كيف يكتب ويتكلم Market Whales؟</h2><p>مرجع واحد لصوت المحتوى. كل الفريق يقرأه، والمالك فقط يغيره.</p></div><StatusBadge tone={owner ? "success" : "info"}>{owner ? "يمكنك التعديل" : "قراءة فقط"}</StatusBadge></div>
    <aside className="script-trust-note"><ShieldCheck size={18} /><div><strong>الـAI لا يتعلم وحده من الإنترنت</strong><p>يستخدم هذه البصمة ومراجع البراند المعتمدة فقط عند ضغطك على زر التوليد. لا يوجد Apify أو سحب منافسين تلقائي في هذه المرحلة.</p></div></aside>
    <form className="voice-profile-form" onSubmit={(event) => void submit(event)}>
      <label className="span-2"><span>ملخص الصوت والشخصية</span><textarea disabled={!owner} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="مصري طبيعي، مباشر، عملي، يشرح التداول بدون تعقيد أو وعود..." /></label>
      <label><span>قواعد الكتابة — قاعدة في كل سطر</span><textarea disabled={!owner} value={rules} onChange={(event) => setRules(event.target.value)} placeholder={"ابدأ بهوك يلمس مشكلة حقيقية\nمثال قبل الشرح النظري"} /></label>
      <label><span>كلمات وعبارات ممنوعة — واحدة في كل سطر</span><textarea disabled={!owner} value={banned} onChange={(event) => setBanned(event.target.value)} placeholder={"أرباح مضمونة\nسر لن يخبرك به أحد"} /></label>
      <label><span>بنك القصص — موقف في كل سطر</span><textarea disabled={!owner} value={stories} onChange={(event) => setStories(event.target.value)} placeholder="مواقف شخصية أو قصص عمل يمكن الرجوع لها..." /></label>
      <label><span>مصادر التعلم والملاحظات</span><textarea disabled={!owner} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="المراجع التي تمثل منهجك وما لا يجب نسبه لك..." /></label>
      <label className="span-2"><span>أرشيف أمثلة الصوت</span><textarea className="voice-examples" disabled={!owner} value={examples} onChange={(event) => setExamples(event.target.value)} placeholder="العينات الجديدة تُعتمد من داخل محرر الاسكريبت بعد تعديلها وحفظها يدويًا." /><small>لمنع خلط الإعلانات بصوتك الطبيعي، التوليد يستخدم فقط المقاطع المعلّمة «عينة معتمدة من سميح» التي أضفتها بزر الاعتماد داخل الاسكريبت. يمكنك حذف عينة قديمة من هنا عند الحاجة.</small></label>
      {notice ? <p className={`form-notice ${notice.startsWith("تم") ? "success" : "error"}`}>{notice}</p> : null}
      {owner ? <div className="form-actions"><Button type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />} حفظ بصمتي</Button></div> : null}
    </form>
  </section>;
}

export function ScriptsWorkspace() {
  const configured = isSupabaseConfigured();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("scripts");
  const [search, setSearch] = useState("");
  const [personFilter, setPersonFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [showCreateScript, setShowCreateScript] = useState(false);
  const [showCreateResearch, setShowCreateResearch] = useState(false);
  const [scriptForm, setScriptForm] = useState(initialScriptForm);
  const [assignedTo, setAssignedTo] = useState("");
  const [researchForm, setResearchForm] = useState({ kind: "idea", title: "", source_url: "", raw_notes: "", transcript: "", hook: "", transferable_principle: "", why_it_works: "", original_angles: "", performance_signal: "", brand_fit: "", freshness: "" });
  const [researchAssignedTo, setResearchAssignedTo] = useState("");
  const [saving, setSaving] = useState(false);

  const clearWorkspace = useCallback(() => setWorkspace(null), []);
  const clearTransientState = useCallback(() => { setError(null); setNotice(null); }, []);

  const loadRows = useCallback(async (base: Omit<Workspace, "scripts" | "research" | "voice">) => {
    const supabase = getSupabaseBrowserClient();
    const [scriptsResult, researchResult, voiceResult] = await Promise.all([
      supabase.from("scripts").select("*").eq("organization_id", base.organization.id).order("updated_at", { ascending: false }),
      supabase.from("script_research_items").select("*").eq("organization_id", base.organization.id).order("updated_at", { ascending: false }),
      supabase.from("script_voice_profiles").select("*").eq("organization_id", base.organization.id).maybeSingle(),
    ]);
    if (scriptsResult.error) throw scriptsResult.error;
    if (researchResult.error) throw researchResult.error;
    if (voiceResult.error) throw voiceResult.error;
    setWorkspace({ ...base, scripts: scriptsResult.data ?? [], research: researchResult.data ?? [], voice: voiceResult.data });
  }, []);

  const loadWorkspace = useCallback(async (activeSession: Session) => {
    const supabase = getSupabaseBrowserClient();
    setLoading(true);
    try {
      const { data: membership, error: membershipError } = await supabase.from("memberships").select("*").eq("user_id", activeSession.user.id).eq("status", "active").limit(1).maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) { clearWorkspace(); return; }
      const [organizationResult, membershipsResult] = await Promise.all([
        supabase.from("organizations").select("*").eq("id", membership.organization_id).single(),
        supabase.from("memberships").select("*").eq("organization_id", membership.organization_id).eq("status", "active"),
      ]);
      if (organizationResult.error) throw organizationResult.error;
      if (membershipsResult.error) throw membershipsResult.error;
      const ids = (membershipsResult.data ?? []).map((row) => row.user_id);
      const { data: profiles, error: profilesError } = ids.length ? await supabase.from("profiles").select("id, full_name").in("id", ids) : { data: [], error: null };
      if (profilesError) throw profilesError;
      const people = (membershipsResult.data ?? []).map((row) => ({
        id: row.user_id, role: row.role,
        name: profiles?.find((profile) => profile.id === row.user_id)?.full_name ?? (row.user_id === activeSession.user.id ? activeSession.user.email : null) ?? "عضو فريق",
      }));
      const base = { organization: organizationResult.data, membership, people };
      await loadRows(base);
      setAssignedTo((value) => value || activeSession.user.id);
      setResearchAssignedTo((value) => value || activeSession.user.id);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "تعذّر تحميل استوديو الاسكريبتات."); }
    finally { setLoading(false); }
  }, [clearWorkspace, loadRows]);

  const session = useWorkspaceAuth({ configured, loadWorkspace, clearWorkspace, setLoading, clearTransientState });
  const refresh = useCallback(async () => {
    if (!workspace) return;
    await loadRows({ organization: workspace.organization, membership: workspace.membership, people: workspace.people });
  }, [loadRows, workspace]);

  useEffect(() => {
    if (!workspace) return;
    const supabase = getSupabaseBrowserClient();
    const channel = supabase.channel(`scripts-workspace:${workspace.organization.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "scripts", filter: `organization_id=eq.${workspace.organization.id}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "script_research_items", filter: `organization_id=eq.${workspace.organization.id}` }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "script_voice_profiles", filter: `organization_id=eq.${workspace.organization.id}` }, () => void refresh())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refresh, workspace]);

  const filteredScripts = useMemo(() => {
    if (!workspace) return [];
    const query = search.trim().toLocaleLowerCase("ar");
    return workspace.scripts.filter((script) => {
      const matchesSearch = !query || [script.title, script.objective, script.spoken_script, script.caption, script.content_pillar ?? ""].some((value) => value.toLocaleLowerCase("ar").includes(query));
      const matchesPerson = personFilter === "all" || script.assigned_to === personFilter;
      const matchesStatus = statusFilter === "all" || (statusFilter === "active" ? script.status !== "archived" : script.status === statusFilter);
      return matchesSearch && matchesPerson && matchesStatus;
    });
  }, [personFilter, search, statusFilter, workspace]);

  async function createScript(event: FormEvent) {
    event.preventDefault(); if (!workspace) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      const result = await invokeCommand({ action: "create_script", organization_id: workspace.organization.id, assigned_to: assignedTo, ...scriptForm, duration_seconds: Number(scriptForm.duration_seconds) });
      setScriptForm(initialScriptForm); setShowCreateScript(false);
      await refresh();
      const id = String(result.scriptId ?? "");
      setNotice("تم إنشاء المسودة بنسختها الأولى.");
      if (id) window.location.assign(`/scripts/${id}`);
    } catch (createError) { setError(createError instanceof Error ? createError.message : "تعذّر إنشاء الاسكريبت."); }
    finally { setSaving(false); }
  }

  async function createResearch(event: FormEvent) {
    event.preventDefault(); if (!workspace) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      await invokeCommand({ action: "create_research", organization_id: workspace.organization.id, assigned_to: researchAssignedTo, ...researchForm, original_angles: lines(researchForm.original_angles) });
      setResearchForm({ kind: "idea", title: "", source_url: "", raw_notes: "", transcript: "", hook: "", transferable_principle: "", why_it_works: "", original_angles: "", performance_signal: "", brand_fit: "", freshness: "" });
      setShowCreateResearch(false); setNotice("تم حفظ العنصر في الرادار اليدوي."); await refresh();
    } catch (createError) { setError(createError instanceof Error ? createError.message : "تعذّر حفظ الفكرة."); }
    finally { setSaving(false); }
  }

  async function convertResearch(id: string) {
    setSaving(true); setError(null); setNotice(null);
    try {
      const result = await invokeCommand({ action: "research_to_script", research_id: id });
      await refresh();
      const scriptId = String(result.scriptId ?? "");
      if (scriptId) window.location.assign(`/scripts/${scriptId}`);
    } catch (convertError) { setError(convertError instanceof Error ? convertError.message : "تعذّر تحويل الفكرة."); }
    finally { setSaving(false); }
  }

  if (loading) return <section className="workspace-state"><LoaderCircle className="spin" size={24} /><div><h2>جارٍ فتح الاستوديو</h2><p>نحمّل اسكريبتاتك الخاصة وبنك الأفكار.</p></div></section>;
  if (!session) return <section className="workspace-state workspace-onboarding"><LockKeyhole size={27} /><div><h2>سجّل الدخول أولًا</h2><p>الاسكريبتات خاصة ومحمية بحساب كل عضو.</p></div><Button href="/tasks">تسجيل الدخول</Button></section>;
  if (!workspace) return <section className="workspace-state"><UsersRound size={27} /><div><h2>لا توجد مساحة عمل</h2><p>أنشئ مساحة الشركة من قسم المهام أولًا.</p></div></section>;

  const owner = workspace.membership.role === "owner";
  return <section className="scripts-workspace">
    <div className="scripts-tabs" role="tablist" aria-label="أقسام استوديو الاسكريبتات">
      <button type="button" role="tab" aria-selected={tab === "scripts"} className={tab === "scripts" ? "active" : ""} onClick={() => setTab("scripts")}><FilePenLine size={16} /> اسكريبتاتي</button>
      <button type="button" role="tab" aria-selected={tab === "radar"} className={tab === "radar" ? "active" : ""} onClick={() => setTab("radar")}><Radar size={16} /> الأفكار والرادار</button>
      <button type="button" role="tab" aria-selected={tab === "voice"} className={tab === "voice" ? "active" : ""} onClick={() => setTab("voice")}><Sparkles size={16} /> بصمتي</button>
    </div>
    {error ? <p className="form-notice error">{error}</p> : null}
    {notice ? <p className="form-notice success">{notice}</p> : null}

    {tab === "scripts" ? <>
      <section className="panel scripts-control-panel">
        <div className="section-heading"><div><p className="overline">المساحة الخاصة</p><h2>{owner ? "اسكريبتات الفريق" : "اسكريبتاتي"}</h2><p>{owner ? "ترى الجميع بصفتك المالك. كل عضو آخر يرى ملفاته وحده." : "لا يستطيع أي عضو آخر فتح اسكريبتاتك. المالك فقط لديه رؤية تشغيلية كاملة."}</p></div><Button type="button" onClick={() => setShowCreateScript((value) => !value)}><Plus size={15} /> اسكريبت جديد</Button></div>
        <div className="scripts-filters"><label className="search-field"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث في العنوان أو النص أو الكابشن..." /></label>{owner ? <select aria-label="تصفية حسب العضو" value={personFilter} onChange={(event) => setPersonFilter(event.target.value)}><option value="all">كل الأعضاء</option>{workspace.people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select> : null}<select aria-label="تصفية حسب الحالة" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="active">العمل الحالي</option><option value="draft">المسودات</option><option value="ready_to_record">جاهز للتسجيل</option><option value="handed_off">داخل المصنع</option><option value="archived">الأرشيف</option><option value="all">كل الحالات</option></select></div>
        {showCreateScript ? <form className="script-create-form" onSubmit={(event) => void createScript(event)}>
          <label><span>عنوان الاسكريبت</span><input required minLength={3} value={scriptForm.title} onChange={(event) => setScriptForm((form) => ({ ...form, title: event.target.value }))} /></label>
          <label><span>طريقة البداية</span><select value={scriptForm.input_mode} onChange={(event) => setScriptForm((form) => ({ ...form, input_mode: event.target.value }))}>{Object.entries(scriptInputModeConfig).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span>مسؤول الاسكريبت</span><select value={assignedTo} disabled={!owner} onChange={(event) => setAssignedTo(event.target.value)}>{workspace.people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          <label><span>المنصة</span><select value={scriptForm.platform} onChange={(event) => setScriptForm((form) => ({ ...form, platform: event.target.value }))}><option value="instagram">Instagram</option><option value="facebook">Facebook</option><option value="tiktok">TikTok</option><option value="youtube">YouTube</option><option value="telegram">Telegram</option><option value="other">أخرى</option></select></label>
          <label><span>المدة المتوقعة بالثواني</span><input type="number" min={10} max={1800} value={scriptForm.duration_seconds} onChange={(event) => setScriptForm((form) => ({ ...form, duration_seconds: event.target.value }))} /></label>
          <label><span>سلسلة أو عمود محتوى — اختياري</span><input value={scriptForm.content_pillar} onChange={(event) => setScriptForm((form) => ({ ...form, content_pillar: event.target.value }))} /></label>
          <label className="span-2"><span>الهدف من الاسكريبت</span><textarea required minLength={5} value={scriptForm.objective} onChange={(event) => setScriptForm((form) => ({ ...form, objective: event.target.value }))} placeholder="إيه اللي المفروض المشاهد يفهمه أو يعمله؟" /></label>
          <label><span>رابط مرجع — اختياري</span><input type="url" value={scriptForm.source_url} onChange={(event) => setScriptForm((form) => ({ ...form, source_url: event.target.value }))} /></label>
          <label><span>الجمهور</span><input value={scriptForm.audience} onChange={(event) => setScriptForm((form) => ({ ...form, audience: event.target.value }))} /></label>
          <label className="span-2"><span>نص أو ملاحظات المصدر — اختياري</span><textarea value={scriptForm.source_text} onChange={(event) => setScriptForm((form) => ({ ...form, source_text: event.target.value }))} /></label>
          <div className="form-actions"><Button type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={15} /> : <FilePenLine size={15} />} إنشاء وفتح المحرر</Button><Button type="button" variant="ghost" onClick={() => setShowCreateScript(false)}>إلغاء</Button></div>
        </form> : null}
      </section>
      <div className="scripts-grid">{filteredScripts.length ? filteredScripts.map((script) => {
        const config = scriptStatusConfig[script.status];
        return <article className="script-card" key={script.id}><header><div><span className="script-card-icon"><FilePenLine size={18} /></span><div><h3>{script.title}</h3><p>{script.objective}</p></div></div><StatusBadge tone={config.tone}>{config.label}</StatusBadge></header><dl><div><dt>الكاتب</dt><dd><UserRound size={12} /> {personName(workspace.people, script.assigned_to)}</dd></div><div><dt>المدة</dt><dd>{script.duration_seconds.toLocaleString("ar-EG")} ثانية</dd></div><div><dt>آخر نسخة</dt><dd>v{script.edit_version.toLocaleString("ar-EG")}</dd></div></dl><footer><span>{formatScriptDate(script.updated_at)}</span><a className="button button-secondary" href={`/scripts/${script.id}`}>فتح الاسكريبت</a></footer></article>;
      }) : emptyState(Archive, "لا توجد اسكريبتات مطابقة", statusFilter === "active" ? "ابدأ باسكريبت جديد أو غيّر البحث والفلترة." : "غيّر الفلترة لرؤية العمل الحالي أو الأرشيف.")}</div>
    </> : null}

    {tab === "radar" ? <>
      <section className="panel scripts-control-panel">
        <div className="section-heading"><div><p className="overline">الرادار اليدوي الآن</p><h2>مصدر → مبدأ → زاوية أصلية</h2><p>نسجل الفكرة المفيدة ولا ننسخ المنافس. جلب Instagram وTranscript عبر Apify مؤجل لمرحلة مستقلة بعد تحديد الميزانية والحدود.</p></div><Button type="button" onClick={() => setShowCreateResearch((value) => !value)}><Plus size={15} /> إضافة فكرة أو مرجع</Button></div>
        <aside className="script-trust-note"><Bot size={18} /><div><strong>لا يوجد اشتراك مدفوع أو سحب خفي</strong><p>الصق الرابط أو الفكرة يدويًا الآن. سنضيف الأتمتة لاحقًا بدون تغيير شكل بنك الأفكار أو خصوصيته.</p></div></aside>
        {showCreateResearch ? <form className="research-create-form" onSubmit={(event) => void createResearch(event)}>
          <label><span>النوع</span><select value={researchForm.kind} onChange={(event) => setResearchForm((form) => ({ ...form, kind: event.target.value }))}>{Object.entries(scriptResearchKindConfig).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span>المسؤول</span><select value={researchAssignedTo} disabled={!owner} onChange={(event) => setResearchAssignedTo(event.target.value)}>{workspace.people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          <label className="span-2"><span>عنوان الفكرة</span><input required minLength={3} value={researchForm.title} onChange={(event) => setResearchForm((form) => ({ ...form, title: event.target.value }))} /></label>
          <label className="span-2"><span>رابط المصدر — اختياري</span><input type="url" value={researchForm.source_url} onChange={(event) => setResearchForm((form) => ({ ...form, source_url: event.target.value }))} /></label>
          <label><span>الهوك الأصلي</span><textarea value={researchForm.hook} onChange={(event) => setResearchForm((form) => ({ ...form, hook: event.target.value }))} /></label>
          <label><span>المبدأ القابل للنقل</span><textarea value={researchForm.transferable_principle} onChange={(event) => setResearchForm((form) => ({ ...form, transferable_principle: event.target.value }))} /></label>
          <label><span>ليه الفكرة شغالة؟</span><textarea value={researchForm.why_it_works} onChange={(event) => setResearchForm((form) => ({ ...form, why_it_works: event.target.value }))} /></label>
          <label><span>3 زوايا أصلية — زاوية في كل سطر</span><textarea value={researchForm.original_angles} onChange={(event) => setResearchForm((form) => ({ ...form, original_angles: event.target.value }))} /></label>
          <label><span>ملاحظات أو فكرة عامة</span><textarea value={researchForm.raw_notes} onChange={(event) => setResearchForm((form) => ({ ...form, raw_notes: event.target.value }))} /></label>
          <label><span>Transcript — اختياري</span><textarea value={researchForm.transcript} onChange={(event) => setResearchForm((form) => ({ ...form, transcript: event.target.value }))} /></label>
          <div className="research-score-row"><label><span>إشارة الأداء</span><input type="number" min={0} max={100} value={researchForm.performance_signal} onChange={(event) => setResearchForm((form) => ({ ...form, performance_signal: event.target.value }))} /></label><label><span>ملاءمة البراند</span><input type="number" min={0} max={100} value={researchForm.brand_fit} onChange={(event) => setResearchForm((form) => ({ ...form, brand_fit: event.target.value }))} /></label><label><span>حداثة الفكرة</span><input type="number" min={0} max={100} value={researchForm.freshness} onChange={(event) => setResearchForm((form) => ({ ...form, freshness: event.target.value }))} /></label></div>
          <div className="form-actions"><Button type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={15} /> : <Lightbulb size={15} />} حفظ في الرادار</Button><Button type="button" variant="ghost" onClick={() => setShowCreateResearch(false)}>إلغاء</Button></div>
        </form> : null}
      </section>
      <div className="research-grid">{workspace.research.length ? workspace.research.map((item) => <article className={`research-card status-${item.status}`} key={item.id}><header><div><Radar size={17} /><div><span>{scriptResearchKindConfig[item.kind]}</span><h3>{item.title}</h3></div></div><StatusBadge tone={item.status === "used" ? "success" : item.status === "archived" ? "info" : "neutral"}>{item.status === "inbox" ? "وارد" : item.status === "selected" ? "مختار" : item.status === "used" ? "تحول لاسكريبت" : "مؤرشف"}</StatusBadge></header>{item.transferable_principle ? <div className="research-principle"><strong>المبدأ القابل للنقل</strong><p>{item.transferable_principle}</p></div> : null}{item.original_angles.length ? <ul>{item.original_angles.slice(0, 3).map((angle) => <li key={angle}>{angle}</li>)}</ul> : null}<footer><div>{item.source_url ? <a href={item.source_url} target="_blank" rel="noreferrer">فتح المصدر</a> : <span>فكرة داخلية</span>}<small>{personName(workspace.people, item.assigned_to)}</small></div>{item.status === "used" && item.linked_script_id ? <a className="button button-secondary" href={`/scripts/${item.linked_script_id}`}>فتح الاسكريبت</a> : item.status !== "archived" ? <Button type="button" disabled={saving} onClick={() => void convertResearch(item.id)}>حوّل لاسكريبت</Button> : null}</footer></article>) : emptyState(Lightbulb, "الرادار فارغ", "أضف رابط منافس أو فكرة أو مرجع مفيد، ثم استخرج منه زاوية أصلية.")}</div>
    </> : null}

    {tab === "voice" ? <VoiceProfileForm key={workspace.voice?.edit_version ?? 0} profile={workspace.voice} owner={owner} organizationId={workspace.organization.id} onSaved={refresh} /> : null}
  </section>;
}
