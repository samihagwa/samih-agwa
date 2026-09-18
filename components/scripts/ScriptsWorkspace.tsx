"use client";

import type { Session } from "@supabase/supabase-js";
import { FilePenLine, LoaderCircle, LockKeyhole, Plus, ShieldCheck, Sparkles, UsersRound } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { currentUuidDeepLink } from "../../lib/deep-links";
import { lines, scriptContentKindConfig, type ScriptContentKind, scriptDisplayStatus, scriptDraftStage, type WritableScriptStage, scriptInputModeConfig } from "../../lib/scripts";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Tables } from "../../lib/supabase/database.types";
import { useWorkspaceAuth } from "../../lib/supabase/use-workspace-auth";
import { Button } from "../ui/Button";
import { ScriptLibrary } from "./ScriptLibrary";
import { ScriptToolPanel } from "./ScriptToolPanel";
import { StatusBadge } from "../ui/StatusBadge";

type Membership = Tables<"memberships">;
type Organization = Tables<"organizations">;
type Script = Tables<"scripts">;
type Research = Tables<"script_research_items">;
type VoiceProfile = Tables<"script_voice_profiles">;
type VoiceSample = Tables<"script_voice_samples">;
type Task = Tables<"tasks">;
type Person = { id: string; name: string; role: Membership["role"] };
type Workspace = {
  organization: Organization;
  membership: Membership;
  people: Person[];
  scripts: Script[];
  research: Research[];
  voice: VoiceProfile | null;
  voiceSamples: VoiceSample[];
  productionTasks: Task[];
};
type Tab = "scripts" | "voice";
type ScriptStage = "idea" | "draft" | "ready_to_record" | "recorded" | "ready_to_publish" | "published" | "archived";
type ScriptFilter = "active" | ScriptStage | "all";

const scriptFilters: { value: ScriptFilter; label: string }[] = [
  { value: "active", label: "العمل الحالي" },
  { value: "idea", label: "فكرة" },
  { value: "draft", label: "قيد الكتابة" },
  { value: "ready_to_record", label: "جاهز للتصوير" },
  { value: "recorded", label: "تم التصوير" },
  { value: "ready_to_publish", label: "جاهز للنشر" },
  { value: "published", label: "تم النشر" },
  { value: "archived", label: "مؤرشف" },
  { value: "all", label: "الكل" },
];

const initialScriptForm = {
  title: "", content_kind: "educational" as ScriptContentKind, input_mode: "idea", source_text: "", objective: "",
  audience: "متداولون عرب", platform: "instagram", duration_seconds: "60", content_pillar: "",
};

function scriptCardStatus(script: Script, tasks: Task[]) {
  if (script.status !== "handed_off" || !script.content_item_id) return scriptDisplayStatus(script);
  const linked = tasks.filter((task) => task.content_item_id === script.content_item_id);
  const step = (name: Task["content_step"]) => linked.find((task) => task.content_step === name);
  const publishing = step("publishing"); const editing = step("editing"); const recording = step("recording");
  if (publishing?.status === "done") return { label: "تم النشر", tone: "success" as const };
  if (publishing && ["ready", "in_progress", "review"].includes(publishing.status)) return { label: "مرحلة النشر", tone: "warning" as const };
  if (editing?.status === "done") return { label: "تم المونتاج", tone: "success" as const };
  if (editing && ["ready", "in_progress", "review"].includes(editing.status)) return { label: "قيد المونتاج", tone: "info" as const };
  if (recording?.status === "done") return { label: "تم التصوير", tone: "success" as const };
  return { label: "بانتظار التصوير", tone: "info" as const };
}

function linkedStep(tasks: Task[], script: Script, step: Task["content_step"]) {
  if (!script.content_item_id) return undefined;
  return tasks.find((task) => task.content_item_id === script.content_item_id && task.content_step === step);
}

function scriptStage(script: Script, tasks: Task[]): ScriptStage {
  if (script.status === "archived") return "archived";
  if (script.status === "draft") return scriptDraftStage(script) === "idea" ? "idea" : "draft";
  if (script.status === "ready_to_record") return "ready_to_record";
  if (linkedStep(tasks, script, "publishing")?.status === "done") return "published";
  if (["ready", "in_progress", "review"].includes(linkedStep(tasks, script, "publishing")?.status ?? "")) return "ready_to_publish";
  if (linkedStep(tasks, script, "recording")?.status === "done") return "recorded";
  // A sent script awaiting recording stays visible without inventing a task state.
  return "ready_to_record";
}

function matchesScriptFilter(script: Script, tasks: Task[], filter: ScriptFilter) {
  if (filter === "all") return true;
  const stage = scriptStage(script, tasks);
  if (filter === "active") return !["published", "archived"].includes(stage);
  return stage === filter;
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

function VoiceProfileForm({ profile, samples, organizationId, onSaved, readOnly }: { profile: VoiceProfile | null; samples: VoiceSample[]; organizationId: string; onSaved: () => Promise<void>; readOnly: boolean }) {
  const [summary, setSummary] = useState(profile?.voice_summary ?? "");
  const [rules, setRules] = useState((profile?.writing_rules ?? []).join("\n"));
  const [banned, setBanned] = useState((profile?.banned_phrases ?? []).join("\n"));
  const [stories, setStories] = useState((profile?.story_bank ?? []).join("\n"));
  const [examples, setExamples] = useState(profile?.approved_examples ?? "");
  const [notes, setNotes] = useState(profile?.source_notes ?? "");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sampleId, setSampleId] = useState("");
  const [sampleText, setSampleText] = useState("");
  const [sampleKind, setSampleKind] = useState<ScriptContentKind>("educational");
  const [sampleEnabled, setSampleEnabled] = useState(true);

  async function saveSample(event: FormEvent) {
    event.preventDefault(); if (readOnly) return;
    setSaving(true); setNotice(null);
    try {
      await invokeCommand({ action: "manage_voice_sample", organization_id: organizationId,
        sample_id: sampleId || null, content_kind: sampleKind, sample_text: sampleText, active: sampleEnabled });
      setSampleId(""); setSampleText(""); setSampleEnabled(true);
      setNotice("تم حفظ المثال بتصنيفه. لن يستخدمه AI إلا عند كتابة نفس النوع، وفقط لو كان مفعّلًا.");
      await onSaved();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "تعذّر حفظ المثال."); }
    finally { setSaving(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (readOnly) return;
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
    <div className="section-heading"><div><p className="overline">بصمتي الخاصة</p><h2>كيف أكتب وأتكلم أنا؟</h2><p>ملف شخصي محمي بالصلاحيات؛ لا يراه أي عضو آخر، ولا تظهر لك بصمات الفريق.</p></div><StatusBadge tone="success">خاص بك فقط</StatusBadge></div>
    <aside className="script-trust-note"><ShieldCheck size={18} /><div><strong>الـAI لا يتعلم وحده من الإنترنت</strong><p>يستخدم هذه البصمة ومراجع البراند المعتمدة فقط عند ضغطك على زر التوليد. لا يوجد Apify أو سحب منافسين تلقائي في هذه المرحلة.</p></div></aside>
    <form className="voice-profile-form" onSubmit={(event) => void submit(event)}>
      <label className="span-2"><span>ملخص صوتك وشخصيتك</span><textarea disabled={readOnly} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="طبيعي، مباشر، عملي، وطريقتي في شرح الفكرة..." /></label>
      <label><span>قواعد كتابتي — قاعدة في كل سطر</span><textarea disabled={readOnly} value={rules} onChange={(event) => setRules(event.target.value)} placeholder={"ابدأ بهوك يلمس مشكلة حقيقية\nمثال قبل الشرح النظري"} /></label>
      <label><span>كلمات وعبارات لا أستخدمها</span><textarea disabled={readOnly} value={banned} onChange={(event) => setBanned(event.target.value)} placeholder={"عبارة لا تشبهني\nوعد لا أقوله"} /></label>
      <label><span>بنك قصصي — موقف في كل سطر</span><textarea disabled={readOnly} value={stories} onChange={(event) => setStories(event.target.value)} placeholder="مواقف شخصية حقيقية يمكن الرجوع لها..." /></label>
      <label><span>مصادر تعلّمي وملاحظاتي</span><textarea disabled={readOnly} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="المراجع التي تمثل منهجي وما لا يجب نسبه لي..." /></label>
      <label className="span-2"><span>أمثلة قديمة غير مصنفة — محفوظة كما هي</span><textarea className="voice-examples" disabled={readOnly} value={examples} onChange={(event) => setExamples(event.target.value)} placeholder="أمثلتك القديمة محفوظة هنا." /><small>الأمثلة القديمة لم نغيّر تصنيفها تلقائيًا، ولا تُرسل لـAI حتى تنسخ المثال المناسب إلى الأمثلة المصنفة أدناه.</small></label>
      {notice ? <p className={`form-notice ${notice.startsWith("تم") ? "success" : "error"}`}>{notice}</p> : null}
      {!readOnly ? <div className="form-actions"><Button type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />} حفظ بصمتي الخاصة</Button></div> : null}
    </form>
    <div className="script-voice-sample-list"><h3>الأمثلة المصنفة</h3>{samples.length ? samples.map((sample) => {
      const conflicts = (profile?.banned_phrases ?? []).filter((phrase) => sample.sample_text.toLocaleLowerCase().includes(phrase.toLocaleLowerCase()));
      return <article key={sample.id}><strong>{scriptContentKindConfig[sample.content_kind as ScriptContentKind] ?? sample.content_kind} · {sample.active ? "مفعّل" : "مستبعد"}</strong><p>{sample.sample_text.slice(0, 350)}</p>{conflicts.length ? <small className="form-notice error">قد يتعارض مع كلمات ممنوعة في قواعدك: {conflicts.join("، ")}. القاعدة الحديثة تتقدم على المثال؛ راجعه بنفسك.</small> : null}{!readOnly ? <Button type="button" variant="ghost" onClick={() => { setSampleId(sample.id); setSampleText(sample.sample_text); setSampleKind(sample.content_kind as ScriptContentKind); setSampleEnabled(sample.active); }}>تعديل التصنيف أو الاستبعاد</Button> : null}</article>;
    }) : <p>لم تصنف أي مثال بعد. اختر مثالًا حقيقيًا من كتابتك وحدد نوعه بنفسك.</p>}</div>
    {!readOnly ? <form className="script-voice-sample-form" onSubmit={(event) => void saveSample(event)}><label><span>نوع المثال</span><select value={sampleKind} onChange={(event) => setSampleKind(event.target.value as ScriptContentKind)}>{Object.entries(scriptContentKindConfig).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="span-2"><span>{sampleId ? "تعديل المثال" : "إضافة مثال من كتابتك"}</span><textarea required minLength={20} maxLength={5000} value={sampleText} onChange={(event) => setSampleText(event.target.value)} /></label><label className="script-sample-active"><input type="checkbox" checked={sampleEnabled} onChange={(event) => setSampleEnabled(event.target.checked)} /> استخدم المثال في التوليد</label><Button type="submit" disabled={saving || sampleText.trim().length < 20}>{sampleId ? "حفظ التعديل" : "اعتماد المثال"}</Button>{sampleId ? <Button type="button" variant="ghost" onClick={() => { setSampleId(""); setSampleText(""); setSampleEnabled(true); }}>إلغاء</Button> : null}</form> : null}
  </section>;
}

export function ScriptsWorkspace() {
  const configured = isSupabaseConfigured();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [linkedResearchId] = useState(() => currentUuidDeepLink("research", "research"));
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return "scripts";
    const requested = new URL(window.location.href).searchParams.get("tab");
    return requested === "voice" ? "voice" : "scripts";
  });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ScriptFilter>("all");
  const [showCreateScript, setShowCreateScript] = useState(false);
  const [createStage, setCreateStage] = useState<WritableScriptStage>("idea");
  const [createText, setCreateText] = useState("");
  const createInFlight = useRef(false);
  const [scriptForm, setScriptForm] = useState(initialScriptForm);
  const [saving, setSaving] = useState(false);
  const [workingScriptId, setWorkingScriptId] = useState<string | null>(null);
  const openedResearchLink = useRef<string | null>(null);

  const clearWorkspace = useCallback(() => setWorkspace(null), []);
  const clearTransientState = useCallback(() => { setError(null); setNotice(null); }, []);

  const loadRows = useCallback(async (base: Omit<Workspace, "scripts" | "research" | "voice" | "voiceSamples" | "productionTasks">) => {
    const supabase = getSupabaseBrowserClient();
    const [scriptsResult, researchResult, voiceResult, voiceSamplesResult] = await Promise.all([
      supabase.from("scripts").select("*").eq("organization_id", base.organization.id).order("updated_at", { ascending: false }),
      supabase.from("script_research_items").select("*").eq("organization_id", base.organization.id).eq("assigned_to", base.membership.user_id).order("updated_at", { ascending: false }),
      supabase.from("script_voice_profiles").select("*").eq("organization_id", base.organization.id).eq("user_id", base.membership.user_id).maybeSingle(),
      supabase.from("script_voice_samples").select("*").eq("organization_id", base.organization.id).eq("owner_id", base.membership.user_id).order("updated_at", { ascending: false }),
    ]);
    if (scriptsResult.error) throw scriptsResult.error;
    if (researchResult.error) throw researchResult.error;
    if (voiceResult.error) throw voiceResult.error;
    if (voiceSamplesResult.error) throw voiceSamplesResult.error;
    const scripts = scriptsResult.data ?? [];
    const contentIds = scripts.map((script) => script.content_item_id).filter((id): id is string => Boolean(id));
    const tasksResult = contentIds.length
      ? await supabase.from("tasks").select("*").in("content_item_id", contentIds)
      : { data: [], error: null };
    if (tasksResult.error) throw tasksResult.error;
    setWorkspace({ ...base, scripts, research: researchResult.data ?? [], voice: voiceResult.data, voiceSamples: voiceSamplesResult.data ?? [], productionTasks: tasksResult.data ?? [] });
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
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "تعذّر تحميل استوديو الاسكريبتات."); }
    finally { setLoading(false); }
  }, [clearWorkspace, loadRows]);

  const session = useWorkspaceAuth({ configured, loadWorkspace, clearWorkspace, setLoading, clearTransientState });
  const canWriteScripts = Boolean(workspace && workspace.membership.role !== "viewer");

  useEffect(() => {
    if (!linkedResearchId || openedResearchLink.current === linkedResearchId || !workspace?.research.some((item) => item.id === linkedResearchId)) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(`research-${linkedResearchId}`);
      if (!target) return;
      openedResearchLink.current = linkedResearchId;
      target.scrollIntoView({ block: "center" });
      target.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [linkedResearchId, workspace]);
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
      const matchesStatus = matchesScriptFilter(script, workspace.productionTasks, statusFilter);
      return matchesSearch && matchesStatus;
    });
  }, [search, statusFilter, workspace]);

  const scriptFilterCounts = useMemo(() => {
    const counts = new Map<ScriptFilter, number>();
    if (!workspace) return counts;
    for (const filter of scriptFilters) {
      counts.set(filter.value, workspace.scripts.filter((script) => matchesScriptFilter(script, workspace.productionTasks, filter.value)).length);
    }
    return counts;
  }, [workspace]);

  async function createScript(event: FormEvent) {
    event.preventDefault(); if (!workspace || !session || !canWriteScripts || createInFlight.current) return;
    createInFlight.current = true;
    const requestText = scriptForm.source_text.trim();
    setSaving(true); setError(null); setNotice(null);
    try {
      const { data: createdId, error: createError } = await getSupabaseBrowserClient().rpc("create_board_script", {
        organization: workspace.organization.id, title: scriptForm.title, stage: createStage,
        script_text: createText, kind: scriptForm.content_kind, source_text: requestText,
        duration: Number(scriptForm.duration_seconds), input_mode: scriptForm.input_mode as Script["input_mode"],
      });
      if (createError) throw createError;
      setScriptForm(initialScriptForm); setShowCreateScript(false);
      const id = createdId ?? "";
      setNotice("تم إنشاء المسودة بنسختها الأولى.");
      if (id) { window.location.assign(`/scripts/${id}`); return; }
      await refresh();
    } catch (createError) { setError(createError instanceof Error ? createError.message : "تعذّر إنشاء الاسكريبت."); }
    finally { createInFlight.current = false; setSaving(false); }
  }

  async function changeScriptStatus(script: Script, status: WritableScriptStage) {
    if (!canWriteScripts) return;
    setWorkingScriptId(script.id); setError(null); setNotice(null);
    try {
      const { error: moveError } = await getSupabaseBrowserClient().rpc("move_script_card", { target_script_id: script.id, expected_version: script.edit_version, destination: status });
      if (moveError) throw moveError;
      setNotice(status === "archived" ? "تم نقل الاسكريبت إلى الأرشيف."
        : status === "ready_to_record" ? "تم نقل الاسكريبت إلى جاهز للتصوير."
        : status === "idea" ? "تم نقل السكريبت إلى الأفكار." : "تم نقل الاسكريبت إلى قيد الكتابة.");
      await refresh();
    } catch (statusError) { setError(statusError instanceof Error ? statusError.message : "تعذّر تغيير حالة الاسكريبت."); }
    finally { setWorkingScriptId(null); }
  }

  async function deleteScript(script: Script) {
    if (!canWriteScripts) return;
    if (!window.confirm(`حذف «${script.title}» نهائيًا؟\n\nلن يمكن استرجاع النص أو نسخه المحفوظة بعد الحذف.`)) return;
    setWorkingScriptId(script.id); setError(null); setNotice(null);
    try {
      await invokeCommand({ action: "delete_script", script_id: script.id, expected_edit_version: script.edit_version });
      setNotice("تم حذف الاسكريبت المؤرشف نهائيًا.");
      await refresh();
    } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : "تعذّر حذف الاسكريبت."); }
    finally { setWorkingScriptId(null); }
  }

  async function convertResearch(id: string) {
    if (!canWriteScripts) return;
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

  return <section className="scripts-workspace script-library-workspace">
    <details className="script-privacy-note"><summary><ShieldCheck size={14} /> الخصوصية</summary><p>اسكريبتاتك خاصة بك؛ وقد يظهر هنا اسكريبت شاركه صاحبه معك للمراجعة فقط. البصمة لا تنتقل بالمشاركة.</p></details>
    <div className="scripts-tabs" role="tablist" aria-label="أقسام استوديو الاسكريبتات">
      <button type="button" role="tab" aria-selected={tab === "scripts"} className={tab === "scripts" ? "active" : ""} onClick={() => setTab("scripts")}><FilePenLine size={16} /> اسكريبتاتي</button>
      <button type="button" role="tab" aria-selected={tab === "voice"} className={tab === "voice" ? "active" : ""} onClick={() => setTab("voice")}><Sparkles size={16} /> بصمتي</button>
    </div>
    {error ? <p className="form-notice error">{error}</p> : null}
    {notice ? <p className="form-notice success">{notice}</p> : null}
    {!canWriteScripts ? <aside className="script-readonly-note"><ShieldCheck size={18} /><div><strong>صلاحية مشاهدة فقط</strong><p>يمكنك قراءة محتواك، لكن إنشاء الاسكريبتات أو تعديلها أو استخدام AI أو تغيير الحالات غير متاح لحساب viewer.</p></div></aside> : null}
    {linkedResearchId && workspace.research.some((item) => item.id === linkedResearchId) ? <p className="direct-link-notice" role="status">تم فتح الفكرة المطلوبة. {workspace.research.find((item) => item.id === linkedResearchId)?.linked_script_id ? <a href={`/scripts/${workspace.research.find((item) => item.id === linkedResearchId)?.linked_script_id}`}>فتح السكريبت المرتبط</a> : null}</p> : linkedResearchId ? <p className="form-notice error">العنصر المطلوب غير موجود أو ليس ضمن صلاحيات حسابك.</p> : null}

    {tab === "scripts" ? <ScriptLibrary
      scripts={filteredScripts} tasks={workspace.productionTasks} userId={workspace.membership.user_id}
      canWrite={canWriteScripts} search={search} onSearch={setSearch}
      filters={scriptFilters} statusFilter={statusFilter} onFilter={setStatusFilter}
      counts={scriptFilterCounts} stageOf={scriptStage} statusOf={scriptCardStatus}
      workingId={workingScriptId} onStatus={changeScriptStatus} onDelete={deleteScript}
      ideaItems={workspace.research.filter((item) => !item.linked_script_id && ["inbox", "selected"].includes(item.status)).map((item) => <article className="script-board-card" key={item.id} id={`research-${item.id}`} data-direct-target={linkedResearchId === item.id || undefined} tabIndex={-1}><strong>{item.title}</strong><Button type="button" variant="ghost" disabled={saving || !canWriteScripts} onClick={() => void convertResearch(item.id)}>فتح الفكرة للكتابة</Button></article>)}
      onCreate={(stage = "idea") => { setError(null); setNotice(null); setCreateStage(stage); setCreateText(""); setShowCreateScript(true); }}
      createForm={showCreateScript && canWriteScripts ? <ScriptToolPanel title="صفحة سكريبت جديدة" error={error} notice={notice} onClose={() => { if (!saving) setShowCreateScript(false); }}><form className="script-inline-create" onSubmit={(event) => void createScript(event)} aria-busy={saving}>
        <div className="script-inline-create-main"><Plus size={18} /><input ref={(node) => { if (node && !saving && !node.value) node.focus(); }} aria-label="فكرة السكريبت الجديد" required minLength={5} maxLength={180} value={scriptForm.title} onChange={(event) => setScriptForm((form) => ({ ...form, title: event.target.value }))} placeholder="اكتب فكرة السكريبت…" disabled={saving} /><Button type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={16} /> : null} إنشاء</Button><Button type="button" variant="ghost" disabled={saving} onClick={() => setShowCreateScript(false)}>إلغاء</Button></div>
        <p>صفحة جديدة في: {scriptFilters.find((filter) => filter.value === createStage)?.label}</p>
        {createStage === "ready_to_record" ? <label>نص السكريبت الجاهز<textarea required minLength={20} maxLength={30000} value={createText} onChange={(event) => setCreateText(event.target.value)} /></label> : null}
        <details className="script-create-properties"><summary>خصائص ومرجع — اختياري</summary><div className="script-fields-grid">
          <label><span>النوع</span><select value={scriptForm.content_kind} onChange={(event) => setScriptForm((form) => ({ ...form, content_kind: event.target.value as ScriptContentKind }))}>{Object.entries(scriptContentKindConfig).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span>المدة بالثواني</span><input type="number" min={10} max={1800} value={scriptForm.duration_seconds} onChange={(event) => setScriptForm((form) => ({ ...form, duration_seconds: event.target.value }))} /></label>
          <label className="span-2"><span>كل المطلوب والروابط</span><textarea className="script-request-textarea" maxLength={30000} value={scriptForm.source_text} onChange={(event) => setScriptForm((form) => ({ ...form, source_text: event.target.value }))} /></label>
          <label><span>طريقة البداية</span><select value={scriptForm.input_mode} onChange={(event) => setScriptForm((form) => ({ ...form, input_mode: event.target.value }))}>{Object.entries(scriptInputModeConfig).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div></details>
      </form></ScriptToolPanel> : null}
    /> : null}


    {tab === "voice" ? <VoiceProfileForm key={workspace.voice?.edit_version ?? 0} profile={workspace.voice} samples={workspace.voiceSamples} organizationId={workspace.organization.id} onSaved={refresh} readOnly={!canWriteScripts} /> : null}
  </section>;
}
