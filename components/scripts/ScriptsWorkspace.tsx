"use client";

import type { Session } from "@supabase/supabase-js";
import { Archive, Bot, CheckCircle2, FilePenLine, Lightbulb, LoaderCircle, LockKeyhole, Plus, Radar, RefreshCw, Search, ShieldCheck, Sparkles, Trash2, UserRound, UsersRound } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { currentUuidDeepLink } from "../../lib/deep-links";
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
type Task = Tables<"tasks">;
type Person = { id: string; name: string; role: Membership["role"] };
type ScriptVariant = { label: string; hook: string; spoken_script: string; cta: string };
type Workspace = {
  organization: Organization;
  membership: Membership;
  people: Person[];
  scripts: Script[];
  research: Research[];
  voice: VoiceProfile | null;
  productionTasks: Task[];
};
type Tab = "scripts" | "radar" | "voice";
type ScriptStage = "idea" | "draft" | "ready_to_record" | "production" | "recorded" | "ready_to_publish" | "published" | "archived";
type ScriptFilter = "active" | ScriptStage | "all";

const scriptFilters: { value: ScriptFilter; label: string }[] = [
  { value: "active", label: "العمل الحالي" },
  { value: "idea", label: "فكرة" },
  { value: "draft", label: "قيد الكتابة" },
  { value: "ready_to_record", label: "جاهز للتصوير" },
  { value: "production", label: "قيد التنفيذ" },
  { value: "recorded", label: "تم التصوير" },
  { value: "ready_to_publish", label: "جاهز للنشر" },
  { value: "published", label: "تم النشر" },
  { value: "archived", label: "مؤرشف" },
  { value: "all", label: "الكل" },
];

const initialScriptForm = {
  title: "", input_mode: "idea", source_text: "", objective: "",
  audience: "متداولون عرب", platform: "instagram", duration_seconds: "60", content_pillar: "",
};

function personName(people: Person[], id: string) {
  return people.find((person) => person.id === id)?.name ?? "عضو فريق";
}

function scriptCardStatus(script: Script, tasks: Task[]) {
  if (script.status !== "handed_off" || !script.content_item_id) return scriptStatusConfig[script.status];
  const linked = tasks.filter((task) => task.content_item_id === script.content_item_id);
  const step = (name: Task["content_step"]) => linked.find((task) => task.content_step === name);
  const publishing = step("publishing"); const editing = step("editing"); const recording = step("recording");
  if (publishing?.status === "done") return { label: "تم النشر", tone: "success" as const };
  if (publishing && ["ready", "in_progress", "review"].includes(publishing.status)) return { label: "مرحلة النشر", tone: "warning" as const };
  if (editing?.status === "done") return { label: "تم المونتاج", tone: "success" as const };
  if (editing && ["ready", "in_progress", "review"].includes(editing.status)) return { label: "قيد المونتاج", tone: "info" as const };
  if (recording?.status === "done") return { label: "تم التصوير", tone: "success" as const };
  return { label: "قيد التنفيذ", tone: "info" as const };
}

function linkedStep(tasks: Task[], script: Script, step: Task["content_step"]) {
  if (!script.content_item_id) return undefined;
  return tasks.find((task) => task.content_item_id === script.content_item_id && task.content_step === step);
}

function scriptStage(script: Script, tasks: Task[]): ScriptStage {
  if (script.status === "archived") return "archived";
  if (script.status === "draft") return script.spoken_script.trim().length < 20 ? "idea" : "draft";
  if (script.status === "ready_to_record") return "ready_to_record";
  if (linkedStep(tasks, script, "publishing")?.status === "done") return "published";
  if (["ready", "in_progress", "review"].includes(linkedStep(tasks, script, "publishing")?.status ?? "")) return "ready_to_publish";
  if (linkedStep(tasks, script, "recording")?.status === "done") return "recorded";
  return "production";
}

function matchesScriptFilter(script: Script, tasks: Task[], filter: ScriptFilter) {
  if (filter === "all") return true;
  const stage = scriptStage(script, tasks);
  if (filter === "active") return !["published", "archived"].includes(stage);
  return stage === filter;
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

async function invokeScriptAi(body: Record<string, unknown>) {
  const { data, error } = await getSupabaseBrowserClient().functions.invoke("script-ai", { body });
  if (error) {
    const context = error.context as Response | undefined;
    if (context) {
      try { const payload = await context.clone().json() as { message?: string }; if (payload.message) throw new Error(payload.message); }
      catch (parseError) { if (parseError instanceof Error && !/JSON|Unexpected|body stream/i.test(parseError.message)) throw parseError; }
    }
    throw error;
  }
  return data as Record<string, unknown>;
}

function VoiceProfileForm({ profile, organizationId, onSaved, readOnly }: { profile: VoiceProfile | null; organizationId: string; onSaved: () => Promise<void>; readOnly: boolean }) {
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
    <div className="section-heading"><div><p className="overline">بصمتي الخاصة</p><h2>كيف أكتب وأتكلم أنا؟</h2><p>ملف شخصي مشفّر بالصلاحيات؛ لا يراه أي عضو آخر، ولا تظهر لك بصمة سميح أو بصمات الفريق.</p></div><StatusBadge tone="success">خاص بك فقط</StatusBadge></div>
    <aside className="script-trust-note"><ShieldCheck size={18} /><div><strong>الـAI لا يتعلم وحده من الإنترنت</strong><p>يستخدم هذه البصمة ومراجع البراند المعتمدة فقط عند ضغطك على زر التوليد. لا يوجد Apify أو سحب منافسين تلقائي في هذه المرحلة.</p></div></aside>
    <form className="voice-profile-form" onSubmit={(event) => void submit(event)}>
      <label className="span-2"><span>ملخص صوتك وشخصيتك</span><textarea disabled={readOnly} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="طبيعي، مباشر، عملي، وطريقتي في شرح الفكرة..." /></label>
      <label><span>قواعد كتابتي — قاعدة في كل سطر</span><textarea disabled={readOnly} value={rules} onChange={(event) => setRules(event.target.value)} placeholder={"ابدأ بهوك يلمس مشكلة حقيقية\nمثال قبل الشرح النظري"} /></label>
      <label><span>كلمات وعبارات لا أستخدمها</span><textarea disabled={readOnly} value={banned} onChange={(event) => setBanned(event.target.value)} placeholder={"عبارة لا تشبهني\nوعد لا أقوله"} /></label>
      <label><span>بنك قصصي — موقف في كل سطر</span><textarea disabled={readOnly} value={stories} onChange={(event) => setStories(event.target.value)} placeholder="مواقف شخصية حقيقية يمكن الرجوع لها..." /></label>
      <label><span>مصادر تعلّمي وملاحظاتي</span><textarea disabled={readOnly} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="المراجع التي تمثل منهجي وما لا يجب نسبه لي..." /></label>
      <label className="span-2"><span>أمثلة معتمدة من كتابتي</span><textarea className="voice-examples" disabled={readOnly} value={examples} onChange={(event) => setExamples(event.target.value)} placeholder="أضف نصوصًا حقيقية كتبتها، أو اعتمد اسكريبتًا من محرره بعد تعديله يدويًا." /><small>الـAI يستخدم أمثلتك أنت فقط عند توليد اسكريبت مسند إليك.</small></label>
      {notice ? <p className={`form-notice ${notice.startsWith("تم") ? "success" : "error"}`}>{notice}</p> : null}
      {!readOnly ? <div className="form-actions"><Button type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />} حفظ بصمتي الخاصة</Button></div> : null}
    </form>
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
    return new URL(window.location.href).searchParams.get("tab") === "radar" || currentUuidDeepLink("research", "research") ? "radar" : "scripts";
  });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ScriptFilter>("active");
  const [showCreateScript, setShowCreateScript] = useState(false);
  const [showCreateResearch, setShowCreateResearch] = useState(false);
  const [scriptForm, setScriptForm] = useState(initialScriptForm);
  const [researchForm, setResearchForm] = useState({ kind: "idea", title: "", source_url: "", raw_notes: "", transcript: "", hook: "", transferable_principle: "", why_it_works: "", original_angles: "", performance_signal: "", brand_fit: "", freshness: "" });
  const [saving, setSaving] = useState(false);
  const [workingScriptId, setWorkingScriptId] = useState<string | null>(null);
  const [researchAiLoading, setResearchAiLoading] = useState<string | null>(null);
  const [researchPreview, setResearchPreview] = useState<{ researchId: string; variants: ScriptVariant[]; hooks: string[] } | null>(null);
  const [researchAiDirection, setResearchAiDirection] = useState("");
  const openedResearchLink = useRef<string | null>(null);

  const clearWorkspace = useCallback(() => setWorkspace(null), []);
  const clearTransientState = useCallback(() => { setError(null); setNotice(null); }, []);

  const loadRows = useCallback(async (base: Omit<Workspace, "scripts" | "research" | "voice" | "productionTasks">) => {
    const supabase = getSupabaseBrowserClient();
    const [scriptsResult, researchResult, voiceResult] = await Promise.all([
      supabase.from("scripts").select("*").eq("organization_id", base.organization.id).eq("assigned_to", base.membership.user_id).order("updated_at", { ascending: false }),
      supabase.from("script_research_items").select("*").eq("organization_id", base.organization.id).eq("assigned_to", base.membership.user_id).order("updated_at", { ascending: false }),
      supabase.from("script_voice_profiles").select("*").eq("organization_id", base.organization.id).eq("user_id", base.membership.user_id).maybeSingle(),
    ]);
    if (scriptsResult.error) throw scriptsResult.error;
    if (researchResult.error) throw researchResult.error;
    if (voiceResult.error) throw voiceResult.error;
    const scripts = scriptsResult.data ?? [];
    const contentIds = scripts.map((script) => script.content_item_id).filter((id): id is string => Boolean(id));
    const tasksResult = contentIds.length
      ? await supabase.from("tasks").select("*").in("content_item_id", contentIds)
      : { data: [], error: null };
    if (tasksResult.error) throw tasksResult.error;
    setWorkspace({ ...base, scripts, research: researchResult.data ?? [], voice: voiceResult.data, productionTasks: tasksResult.data ?? [] });
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
    event.preventDefault(); if (!workspace || !session || !canWriteScripts) return;
    const requestText = scriptForm.source_text.trim();
    if (requestText.length < 10) {
      setError("اكتب كل المطلوب والروابط بوضوح؛ النص لازم يكون 10 حروف على الأقل.");
      return;
    }
    const objective = scriptForm.objective.trim() || requestText.slice(0, 1000);
    setSaving(true); setError(null); setNotice(null);
    try {
      const result = await invokeCommand({
        action: "create_script",
        organization_id: workspace.organization.id,
        assigned_to: session.user.id,
        ...scriptForm,
        source_url: "",
        source_text: requestText,
        objective,
        duration_seconds: Number(scriptForm.duration_seconds),
      });
      setScriptForm(initialScriptForm); setShowCreateScript(false);
      await refresh();
      const id = String(result.scriptId ?? "");
      setNotice("تم إنشاء المسودة بنسختها الأولى.");
      if (id) window.location.assign(`/scripts/${id}`);
    } catch (createError) { setError(createError instanceof Error ? createError.message : "تعذّر إنشاء الاسكريبت."); }
    finally { setSaving(false); }
  }

  async function changeScriptStatus(script: Script, status: "draft" | "ready_to_record" | "archived") {
    if (!canWriteScripts) return;
    setWorkingScriptId(script.id); setError(null); setNotice(null);
    try {
      await invokeCommand({ action: "change_status", script_id: script.id, expected_edit_version: script.edit_version, status });
      setNotice(status === "archived" ? "تم نقل الاسكريبت إلى الأرشيف."
        : status === "ready_to_record" ? "تم نقل الاسكريبت إلى جاهز للتصوير."
        : "تم نقل الاسكريبت إلى قيد الكتابة.");
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

  async function createResearch(event: FormEvent) {
    event.preventDefault(); if (!workspace || !session || !canWriteScripts) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      await invokeCommand({ action: "create_research", organization_id: workspace.organization.id, assigned_to: session.user.id, ...researchForm, original_angles: lines(researchForm.original_angles) });
      setResearchForm({ kind: "idea", title: "", source_url: "", raw_notes: "", transcript: "", hook: "", transferable_principle: "", why_it_works: "", original_angles: "", performance_signal: "", brand_fit: "", freshness: "" });
      setShowCreateResearch(false); setNotice("تم حفظ العنصر في الرادار اليدوي."); await refresh();
    } catch (createError) { setError(createError instanceof Error ? createError.message : "تعذّر حفظ الفكرة."); }
    finally { setSaving(false); }
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

  async function generateResearchPreview(item: Research) {
    if (!canWriteScripts) return;
    setResearchAiLoading(item.id); setError(null); setNotice(null);
    try {
      const result = await invokeScriptAi({
        research_id: item.id, scope: "script_variants", mode: item.source_url ? "reference" : "idea",
        generation_direction: researchPreview?.researchId === item.id ? researchAiDirection : "",
      });
      const generated = result.generated as { variants?: ScriptVariant[]; hook_variants?: string[] } | undefined;
      const variants = Array.isArray(generated?.variants) ? generated.variants : [];
      const quality = result.quality as { removed_variants?: number; removed_hooks?: number } | undefined;
      const removedVariants = Number(quality?.removed_variants ?? 0);
      const removedHooks = Number(quality?.removed_hooks ?? 0);
      setResearchPreview({
        researchId: item.id,
        variants,
        hooks: Array.isArray(generated?.hook_variants) ? generated.hook_variants : [],
      });
      const guardNotice = removedVariants || removedHooks
        ? ` الحارس استبعد ${removedVariants ? `${removedVariants} نسخة` : ""}${removedVariants && removedHooks ? " و" : ""}${removedHooks ? `${removedHooks} هوك` : ""} لعدم مطابقتها، من غير طلب إضافي.`
        : "";
      setNotice(`عدد البدائل السليمة: ${variants.length}. دي معاينة فقط؛ الفكرة مازالت في مكانها ولم يُنشأ أي اسكريبت.${guardNotice}`);
    } catch (previewError) { setError(previewError instanceof Error ? previewError.message : "تعذّر توليد معاينة الفكرة."); }
    finally { setResearchAiLoading(null); }
  }

  async function saveResearchVariant(item: Research, variant: ScriptVariant) {
    if (!canWriteScripts) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      const result = await invokeCommand({
        action: "research_variant_to_script", research_id: item.id,
        hook_variants: lines(`${variant.hook}\n${researchPreview?.hooks.join("\n") ?? ""}`),
        spoken_script: variant.spoken_script, cta: variant.cta,
      });
      const scriptId = String(result.scriptId ?? "");
      setResearchPreview(null); await refresh();
      if (scriptId) window.location.assign(`/scripts/${scriptId}`);
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "تعذّر حفظ النسخة المختارة."); }
    finally { setSaving(false); }
  }

  if (loading) return <section className="workspace-state"><LoaderCircle className="spin" size={24} /><div><h2>جارٍ فتح الاستوديو</h2><p>نحمّل اسكريبتاتك الخاصة وبنك الأفكار.</p></div></section>;
  if (!session) return <section className="workspace-state workspace-onboarding"><LockKeyhole size={27} /><div><h2>سجّل الدخول أولًا</h2><p>الاسكريبتات خاصة ومحمية بحساب كل عضو.</p></div><Button href="/tasks">تسجيل الدخول</Button></section>;
  if (!workspace) return <section className="workspace-state"><UsersRound size={27} /><div><h2>لا توجد مساحة عمل</h2><p>أنشئ مساحة الشركة من قسم المهام أولًا.</p></div></section>;

  return <section className="scripts-workspace">
    <div className="scripts-tabs" role="tablist" aria-label="أقسام استوديو الاسكريبتات">
      <button type="button" role="tab" aria-selected={tab === "scripts"} className={tab === "scripts" ? "active" : ""} onClick={() => setTab("scripts")}><FilePenLine size={16} /> اسكريبتاتي</button>
      <button type="button" role="tab" aria-selected={tab === "radar"} className={tab === "radar" ? "active" : ""} onClick={() => setTab("radar")}><Radar size={16} /> الأفكار والرادار</button>
      <button type="button" role="tab" aria-selected={tab === "voice"} className={tab === "voice" ? "active" : ""} onClick={() => setTab("voice")}><Sparkles size={16} /> بصمتي</button>
    </div>
    {error ? <p className="form-notice error">{error}</p> : null}
    {notice ? <p className="form-notice success">{notice}</p> : null}
    {!canWriteScripts ? <aside className="script-readonly-note"><ShieldCheck size={18} /><div><strong>صلاحية مشاهدة فقط</strong><p>يمكنك قراءة محتواك، لكن إنشاء الاسكريبتات أو تعديلها أو استخدام AI أو تغيير الحالات غير متاح لحساب viewer.</p></div></aside> : null}
    {linkedResearchId && workspace.research.some((item) => item.id === linkedResearchId) ? <p className="direct-link-notice" role="status"><Radar size={15} /> تم فتح الفكرة أو البحث المطلوب مباشرة.</p> : linkedResearchId ? <p className="form-notice error">العنصر المطلوب غير موجود أو ليس ضمن صلاحيات حسابك.</p> : null}

    {tab === "scripts" ? <>
      <section className="panel scripts-control-panel">
        <div className="section-heading"><div><p className="overline">المساحة الخاصة</p><h2>اسكريبتاتي</h2><p>لا يستطيع أي عضو آخر، بما في ذلك مدير المنصة، فتح اسكريبتاتك أو بصمتك. عند التسليم فقط تُنشأ منه نسخة مشتركة داخل طلبات التنفيذ.</p></div>{canWriteScripts ? <Button type="button" onClick={() => setShowCreateScript((value) => !value)}><Plus size={15} /> اسكريبت جديد</Button> : null}</div>
        <div className="scripts-filters">
          <label className="search-field"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث في العنوان أو النص أو الكابشن..." /></label>
          <div className="script-status-filters" role="group" aria-label="تصفية الاسكريبتات حسب الحالة">
            {scriptFilters.map((filter) => <button
              key={filter.value}
              type="button"
              aria-pressed={statusFilter === filter.value}
              className={statusFilter === filter.value ? "active" : ""}
              onClick={() => setStatusFilter(filter.value)}
              title={["recorded", "ready_to_publish", "published"].includes(filter.value) ? "تتحدث تلقائيًا من مهام التنفيذ المرتبطة" : undefined}
            >{filter.label}<span>{(scriptFilterCounts.get(filter.value) ?? 0).toLocaleString("ar-EG")}</span></button>)}
          </div>
          <small className="script-filter-note">«تم التصوير» و«جاهز للنشر» و«تم النشر» تتحدث تلقائيًا من مهام التنفيذ؛ لا يغيّرها أي عضو يدويًا.</small>
        </div>
        {showCreateScript && canWriteScripts ? <form className="script-create-form" onSubmit={(event) => void createScript(event)}>
          <label className="span-2"><span>عنوان الاسكريبت</span><input required minLength={3} maxLength={180} value={scriptForm.title} onChange={(event) => setScriptForm((form) => ({ ...form, title: event.target.value }))} placeholder="مثال: ليه بتتوتر وإنت كسبان؟" /></label>
          <label className="span-2"><span>كل المطلوب والروابط</span><textarea className="script-request-textarea" required minLength={10} maxLength={30000} rows={14} value={scriptForm.source_text} onChange={(event) => setScriptForm((form) => ({ ...form, source_text: event.target.value }))} placeholder="اكتب الفكرة، المطلوب، ملاحظاتك، وأي روابط في نفس الخانة…" /><small>النص والروابط سيظلان معًا كما كتبتهما، وهما المرجع الأساسي للاسكريبت.</small></label>
          <details className="content-request-advanced span-2">
            <summary>إعدادات اختيارية: المنصة والمدة والجمهور</summary>
            <div className="content-request-advanced-body script-fields-grid">
              <label><span>طريقة البداية</span><select value={scriptForm.input_mode} onChange={(event) => setScriptForm((form) => ({ ...form, input_mode: event.target.value }))}>{Object.entries(scriptInputModeConfig).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label><span>المنصة</span><select value={scriptForm.platform} onChange={(event) => setScriptForm((form) => ({ ...form, platform: event.target.value }))}><option value="instagram">Instagram</option><option value="facebook">Facebook</option><option value="tiktok">TikTok</option><option value="youtube">YouTube</option><option value="telegram">Telegram</option><option value="other">أخرى</option></select></label>
              <label><span>المدة المتوقعة بالثواني</span><input type="number" min={10} max={1800} value={scriptForm.duration_seconds} onChange={(event) => setScriptForm((form) => ({ ...form, duration_seconds: event.target.value }))} /></label>
              <label><span>سلسلة أو عمود محتوى — اختياري</span><input value={scriptForm.content_pillar} onChange={(event) => setScriptForm((form) => ({ ...form, content_pillar: event.target.value }))} /></label>
              <label className="span-2"><span>الهدف — اختياري</span><textarea maxLength={1000} value={scriptForm.objective} onChange={(event) => setScriptForm((form) => ({ ...form, objective: event.target.value }))} placeholder="اتركه فارغًا وسيستخرج النظام الهدف من خانة كل المطلوب." /></label>
              <label className="span-2"><span>الجمهور — اختياري</span><input maxLength={500} value={scriptForm.audience} onChange={(event) => setScriptForm((form) => ({ ...form, audience: event.target.value }))} /></label>
            </div>
          </details>
          <div className="form-actions"><Button type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={15} /> : <FilePenLine size={15} />} إنشاء وفتح المحرر</Button><Button type="button" variant="ghost" onClick={() => setShowCreateScript(false)}>إلغاء</Button><small>المسودة تُحفظ في مساحتك الخاصة فقط.</small></div>
        </form> : null}
      </section>
      {statusFilter === "archived" ? <aside className="script-archive-note"><Archive size={17} /><div><strong>الأرشيف خارج ضغط الشغل اليومي</strong><p>تقدر تسترجع أو تحذف نهائيًا اسكريبتاتك غير المرتبطة بالإنتاج أو بمرجع محفوظ.</p></div></aside> : null}
      <div className="scripts-grid">{filteredScripts.length ? filteredScripts.map((script) => {
        const config = scriptCardStatus(script, workspace.productionTasks);
        const stage = scriptStage(script, workspace.productionTasks);
        const working = workingScriptId === script.id;
        const canArchive = script.status !== "archived";
        return <article className="script-card" data-status={script.status} data-stage={stage} key={script.id}>
          <header><div><span className="script-card-icon"><FilePenLine size={18} /></span><div><h3>{script.title}</h3><p>{script.objective}</p></div></div><StatusBadge tone={config.tone}>{config.label}</StatusBadge></header>
          <dl><div><dt>الكاتب</dt><dd><UserRound size={12} /> {personName(workspace.people, script.assigned_to)}</dd></div><div><dt>المدة</dt><dd>{script.duration_seconds.toLocaleString("ar-EG")} ثانية</dd></div><div><dt>آخر نسخة</dt><dd>v{script.edit_version.toLocaleString("ar-EG")}</dd></div></dl>
          <footer><span>{formatScriptDate(script.updated_at)}</span><div className="script-card-actions">
            <a className="button button-secondary" href={`/scripts/${script.id}`}>{script.status === "handed_off" ? "متابعة التنفيذ" : "فتح الاسكريبت"}</a>
            {canWriteScripts && script.status === "draft" && script.spoken_script.trim().length >= 20 ? <button type="button" className="text-button script-quick-transition" disabled={working} onClick={() => void changeScriptStatus(script, "ready_to_record")}>{working ? <LoaderCircle className="spin" size={14} /> : <CheckCircle2 size={14} />} جاهز للتصوير</button> : null}
            {canWriteScripts && script.status === "ready_to_record" ? <button type="button" className="text-button script-quick-transition" disabled={working} onClick={() => void changeScriptStatus(script, "draft")}>{working ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />} إرجاع للكتابة</button> : null}
            {canWriteScripts && canArchive ? <button type="button" className="text-button" disabled={working} onClick={() => void changeScriptStatus(script, "archived")}>{working ? <LoaderCircle className="spin" size={14} /> : <Archive size={14} />} أرشفة</button> : null}
            {canWriteScripts && script.status === "archived" && !script.content_item_id ? <button type="button" className="text-button" disabled={working} onClick={() => void changeScriptStatus(script, "draft")}>{working ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />} استرجاع</button> : null}
            {canWriteScripts && script.status === "archived" && !script.content_item_id ? <button type="button" className="text-button danger-text" disabled={working} onClick={() => void deleteScript(script)}><Trash2 size={14} /> حذف نهائي</button> : null}
          </div></footer>
        </article>;
      }) : emptyState(Archive, "لا توجد اسكريبتات مطابقة", statusFilter === "active" ? "ابدأ باسكريبت جديد أو غيّر البحث والفلترة." : "غيّر الفلترة لرؤية العمل الحالي أو الأرشيف.")}</div>
    </> : null}

    {tab === "radar" ? <>
      <section className="panel scripts-control-panel">
        <div className="section-heading"><div><p className="overline">الرادار اليدوي الآن</p><h2>مصدر → مبدأ → زاوية أصلية</h2><p>نسجل الفكرة المفيدة ولا ننسخ المنافس. جلب Instagram وTranscript عبر Apify مؤجل لمرحلة مستقلة بعد تحديد الميزانية والحدود.</p></div>{canWriteScripts ? <Button type="button" onClick={() => setShowCreateResearch((value) => !value)}><Plus size={15} /> إضافة فكرة أو مرجع</Button> : null}</div>
        <aside className="script-trust-note"><Bot size={18} /><div><strong>لا يوجد اشتراك مدفوع أو سحب خفي</strong><p>الصق الرابط أو الفكرة يدويًا الآن. سنضيف الأتمتة لاحقًا بدون تغيير شكل بنك الأفكار أو خصوصيته.</p></div></aside>
        {showCreateResearch && canWriteScripts ? <form className="research-create-form" onSubmit={(event) => void createResearch(event)}>
          <label><span>النوع</span><select value={researchForm.kind} onChange={(event) => setResearchForm((form) => ({ ...form, kind: event.target.value }))}>{Object.entries(scriptResearchKindConfig).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
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
      <div className="research-grid">{workspace.research.length ? workspace.research.map((item) => {
        const preview = researchPreview?.researchId === item.id ? researchPreview : null;
        const canUse = canWriteScripts && item.status !== "archived" && item.status !== "used";
        return <article className={`research-card status-${item.status}`} id={`research-${item.id}`} data-direct-target={linkedResearchId === item.id || undefined} tabIndex={linkedResearchId === item.id ? -1 : undefined} key={item.id}>
          <header><div><Radar size={17} /><div><span>{scriptResearchKindConfig[item.kind]}</span><h3>{item.title}</h3></div></div><StatusBadge tone={item.status === "used" ? "success" : item.status === "archived" ? "info" : "neutral"}>{item.status === "inbox" ? "وارد" : item.status === "selected" ? "مختار" : item.status === "used" ? "تحول لاسكريبت" : "مؤرشف"}</StatusBadge></header>
          {linkedResearchId === item.id ? <span className="direct-target-label"><Radar size={11} /> ده العنصر المطلوب</span> : null}
          {item.transferable_principle ? <div className="research-principle"><strong>المبدأ القابل للنقل</strong><p>{item.transferable_principle}</p></div> : null}
          {item.original_angles.length ? <ul>{item.original_angles.slice(0, 3).map((angle) => <li key={angle}>{angle}</li>)}</ul> : null}
          {canUse ? <div className="research-ai-preview">
            <label><span>توجيه للـAI — اختياري</span><textarea value={preview ? researchAiDirection : ""} onFocus={() => { if (!preview) setResearchPreview({ researchId: item.id, variants: [], hooks: [] }); }} onChange={(event) => setResearchAiDirection(event.target.value)} placeholder="عايز أوصل الفكرة من زاوية..." /></label>
            <div className="research-ai-actions"><Button type="button" disabled={Boolean(researchAiLoading) || saving} onClick={() => void generateResearchPreview(item)}>{researchAiLoading === item.id ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />} اكتب 3 بدائل بالـAI</Button><Button type="button" variant="ghost" disabled={saving} onClick={() => void convertResearch(item.id)}>إنشاء مسودة يدوية</Button></div>
            {preview?.variants.length ? <div className="research-variant-list">{preview.variants.map((variant, index) => <article key={`${variant.label}-${index}`}><header><strong>{variant.label}</strong><span>نسخة {index + 1}</span></header><p>{variant.spoken_script}</p><Button type="button" variant="secondary" disabled={saving} onClick={() => void saveResearchVariant(item, variant)}>اختيار وحفظ كاسكريبت</Button></article>)}</div> : <small>لن تظهر الفكرة في «اسكريبتاتي» إلا بعد اختيار نسخة والضغط على الحفظ.</small>}
          </div> : null}
          <footer><div>{item.source_url ? <a href={item.source_url} target="_blank" rel="noreferrer">فتح المصدر</a> : <span>فكرة داخلية</span>}<small>{personName(workspace.people, item.assigned_to)}</small></div>{item.status === "used" && item.linked_script_id ? <a className="button button-secondary" href={`/scripts/${item.linked_script_id}`}>فتح الاسكريبت</a> : null}</footer>
        </article>;
      }) : emptyState(Lightbulb, "الرادار فارغ", "أضف رابط منافس أو فكرة أو مرجع مفيد، ثم استخرج منه زاوية أصلية.")}</div>
    </> : null}

    {tab === "voice" ? <VoiceProfileForm key={workspace.voice?.edit_version ?? 0} profile={workspace.voice} organizationId={workspace.organization.id} onSaved={refresh} readOnly={!canWriteScripts} /> : null}
  </section>;
}
