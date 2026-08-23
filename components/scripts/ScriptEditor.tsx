"use client";

import type { Session } from "@supabase/supabase-js";
import {
  Archive, ArrowRight, Bot, CheckCircle2, ExternalLink, Factory, FileClock, FilePenLine,
  History, Lightbulb, LoaderCircle, LockKeyhole, RefreshCw, Save, Sparkles, UserRound, WandSparkles,
} from "lucide-react";
import { type FormEvent, useCallback, useMemo, useState } from "react";
import { formatScriptDate, lines, scriptInputModeConfig, scriptPlatformConfig, scriptStatusConfig } from "../../lib/scripts";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Tables } from "../../lib/supabase/database.types";
import { useWorkspaceAuth } from "../../lib/supabase/use-workspace-auth";
import { Button } from "../ui/Button";
import { StatusBadge } from "../ui/StatusBadge";

type Membership = Tables<"memberships">;
type Organization = Tables<"organizations">;
type Script = Tables<"scripts">;
type ScriptVersion = Tables<"script_versions">;
type Person = { id: string; name: string; role: Membership["role"] };
type Workspace = { organization: Organization; membership: Membership; people: Person[]; storyBank: string[]; script: Script; versions: ScriptVersion[] };
type WritingMode = "idea" | "reference" | "improve";
type AiScope = "script_variants" | "hooks" | "production_pack" | "recording" | "editing" | "thumbnail" | "caption";
type ScriptVariant = { label: string; hook: string; spoken_script: string; cta: string };
type CaptionOption = { label: string; caption: string; hashtags: string[] };
type ThumbnailOption = { label: string; cover_text: string; visual_direction: string; script_connection: string };
type EditorForm = {
  title: string; input_mode: Script["input_mode"]; source_url: string; source_text: string;
  objective: string; audience: string; platform: string; duration_seconds: string; content_pillar: string;
  hook_variants: string; spoken_script: string; caption: string; hashtags: string;
  recording_notes: string; editing_notes: string; thumbnail_notes: string; on_screen_text: string;
  b_roll_notes: string; claims_notes: string;
};

function formFromScript(script: Script): EditorForm {
  return {
    title: script.title, input_mode: script.input_mode, source_url: script.source_url ?? "", source_text: script.source_text ?? "",
    objective: script.objective, audience: script.audience, platform: script.platform, duration_seconds: String(script.duration_seconds), content_pillar: script.content_pillar ?? "",
    hook_variants: script.hook_variants.join("\n"), spoken_script: script.spoken_script, caption: script.caption, hashtags: script.hashtags.join("\n"),
    recording_notes: script.recording_notes, editing_notes: script.editing_notes, thumbnail_notes: script.thumbnail_notes,
    on_screen_text: script.on_screen_text, b_roll_notes: script.b_roll_notes, claims_notes: script.claims_notes,
  };
}

function localDateTime(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function thumbnailOptionText(option: ThumbnailOption) {
  return `النص على الغلاف: ${option.cover_text}\nالاتجاه البصري: ${option.visual_direction}\nصلته بالاسكريبت: ${option.script_connection}`;
}

async function invokeFunction(name: string, body: Record<string, unknown>) {
  const { data, error } = await getSupabaseBrowserClient().functions.invoke(name, { body });
  if (error) {
    const context = error.context as Response | undefined;
    if (context) {
      try {
        const payload = await context.clone().json() as { message?: string };
        if (payload.message) throw new Error(payload.message);
      } catch (parseError) {
        if (parseError instanceof Error && !/JSON|Unexpected|body stream/i.test(parseError.message)) throw parseError;
      }
    }
    throw error;
  }
  return data as Record<string, unknown>;
}

export function ScriptEditor({ scriptId }: { scriptId: string }) {
  const configured = isSupabaseConfigured();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [form, setForm] = useState<EditorForm | null>(null);
  const [loading, setLoading] = useState(configured);
  const [saving, setSaving] = useState(false);
  const [aiScope, setAiScope] = useState<AiScope | null>(null);
  const [scriptVariants, setScriptVariants] = useState<ScriptVariant[]>([]);
  const [captionOptions, setCaptionOptions] = useState<CaptionOption[]>([]);
  const [thumbnailOptions, setThumbnailOptions] = useState<ThumbnailOption[]>([]);
  const [generationDirection, setGenerationDirection] = useState("");
  const [selectedStory, setSelectedStory] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [versionNote, setVersionNote] = useState("");
  const [showHandoff, setShowHandoff] = useState(false);
  const [publishAt, setPublishAt] = useState(() => localDateTime(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)));
  const [contentCreatorId, setContentCreatorId] = useState("");
  const [editingOwnerId, setEditingOwnerId] = useState("");
  const [thumbnailOwnerId, setThumbnailOwnerId] = useState("");
  const [publishingOwnerId, setPublishingOwnerId] = useState("");

  const clearWorkspace = useCallback(() => { setWorkspace(null); setForm(null); }, []);
  const clearTransientState = useCallback(() => { setError(null); setNotice(null); }, []);
  const loadScriptRows = useCallback(async (base: Omit<Workspace, "script" | "versions">) => {
    const supabase = getSupabaseBrowserClient();
    const [scriptResult, versionsResult] = await Promise.all([
      supabase.from("scripts").select("*").eq("id", scriptId).maybeSingle(),
      supabase.from("script_versions").select("*").eq("script_id", scriptId).order("version_number", { ascending: false }).limit(30),
    ]);
    if (scriptResult.error) throw scriptResult.error;
    if (!scriptResult.data) throw new Error("الاسكريبت غير موجود أو ليس لديك صلاحية لفتحه.");
    if (versionsResult.error) throw versionsResult.error;
    const loadedScript = scriptResult.data;
    setWorkspace({ ...base, script: loadedScript, versions: versionsResult.data ?? [] });
    setForm(formFromScript(loadedScript));
    setContentCreatorId((value) => value || loadedScript.assigned_to);
    const fallback = base.people.find((person) => person.role === "owner")?.id ?? base.membership.user_id;
    setEditingOwnerId((value) => value || fallback); setThumbnailOwnerId((value) => value || fallback); setPublishingOwnerId((value) => value || fallback);
  }, [scriptId]);

  const loadWorkspace = useCallback(async (activeSession: Session) => {
    const supabase = getSupabaseBrowserClient(); setLoading(true);
    try {
      const { data: membership, error: membershipError } = await supabase.from("memberships").select("*").eq("user_id", activeSession.user.id).eq("status", "active").limit(1).maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) { clearWorkspace(); return; }
      const [organizationResult, membershipsResult, voiceProfileResult] = await Promise.all([
        supabase.from("organizations").select("*").eq("id", membership.organization_id).single(),
        supabase.from("memberships").select("*").eq("organization_id", membership.organization_id).eq("status", "active"),
        supabase.from("script_voice_profiles").select("story_bank").eq("organization_id", membership.organization_id).maybeSingle(),
      ]);
      if (organizationResult.error) throw organizationResult.error;
      if (membershipsResult.error) throw membershipsResult.error;
      if (voiceProfileResult.error) throw voiceProfileResult.error;
      const ids = (membershipsResult.data ?? []).map((row) => row.user_id);
      const { data: profiles, error: profilesError } = ids.length ? await supabase.from("profiles").select("id, full_name").in("id", ids) : { data: [], error: null };
      if (profilesError) throw profilesError;
      const people = (membershipsResult.data ?? []).map((row) => ({
        id: row.user_id, role: row.role,
        name: profiles?.find((profile) => profile.id === row.user_id)?.full_name ?? (row.user_id === activeSession.user.id ? activeSession.user.email : null) ?? "عضو فريق",
      }));
      await loadScriptRows({ organization: organizationResult.data, membership, people, storyBank: voiceProfileResult.data?.story_bank ?? [] });
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "تعذّر تحميل الاسكريبت."); }
    finally { setLoading(false); }
  }, [clearWorkspace, loadScriptRows]);

  const session = useWorkspaceAuth({ configured, loadWorkspace, clearWorkspace, setLoading, clearTransientState });
  const refresh = useCallback(async () => {
    if (!workspace) return;
    await loadScriptRows({ organization: workspace.organization, membership: workspace.membership, people: workspace.people, storyBank: workspace.storyBank });
  }, [loadScriptRows, workspace]);
  const update = useCallback(<K extends keyof EditorForm>(key: K, value: EditorForm[K]) => {
    setForm((current) => current ? { ...current, [key]: value } : current); setNotice(null);
  }, []);

  const assignedWriter = Boolean(workspace && session && workspace.script.assigned_to === session.user.id);
  const readOnly = !assignedWriter || workspace?.script.status === "handed_off" || workspace?.script.status === "archived";
  const wordCount = useMemo(() => form?.spoken_script.trim().split(/\s+/).filter(Boolean).length ?? 0, [form?.spoken_script]);
  const estimatedSeconds = Math.max(0, Math.round(wordCount / 2.15));
  const writingHasUnsavedChanges = useMemo(() => {
    if (!workspace || !form) return false;
    return form.title !== workspace.script.title || form.objective !== workspace.script.objective
      || form.source_url !== (workspace.script.source_url ?? "") || form.source_text !== (workspace.script.source_text ?? "")
      || form.hook_variants !== workspace.script.hook_variants.join("\n") || form.spoken_script !== workspace.script.spoken_script;
  }, [form, workspace]);
  const productionHasUnsavedChanges = useMemo(() => {
    if (!workspace || !form) return false;
    return form.recording_notes !== workspace.script.recording_notes || form.editing_notes !== workspace.script.editing_notes
      || form.thumbnail_notes !== workspace.script.thumbnail_notes || form.on_screen_text !== workspace.script.on_screen_text
      || form.b_roll_notes !== workspace.script.b_roll_notes || form.claims_notes !== workspace.script.claims_notes
      || form.caption !== workspace.script.caption || form.hashtags !== workspace.script.hashtags.join("\n");
  }, [form, workspace]);

  async function save(event?: FormEvent) {
    event?.preventDefault(); if (!workspace || !form || readOnly) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      await invokeFunction("script-commands", {
        action: "save_script", script_id: workspace.script.id, expected_edit_version: workspace.script.edit_version,
        ...form, duration_seconds: Number(form.duration_seconds), hook_variants: lines(form.hook_variants), hashtags: lines(form.hashtags),
        version_note: versionNote,
      });
      setVersionNote(""); setScriptVariants([]);
      if (writingHasUnsavedChanges) { setCaptionOptions([]); setThumbnailOptions([]); }
      setNotice(workspace.script.status === "ready_to_record" && writingHasUnsavedChanges
        ? "تم حفظ النص وإرجاعه إلى «قيد الكتابة» لأن النسخة المعتمدة اتغيرت."
        : "تم حفظ نسخة جديدة.");
      await refresh();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "تعذّر حفظ الاسكريبت."); }
    finally { setSaving(false); }
  }

  async function changeStatus(status: "draft" | "ready_to_record" | "archived") {
    if (!workspace || !form) return;
    if (writingHasUnsavedChanges) { setError("احفظ تعديلات النص أولًا قبل تغيير حالته."); return; }
    setSaving(true); setError(null); setNotice(null);
    try {
      await invokeFunction("script-commands", { action: "change_status", script_id: workspace.script.id, expected_edit_version: workspace.script.edit_version, status });
      setNotice(status === "ready_to_record" ? "تم اعتماد النص النهائي. الآن فقط يمكنك إنشاء حزمة التسجيل والمونتاج والغلاف."
        : status === "archived" ? "تم نقل الاسكريبت إلى الأرشيف." : "عاد الاسكريبت إلى قيد الكتابة.");
      await refresh();
    } catch (statusError) { setError(statusError instanceof Error ? statusError.message : "تعذّر تغيير الحالة."); }
    finally { setSaving(false); }
  }

  async function generateWriting(mode: WritingMode, scope: "script_variants" | "hooks") {
    if (!workspace || !form || readOnly) return;
    if (writingHasUnsavedChanges) { setError("احفظ تعديلات الفكرة أو النص أولًا حتى يبني AI على أحدث نسخة."); return; }
    setAiScope(scope); setError(null); setNotice(null);
    try {
      const result = await invokeFunction("script-ai", {
        script_id: workspace.script.id, expected_edit_version: workspace.script.edit_version, mode, scope,
        generation_direction: generationDirection, selected_story: selectedStory,
      });
      const generated = result.generated as { variants?: ScriptVariant[]; hook_variants?: string[] } | undefined;
      const variants = Array.isArray(generated?.variants) ? generated.variants : [];
      const hooks = Array.isArray(generated?.hook_variants) ? generated.hook_variants : [];
      const quality = result.quality as { removed_variants?: number; removed_hooks?: number } | undefined;
      const removedVariants = Number(quality?.removed_variants ?? 0);
      const removedHooks = Number(quality?.removed_hooks ?? 0);
      const guardNotice = removedVariants || removedHooks
        ? ` الحارس استبعد ${removedVariants ? `${removedVariants} نسخة` : ""}${removedVariants && removedHooks ? " و" : ""}${removedHooks ? `${removedHooks} هوك` : ""} لعدم مطابقتها، من غير طلب API إضافي.`
        : "";
      if (scope === "script_variants") setScriptVariants(variants);
      if (Array.isArray(generated?.hook_variants)) update("hook_variants", generated.hook_variants.join("\n"));
      setNotice(scope === "script_variants"
        ? `عدد البدائل السليمة: ${variants.length}. دي معاينة فقط؛ اختر نسخة ثم احفظها بنفسك، ولم نغيّر الاسكريبت أو مصنع المحتوى.${guardNotice}`
        : `عدد الهوكات السليمة: ${hooks.length}. ظهرت داخل المحرر ولم تُحفظ بعد.${guardNotice}`);
    } catch (generateError) { setError(generateError instanceof Error ? generateError.message : "تعذّر توليد بدائل الكتابة."); }
    finally { setAiScope(null); }
  }

  function chooseVariant(variant: ScriptVariant) {
    if (!form) return;
    const hooks = lines(`${variant.hook}\n${form.hook_variants}`);
    setForm({ ...form, spoken_script: variant.spoken_script, hook_variants: hooks.join("\n") });
    setNotice(`تم وضع «${variant.label}» داخل المحرر فقط. عدّلها براحتك ثم اضغط حفظ.`);
  }

  async function generateProduction(scope: Exclude<AiScope, "script_variants" | "hooks">) {
    if (!workspace || workspace.script.status !== "ready_to_record") return;
    if (productionHasUnsavedChanges) { setError("احفظ تعديلات حزمة التنفيذ أولًا قبل إعادة توليد أي جزء."); return; }
    setAiScope(scope); setError(null); setNotice(null);
    try {
      const result = await invokeFunction("script-ai", {
        script_id: workspace.script.id, expected_edit_version: workspace.script.edit_version,
        mode: "improve", scope, generation_direction: generationDirection,
      });
      const generated = result.generated as { caption_options?: CaptionOption[]; thumbnail_options?: ThumbnailOption[] } | undefined;
      const captions = Array.isArray(generated?.caption_options) ? generated.caption_options : [];
      const thumbnails = Array.isArray(generated?.thumbnail_options) ? generated.thumbnail_options : [];
      if (scope === "caption" || scope === "production_pack") setCaptionOptions(captions);
      if (scope === "thumbnail" || scope === "production_pack") setThumbnailOptions(thumbnails);
      const quality = result.quality as { removed_options?: number } | undefined;
      const removed = Number(quality?.removed_options ?? 0);
      const guardNotice = removed ? ` الحارس استبعد ${removed} اقتراحات غير مطابقة، من غير طلب API إضافي.` : "";
      if (scope === "caption") setNotice(`ظهر ${captions.length} اقتراحات كابشن. اختر واحدًا بعلامة صح ثم احفظ بنفسك؛ لم نعتمد شيئًا تلقائيًا.${guardNotice}`);
      else if (scope === "thumbnail") setNotice(`ظهر ${thumbnails.length} اقتراحات غلاف مبنية على الاسكريبت. اختر واحدًا بعلامة صح ثم احفظ بنفسك؛ لم نعتمد شيئًا تلقائيًا.${guardNotice}`);
      else setNotice(scope === "production_pack"
        ? `تم إنشاء تعليمات التسجيل والمونتاج من النص المعتمد، وظهرت بدائل الكابشن والغلاف لتختارها بنفسك.${guardNotice}`
        : "تم إعادة توليد الجزء المطلوب فقط من حزمة التنفيذ.");
      if (result.saved) await refresh();
    } catch (generateError) { setError(generateError instanceof Error ? generateError.message : "تعذّر إنشاء تعليمات التنفيذ."); }
    finally { setAiScope(null); }
  }

  function chooseCaptionOption(option: CaptionOption) {
    if (!form) return;
    setForm({ ...form, caption: option.caption, hashtags: option.hashtags.join("\n") });
    setNotice(`تم تحديد كابشن «${option.label}» بعلامة صح داخل المحرر. راجعه ثم اضغط حفظ لاعتماده.`);
  }

  function chooseThumbnailOption(option: ThumbnailOption) {
    if (!form) return;
    setForm({ ...form, thumbnail_notes: thumbnailOptionText(option) });
    setNotice(`تم تحديد غلاف «${option.label}» بعلامة صح داخل المحرر. راجعه ثم اضغط حفظ لاعتماده.`);
  }

  async function approveVoiceSample() {
    if (!workspace || !form || !assignedWriter) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      await invokeFunction("script-commands", { action: "approve_voice_sample", script_id: workspace.script.id, expected_edit_version: workspace.script.edit_version });
      setNotice("تم اعتماد النص الحالي كعينة حقيقية لصوتك.");
    } catch (approveError) { setError(approveError instanceof Error ? approveError.message : "تعذّر اعتماد النص كعينة لصوتك."); }
    finally { setSaving(false); }
  }

  async function handoff(event: FormEvent) {
    event.preventDefault(); if (!workspace) return;
    if (writingHasUnsavedChanges || productionHasUnsavedChanges) { setError("احفظ كل التعديلات أولًا قبل تسليم النسخة لمصنع المحتوى."); return; }
    setSaving(true); setError(null); setNotice(null);
    try {
      const result = await invokeFunction("script-commands", {
        action: "handoff", script_id: workspace.script.id, expected_edit_version: workspace.script.edit_version,
        publish_at: new Date(publishAt).toISOString(), content_creator_id: contentCreatorId,
        editing_owner_id: editingOwnerId, thumbnail_owner_id: thumbnailOwnerId, publishing_owner_id: publishingOwnerId,
      });
      setNotice("تم إنشاء خط الإنتاج كاملًا داخل مصنع المحتوى."); setShowHandoff(false); await refresh();
      const contentId = String(result.contentId ?? ""); if (contentId) window.location.assign(`/content?content=${contentId}#content-${contentId}`);
    } catch (handoffError) { setError(handoffError instanceof Error ? handoffError.message : "تعذّر تسليم الاسكريبت."); }
    finally { setSaving(false); }
  }

  if (loading) return <section className="workspace-state"><LoaderCircle className="spin" size={24} /><div><h2>جارٍ فتح الاسكريبت</h2><p>نتحقق من الصلاحية ونحمّل آخر نسخة.</p></div></section>;
  if (!session) return <section className="workspace-state workspace-onboarding"><LockKeyhole size={27} /><div><h2>سجّل الدخول أولًا</h2><p>هذه صفحة خاصة بصاحب الاسكريبت والمالك.</p></div><Button href="/tasks">تسجيل الدخول</Button></section>;
  if (!workspace || !form) return <section className="workspace-state"><FilePenLine size={27} /><div><h2>تعذّر فتح الاسكريبت</h2><p>{error ?? "الاسكريبت غير موجود أو ليس لديك صلاحية."}</p></div><Button href="/scripts">العودة للاستوديو</Button></section>;

  const owner = workspace.membership.role === "owner"; const status = scriptStatusConfig[workspace.script.status];
  const assignee = workspace.people.find((person) => person.id === workspace.script.assigned_to)?.name ?? "عضو فريق";
  const latestVersionIsManual = workspace.versions[0]?.source === "manual_save";
  const spokenScriptHasUnsavedChanges = form.spoken_script !== workspace.script.spoken_script;
  const packExists = workspace.script.production_pack_source_version !== null;
  const packStale = workspace.script.production_pack_stale;
  const showProduction = readOnly || workspace.script.status === "ready_to_record";

  return <section className="script-editor-workspace">
    <div className="script-editor-topbar"><Button href="/scripts" variant="ghost"><ArrowRight size={15} /> العودة للاستوديو</Button><div><StatusBadge tone={status.tone}>{status.label}</StatusBadge><span><UserRound size={13} /> {assignee}</span><span><FileClock size={13} /> النسخة {workspace.script.edit_version.toLocaleString("ar-EG")}</span></div></div>
    {error ? <p className="form-notice error">{error}</p> : null}
    {notice ? <p className="form-notice success">{notice}</p> : null}
    {readOnly ? <aside className="script-readonly-note"><CheckCircle2 size={18} /><div><strong>{!assignedWriter ? "عرض إشرافي فقط — صاحب الاسكريبت هو من يكتب ويولّد" : workspace.script.status === "handed_off" ? "هذه هي النسخة التي دخلت مصنع المحتوى" : "الاسكريبت مؤرشف"}</strong><p>{!assignedWriter ? "يمكن للمالك متابعة النسخة، لكن لا يمكنه كشف بصمة الكاتب أو التوليد والتعديل مكانه." : "أي تنفيذ لاحق يتم من مصنع المحتوى وليس بتعديل هذا الأصل."}</p>{workspace.script.content_item_id ? <a href={`/content?content=${workspace.script.content_item_id}#content-${workspace.script.content_item_id}`}>فتح خط الإنتاج <ExternalLink size={13} /></a> : null}</div></aside> : null}

    <form className="script-editor-form" onSubmit={(event) => void save(event)}>
      <section className="panel script-editor-section">
        <div className="section-heading"><div><p className="overline">الأساس</p><h2>الفكرة والسياق</h2><p>المصدر مرجع للفهم، وليس تصريحًا بنسخ التنفيذ.</p></div><StatusBadge tone="neutral">{scriptInputModeConfig[form.input_mode]}</StatusBadge></div>
        <div className="script-fields-grid">
          <label className="span-2"><span>عنوان الاسكريبت</span><input disabled={readOnly} required minLength={3} value={form.title} onChange={(event) => update("title", event.target.value)} /></label>
          <label><span>طريقة البداية</span><select disabled={readOnly} value={form.input_mode} onChange={(event) => update("input_mode", event.target.value as EditorForm["input_mode"])}>{Object.entries(scriptInputModeConfig).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span>المنصة</span><select disabled={readOnly} value={form.platform} onChange={(event) => update("platform", event.target.value)}>{Object.entries(scriptPlatformConfig).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span>المدة المستهدفة بالثواني</span><input disabled={readOnly} type="number" min={10} max={1800} value={form.duration_seconds} onChange={(event) => update("duration_seconds", event.target.value)} /></label>
          <label><span>السلسلة أو عمود المحتوى</span><input disabled={readOnly} value={form.content_pillar} onChange={(event) => update("content_pillar", event.target.value)} /></label>
          <label className="span-2"><span>الهدف</span><textarea disabled={readOnly} required minLength={5} value={form.objective} onChange={(event) => update("objective", event.target.value)} /></label>
          <label><span>الجمهور</span><input disabled={readOnly} value={form.audience} onChange={(event) => update("audience", event.target.value)} /></label>
          <label><span>رابط المرجع — اختياري</span><input disabled={readOnly} type="url" value={form.source_url} onChange={(event) => update("source_url", event.target.value)} /></label>
          <label className="span-2"><span>نص أو ملاحظات المصدر</span><textarea className="source-textarea" disabled={readOnly} value={form.source_text} onChange={(event) => update("source_text", event.target.value)} /></label>
        </div>
      </section>

      {!readOnly ? <section className="panel script-ai-panel">
        <div className="script-ai-copy"><span className="script-ai-icon"><WandSparkles size={21} /></span><div><p className="overline">مرحلة 1 — الكتابة</p><h2>ولّد بدائل، واختار بنفسك</h2><p>أي توليد هنا معاينة فقط: لا يحفظ نسخة، ولا ينشئ مونتاج أو غلاف أو مهام إنتاج.</p></div></div>
        <div className="script-ai-guardrails">
          <label><span>القصة الشخصية</span><select value={selectedStory} onChange={(event) => setSelectedStory(event.target.value)}><option value="">بدون قصة شخصية — الافتراضي</option>{workspace.storyBank.map((story) => <option key={story} value={story}>{story}</option>)}</select><small>{selectedStory ? "سيُسمح بهذه القصة وحدها." : "لن تُستخدم قصة ترامب أو غيرها."}</small></label>
          <label><span>قولها بطريقتك — اختياري</span><textarea maxLength={1500} value={generationDirection} onChange={(event) => setGenerationDirection(event.target.value)} placeholder="أنا عايز أوصل له إن... ومتقولش..." /><small>التوجيه يطبّق على المعاينة التالية فقط.</small></label>
        </div>
        <div className="script-ai-actions">
          <Button type="button" disabled={Boolean(aiScope) || saving} onClick={() => void generateWriting("idea", "script_variants")}>{aiScope === "script_variants" ? <LoaderCircle className="spin" size={15} /> : <Lightbulb size={15} />} ولّد 3 بدائل للاسكريبت</Button>
          <Button type="button" variant="secondary" disabled={Boolean(aiScope) || saving || !form.source_url} onClick={() => void generateWriting("reference", "script_variants")}><Bot size={15} /> بدائل من المرجع بطريقتي</Button>
          <Button type="button" variant="secondary" disabled={Boolean(aiScope) || saving || form.spoken_script.length < 20} onClick={() => void generateWriting("improve", "script_variants")}><Sparkles size={15} /> 3 بدائل محسنة من مسودتي</Button>
        </div>
        {scriptVariants.length ? <div className="script-variants-grid">{scriptVariants.map((variant, index) => <article key={`${variant.label}-${index}`}><header><span>نسخة {index + 1}</span><strong>{variant.label}</strong></header><p>{variant.spoken_script}</p><Button type="button" variant="secondary" onClick={() => chooseVariant(variant)}>اختيار هذه النسخة</Button></article>)}</div> : null}
      </section> : null}

      <section className="panel script-editor-section">
        <div className="section-heading"><div><p className="overline">الكلام أمام الكاميرا</p><h2>الهوك ونص الاسكريبت</h2><p>CTA جزء من النص النهائي، لذلك لن تكتبه مرة ثانية في خانة مكررة.</p></div><div className="script-word-count"><strong>{wordCount.toLocaleString("ar-EG")}</strong><span>كلمة · نحو {estimatedSeconds.toLocaleString("ar-EG")} ثانية</span></div></div>
        <div className="script-fields-grid">
          <label className="span-2"><span>بدائل الهوك — واحد في كل سطر</span><textarea disabled={readOnly} value={form.hook_variants} onChange={(event) => update("hook_variants", event.target.value)} />{!readOnly ? <Button type="button" variant="ghost" disabled={Boolean(aiScope) || saving} onClick={() => void generateWriting(form.spoken_script ? "improve" : "idea", "hooks")}>{aiScope === "hooks" ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />} إعادة توليد الهوكات فقط</Button> : null}</label>
          <label className="span-2"><span>نص الكلام النهائي</span><textarea className="spoken-script-textarea" disabled={readOnly} value={form.spoken_script} onChange={(event) => update("spoken_script", event.target.value)} placeholder="اكتب الكلام كما سيُقال فعلًا، بما فيه الدعوة للإجراء..." /></label>
        </div>
        {assignedWriter ? <aside className="script-calibration-note"><CheckCircle2 size={18} /><div><strong>هل النص بقى أنت فعلًا بعد تعديلك؟</strong><p>احفظ تعديلك اليدوي أولًا، ثم أضفه إلى بصمتك الخاصة.</p></div><Button type="button" variant="secondary" disabled={saving || Boolean(aiScope) || form.spoken_script.trim().length < 20 || spokenScriptHasUnsavedChanges || !latestVersionIsManual} onClick={() => void approveVoiceSample()}>{spokenScriptHasUnsavedChanges || !latestVersionIsManual ? "احفظ تعديلك أولًا" : "اعتمد النص كعينة لصوتي"}</Button></aside> : null}
      </section>

      {showProduction ? <>
        <section className="panel script-editor-section script-production-panel">
          <div className="section-heading"><div><p className="overline">مرحلة 2 — التنفيذ</p><h2>حزمة مبنية على النص المعتمد</h2><p>{packStale ? "النص اتغير بعد إنشاء الحزمة؛ تجاهل التعليمات القديمة وأعد بناء الحزمة كاملة." : packExists ? "الحزمة مرتبطة بالنسخة المعتمدة. يمكنك إعادة توليد جزء محدد." : "لم تُنشأ تعليمات تنفيذ بعد."}</p></div><StatusBadge tone={packStale ? "warning" : packExists ? "success" : "neutral"}>{packStale ? "تحتاج تحديث" : packExists ? "الحزمة جاهزة" : "لم تُنشأ"}</StatusBadge></div>
          {!readOnly ? <div className="script-production-actions">
            <Button type="button" disabled={Boolean(aiScope) || saving} onClick={() => void generateProduction("production_pack")}>{aiScope === "production_pack" ? <LoaderCircle className="spin" size={15} /> : <Factory size={15} />} {packExists ? "إعادة بناء الحزمة كاملة" : "إنشاء حزمة التنفيذ"}</Button>
            <Button type="button" variant="secondary" disabled={Boolean(aiScope) || saving || !packExists || packStale} onClick={() => void generateProduction("recording")}><RefreshCw size={14} /> التسجيل فقط</Button>
            <Button type="button" variant="secondary" disabled={Boolean(aiScope) || saving || !packExists || packStale} onClick={() => void generateProduction("editing")}><RefreshCw size={14} /> المونتاج فقط</Button>
            <Button type="button" variant="secondary" disabled={Boolean(aiScope) || saving} onClick={() => void generateProduction("thumbnail")}><RefreshCw size={14} /> 3 اقتراحات للغلاف</Button>
            <Button type="button" variant="secondary" disabled={Boolean(aiScope) || saving} onClick={() => void generateProduction("caption")}><RefreshCw size={14} /> 3 اقتراحات للكابشن</Button>
          </div> : null}
          <div className="script-fields-grid execution-fields">
            <label><span>تعليمات التسجيل</span><textarea disabled={readOnly} value={form.recording_notes} onChange={(event) => update("recording_notes", event.target.value)} /></label>
            <label><span>تعليمات المونتاج</span><textarea disabled={readOnly} value={form.editing_notes} onChange={(event) => update("editing_notes", event.target.value)} /></label>
            <label><span>تعليمات الغلاف</span><textarea disabled={readOnly} value={form.thumbnail_notes} onChange={(event) => update("thumbnail_notes", event.target.value)} /></label>
            <label><span>النصوص على الشاشة</span><textarea disabled={readOnly} value={form.on_screen_text} onChange={(event) => update("on_screen_text", event.target.value)} /></label>
            <label><span>B-roll وصور ومصادر بصرية</span><textarea disabled={readOnly} value={form.b_roll_notes} onChange={(event) => update("b_roll_notes", event.target.value)} /></label>
            <label><span>حقائق تحتاج مراجعة</span><textarea disabled={readOnly} value={form.claims_notes} onChange={(event) => update("claims_notes", event.target.value)} /></label>
          </div>
          {thumbnailOptions.length ? <div className="script-variants-grid" aria-label="اقتراحات الغلاف">{thumbnailOptions.map((option, index) => {
            const selected = form.thumbnail_notes === thumbnailOptionText(option);
            return <article key={`${option.label}-${index}`}><header><span>غلاف {index + 1}</span><strong>{option.label}</strong></header><p><strong>النص:</strong> {option.cover_text}</p><p><strong>الاتجاه البصري:</strong> {option.visual_direction}</p><p><strong>صلته بالنص:</strong> {option.script_connection}</p><Button type="button" variant={selected ? "primary" : "secondary"} aria-pressed={selected} onClick={() => chooseThumbnailOption(option)}>{selected ? <CheckCircle2 size={15} /> : null}{selected ? " محدد بعلامة صح" : "اختيار هذا الغلاف"}</Button></article>;
          })}</div> : null}
        </section>
        <section className="panel script-editor-section">
          <div className="section-heading"><div><p className="overline">بعد التسجيل</p><h2>الكابشن والهاشتاجات</h2><p>مبنيان على النص المعتمد ويصلان لموظف النشر لاحقًا.</p></div></div>
          <div className="script-fields-grid"><label className="span-2"><span>الكابشن</span><textarea className="caption-textarea" disabled={readOnly} value={form.caption} onChange={(event) => update("caption", event.target.value)} /></label><label className="span-2"><span>الهاشتاجات — واحد في كل سطر</span><textarea disabled={readOnly} value={form.hashtags} onChange={(event) => update("hashtags", event.target.value)} /></label></div>
          {captionOptions.length ? <div className="script-variants-grid" aria-label="اقتراحات الكابشن">{captionOptions.map((option, index) => {
            const selected = form.caption === option.caption && lines(form.hashtags).join("\n") === option.hashtags.join("\n");
            return <article key={`${option.label}-${index}`}><header><span>كابشن {index + 1}</span><strong>{option.label}</strong></header><p>{option.caption}</p><small>{option.hashtags.join(" ")}</small><Button type="button" variant={selected ? "primary" : "secondary"} aria-pressed={selected} onClick={() => chooseCaptionOption(option)}>{selected ? <CheckCircle2 size={15} /> : null}{selected ? " محدد بعلامة صح" : "اختيار هذا الكابشن"}</Button></article>;
          })}</div> : null}
        </section>
      </> : <aside className="script-production-gate"><Factory size={20} /><div><strong>تعليمات التنفيذ لسه مقفولة</strong><p>عدّل النص واختار نسختك، ثم اضغط «جاهز للتصوير». بعدها فقط يظهر توليد التسجيل والمونتاج والغلاف والكابشن.</p></div></aside>}

      {!readOnly ? <div className="script-save-bar"><label><span>إيه اللي عدّلته؟ — اختياري</span><input value={versionNote} maxLength={500} onChange={(event) => setVersionNote(event.target.value)} placeholder="مثال: غيرت الهوك وقصّرت النص" /><small>تظهر الملاحظة في سجل النسخ فقط، ولا تدخل في الاسكريبت.</small></label><Button type="submit" disabled={saving || Boolean(aiScope)}>{saving ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />} حفظ التعديلات</Button></div> : null}
    </form>

    <section className="panel script-status-panel">
      <div className="section-heading"><div><p className="overline">الحالة</p><h2>أنت الذي يحدد انتقال الاسكريبت</h2><p>لا ينتقل إلى مصنع المحتوى ولا تتولد تعليماته لمجرد ضغط زر AI.</p></div><StatusBadge tone={status.tone}>{status.label}</StatusBadge></div>
      <div className="script-status-actions">
        {workspace.script.status === "draft" ? <Button type="button" disabled={saving || form.spoken_script.trim().length < 20} onClick={() => void changeStatus("ready_to_record")}><CheckCircle2 size={15} /> جاهز للتصوير</Button> : null}
        {workspace.script.status === "ready_to_record" ? <><Button type="button" variant="secondary" disabled={saving} onClick={() => void changeStatus("draft")}><RefreshCw size={15} /> إرجاع لقيد الكتابة</Button>{owner ? <Button type="button" onClick={() => setShowHandoff((value) => !value)}><Factory size={15} /> تسليم لمصنع المحتوى</Button> : <span className="script-owner-action-note">المالك يحدد فريق الإنتاج والموعد.</span>}</> : null}
        {workspace.script.status !== "archived" ? <Button type="button" variant="ghost" disabled={saving} onClick={() => void changeStatus("archived")}><Archive size={15} /> أرشفة</Button> : null}
        {workspace.script.status === "archived" && !workspace.script.content_item_id ? <Button type="button" variant="secondary" disabled={saving} onClick={() => void changeStatus("draft")}><RefreshCw size={15} /> استعادة لقيد الكتابة</Button> : null}
      </div>
      {showHandoff && owner ? <form className="script-handoff-form" onSubmit={(event) => void handoff(event)}><div className="script-handoff-heading"><Factory size={19} /><div><strong>التسليم الذري</strong><p>إما يُنشأ أصل المحتوى ومهام التسجيل والمونتاج والغلاف والنشر معًا، أو لا يُحفظ شيء.</p></div></div><div className="script-fields-grid"><label><span>موعد النشر</span><input required type="datetime-local" value={publishAt} onChange={(event) => setPublishAt(event.target.value)} /></label><label><span>التسجيل وصناعة المحتوى</span><select value={contentCreatorId} onChange={(event) => setContentCreatorId(event.target.value)}>{workspace.people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label><span>المونتاج</span><select value={editingOwnerId} onChange={(event) => setEditingOwnerId(event.target.value)}>{workspace.people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label><span>الغلاف</span><select value={thumbnailOwnerId} onChange={(event) => setThumbnailOwnerId(event.target.value)}>{workspace.people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label><span>النشر</span><select value={publishingOwnerId} onChange={(event) => setPublishingOwnerId(event.target.value)}>{workspace.people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label></div><div className="form-actions"><Button type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={15} /> : <Factory size={15} />} إنشاء خط الإنتاج</Button><Button type="button" variant="ghost" onClick={() => setShowHandoff(false)}>إلغاء</Button></div></form> : null}
    </section>

    <section className="panel script-history-panel">
      <div className="section-heading"><div><p className="overline">سجل النسخ</p><h2>ما الذي حُفظ ومتى؟</h2><p>«ملاحظة النسخة» مجرد وصف اختياري يساعدك تفتكر سبب التعديل.</p></div><History size={21} /></div>
      {workspace.versions.length ? <ol>{workspace.versions.map((version) => <li key={version.id}><span><strong>v{version.version_number.toLocaleString("ar-EG")}</strong><small>{version.source === "ai_generation" ? "حزمة AI" : version.source === "handoff" ? "تسليم للمصنع" : "حفظ يدوي"}</small></span><div><strong>{version.note || "بدون ملاحظة"}</strong><small>{formatScriptDate(version.created_at)}</small></div></li>)}</ol> : <p className="tool-empty">لا توجد نسخ مسجلة.</p>}
    </section>
  </section>;
}
