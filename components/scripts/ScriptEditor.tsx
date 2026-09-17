"use client";

import { DateInput } from "../ui/DateInput";

import type { Session } from "@supabase/supabase-js";
import {
  Archive, ArrowRight, Bot, CheckCircle2, ExternalLink, Factory, FilePenLine, MoreHorizontal, Plus,
  Lightbulb, LoaderCircle, LockKeyhole, Pause, Play, RefreshCw, Save, Sparkles, Trash2, WandSparkles, X,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatScriptDate, lines, scriptContentKindConfig, type ScriptContentKind, scriptDisplayStatus, scriptInputModeConfig, scriptPlatformConfig } from "../../lib/scripts";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Tables } from "../../lib/supabase/database.types";
import { useWorkspaceAuth } from "../../lib/supabase/use-workspace-auth";
import { Button } from "../ui/Button";
import { ScriptToolPanel } from "./ScriptToolPanel";
import { StatusBadge } from "../ui/StatusBadge";

type Membership = Tables<"memberships">;
type Organization = Tables<"organizations">;
type Script = Tables<"scripts">;
type ScriptVersion = Tables<"script_versions">;
type Person = { id: string; name: string; role: Membership["role"]; allowedSections: string[] };
type ReviewGrant = Tables<"script_review_access">;
type ReviewComment = Tables<"script_review_comments">;
type Workspace = { organization: Organization; membership: Membership; people: Person[]; storyBank: string[]; script: Script; versions: ScriptVersion[]; reviewGrants: ReviewGrant[]; reviewComments: ReviewComment[] };
type WritingMode = "idea" | "reference" | "improve";
type AiScope = "script_variants" | "hooks" | "angles" | "single_draft" | "rewrite_excerpt" | "production_pack" | "recording" | "editing" | "thumbnail" | "caption";
type WritingAngle = { title: string; hook: string; core_idea: string };
type RewriteAction = "my_voice" | "shorten" | "simplify" | "chart_example" | "stronger_hook" | "target_duration";
const rewriteLabels: Record<RewriteAction, string> = {
  my_voice: "خليها بطريقتي", shorten: "اختصر", simplify: "بسّط",
  chart_example: "ضيف مثال شارت", stronger_hook: "قوّي الهوك", target_duration: "اختصر للمدة المطلوبة",
};
type ScriptVariant = { label: string; hook: string; spoken_script: string; cta: string };
type CaptionOption = { label: string; caption: string; hashtags: string[] };
type ThumbnailOption = { label: string; cover_text: string; visual_direction: string; script_connection: string };
type EditorForm = {
  title: string; content_kind: ScriptContentKind; input_mode: Script["input_mode"]; source_url: string; source_text: string;
  objective: string; audience: string; platform: string; duration_seconds: string; content_pillar: string;
  hook_variants: string; spoken_script: string; caption: string; hashtags: string;
  recording_notes: string; editing_notes: string; thumbnail_notes: string; on_screen_text: string;
  b_roll_notes: string; claims_notes: string;
};

function formFromScript(script: Script): EditorForm {
  return {
    title: script.title, content_kind: script.content_kind as ScriptContentKind, input_mode: script.input_mode, source_url: script.source_url ?? "", source_text: script.source_text ?? "",
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
  return `الاختيار المعتمد: ${option.label}\nالنص على الغلاف: ${option.cover_text}\nالاتجاه البصري: ${option.visual_direction}\nصلته بالاسكريبت: ${option.script_connection}`;
}

function canReceiveTasks(person: Person) {
  return person.role !== "viewer" && (person.role === "owner" || person.allowedSections.includes("tasks"));
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
  const [angles, setAngles] = useState<WritingAngle[]>([]);
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
  const [teleprompterOpen, setTeleprompterOpen] = useState(false);
  const [teleprompterPlaying, setTeleprompterPlaying] = useState(false);
  const [teleprompterFontSize, setTeleprompterFontSize] = useState(40);
  const [teleprompterSpeed, setTeleprompterSpeed] = useState(28);
  const teleprompterText = useRef<HTMLDivElement>(null);
  const spokenTextInput = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<EditorForm | null>(null);
  const [rewritePreview, setRewritePreview] = useState<{ action: RewriteAction; original: string; suggestion: string; base: string; start: number; end: number } | null>(null);
  const [autosaveState, setAutosaveState] = useState<"saved" | "pending" | "saving" | "failed">("saved");
  const [recoverableText, setRecoverableText] = useState<string | null>(null);
  const autosaveInFlight = useRef(false);
  const handoffInFlight = useRef(false);
  const [restorePending, setRestorePending] = useState(false);
  const [compareLeft, setCompareLeft] = useState("");
  const [compareRight, setCompareRight] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [reviewComment, setReviewComment] = useState("");
  const [editorPanel, setEditorPanel] = useState<"properties" | "assistant" | "hooks" | "production" | "actions" | "review" | "versions" | null>(null);
  const [selectionActive, setSelectionActive] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [rewriteToolsOpen, setRewriteToolsOpen] = useState(false);
  const editorMenu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (!teleprompterOpen || !teleprompterPlaying) return;
    let frame = 0;
    let previous = 0;
    const advance = (timestamp: number) => {
      if (previous && teleprompterText.current) teleprompterText.current.scrollTop += teleprompterSpeed * (timestamp - previous) / 1000;
      previous = timestamp;
      frame = requestAnimationFrame(advance);
    };
    frame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frame);
  }, [teleprompterOpen, teleprompterPlaying, teleprompterSpeed]);

  const clearWorkspace = useCallback(() => { setWorkspace(null); setForm(null); }, []);
  const clearTransientState = useCallback(() => { setError(null); setNotice(null); }, []);
  const loadScriptRows = useCallback(async (base: Omit<Workspace, "script" | "versions" | "reviewGrants" | "reviewComments">) => {
    const supabase = getSupabaseBrowserClient();
    const [scriptResult, versionsResult, grantsResult, commentsResult] = await Promise.all([
      supabase.from("scripts").select("*").eq("id", scriptId).maybeSingle(),
      supabase.from("script_versions").select("*").eq("script_id", scriptId).order("version_number", { ascending: false }).limit(30),
      supabase.from("script_review_access").select("*").eq("script_id", scriptId),
      supabase.from("script_review_comments").select("*").eq("script_id", scriptId).order("created_at", { ascending: true }).limit(100),
    ]);
    if (scriptResult.error) throw scriptResult.error;
    if (!scriptResult.data) throw new Error("الاسكريبت غير موجود أو ليس لديك صلاحية لفتحه.");
    if (versionsResult.error) throw versionsResult.error;
    if (grantsResult.error) throw grantsResult.error;
    if (commentsResult.error) throw commentsResult.error;
    const loadedScript = scriptResult.data;
    setWorkspace({ ...base, script: loadedScript, versions: versionsResult.data ?? [], reviewGrants: grantsResult.data ?? [], reviewComments: commentsResult.data ?? [] });
    const loadedForm = formFromScript(loadedScript);
    formRef.current = loadedForm;
    setForm(loadedForm);
    setRewritePreview(null);
    setAutosaveState("saved");
    setRestorePending(false);
    const storageKey = `market-whales-script-draft:${base.membership.user_id}:${scriptId}`;
    try {
      const local = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { text?: unknown; updatedAt?: unknown } | null;
      setRecoverableText(typeof local?.text === "string" && local.text !== loadedScript.spoken_script ? local.text : null);
    } catch { setRecoverableText(null); }
    const assignablePeople = base.people.filter(canReceiveTasks);
    setReviewerId((current) => base.people.some((person) => person.id === current) ? current : "");
    const assignableIds = new Set(assignablePeople.map((person) => person.id));
    const fallback = assignablePeople.find((person) => person.role === "owner")?.id ?? assignablePeople[0]?.id ?? "";
    setContentCreatorId(assignableIds.has(loadedScript.assigned_to) ? loadedScript.assigned_to : fallback);
    setEditingOwnerId((value) => assignableIds.has(value) ? value : fallback);
    setThumbnailOwnerId((value) => assignableIds.has(value) ? value : fallback);
    setPublishingOwnerId((value) => assignableIds.has(value) ? value : fallback);
  }, [scriptId, setRewritePreview]);

  const loadWorkspace = useCallback(async (activeSession: Session) => {
    const supabase = getSupabaseBrowserClient(); setLoading(true);
    try {
      const { data: membership, error: membershipError } = await supabase.from("memberships").select("*").eq("user_id", activeSession.user.id).eq("status", "active").limit(1).maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) { clearWorkspace(); return; }
      const [organizationResult, membershipsResult, voiceProfileResult] = await Promise.all([
        supabase.from("organizations").select("*").eq("id", membership.organization_id).single(),
        supabase.from("memberships").select("*").eq("organization_id", membership.organization_id).eq("status", "active"),
        supabase.from("script_voice_profiles").select("story_bank").eq("organization_id", membership.organization_id).eq("user_id", activeSession.user.id).maybeSingle(),
      ]);
      if (organizationResult.error) throw organizationResult.error;
      if (membershipsResult.error) throw membershipsResult.error;
      if (voiceProfileResult.error) throw voiceProfileResult.error;
      const ids = (membershipsResult.data ?? []).map((row) => row.user_id);
      const { data: profiles, error: profilesError } = ids.length ? await supabase.from("profiles").select("id, full_name").in("id", ids) : { data: [], error: null };
      if (profilesError) throw profilesError;
      const people = (membershipsResult.data ?? []).map((row) => ({
        id: row.user_id, role: row.role, allowedSections: row.allowed_sections,
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
  const refreshReviews = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    const [grants, comments] = await Promise.all([
      supabase.from("script_review_access").select("*").eq("script_id", scriptId),
      supabase.from("script_review_comments").select("*").eq("script_id", scriptId).order("created_at", { ascending: true }).limit(100),
    ]);
    if (grants.error) throw grants.error;
    if (comments.error) throw comments.error;
    setWorkspace((current) => current ? { ...current, reviewGrants: grants.data ?? [], reviewComments: comments.data ?? [] } : current);
  }, [scriptId]);

  async function setReviewAccess(reviewer: string, allow: boolean) {
    if (!workspace || !assignedWriter) return;
    setSaving(true); setError(null);
    try {
      await invokeFunction("script-commands", { action: "share_review", script_id: scriptId, reviewer_id: reviewer, allow_review: allow });
      setNotice(allow ? "تمت مشاركة هذا السكريبت فقط للمراجعة والتعليق، من غير كشف بصمتك." : "اتلغت المشاركة؛ العضو مش هيقدر يفتح السكريبت أو تعليقات المراجعة.");
      await refreshReviews();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذّر تعديل المشاركة."); }
    finally { setSaving(false); }
  }

  async function postReviewComment(event: FormEvent) {
    event.preventDefault(); if (!workspace || !reviewComment.trim()) return;
    setSaving(true); setError(null);
    try {
      await invokeFunction("script-commands", { action: "comment_review", script_id: scriptId, comment: reviewComment });
      setReviewComment(""); setNotice("التعليق وصل في مراجعة هذا السكريبت فقط."); await refreshReviews();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذّر حفظ التعليق."); }
    finally { setSaving(false); }
  }
  const update = useCallback(<K extends keyof EditorForm>(key: K, value: EditorForm[K]) => {
    if (formRef.current) formRef.current = { ...formRef.current, [key]: value };
    setForm((current) => current ? { ...current, [key]: value } : current); setNotice(null);
    if (key === "spoken_script") setAutosaveState("pending");
  }, []);

  async function rewrite(action: RewriteAction) {
    if (!workspace || !form || readOnly || aiScope) return;
    const input = spokenTextInput.current;
    const base = form.spoken_script;
    const selected = input && input.selectionStart !== input.selectionEnd;
    const start = selected ? input.selectionStart : 0;
    const end = selected ? input.selectionEnd : base.length;
    const original = base.slice(start, end);
    if (!original.trim()) return setError("اكتب النص أولًا، ثم حدد فقرة أو عدّل النص كله.");
    setAiScope("rewrite_excerpt"); setRewritePreview(null); setError(null); setNotice(null);
    try {
      const result = await invokeFunction("script-ai", {
        script_id: workspace.script.id, expected_edit_version: workspace.script.edit_version,
        mode: "improve", scope: "rewrite_excerpt", rewrite_action: action, selected_text: original,
      });
      const suggestion = String((result.generated as { rewritten_text?: string } | undefined)?.rewritten_text ?? "");
      if (!suggestion) throw new Error("لم يصل اقتراح صالح؛ لم يتغير النص.");
      if (formRef.current?.spoken_script !== base) {
        setError("النص اتغيّر أثناء تجهيز الاقتراح. احتفظنا بتعديلك اليدوي، واطلب اقتراحًا جديدًا لو محتاج.");
        return;
      }
      setRewritePreview({ action, original, suggestion, base, start, end });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذّر تعديل المقطع."); }
    finally { setAiScope(null); }
  }

  function acceptRewrite() {
    if (!rewritePreview) return;
    if (formRef.current?.spoken_script !== rewritePreview.base) {
      setRewritePreview(null); setError("النص اتغيّر منذ إنشاء المعاينة؛ رفضنا الاستبدال حتى لا تضيع تعديلاتك.");
      return;
    }
    update("spoken_script", rewritePreview.base.slice(0, rewritePreview.start) + rewritePreview.suggestion + rewritePreview.base.slice(rewritePreview.end));
    setRewritePreview(null);
    setNotice("الاقتراح دخل المحرر فقط؛ راجعه واحفظه لو مناسب.");
  }

  const assignedWriter = Boolean(workspace && session && workspace.script.assigned_to === session.user.id);
  const canWriteScript = assignedWriter && workspace?.membership.role !== "viewer";
  const readOnly = !canWriteScript || workspace?.script.status === "handed_off" || workspace?.script.status === "archived";
  const assignablePeople = useMemo(() => workspace?.people.filter(canReceiveTasks) ?? [], [workspace?.people]);
  const wordCount = useMemo(() => form?.spoken_script.trim().split(/\s+/).filter(Boolean).length ?? 0, [form?.spoken_script]);
  const estimatedSeconds = Math.max(0, Math.round(wordCount / 2.15));
  const writingHasUnsavedChanges = useMemo(() => {
    if (!workspace || !form) return false;
    return form.title !== workspace.script.title || form.objective !== workspace.script.objective
      || form.content_kind !== workspace.script.content_kind || form.input_mode !== workspace.script.input_mode
      || form.audience !== workspace.script.audience || form.platform !== workspace.script.platform
      || Number(form.duration_seconds) !== workspace.script.duration_seconds || form.content_pillar !== (workspace.script.content_pillar ?? "")
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

  useEffect(() => {
    if (!workspace || !form || readOnly || saving || restorePending || form.spoken_script === workspace.script.spoken_script) return;
    const storageKey = `market-whales-script-draft:${workspace.membership.user_id}:${scriptId}`;
    try { localStorage.setItem(storageKey, JSON.stringify({ text: form.spoken_script, updatedAt: Date.now() })); }
    catch { /* Server save remains available if local browser storage is full or unavailable. */ }
    const snapshot = form.spoken_script;
    const expected = workspace.script.edit_version;
    const timer = window.setTimeout(async () => {
      if (autosaveInFlight.current) return;
      autosaveInFlight.current = true; setAutosaveState("saving");
      try {
        const result = await invokeFunction("script-commands", {
          action: "autosave_script_text", script_id: scriptId,
          expected_edit_version: expected, spoken_script: snapshot,
        });
        const nextVersion = Number(result.editVersion);
        if (!Number.isSafeInteger(nextVersion) || nextVersion < expected) throw new Error("لم نتأكد من حفظ المسودة؛ حاول مرة أخرى.");
        setWorkspace((current) => current && current.script.id === scriptId && current.script.edit_version === expected
          ? { ...current, script: { ...current.script, spoken_script: snapshot, edit_version: nextVersion,
            status: current.script.status === "ready_to_record" ? "draft" : current.script.status,
            production_pack_stale: current.script.production_pack_source_version !== null || current.script.production_pack_stale } }
          : current);
        if (formRef.current?.spoken_script === snapshot) {
          setAutosaveState("saved"); setRecoverableText(null);
          try { localStorage.removeItem(storageKey); } catch { /* Keep the server-saved draft. */ }
        }
      } catch (cause) {
        setAutosaveState("failed");
        setError(cause instanceof Error && /another session|جلسة أخرى|اتعدل/.test(cause.message)
          ? "في نسخة أحدث من تبويب آخر. احتفظنا بكلامك على هذا الجهاز؛ حدّث الصفحة ثم راجع النسختين قبل أي حفظ."
          : "تعذّر الحفظ التلقائي. احتفظنا بالمسودة على هذا الجهاز، ويمكنك إعادة المحاولة.");
      } finally { autosaveInFlight.current = false; }
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [form, workspace, readOnly, saving, restorePending, scriptId]);

  async function save(event?: FormEvent) {
    event?.preventDefault(); if (!workspace || !form || readOnly) return;
    if (autosaveInFlight.current) { setError("الحفظ التلقائي جارٍ الآن؛ انتظر لحظة ثم احفظ النسخة المهمة."); return; }
    setSaving(true); setError(null); setNotice(null);
    try {
      await invokeFunction("script-commands", {
        action: "save_script", script_id: workspace.script.id, expected_edit_version: workspace.script.edit_version,
        ...form, duration_seconds: Number(form.duration_seconds), hook_variants: lines(form.hook_variants), hashtags: lines(form.hashtags),
        version_note: versionNote,
      });
      setVersionNote(""); setScriptVariants([]);
      setRestorePending(false);
      if (writingHasUnsavedChanges) { setCaptionOptions([]); setThumbnailOptions([]); }
      setNotice(workspace.script.status === "ready_to_record" && writingHasUnsavedChanges
        ? "تم حفظ النص وإرجاعه إلى «قيد الكتابة» لأن النسخة المعتمدة اتغيرت."
        : "تم حفظ نسخة جديدة.");
      await refresh();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "تعذّر حفظ الاسكريبت."); }
    finally { setSaving(false); }
  }

  async function changeStatus(status: "draft" | "ready_to_record" | "archived") {
    if (!workspace || !form || !canWriteScript) return;
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

  async function deleteScript() {
    if (!workspace || !canWriteScript || workspace.script.status !== "archived" || workspace.script.content_item_id) return;
    if (!window.confirm(`حذف «${workspace.script.title}» نهائيًا؟\n\nلن يمكن استرجاع النص أو سجل نسخه بعد الحذف.`)) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      await invokeFunction("script-commands", { action: "delete_script", script_id: workspace.script.id, expected_edit_version: workspace.script.edit_version });
      window.location.assign("/scripts");
    } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : "تعذّر حذف الاسكريبت."); setSaving(false); }
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
        ? `عدد البدائل السليمة: ${variants.length}. دي معاينة فقط؛ اختر نسخة ثم احفظها بنفسك، ولم نغيّر الاسكريبت أو طلبات التنفيذ.${guardNotice}`
        : `عدد الهوكات السليمة: ${hooks.length}. ظهرت داخل المحرر ولم تُحفظ بعد.${guardNotice}`);
    } catch (generateError) { setError(generateError instanceof Error ? generateError.message : "تعذّر توليد بدائل الكتابة."); }
    finally { setAiScope(null); }
  }

  async function generateAngles() {
    if (!workspace || !form || readOnly || aiScope) return;
    if (writingHasUnsavedChanges) { setError("احفظ الفكرة أولًا حتى نبني الزوايا على أحدث نسخة."); return; }
    const title = form.title; const sourceText = form.source_text; const objective = form.objective;
    setAiScope("angles"); setAngles([]); setScriptVariants([]); setError(null);
    try {
      const result = await invokeFunction("script-ai", {
        script_id: workspace.script.id, expected_edit_version: workspace.script.edit_version,
        mode: "idea", scope: "angles", generation_direction: generationDirection, selected_story: selectedStory,
      });
      const proposed = (result.generated as { angles?: WritingAngle[] } | undefined)?.angles;
      if (formRef.current?.title !== title || formRef.current?.source_text !== sourceText || formRef.current?.objective !== objective) {
        setError("الفكرة اتغيرت أثناء التوليد؛ اطلب زوايا جديدة بدل عرض اقتراحات قديمة."); return;
      }
      if (!Array.isArray(proposed) || proposed.length !== 3) throw new Error("لم تصل زوايا كاملة.");
      setAngles(proposed); setNotice("اختر زاوية واحدة، وبعدها نجهز مسودة واحدة تراجعها قبل وضعها في المحرر.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذّر اقتراح الزوايا."); }
    finally { setAiScope(null); }
  }

  async function draftFromAngle(angle: WritingAngle) {
    if (!workspace || !form || readOnly || aiScope) return;
    if (writingHasUnsavedChanges) { setError("احفظ آخر تعديلات الفكرة أو النص أولًا."); return; }
    const currentText = form.spoken_script;
    setAiScope("single_draft"); setScriptVariants([]); setError(null);
    try {
      const result = await invokeFunction("script-ai", {
        script_id: workspace.script.id, expected_edit_version: workspace.script.edit_version,
        mode: "idea", scope: "single_draft",
        selected_angle: `${angle.title}\n${angle.hook}\n${angle.core_idea}`,
        selected_story: selectedStory,
      });
      const draft = (result.generated as { draft?: { spoken_script: string; hook: string } } | undefined)?.draft;
      if (formRef.current?.spoken_script !== currentText) {
        setError("النص اتعدل أثناء التوليد؛ لم نستبدل تعديلاتك، واطلب المسودة من جديد لو محتاج."); return;
      }
      if (!draft?.spoken_script) throw new Error("المسودة لم تصل كاملة.");
      setScriptVariants([{ label: angle.title, hook: draft.hook, spoken_script: draft.spoken_script, cta: "" }]);
      setNotice("المسودة ظاهرة للمعاينة فقط؛ اضغط «اختيار هذه النسخة» لو حابب تدخلها المحرر.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذّر توليد المسودة."); }
    finally { setAiScope(null); }
  }

  function chooseVariant(variant: ScriptVariant) {
    if (!form) return;
    const hooks = lines(`${variant.hook}\n${form.hook_variants}`);
    const next = { ...form, spoken_script: variant.spoken_script, hook_variants: hooks.join("\n") };
    formRef.current = next;
    setForm(next); setAutosaveState("pending");
    setEditorPanel(null);
    setNotice(`تم وضع «${variant.label}» داخل المحرر فقط. عدّلها براحتك ثم اضغط حفظ.`);
  }

  async function generateProduction(scope: Exclude<AiScope, "script_variants" | "hooks">) {
    if (!workspace || readOnly || workspace.script.status !== "ready_to_record") return;
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
    if (!form || readOnly) return;
    setForm({ ...form, caption: option.caption, hashtags: option.hashtags.join("\n") });
    setNotice(`تم تحديد كابشن «${option.label}» بعلامة صح داخل المحرر. راجعه ثم اضغط حفظ لاعتماده.`);
  }

  function chooseThumbnailOption(option: ThumbnailOption) {
    if (!form || readOnly) return;
    setForm({ ...form, thumbnail_notes: thumbnailOptionText(option) });
    setNotice(`تم اختيار غلاف «${option.label}» ونسخ تفاصيله إلى تعليمات الغلاف. راجعه ثم اضغط حفظ ليصل بنفس النص إلى مهمة المصمم.`);
  }

  async function approveVoiceSample() {
    if (!workspace || !form || !canWriteScript) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      await invokeFunction("script-commands", { action: "approve_voice_sample", script_id: workspace.script.id, expected_edit_version: workspace.script.edit_version });
      setNotice(`تم اعتماد النص الحالي كعينة خاصة بنوع «${scriptContentKindConfig[form.content_kind]}»؛ تقدر تستبعدها أو تغيّر تصنيفها من «بصمتي».`);
    } catch (approveError) { setError(approveError instanceof Error ? approveError.message : "تعذّر اعتماد النص كعينة لصوتك."); }
    finally { setSaving(false); }
  }

  async function handoff(event: FormEvent) {
    event.preventDefault(); if (!workspace || !canWriteScript || handoffInFlight.current) return;
    const selectedOwnerIds = [contentCreatorId, editingOwnerId, thumbnailOwnerId, publishingOwnerId];
    if (selectedOwnerIds.some((ownerId) => !assignablePeople.some((person) => person.id === ownerId))) {
      setError("اختر مسؤولًا نشطًا لديه صلاحية المهام لكل خطوة.");
      return;
    }
    if (writingHasUnsavedChanges || productionHasUnsavedChanges) { setError("احفظ كل التعديلات أولًا قبل تسليم النسخة لطلبات التنفيذ."); return; }
    handoffInFlight.current = true; setSaving(true); setError(null); setNotice(null);
    try {
      const result = await invokeFunction("script-commands", {
        action: "handoff", script_id: workspace.script.id, expected_edit_version: workspace.script.edit_version,
        publish_at: new Date(publishAt).toISOString(), content_creator_id: contentCreatorId,
        editing_owner_id: editingOwnerId, thumbnail_owner_id: thumbnailOwnerId, publishing_owner_id: publishingOwnerId,
      });
      setNotice("تم إنشاء طلب التنفيذ ومهام الأشخاص المطلوبة."); setShowHandoff(false); await refresh();
      const contentId = String(result.contentId ?? ""); if (contentId) window.location.assign(`/content?content=${contentId}#content-${contentId}`);
    } catch (handoffError) { setError(handoffError instanceof Error ? handoffError.message : "تعذّر تسليم الاسكريبت."); }
    finally { handoffInFlight.current = false; setSaving(false); }
  }

  useEffect(() => {
    const input = spokenTextInput.current;
    if (!input) return;
    let cancelled = false;
    let width = input.clientWidth;
    const fitText = () => {
      if (cancelled) return;
      input.style.height = "auto";
      input.style.height = Math.max(320, input.scrollHeight + 2) + "px";
    };
    fitText();
    const observer = new ResizeObserver(() => {
      if (input.clientWidth !== width) { width = input.clientWidth; fitText(); }
    });
    observer.observe(input);
    void document.fonts.ready.then(fitText);
    return () => { cancelled = true; observer.disconnect(); };
  }, [form?.spoken_script, loading]);

  useEffect(() => {
    if (!writingHasUnsavedChanges && !productionHasUnsavedChanges && !restorePending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [writingHasUnsavedChanges, productionHasUnsavedChanges, restorePending]);

  function openPanel(panel: typeof editorPanel) {
    if (editorMenu.current) editorMenu.current.open = false;
    setEditorPanel(panel);
  }

  function insertLine(prefix: string) {
    const input = spokenTextInput.current;
    if (!input || !form || readOnly) return;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const slash = form.spoken_script[start - 1] === "/" ? start - 1 : start;
    const before = form.spoken_script.slice(0, slash);
    const inserted = (before && !before.endsWith("\n") ? "\n" : "") + prefix;
    update("spoken_script", before + inserted + form.spoken_script.slice(end));
    setSlashOpen(false);
    requestAnimationFrame(() => { input.focus(); input.setSelectionRange(slash + inserted.length, slash + inserted.length); });
  }

  if (loading) return <section className="workspace-state"><LoaderCircle className="spin" size={24} /><div><h2>جارٍ فتح الاسكريبت</h2><p>نتحقق من الصلاحية ونحمّل آخر نسخة.</p></div></section>;
  if (!session) return <section className="workspace-state workspace-onboarding"><LockKeyhole size={27} /><div><h2>سجّل الدخول أولًا</h2><p>هذه الصفحة لصاحب الاسكريبت أو عضو دعاه للمراجعة فقط.</p></div><Button href="/tasks">تسجيل الدخول</Button></section>;
  if (!workspace || !form) return <section className="workspace-state"><FilePenLine size={27} /><div><h2>تعذّر فتح الاسكريبت</h2><p>{error ?? "الاسكريبت غير موجود أو ليس لديك صلاحية."}</p></div><Button href="/scripts">العودة للاستوديو</Button></section>;

  const status = scriptDisplayStatus(workspace.script);

  const latestVersionIsManual = workspace.versions[0]?.source === "manual_save"
    && workspace.versions[0]?.version_number === workspace.script.edit_version;
  const spokenScriptHasUnsavedChanges = form.spoken_script !== workspace.script.spoken_script;
  const packExists = workspace.script.production_pack_source_version !== null;
  const packStale = workspace.script.production_pack_stale;
  const showProduction = readOnly || workspace.script.status === "ready_to_record";
  const thumbnailInstructionsSaved = Boolean(form.thumbnail_notes.trim()) && form.thumbnail_notes === workspace.script.thumbnail_notes;
  const leftVersion = workspace.versions.find((version) => version.id === compareLeft);
  const rightVersion = workspace.versions.find((version) => version.id === compareRight);
  const versionText = (version?: ScriptVersion) => version?.snapshot && typeof version.snapshot === "object" && !Array.isArray(version.snapshot)
    ? String((version.snapshot as Record<string, unknown>).spoken_script ?? "") : "";

  return <section className="script-editor-workspace script-document">
    <div className="script-document-toolbar">
      <Button href="/scripts" variant="ghost"><ArrowRight size={16} /> السكريبتات</Button>
      <div className="script-document-toolbar-actions">
        <span role="status" className={"script-autosave-state " + autosaveState}>{saving || autosaveState === "saving" ? "جارٍ الحفظ…" : autosaveState === "failed" ? "تعذّر الحفظ" : writingHasUnsavedChanges || productionHasUnsavedChanges || restorePending ? "تعديلات غير محفوظة" : "تم الحفظ"}</span>
        {!readOnly && (writingHasUnsavedChanges || productionHasUnsavedChanges || restorePending) ? <Button type="button" variant="secondary" disabled={saving || autosaveState === "saving"} onClick={() => void save()}><Save size={15} /> حفظ</Button> : null}
        <details className="script-document-menu" ref={editorMenu}><summary aria-label="المزيد من أدوات السكريبت"><MoreHorizontal size={22} /></summary><div>
          {!readOnly ? <button type="button" onClick={() => openPanel("assistant")}>مساعد الكتابة</button> : null}
          <button type="button" onClick={() => openPanel("hooks")}>الهوكات</button>
          <button type="button" onClick={() => openPanel("versions")}>النسخ السابقة والبصمة</button>
          <button type="button" onClick={() => openPanel("review")}>المشاركة والتعليقات ({workspace.reviewComments.length})</button>
          {showProduction ? <button type="button" onClick={() => openPanel("production")}>تعليمات التنفيذ</button> : null}
          {canWriteScript ? <button type="button" onClick={() => openPanel("actions")}>الحالة والأرشفة</button> : null}
          {assignedWriter ? <a href="/scripts?tab=voice">بصمتي</a> : null}
        </div></details>
        <Button type="button" variant="ghost" disabled={!form.spoken_script.trim()} onClick={() => { setTeleprompterOpen(true); setTeleprompterPlaying(false); }}>وضع التصوير</Button>
        {!readOnly && workspace.script.status === "draft" ? <Button type="button" disabled={saving || Boolean(aiScope) || writingHasUnsavedChanges || form.spoken_script.trim().length < 20} onClick={() => void changeStatus("ready_to_record")}><CheckCircle2 size={15} /> جاهز للتصوير</Button> : null}
        {!readOnly && workspace.script.status === "ready_to_record" ? <Button type="button" onClick={() => openPanel("production")}><Factory size={15} /> تجهيز التنفيذ</Button> : null}
      </div>
    </div>
    {error ? <p className="form-notice error">{error}</p> : null}
    {notice ? <p className="form-notice success">{notice}</p> : null}
    {readOnly ? <aside className="script-readonly-note"><CheckCircle2 size={18} /><div><strong>{!assignedWriter ? "مشاركة للمراجعة فقط" : workspace.script.status === "handed_off" ? "هذه هي النسخة التي دخلت طلبات التنفيذ" : "الاسكريبت مؤرشف"}</strong><p>{!assignedWriter ? "تقدر تعلق على هذا السكريبت فقط؛ الكتابة والتوليد والبصمة وبقية السكريبتات خاصة بصاحبها." : "أي تنفيذ لاحق يتم من طلب التنفيذ وليس بتعديل هذا الأصل."}</p>{workspace.script.content_item_id ? <a href={`/content?content=${workspace.script.content_item_id}#content-${workspace.script.content_item_id}`}>فتح طلب التنفيذ <ExternalLink size={13} /></a> : null}</div></aside> : null}

    <form className="script-editor-form" onSubmit={(event) => void save(event)} inert={saving} aria-busy={saving}>
      <section className="panel script-editor-section script-writing-focus">
        <input className="script-document-title" aria-label="عنوان السكريبت" required minLength={3} maxLength={180} readOnly={readOnly} value={form.title} onChange={(event) => update("title", event.target.value)} placeholder="عنوان السكريبت" />
        <div className="script-document-properties"><StatusBadge tone={status.tone}>{status.label}</StatusBadge><span>{scriptContentKindConfig[form.content_kind]}</span><span dir="ltr">{form.duration_seconds}s</span><Button type="button" variant="ghost" onClick={() => openPanel("properties")}>خصائص</Button></div>
        {recoverableText !== null ? <aside className="script-local-recovery"><strong>لقيت مسودة على هذا الجهاز تختلف عن آخر نسخة على الموقع.</strong><p>راجعها قبل الاستعادة؛ مش هنكتب فوق النسخة الموجودة تلقائيًا.</p><div><Button type="button" variant="secondary" onClick={() => { update("spoken_script", recoverableText); setRecoverableText(null); }}>استعادة مسودتي</Button><Button type="button" variant="ghost" onClick={() => { setRecoverableText(null); try { localStorage.removeItem(`market-whales-script-draft:${workspace.membership.user_id}:${scriptId}`); } catch { /* Ignore unavailable browser storage. */ } }}>تجاهل</Button></div></aside> : null}
        <div className="script-document-writing">
          <label className="script-main-text-label"><span className="sr-only">نص السكريبت</span><textarea ref={spokenTextInput} className="spoken-script-textarea" readOnly={readOnly} value={form.spoken_script}
            onSelect={(event) => setSelectionActive(event.currentTarget.selectionStart !== event.currentTarget.selectionEnd)}
            onKeyDown={(event) => {
              if (event.key === "Escape") { setSlashOpen(false); setRewriteToolsOpen(false); }
              if ((event.ctrlKey || event.metaKey) && event.key === "s") { event.preventDefault(); void save(); }
              if (event.key === "/" && !readOnly && !event.nativeEvent.isComposing) setSlashOpen(true);
            }}
            onChange={(event) => { update("spoken_script", event.target.value); if (!event.target.value.slice(0, event.target.selectionStart).endsWith("/")) setSlashOpen(false); }}
            placeholder="اكتب هنا، أو اضغط / للأدوات…" /></label>
          {!readOnly ? <button type="button" className="script-document-add" aria-label="أدوات الكتابة" aria-expanded={slashOpen} onClick={() => setSlashOpen(!slashOpen)}><Plus size={18} /></button> : null}
          {slashOpen && !readOnly ? <div className="script-slash-menu"><Button type="button" variant="ghost" onClick={() => insertLine("")}>فقرة جديدة</Button><Button type="button" variant="ghost" onClick={() => insertLine("• ")}>قائمة نقطية</Button><Button type="button" variant="ghost" onClick={() => { insertLine(""); openPanel("assistant"); }}>مساعد الكتابة</Button><Button type="button" variant="ghost" onClick={() => setSlashOpen(false)}>إغلاق</Button></div> : null}
          {!readOnly && (selectionActive || rewriteToolsOpen) ? <div className="script-selection-tools" aria-label="تحسين النص المحدد">
            <span>{selectionActive ? "النص المحدد" : "النص كله"}</span>
            <select aria-label="تحسين الصياغة" defaultValue="" disabled={Boolean(aiScope) || saving} onChange={(event) => { if (event.target.value) void rewrite(event.target.value as RewriteAction); event.target.value = ""; }}><option value="" disabled>تحسين الصياغة…</option>{Object.entries(rewriteLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <Button type="button" variant="ghost" aria-label="إغلاق أدوات النص" onClick={() => { setSelectionActive(false); setRewriteToolsOpen(false); }}><X size={16} /></Button>
          </div> : null}
          {aiScope === "rewrite_excerpt" ? <span className="script-inline-ai-status" role="status"><LoaderCircle size={16} className="spin" /> جارٍ تجهيز الاقتراح…</span> : null}
        </div>
        {rewritePreview ? <aside className="script-rewrite-preview"><header><strong>معاينة: {rewriteLabels[rewritePreview.action]}</strong><small>لم يتم اعتماد الاقتراح أو حفظه</small></header><div><section><span>قبل</span><p>{rewritePreview.original}</p></section><section><span>بعد</span><p>{rewritePreview.suggestion}</p></section></div><footer><Button type="button" disabled={form.spoken_script !== rewritePreview.base} onClick={acceptRewrite}>استخدم التعديل</Button><Button type="button" variant="ghost" onClick={() => setRewritePreview(null)}>رفض</Button></footer>{form.spoken_script !== rewritePreview.base ? <small>تغيّر النص أثناء المعاينة. أعد الطلب بدل استبدال تعديلك.</small> : null}</aside> : null}
        <div className="script-document-footnote"><span>{wordCount} كلمة · تقدير القراءة <bdi>{estimatedSeconds}s</bdi>{estimatedSeconds > Number(form.duration_seconds) ? " · أطول من المدة المستهدفة" : ""}</span>{!readOnly ? <button type="button" className="text-button" onClick={() => { spokenTextInput.current?.setSelectionRange(0, 0); setSelectionActive(false); setRewriteToolsOpen(!rewriteToolsOpen); }}>تحسين النص</button> : null}</div>
      </section>
      {editorPanel === "properties" ? <ScriptToolPanel error={error} notice={notice} title="خصائص السكريبت" onClose={() => setEditorPanel(null)}>

        <div className="script-fields-grid">

          <label><span>نوع المحتوى</span><select disabled={readOnly} value={form.content_kind} onChange={(event) => update("content_kind", event.target.value as ScriptContentKind)}>{Object.entries(scriptContentKindConfig).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span>طريقة البداية</span><select disabled={readOnly} value={form.input_mode} onChange={(event) => update("input_mode", event.target.value as EditorForm["input_mode"])}>{Object.entries(scriptInputModeConfig).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span>المنصة</span><select disabled={readOnly} value={form.platform} onChange={(event) => update("platform", event.target.value)}>{Object.entries(scriptPlatformConfig).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span>المدة المستهدفة بالثواني</span><input disabled={readOnly} type="number" min={10} max={1800} value={form.duration_seconds} onChange={(event) => update("duration_seconds", event.target.value)} /></label>
          <label><span>السلسلة أو عمود المحتوى</span><input disabled={readOnly} value={form.content_pillar} onChange={(event) => update("content_pillar", event.target.value)} /></label>
          <label className="span-2"><span>الهدف</span><textarea disabled={readOnly} required minLength={5} value={form.objective} onChange={(event) => update("objective", event.target.value)} /></label>
          <label><span>الجمهور</span><input disabled={readOnly} value={form.audience} onChange={(event) => update("audience", event.target.value)} /></label>
          <label><span>رابط المرجع — اختياري</span><input disabled={readOnly} type="url" value={form.source_url} onChange={(event) => update("source_url", event.target.value)} /></label>
          <label className="span-2"><span>نص أو ملاحظات المصدر</span><textarea className="source-textarea" disabled={readOnly} value={form.source_text} onChange={(event) => update("source_text", event.target.value)} /></label>
        </div>
      {!readOnly ? <Button type="submit" disabled={saving || autosaveState === "saving"}>حفظ التعديلات</Button> : null}</ScriptToolPanel> : null}

      {!readOnly && editorPanel === "assistant" ? <ScriptToolPanel error={error} notice={notice} title="مساعد الكتابة" onClose={() => setEditorPanel(null)}>

        <div className="script-ai-copy"><span className="script-ai-icon"><WandSparkles size={21} /></span><div><p className="overline">مساعد الكتابة</p><h2>اختر الزاوية ثم المسودة</h2><p>التوليد اختياري، وكل نتيجة معاينة فقط: لا تحفظ نسخة ولا تنشئ مهامًا.</p></div></div>
        <div className="script-ai-guardrails">
          <label><span>القصة الشخصية</span><select value={selectedStory} onChange={(event) => setSelectedStory(event.target.value)}><option value="">بدون قصة شخصية — الافتراضي</option>{workspace.storyBank.map((story) => <option key={story} value={story}>{story}</option>)}</select><small>{selectedStory ? "سيُسمح بهذه القصة وحدها." : "لن تُستخدم قصة ترامب أو غيرها."}</small></label>
          <label><span>قولها بطريقتك — اختياري</span><textarea maxLength={1500} value={generationDirection} onChange={(event) => setGenerationDirection(event.target.value)} placeholder="أنا عايز أوصل له إن... ومتقولش..." /><small>التوجيه يطبّق على المعاينة التالية فقط.</small></label>
        </div>
        <div className="script-ai-actions">
          <Button type="button" disabled={Boolean(aiScope) || saving} onClick={() => void generateAngles()}>{aiScope === "angles" ? <LoaderCircle className="spin" size={15} /> : <Lightbulb size={15} />} اقترح 3 زوايا للفكرة</Button>
        </div>
        {angles.length ? <div className="script-variants-grid" aria-label="زوايا الكتابة">{angles.map((angle, index) => <article key={`${angle.title}-${index}`}><header><span>زاوية {index + 1}</span><strong>{angle.title}</strong></header><p><strong>الهوك:</strong> {angle.hook}</p><p>{angle.core_idea}</p><Button type="button" variant="secondary" disabled={Boolean(aiScope) || saving} onClick={() => void draftFromAngle(angle)}>اكتب مسودة لهذه الزاوية</Button></article>)}</div> : null}
        <details className="script-extra-variants"><summary>بدائل كاملة عند الحاجة</summary><div className="script-ai-actions">
          <Button type="button" variant="secondary" disabled={Boolean(aiScope) || saving} onClick={() => void generateWriting("idea", "script_variants")}><Lightbulb size={15} /> 3 بدائل كاملة</Button>
          <Button type="button" variant="secondary" disabled={Boolean(aiScope) || saving || !form.source_url} onClick={() => void generateWriting("reference", "script_variants")}><Bot size={15} /> من المرجع بطريقتي</Button>
          <Button type="button" variant="secondary" disabled={Boolean(aiScope) || saving || form.spoken_script.length < 20} onClick={() => void generateWriting("improve", "script_variants")}><Sparkles size={15} /> بدائل من مسودتي</Button>
        </div></details>
        {scriptVariants.length ? <div className="script-variants-grid">{scriptVariants.map((variant, index) => <article key={`${variant.label}-${index}`}><header><span>نسخة {index + 1}</span><strong>{variant.label}</strong></header><p>{variant.spoken_script}</p><Button type="button" variant="secondary" onClick={() => chooseVariant(variant)}>اختيار هذه النسخة</Button></article>)}</div> : null}
      </ScriptToolPanel> : null}

      {editorPanel === "hooks" ? <ScriptToolPanel error={error} notice={notice} title="الهوكات" onClose={() => setEditorPanel(null)}>
        <div className="script-fields-grid"><label className="span-2"><span>بدائل الهوك — واحد في كل سطر</span><textarea disabled={readOnly} value={form.hook_variants} onChange={(event) => update("hook_variants", event.target.value)} />{!readOnly ? <Button type="button" variant="ghost" disabled={Boolean(aiScope) || saving} onClick={() => void generateWriting(form.spoken_script ? "improve" : "idea", "hooks")}>{aiScope === "hooks" ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />} اقتراح هوكات أخرى</Button> : null}</label></div>
      {!readOnly ? <Button type="submit" disabled={saving || autosaveState === "saving"}>حفظ التعديلات</Button> : null}</ScriptToolPanel> : null}

      {showProduction && editorPanel === "production" ? <ScriptToolPanel error={error} notice={notice} title="تجهيز التنفيذ" onClose={() => setEditorPanel(null)}>
        <section className="panel script-editor-section script-production-panel">
          <div className="section-heading"><div><p className="overline">بعد اعتماد النص</p><h2>تجهيز التصوير</h2><p>{packStale ? "النص اتغير بعد تجهيز التعليمات؛ راجعها وحدّثها صراحة قبل التسليم." : packExists ? "المشهد والمرجع والمونتاج قابلين للتعديل بنفسك أو بمساعدة AI." : "رتب التصوير بنفسك أو جهّز اقتراحات قابلة للتعديل."}</p></div><StatusBadge tone={packStale ? "warning" : packExists ? "success" : "neutral"}>{packStale ? "تحتاج تحديث" : packExists ? "التجهيز جاهز" : "لم يُجهز"}</StatusBadge></div>
          {!readOnly ? <div className="script-production-actions">
            <Button type="button" disabled={Boolean(aiScope) || saving} onClick={() => void generateProduction("production_pack")}>{aiScope === "production_pack" ? <LoaderCircle className="spin" size={15} /> : <Factory size={15} />} {packExists ? "إعادة بناء الحزمة كاملة" : "إنشاء حزمة التنفيذ"}</Button>
            <Button type="button" variant="secondary" disabled={Boolean(aiScope) || saving || !packExists || packStale} onClick={() => void generateProduction("recording")}><RefreshCw size={14} /> التسجيل فقط</Button>
            <Button type="button" variant="secondary" disabled={Boolean(aiScope) || saving || !packExists || packStale} onClick={() => void generateProduction("editing")}><RefreshCw size={14} /> المونتاج فقط</Button>
            <Button type="button" variant="secondary" disabled={Boolean(aiScope) || saving} onClick={() => void generateProduction("thumbnail")}><RefreshCw size={14} /> 3 اقتراحات للغلاف</Button>
            <Button type="button" variant="secondary" disabled={Boolean(aiScope) || saving} onClick={() => void generateProduction("caption")}><RefreshCw size={14} /> 3 اقتراحات للكابشن</Button>
          </div> : null}
          <div className="script-shooting-grid">
            <label><span>المشهد والتصوير</span><textarea disabled={readOnly} value={form.recording_notes} onChange={(event) => update("recording_notes", event.target.value)} placeholder="لقطة الكاميرا، الشارت، والتوقيت الذي تحتاجه…" /></label>
            <section><strong>الكلام</strong><p>{form.spoken_script}</p><small>عدّل الكلام من مساحة الكتابة الأساسية؛ هذه معاينة النسخة التي ستصل للفريق.</small></section>
            <label><span>المرجع أو صورة الشارت</span><textarea disabled={readOnly} value={form.b_roll_notes} onChange={(event) => update("b_roll_notes", event.target.value)} placeholder="رابط لقطة الشارت أو وصف الصورة المطلوبة…" />{form.source_url ? <a href={form.source_url} target="_blank" rel="noreferrer">فتح المرجع المحفوظ <ExternalLink size={13} /></a> : null}</label>
            <label><span>تعليمات المونتاج</span><textarea disabled={readOnly} value={form.editing_notes} onChange={(event) => update("editing_notes", event.target.value)} placeholder="أماكن القص، الانتقالات، والنصوص المهمة…" /></label>
          </div>
          <div className="script-fields-grid execution-fields">
            <label className="script-thumbnail-notes"><span>تعليمات الغلاف</span><textarea disabled={readOnly} value={form.thumbnail_notes} onChange={(event) => update("thumbnail_notes", event.target.value)} /><small>المحتوى المحفوظ هنا هو نفسه الذي ينتقل إلى تعليمات مهمة الغلاف عند إنشاء طلب التنفيذ.</small></label>
            <label><span>النصوص على الشاشة</span><textarea disabled={readOnly} value={form.on_screen_text} onChange={(event) => update("on_screen_text", event.target.value)} /></label>
            <label><span>حقائق تحتاج مراجعة</span><textarea disabled={readOnly} value={form.claims_notes} onChange={(event) => update("claims_notes", event.target.value)} /></label>
          </div>
          {form.thumbnail_notes.trim() ? <aside className={`script-thumbnail-choice ${thumbnailInstructionsSaved ? "saved" : "unsaved"}`} role="status"><CheckCircle2 size={18} /><div><strong>{thumbnailInstructionsSaved ? "تعليمات الغلاف محفوظة" : "اختيار الغلاف يحتاج حفظ"}</strong><p>{thumbnailInstructionsSaved ? "هذه هي التعليمات التي ستصل للمصمم عند إنشاء طلب التنفيذ." : "راجع الاختيار ثم اضغط «حفظ التعديلات» قبل إنشاء طلب التنفيذ."}</p></div></aside> : null}
          {thumbnailOptions.length ? <div className="script-variants-grid" aria-label="اقتراحات الغلاف">{thumbnailOptions.map((option, index) => {
            const selected = form.thumbnail_notes === thumbnailOptionText(option);
            return <article className={selected ? "selected" : undefined} key={`${option.label}-${index}`}><header><span>غلاف {index + 1}</span><strong>{option.label}</strong></header><p><strong>النص:</strong> {option.cover_text}</p><p><strong>الاتجاه البصري:</strong> {option.visual_direction}</p><p><strong>صلته بالنص:</strong> {option.script_connection}</p><Button type="button" variant={selected ? "primary" : "secondary"} aria-pressed={selected} onClick={() => chooseThumbnailOption(option)}>{selected ? <CheckCircle2 size={15} /> : null}{selected ? thumbnailInstructionsSaved ? " الاختيار محفوظ" : " مختار — احفظ التعديلات" : "اختيار هذا الغلاف"}</Button></article>;
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
      {!readOnly ? <div className="form-actions"><Button type="submit" disabled={saving || autosaveState === "saving"}>حفظ تعليمات التنفيذ</Button><Button type="button" variant="secondary" disabled={writingHasUnsavedChanges || productionHasUnsavedChanges} onClick={() => { setShowHandoff(true); openPanel("actions"); }}>التالي: توزيع المهام</Button></div> : null}</ScriptToolPanel> : null}


    </form>

    {editorPanel === "actions" ? <ScriptToolPanel error={error} notice={notice} title="الحالة وطلب التنفيذ" onClose={() => { setEditorPanel(null); setShowHandoff(false); }}><section className="script-status-panel">
      <div className="section-heading"><div><p className="overline">الحالة</p><h2>أنت الذي يحدد انتقال الاسكريبت</h2><p>لا يتحول إلى طلب تنفيذ ولا تتولد مهامه لمجرد ضغط زر AI.</p></div><StatusBadge tone={status.tone}>{status.label}</StatusBadge></div>
      {canWriteScript ? <div className="script-status-actions">
        {workspace.script.status === "draft" ? <Button type="button" disabled={saving || form.spoken_script.trim().length < 20} onClick={() => void changeStatus("ready_to_record")}><CheckCircle2 size={15} /> جاهز للتصوير</Button> : null}
        {workspace.script.status === "ready_to_record" ? <><Button type="button" variant="secondary" disabled={saving} onClick={() => void changeStatus("draft")}><RefreshCw size={15} /> إرجاع لقيد الكتابة</Button><Button type="button" disabled={!assignablePeople.length} onClick={() => setShowHandoff((value) => !value)}><Factory size={15} /> إنشاء طلب تنفيذ</Button></> : null}
        {workspace.script.status !== "archived" ? <Button type="button" variant="ghost" disabled={saving} onClick={() => void changeStatus("archived")}><Archive size={15} /> أرشفة</Button> : null}
        {workspace.script.status === "archived" && !workspace.script.content_item_id ? <Button type="button" variant="secondary" disabled={saving} onClick={() => void changeStatus("draft")}><RefreshCw size={15} /> استعادة لقيد الكتابة</Button> : null}
        {workspace.script.status === "archived" && !workspace.script.content_item_id ? <Button type="button" variant="ghost" className="danger-text" disabled={saving} onClick={() => void deleteScript()}><Trash2 size={15} /> حذف نهائي</Button> : null}
      </div> : <p className="tool-empty">هذه الحالة للعرض فقط، ولا توجد إجراءات متاحة لحسابك.</p>}
      {showHandoff && canWriteScript && assignablePeople.length ? <form className="script-handoff-form" onSubmit={(event) => void handoff(event)}>
        <div className="script-handoff-heading"><Factory size={19} /><div><strong>إنشاء طلب التنفيذ</strong><p>عند تأكيدك فقط تُنسخ النسخة النهائية ويصل لكل مكلف الجزء الخاص به. إما تُنشأ المهام كلها معًا، أو لا يُحفظ شيء.</p></div></div>
        <aside className={`script-handoff-cover-summary ${workspace.script.thumbnail_notes.trim() ? "ready" : "empty"}`}>
          <CheckCircle2 size={18} />
          <div><strong>تعليمات الغلاف التي ستصل للمصمم</strong><p>{workspace.script.thumbnail_notes.trim() || "لا توجد تعليمات غلاف محفوظة. يمكنك إنشاء الطلب، لكن مهمة المصمم ستصل بدون اتجاه غلاف محدد."}</p></div>
        </aside>
        <div className="script-fields-grid">
          <label><span>موعد النشر</span><DateInput required type="datetime-local" value={publishAt} onChange={(event) => setPublishAt(event.target.value)} /></label>
          <label><span>التسجيل وصناعة المحتوى</span><select value={contentCreatorId} onChange={(event) => setContentCreatorId(event.target.value)}>{assignablePeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          <label><span>المونتاج</span><select value={editingOwnerId} onChange={(event) => setEditingOwnerId(event.target.value)}>{assignablePeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          <label><span>الغلاف</span><select value={thumbnailOwnerId} onChange={(event) => setThumbnailOwnerId(event.target.value)}>{assignablePeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          <label><span>النشر</span><select value={publishingOwnerId} onChange={(event) => setPublishingOwnerId(event.target.value)}>{assignablePeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
        </div>
        <details className="script-handoff-preview"><summary>عاين ما سيصل للفريق قبل الإنشاء</summary><div className="script-fields-grid">
          <section><strong>المشهد والتصوير</strong><p>{workspace.script.recording_notes || "لا توجد ملاحظات تصوير."}</p><small>المسؤول: {workspace.people.find((person) => person.id === contentCreatorId)?.name ?? "غير محدد"}</small></section>
          <section><strong>الكلام</strong><p>{workspace.script.spoken_script}</p></section>
          <section><strong>المرجع أو الشارت</strong><p>{workspace.script.source_url || workspace.script.b_roll_notes || workspace.script.source_text || "لا يوجد مرجع إضافي."}</p></section>
          <section><strong>المونتاج</strong><p>{workspace.script.editing_notes || "لا توجد ملاحظات مونتاج."}</p><small>المسؤول: {workspace.people.find((person) => person.id === editingOwnerId)?.name ?? "غير محدد"}</small></section>
          <section><strong>صورة الغلاف</strong><p>{workspace.script.thumbnail_notes || "لا توجد تعليمات غلاف."}</p><small>المسؤول: {workspace.people.find((person) => person.id === thumbnailOwnerId)?.name ?? "غير محدد"}</small></section>
          <section><strong>الكابشن والنشر</strong><p>{workspace.script.caption || "لا يوجد كابشن محفوظ."}</p><small>{workspace.script.hashtags.join(" ")} · {workspace.people.find((person) => person.id === publishingOwnerId)?.name ?? "غير محدد"}</small></section>
        </div></details>
        <div className="form-actions"><Button type="submit" disabled={saving || writingHasUnsavedChanges || productionHasUnsavedChanges}>{saving ? <LoaderCircle className="spin" size={15} /> : <Factory size={15} />} إنشاء الطلب والمهام</Button><Button type="button" variant="ghost" onClick={() => setShowHandoff(false)}>إلغاء</Button></div>
      </form> : null}
    </section></ScriptToolPanel> : null}

    {editorPanel === "review" ? <ScriptToolPanel error={error} notice={notice} title="المشاركة والتعليقات" onClose={() => setEditorPanel(null)}>
      <p className="script-field-help">المشاركة اختيارية لهذا السكريبت وحده، ولا تكشف بصمتك أو تتيح تعديل النص.</p>
      {assignedWriter ? <div className="script-review-share">
        <label><span>شارك للمراجعة مع عضو</span><select value={reviewerId} onChange={(event) => setReviewerId(event.target.value)}><option value="">اختر عضوًا</option>{workspace.people.filter((person) => person.id !== workspace.script.assigned_to && (person.role === "owner" || person.allowedSections.includes("scripts"))).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
        <Button type="button" variant="secondary" disabled={!reviewerId || saving || workspace.reviewGrants.some((grant) => grant.reviewer_id === reviewerId)} onClick={() => void setReviewAccess(reviewerId, true)}>مشاركة هذا السكريبت</Button>
        {workspace.reviewGrants.length ? <div className="script-review-grants">{workspace.reviewGrants.map((grant) => <span key={grant.reviewer_id}>{workspace.people.find((person) => person.id === grant.reviewer_id)?.name ?? "عضو"} <Button type="button" variant="ghost" disabled={saving} onClick={() => void setReviewAccess(grant.reviewer_id, false)}>إلغاء الوصول</Button></span>)}</div> : null}
      </div> : null}
      <div className="script-review-comments">{workspace.reviewComments.length ? workspace.reviewComments.map((comment) => <article key={comment.id}><strong>{workspace.people.find((person) => person.id === comment.author_id)?.name ?? "عضو"}</strong><small>{formatScriptDate(comment.created_at)}</small><p>{comment.body}</p></article>) : <p className="tool-empty">لسه مفيش تعليقات.</p>}</div>
      <form onSubmit={(event) => void postReviewComment(event)}><label><span>تعليق للمراجعة</span><textarea value={reviewComment} maxLength={4000} onChange={(event) => setReviewComment(event.target.value)} placeholder="سؤال أو ملاحظة محددة على النص…" /></label><Button type="submit" disabled={!reviewComment.trim() || saving}>إرسال التعليق</Button></form>
    </ScriptToolPanel> : null}

    {editorPanel === "versions" ? <ScriptToolPanel error={error} notice={notice} title="النسخ السابقة والبصمة" onClose={() => setEditorPanel(null)}>      {!readOnly ? <div className="script-save-bar"><label><span>إيه اللي عدّلته؟ — اختياري</span><input value={versionNote} maxLength={500} onChange={(event) => setVersionNote(event.target.value)} placeholder="مثال: غيرت الهوك وقصّرت النص" /><small>الحفظ التلقائي للمسودة لا يضيف نسخة للسجل؛ هذه الملاحظة تخص النسخة المهمة فقط.</small></label><Button type="button" onClick={() => void save()} disabled={saving || autosaveState === "saving" || Boolean(aiScope)}>{saving ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />} حفظ نسخة مهمة</Button></div> : null}        {canWriteScript ? <aside className="script-calibration-note"><CheckCircle2 size={18} /><div><strong>هل النص بقى أنت فعلًا بعد تعديلك؟</strong><p>احفظ تعديلك اليدوي أولًا، ثم أضفه إلى بصمتك الخاصة.</p></div><Button type="button" variant="secondary" disabled={saving || Boolean(aiScope) || form.spoken_script.trim().length < 20 || spokenScriptHasUnsavedChanges || !latestVersionIsManual} onClick={() => void approveVoiceSample()}>{spokenScriptHasUnsavedChanges || !latestVersionIsManual ? "احفظ تعديلك أولًا" : "اعتمد النص كعينة لصوتي"}</Button></aside> : null}
      <p className="script-field-help">المسودات المحفوظة تلقائيًا لا تملأ السجل؛ هنا تظهر النسخ المهمة التي اخترت حفظها.</p>
      {workspace.versions.length ? <>
        <div className="script-version-compare-controls">
          <label>النسخة الأولى<select value={compareLeft} onChange={(event) => setCompareLeft(event.target.value)}><option value="">اختر نسخة</option>{workspace.versions.map((version) => <option key={version.id} value={version.id}>v{version.version_number} · {formatScriptDate(version.created_at)}</option>)}</select></label>
          <label>قارن مع<select value={compareRight} onChange={(event) => setCompareRight(event.target.value)}><option value="">اختر نسخة</option>{workspace.versions.map((version) => <option key={version.id} value={version.id}>v{version.version_number} · {formatScriptDate(version.created_at)}</option>)}</select></label>
        </div>
        {leftVersion && rightVersion ? <div className="script-version-compare"><section><strong>نسخة {leftVersion.version_number}</strong><p>{versionText(leftVersion) || "لم يُكتب النص بعد."}</p></section><section><strong>نسخة {rightVersion.version_number}</strong><p>{versionText(rightVersion) || "لم يُكتب النص بعد."}</p></section></div> : null}
        <ol>{workspace.versions.map((version) => <li key={version.id}><span><strong>v{version.version_number.toLocaleString("ar-EG")}</strong><small>{version.source === "ai_generation" ? "حزمة AI" : version.source === "handoff" ? "إرسال للتنفيذ" : "حفظ يدوي"}</small></span><div><strong>{version.note || "بدون ملاحظة"}</strong><small>{formatScriptDate(version.created_at)}</small></div>{!readOnly ? <Button type="button" variant="ghost" disabled={saving || autosaveState === "saving"} onClick={() => { setEditorPanel(null); setRestorePending(true); update("spoken_script", versionText(version)); setVersionNote(`استعادة نص النسخة ${version.version_number}`); setNotice("أعدنا النص للمحرر فقط؛ راجعه ثم اضغط «حفظ نسخة مهمة» ليبقى التاريخ محفوظًا."); window.scrollTo({ top: 0, behavior: "smooth" }); }}>استعادة النص</Button> : null}</li>)}</ol>
      </> : <p className="tool-empty">لا توجد نسخ مسجلة.</p>}
    </ScriptToolPanel> : null}
    {teleprompterOpen ? <div className="script-teleprompter" role="dialog" aria-modal="true" aria-label="وضع قراءة الاسكريبت">
      <div className="script-teleprompter-toolbar">
        <strong>وضع التصوير · {wordCount.toLocaleString("ar-EG")} كلمة</strong>
        <div>
          <label>حجم الخط <input aria-label="حجم خط وضع التصوير" type="range" min="24" max="72" value={teleprompterFontSize} onChange={(event) => setTeleprompterFontSize(Number(event.target.value))} /></label>
          <label>سرعة التمرير <input aria-label="سرعة التمرير" type="range" min="0" max="100" value={teleprompterSpeed} onChange={(event) => setTeleprompterSpeed(Number(event.target.value))} /></label>
          <button type="button" onClick={() => setTeleprompterPlaying((playing) => !playing)}>{teleprompterPlaying ? <Pause size={18} /> : <Play size={18} />}{teleprompterPlaying ? "إيقاف" : "ابدأ"}</button>
          <button type="button" aria-label="إغلاق وضع التصوير" onClick={() => { setTeleprompterPlaying(false); setTeleprompterOpen(false); }}><X size={20} /></button>
        </div>
      </div>
      <div className="script-teleprompter-reading" ref={teleprompterText} style={{ fontSize: teleprompterFontSize }}>{form.spoken_script}</div>
    </div> : null}
  </section>;
}
