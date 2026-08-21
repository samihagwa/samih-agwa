"use client";

import type { Session } from "@supabase/supabase-js";
import { Archive, ArrowRight, Bot, CheckCircle2, ExternalLink, FileClock, FilePenLine, Factory, History, Lightbulb, LoaderCircle, LockKeyhole, RefreshCw, Save, Sparkles, UserRound, WandSparkles } from "lucide-react";
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
type Workspace = { organization: Organization; membership: Membership; people: Person[]; script: Script; versions: ScriptVersion[] };
type AiMode = "idea" | "reference" | "improve";
type EditorForm = {
  title: string; input_mode: Script["input_mode"]; source_url: string; source_text: string;
  objective: string; audience: string; platform: string; duration_seconds: string; content_pillar: string;
  hook_variants: string; spoken_script: string; cta: string; caption: string; hashtags: string;
  recording_notes: string; editing_notes: string; thumbnail_notes: string; on_screen_text: string;
  b_roll_notes: string; claims_notes: string;
};

function formFromScript(script: Script): EditorForm {
  return {
    title: script.title, input_mode: script.input_mode, source_url: script.source_url ?? "", source_text: script.source_text ?? "",
    objective: script.objective, audience: script.audience, platform: script.platform, duration_seconds: String(script.duration_seconds), content_pillar: script.content_pillar ?? "",
    hook_variants: script.hook_variants.join("\n"), spoken_script: script.spoken_script, cta: script.cta, caption: script.caption, hashtags: script.hashtags.join("\n"),
    recording_notes: script.recording_notes, editing_notes: script.editing_notes, thumbnail_notes: script.thumbnail_notes,
    on_screen_text: script.on_screen_text, b_roll_notes: script.b_roll_notes, claims_notes: script.claims_notes,
  };
}

function localDateTime(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
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
  const [aiMode, setAiMode] = useState<AiMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [versionNote, setVersionNote] = useState("حفظ يدوي");
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
    setEditingOwnerId((value) => value || fallback);
    setThumbnailOwnerId((value) => value || fallback);
    setPublishingOwnerId((value) => value || fallback);
  }, [scriptId]);

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
      const people = (membershipsResult.data ?? []).map((row) => ({ id: row.user_id, role: row.role, name: profiles?.find((profile) => profile.id === row.user_id)?.full_name ?? (row.user_id === activeSession.user.id ? activeSession.user.email : null) ?? "عضو فريق" }));
      await loadScriptRows({ organization: organizationResult.data, membership, people });
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "تعذّر تحميل الاسكريبت."); }
    finally { setLoading(false); }
  }, [clearWorkspace, loadScriptRows]);

  const session = useWorkspaceAuth({ configured, loadWorkspace, clearWorkspace, setLoading, clearTransientState });
  const refresh = useCallback(async () => {
    if (!workspace) return;
    await loadScriptRows({ organization: workspace.organization, membership: workspace.membership, people: workspace.people });
  }, [loadScriptRows, workspace]);

  const update = useCallback(<K extends keyof EditorForm>(key: K, value: EditorForm[K]) => {
    setForm((current) => current ? { ...current, [key]: value } : current);
    setNotice(null);
  }, []);

  const readOnly = workspace?.script.status === "handed_off" || workspace?.script.status === "archived";
  const wordCount = useMemo(() => form?.spoken_script.trim().split(/\s+/).filter(Boolean).length ?? 0, [form?.spoken_script]);
  const estimatedSeconds = Math.max(0, Math.round(wordCount / 2.15));

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (!workspace || !form || readOnly) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      await invokeFunction("script-commands", {
        action: "save_script", script_id: workspace.script.id, expected_edit_version: workspace.script.edit_version,
        ...form, duration_seconds: Number(form.duration_seconds), hook_variants: lines(form.hook_variants), hashtags: lines(form.hashtags), version_note: versionNote,
      });
      setNotice("تم حفظ نسخة جديدة من الاسكريبت.");
      await refresh();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "تعذّر حفظ الاسكريبت."); }
    finally { setSaving(false); }
  }

  async function changeStatus(status: "draft" | "ready_to_record" | "archived") {
    if (!workspace) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      await invokeFunction("script-commands", { action: "change_status", script_id: workspace.script.id, expected_edit_version: workspace.script.edit_version, status });
      setNotice(status === "ready_to_record" ? "الاسكريبت جاهز للتسجيل وتم إشعار المالك إن كان كاتبًا آخر." : status === "archived" ? "تم نقل الاسكريبت إلى الأرشيف." : "عاد الاسكريبت إلى المسودة.");
      await refresh();
    } catch (statusError) { setError(statusError instanceof Error ? statusError.message : "تعذّر تغيير الحالة."); }
    finally { setSaving(false); }
  }

  async function generate(mode: AiMode) {
    if (!workspace || !form || readOnly) return;
    setAiMode(mode); setError(null); setNotice(null);
    try {
      const result = await invokeFunction("script-ai", { script_id: workspace.script.id, expected_edit_version: workspace.script.edit_version, mode });
      const generated = result.generated as Partial<EditorForm> | undefined;
      if (generated) {
        setForm((current) => current ? {
          ...current,
          hook_variants: Array.isArray(generated.hook_variants) ? generated.hook_variants.join("\n") : current.hook_variants,
          spoken_script: typeof generated.spoken_script === "string" ? generated.spoken_script : current.spoken_script,
          cta: typeof generated.cta === "string" ? generated.cta : current.cta,
          caption: typeof generated.caption === "string" ? generated.caption : current.caption,
          hashtags: Array.isArray(generated.hashtags) ? generated.hashtags.join("\n") : current.hashtags,
          recording_notes: typeof generated.recording_notes === "string" ? generated.recording_notes : current.recording_notes,
          editing_notes: typeof generated.editing_notes === "string" ? generated.editing_notes : current.editing_notes,
          thumbnail_notes: typeof generated.thumbnail_notes === "string" ? generated.thumbnail_notes : current.thumbnail_notes,
          on_screen_text: typeof generated.on_screen_text === "string" ? generated.on_screen_text : current.on_screen_text,
          b_roll_notes: typeof generated.b_roll_notes === "string" ? generated.b_roll_notes : current.b_roll_notes,
          claims_notes: typeof generated.claims_notes === "string" ? generated.claims_notes : current.claims_notes,
        } : current);
      }
      setNotice("تم توليد وحفظ نسخة AI جديدة. راجعها بشريًا قبل اعتبارها جاهزة.");
      await refresh();
    } catch (generateError) { setError(generateError instanceof Error ? generateError.message : "تعذّر توليد الاسكريبت."); }
    finally { setAiMode(null); }
  }

  async function handoff(event: FormEvent) {
    event.preventDefault(); if (!workspace) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      const result = await invokeFunction("script-commands", {
        action: "handoff", script_id: workspace.script.id, expected_edit_version: workspace.script.edit_version,
        publish_at: new Date(publishAt).toISOString(), content_creator_id: contentCreatorId,
        editing_owner_id: editingOwnerId, thumbnail_owner_id: thumbnailOwnerId, publishing_owner_id: publishingOwnerId,
      });
      setNotice("تم إنشاء خط الإنتاج كاملًا داخل مصنع المحتوى، بدون تكرار أو حفظ جزئي.");
      setShowHandoff(false); await refresh();
      const contentId = String(result.contentId ?? "");
      if (contentId) window.location.assign(`/content#content-${contentId}`);
    } catch (handoffError) { setError(handoffError instanceof Error ? handoffError.message : "تعذّر تسليم الاسكريبت."); }
    finally { setSaving(false); }
  }

  if (loading) return <section className="workspace-state"><LoaderCircle className="spin" size={24} /><div><h2>جارٍ فتح الاسكريبت</h2><p>نتحقق من الصلاحية ونحمّل آخر نسخة.</p></div></section>;
  if (!session) return <section className="workspace-state workspace-onboarding"><LockKeyhole size={27} /><div><h2>سجّل الدخول أولًا</h2><p>هذه صفحة خاصة بصاحب الاسكريبت والمالك.</p></div><Button href="/tasks">تسجيل الدخول</Button></section>;
  if (!workspace || !form) return <section className="workspace-state"><FilePenLine size={27} /><div><h2>تعذّر فتح الاسكريبت</h2><p>{error ?? "الاسكريبت غير موجود أو ليس لديك صلاحية."}</p></div><Button href="/scripts">العودة للاستوديو</Button></section>;

  const owner = workspace.membership.role === "owner";
  const status = scriptStatusConfig[workspace.script.status];
  const assignee = workspace.people.find((person) => person.id === workspace.script.assigned_to)?.name ?? "عضو فريق";

  return <section className="script-editor-workspace">
    <div className="script-editor-topbar"><Button href="/scripts" variant="ghost"><ArrowRight size={15} /> العودة للاستوديو</Button><div><StatusBadge tone={status.tone}>{status.label}</StatusBadge><span><UserRound size={13} /> {assignee}</span><span><FileClock size={13} /> النسخة {workspace.script.edit_version.toLocaleString("ar-EG")}</span></div></div>
    {error ? <p className="form-notice error">{error}</p> : null}
    {notice ? <p className="form-notice success">{notice}</p> : null}

    {readOnly ? <aside className="script-readonly-note"><CheckCircle2 size={18} /><div><strong>{workspace.script.status === "handed_off" ? "هذه هي النسخة التي دخلت مصنع المحتوى" : "الاسكريبت مؤرشف"}</strong><p>حافظنا على النسخة الأصلية للقراءة والمراجعة. أي تنفيذ لاحق يتم من مصنع المحتوى وليس بتعديل هذا الأصل.</p>{workspace.script.content_item_id ? <a href={`/content#content-${workspace.script.content_item_id}`}>فتح خط الإنتاج <ExternalLink size={13} /></a> : null}</div></aside> : null}

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
        <div><span className="script-ai-icon"><WandSparkles size={21} /></span><div><p className="overline">مساعد الكتابة</p><h2>AI يكتب داخل حدود بصمتك</h2><p>يرسل بيانات هذا الاسكريبت وبصمتك ومراجع البراند المعتمدة إلى مزوّد AI الافتراضي الذي اخترته في الإعدادات، وفقط عند ضغط زر. لا يتصفح المنافسين ولا ينشر شيئًا.</p></div></div>
        <div className="script-ai-actions"><Button type="button" disabled={Boolean(aiMode) || saving} onClick={() => void generate("idea")}>{aiMode === "idea" ? <LoaderCircle className="spin" size={15} /> : <Lightbulb size={15} />} اكتب من الفكرة</Button><Button type="button" variant="secondary" disabled={Boolean(aiMode) || saving || !form.source_url} onClick={() => void generate("reference")}>{aiMode === "reference" ? <LoaderCircle className="spin" size={15} /> : <Bot size={15} />} أعد بناء المرجع بطريقتي</Button><Button type="button" variant="secondary" disabled={Boolean(aiMode) || saving || form.spoken_script.length < 20} onClick={() => void generate("improve")}>{aiMode === "improve" ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />} حسّن مسودتي</Button></div>
      </section> : null}

      <section className="panel script-editor-section">
        <div className="section-heading"><div><p className="overline">الكلام أمام الكاميرا</p><h2>الهوك ونص الاسكريبت</h2><p>نص منطوق، مش مقال. عداد تقريبي يساعدك تقارن النص بالمدة المستهدفة.</p></div><div className="script-word-count"><strong>{wordCount.toLocaleString("ar-EG")}</strong><span>كلمة · نحو {estimatedSeconds.toLocaleString("ar-EG")} ثانية</span></div></div>
        <div className="script-fields-grid">
          <label><span>بدائل الهوك — واحد في كل سطر</span><textarea disabled={readOnly} value={form.hook_variants} onChange={(event) => update("hook_variants", event.target.value)} /></label>
          <label><span>الدعوة للإجراء CTA</span><textarea disabled={readOnly} value={form.cta} onChange={(event) => update("cta", event.target.value)} /></label>
          <label className="span-2"><span>نص الكلام النهائي</span><textarea className="spoken-script-textarea" disabled={readOnly} value={form.spoken_script} onChange={(event) => update("spoken_script", event.target.value)} placeholder="اكتب الكلام كما سيُقال فعلًا..." /></label>
        </div>
      </section>

      <section className="panel script-editor-section">
        <div className="section-heading"><div><p className="overline">التنفيذ</p><h2>تعليمات واضحة لباقي المصنع</h2><p>تنتقل هذه البيانات إلى المونتاج والغلاف والتسجيل عند التسليم.</p></div><Factory size={21} /></div>
        <div className="script-fields-grid execution-fields">
          <label><span>تعليمات التسجيل</span><textarea disabled={readOnly} value={form.recording_notes} onChange={(event) => update("recording_notes", event.target.value)} /></label>
          <label><span>تعليمات المونتاج</span><textarea disabled={readOnly} value={form.editing_notes} onChange={(event) => update("editing_notes", event.target.value)} /></label>
          <label><span>تعليمات الغلاف</span><textarea disabled={readOnly} value={form.thumbnail_notes} onChange={(event) => update("thumbnail_notes", event.target.value)} /></label>
          <label><span>النصوص على الشاشة</span><textarea disabled={readOnly} value={form.on_screen_text} onChange={(event) => update("on_screen_text", event.target.value)} /></label>
          <label><span>B-roll وصور ومصادر بصرية</span><textarea disabled={readOnly} value={form.b_roll_notes} onChange={(event) => update("b_roll_notes", event.target.value)} /></label>
          <label><span>حقائق تحتاج مراجعة أو تنبيه امتثال</span><textarea disabled={readOnly} value={form.claims_notes} onChange={(event) => update("claims_notes", event.target.value)} /></label>
        </div>
      </section>

      <section className="panel script-editor-section">
        <div className="section-heading"><div><p className="overline">بعد التسجيل</p><h2>الكابشن والهاشتاجات</h2><p>صانع المحتوى يراجعهم مع الاسكريبت؛ موظف النشر يجد النسخة جاهزة لاحقًا.</p></div></div>
        <div className="script-fields-grid"><label className="span-2"><span>الكابشن</span><textarea className="caption-textarea" disabled={readOnly} value={form.caption} onChange={(event) => update("caption", event.target.value)} /></label><label className="span-2"><span>الهاشتاجات — واحد في كل سطر</span><textarea disabled={readOnly} value={form.hashtags} onChange={(event) => update("hashtags", event.target.value)} /></label></div>
      </section>

      {!readOnly ? <div className="script-save-bar"><label><span>ملاحظة النسخة</span><input value={versionNote} maxLength={500} onChange={(event) => setVersionNote(event.target.value)} /></label><Button type="submit" disabled={saving || Boolean(aiMode)}>{saving ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />} حفظ نسخة جديدة</Button></div> : null}
    </form>

    <section className="panel script-status-panel">
      <div className="section-heading"><div><p className="overline">الحالة</p><h2>خطوة واحدة قبل مصنع المحتوى</h2><p>لا نكرر التسجيل والمونتاج والمراجعة هنا؛ هذه المراحل تبدأ في المصنع بعد التسليم.</p></div><StatusBadge tone={status.tone}>{status.label}</StatusBadge></div>
      <div className="script-status-actions">
        {workspace.script.status === "draft" ? <Button type="button" disabled={saving || form.spoken_script.trim().length < 20 || form.cta.trim().length < 2} onClick={() => void changeStatus("ready_to_record")}><CheckCircle2 size={15} /> اعتبره جاهزًا للتسجيل</Button> : null}
        {workspace.script.status === "ready_to_record" ? <><Button type="button" variant="secondary" disabled={saving} onClick={() => void changeStatus("draft")}><RefreshCw size={15} /> إرجاع لمسودة</Button>{owner ? <Button type="button" onClick={() => setShowHandoff((value) => !value)}><Factory size={15} /> تسليم لمصنع المحتوى</Button> : <span className="script-owner-action-note">تم إشعار المالك؛ هو الذي يحدد فريق الإنتاج والموعد.</span>}</> : null}
        {workspace.script.status !== "archived" ? <Button type="button" variant="ghost" disabled={saving} onClick={() => void changeStatus("archived")}><Archive size={15} /> أرشفة</Button> : null}
        {workspace.script.status === "archived" && !workspace.script.content_item_id ? <Button type="button" variant="secondary" disabled={saving} onClick={() => void changeStatus("draft")}><RefreshCw size={15} /> استعادة كمسودة</Button> : null}
      </div>
      {showHandoff && owner ? <form className="script-handoff-form" onSubmit={(event) => void handoff(event)}><div className="script-handoff-heading"><Factory size={19} /><div><strong>التسليم الذري</strong><p>إما يُنشأ أصل المحتوى ومهام التسجيل والمونتاج والغلاف والنشر معًا، أو لا يُحفظ شيء.</p></div></div><div className="script-fields-grid"><label><span>موعد النشر</span><input required type="datetime-local" value={publishAt} onChange={(event) => setPublishAt(event.target.value)} /></label><label><span>التسجيل وصناعة المحتوى</span><select value={contentCreatorId} onChange={(event) => setContentCreatorId(event.target.value)}>{workspace.people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label><span>المونتاج</span><select value={editingOwnerId} onChange={(event) => setEditingOwnerId(event.target.value)}>{workspace.people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label><span>الغلاف</span><select value={thumbnailOwnerId} onChange={(event) => setThumbnailOwnerId(event.target.value)}>{workspace.people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label><span>النشر</span><select value={publishingOwnerId} onChange={(event) => setPublishingOwnerId(event.target.value)}>{workspace.people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label></div><div className="form-actions"><Button type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={15} /> : <Factory size={15} />} إنشاء خط الإنتاج</Button><Button type="button" variant="ghost" onClick={() => setShowHandoff(false)}>إلغاء</Button></div></form> : null}
    </section>

    <section className="panel script-history-panel">
      <div className="section-heading"><div><p className="overline">سجل النسخ</p><h2>ما الذي حُفظ ومتى؟</h2><p>السجل غير قابل للتعديل من المتصفح ويحفظ لقطة كاملة من كل نسخة.</p></div><History size={21} /></div>
      {workspace.versions.length ? <ol>{workspace.versions.map((version) => <li key={version.id}><span><strong>v{version.version_number.toLocaleString("ar-EG")}</strong><small>{version.source === "ai_generation" ? "AI" : version.source === "handoff" ? "تسليم للمصنع" : "حفظ يدوي"}</small></span><div><strong>{version.note || "بدون ملاحظة"}</strong><small>{formatScriptDate(version.created_at)}</small></div></li>)}</ol> : <p className="tool-empty">لا توجد نسخ مسجلة.</p>}
    </section>
  </section>;
}
