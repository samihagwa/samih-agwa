"use client";

import type { Session } from "@supabase/supabase-js";
import Image from "next/image";
import {
  AlertTriangle, CalendarClock, CheckCircle2, CirclePause, ExternalLink,
  ImageIcon, Library, LoaderCircle, LockKeyhole, MessageSquareText, OctagonX,
  Pencil, Plus, RefreshCw, Send, ShieldCheck, ToggleLeft, ToggleRight, Trash2,
  Video, X,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { previewPolicyConfig, publicationStatus } from "../../lib/publishing";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Tables } from "../../lib/supabase/database.types";
import { getSupabaseFunctionErrorMessage } from "../../lib/supabase/function-errors";
import { useWorkspaceAuth } from "../../lib/supabase/use-workspace-auth";
import { canManageTasks } from "../../lib/tasks";
import { Button } from "../ui/Button";
import { StatusBadge } from "../ui/StatusBadge";

type Membership = Tables<"memberships">;
type Organization = Tables<"organizations">;
type Channel = Tables<"publishing_channels">;
type Schedule = Tables<"publishing_schedules">;
type ScheduleChannel = Tables<"publishing_schedule_channels">;
type Post = Tables<"publishing_posts">;
type Occurrence = Tables<"publishing_occurrences">;
type PublicationLog = Tables<"publishing_publication_logs">;
type Control = Tables<"publishing_controls">;
type AdminConnection = Tables<"publishing_admin_connections">;
type TelegramAsset = Tables<"publishing_telegram_assets">;
type ContentItem = Tables<"content_items">;
type Workspace = { organization: Organization; membership: Membership };
type ScheduleType = "once" | "weekly";
type PreviewPolicy = keyof typeof previewPolicyConfig;
type QueueView = "upcoming" | "history";

const terminalOccurrenceStatuses = new Set([
  "published", "skipped", "held_changed", "failed", "unknown", "cancelled",
]);

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) return String(error.message);
  return "حدث خطأ غير متوقع.";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Cairo",
  }).format(new Date(value));
}

function dateInputInOneHour() {
  const value = new Date(Date.now() + 60 * 60 * 1000);
  value.setMinutes(Math.ceil(value.getMinutes() / 5) * 5, 0, 0);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function cairoDateInput() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function cairoDateTimeInput(value: string | null) {
  if (!value) return dateInputInOneHour();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function text(form: FormData, name: string) {
  return String(form.get(name) ?? "").trim();
}

function mediaKindLabel(kind: string) {
  return kind === "photo" ? "صورة" : "فيديو";
}

function formatFileSize(value: number | null) {
  if (!value) return null;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.ceil(value / 1024)} KB`;
}

function MediaAssetVisual({ asset, previewUrl }: { asset: TelegramAsset; previewUrl?: string }) {
  return <span className="publishing-asset-visual">
    {previewUrl ? <Image src={previewUrl} alt={`معاينة ${asset.display_name}`} width={152} height={124} unoptimized /> : asset.media_kind === "photo" ? <ImageIcon size={23} /> : <Video size={23} />}
    {asset.media_kind === "video" ? <span className="publishing-video-mark"><Video size={11} /></span> : null}
  </span>;
}

export function PublishingWorkspace() {
  const configured = isSupabaseConfigured();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [scheduleChannels, setScheduleChannels] = useState<ScheduleChannel[]>([]);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [logs, setLogs] = useState<PublicationLog[]>([]);
  const [contentItems, setContentItems] = useState<ContentItem[]>([]);
  const [telegramAssets, setTelegramAssets] = useState<TelegramAsset[]>([]);
  const [assetPreviewUrls, setAssetPreviewUrls] = useState<Record<string, string>>({});
  const [control, setControl] = useState<Control | null>(null);
  const [connection, setConnection] = useState<AdminConnection | null>(null);
  const [loading, setLoading] = useState(configured);
  const [working, setWorking] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ schedule: Schedule; post: Post } | null>(null);
  const [queueView, setQueueView] = useState<QueueView>("upcoming");
  const [scheduleType, setScheduleType] = useState<ScheduleType>("once");
  const [mediaKind, setMediaKind] = useState("none");
  const [mediaSourceMode, setMediaSourceMode] = useState<"library" | "url">("library");
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [manualMediaUrl, setManualMediaUrl] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(configured ? null : "لم يتم إعداد Supabase لهذه النسخة.");
  const composerRef = useRef<HTMLFormElement>(null);

  const clearData = useCallback(() => {
    setChannels([]); setPosts([]); setSchedules([]); setScheduleChannels([]); setOccurrences([]);
    setLogs([]); setContentItems([]); setTelegramAssets([]); setAssetPreviewUrls({});
    setControl(null); setConnection(null);
  }, []);
  const clearWorkspace = useCallback(() => { setWorkspace(null); clearData(); }, [clearData]);
  const clearTransientState = useCallback(() => { setNotice(null); setError(null); }, []);

  const refreshPublishing = useCallback(async (organizationId: string, userId: string) => {
    const supabase = getSupabaseBrowserClient();
    const [channelResult, postResult, scheduleResult, scheduleChannelResult, occurrenceResult, logResult, contentResult, assetResult, controlResult, connectionResult] = await Promise.all([
      supabase.from("publishing_channels").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }),
      supabase.from("publishing_posts").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }),
      supabase.from("publishing_schedules").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }),
      supabase.from("publishing_schedule_channels").select("*").eq("organization_id", organizationId),
      supabase.from("publishing_occurrences").select("*").eq("organization_id", organizationId).order("scheduled_at", { ascending: false }).limit(100),
      supabase.from("publishing_publication_logs").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(200),
      supabase.from("content_items").select("*").eq("organization_id", organizationId).neq("status", "cancelled").order("publish_at", { ascending: false }).limit(100),
      supabase.from("publishing_telegram_assets").select("*").eq("organization_id", organizationId).is("archived_at", null).order("created_at", { ascending: false }).limit(100),
      supabase.from("publishing_controls").select("*").eq("organization_id", organizationId).maybeSingle(),
      supabase.from("publishing_admin_connections").select("*").eq("organization_id", organizationId).eq("user_id", userId).maybeSingle(),
    ]);
    const firstError = [channelResult, postResult, scheduleResult, scheduleChannelResult, occurrenceResult, logResult, contentResult, assetResult, controlResult, connectionResult]
      .find((result) => result.error)?.error;
    if (firstError) throw firstError;
    setChannels(channelResult.data ?? []); setPosts(postResult.data ?? []);
    setSchedules(scheduleResult.data ?? []); setScheduleChannels(scheduleChannelResult.data ?? []);
    setOccurrences(occurrenceResult.data ?? []);
    setLogs(logResult.data ?? []); setContentItems(contentResult.data ?? []);
    const nextAssets = assetResult.data ?? [];
    setTelegramAssets(nextAssets);
    const previewPaths = nextAssets.map((asset) => asset.preview_object_path).filter((path): path is string => Boolean(path));
    if (previewPaths.length) {
      const { data: signedPreviews } = await supabase.storage.from("publishing-media-previews").createSignedUrls(previewPaths, 3600);
      setAssetPreviewUrls(Object.fromEntries((signedPreviews ?? []).flatMap((item) => item.signedUrl ? [[item.path, item.signedUrl]] : [])));
    } else setAssetPreviewUrls({});
    setControl(controlResult.data ?? null); setConnection(connectionResult.data ?? null);
  }, []);

  const loadWorkspace = useCallback(async (session: Session) => {
    setLoading(true); setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: membership, error: membershipError } = await supabase.from("memberships")
        .select("*").eq("user_id", session.user.id).eq("status", "active").limit(1).maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) { setWorkspace(null); clearData(); return; }
      const { data: organization, error: organizationError } = await supabase.from("organizations")
        .select("*").eq("id", membership.organization_id).single();
      if (organizationError) throw organizationError;
      setWorkspace({ organization, membership });
      await refreshPublishing(membership.organization_id, session.user.id);
    } catch (loadError) { setError(errorMessage(loadError)); }
    finally { setLoading(false); }
  }, [clearData, refreshPublishing]);

  const session = useWorkspaceAuth({ configured, loadWorkspace, clearWorkspace, setLoading, clearTransientState });

  useEffect(() => {
    if (!workspace || !session) return;
    const supabase = getSupabaseBrowserClient();
    const reload = () => void refreshPublishing(workspace.organization.id, session.user.id);
    const realtime = supabase.channel(`publishing:${workspace.organization.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "publishing_occurrences", filter: `organization_id=eq.${workspace.organization.id}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "publishing_publication_logs", filter: `organization_id=eq.${workspace.organization.id}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "publishing_channels", filter: `organization_id=eq.${workspace.organization.id}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "publishing_posts", filter: `organization_id=eq.${workspace.organization.id}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "publishing_schedules", filter: `organization_id=eq.${workspace.organization.id}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "publishing_schedule_channels", filter: `organization_id=eq.${workspace.organization.id}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "publishing_telegram_assets", filter: `organization_id=eq.${workspace.organization.id}` }, reload)
      .subscribe();
    return () => { void supabase.removeChannel(realtime); };
  }, [refreshPublishing, session, workspace]);

  useEffect(() => {
    if (!showComposer) return;
    const frame = window.requestAnimationFrame(() => {
      composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      composerRef.current?.querySelector<HTMLInputElement>('input[name="post_name"]')?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [showComposer]);

  useEffect(() => {
    if (!pendingDelete) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !working) setPendingDelete(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [pendingDelete, working]);

  const postById = useMemo(() => new Map(posts.map((post) => [post.id, post])), [posts]);
  const scheduleById = useMemo(() => new Map(schedules.map((schedule) => [schedule.id, schedule])), [schedules]);
  const channelIdsBySchedule = useMemo(() => {
    const result = new Map<string, Set<string>>();
    for (const link of scheduleChannels) {
      const ids = result.get(link.schedule_id) ?? new Set<string>();
      ids.add(link.channel_id); result.set(link.schedule_id, ids);
    }
    return result;
  }, [scheduleChannels]);
  const selectedAsset = useMemo(
    () => telegramAssets.find((asset) => asset.id === selectedAssetId && asset.media_kind === mediaKind) ?? null,
    [mediaKind, selectedAssetId, telegramAssets],
  );
  const compatibleAssets = useMemo(
    () => telegramAssets.filter((asset) => mediaKind === "none" || asset.media_kind === mediaKind),
    [mediaKind, telegramAssets],
  );
  const logsByOccurrence = useMemo(() => {
    const result = new Map<string, PublicationLog[]>();
    for (const log of logs) result.set(log.occurrence_id, [...(result.get(log.occurrence_id) ?? []), log]);
    return result;
  }, [logs]);

  async function verifyChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!workspace || !session) return;
    setWorking(true); setError(null); setNotice(null);
    const reference = text(new FormData(event.currentTarget), "channel_reference");
    const { data, error: invokeError } = await getSupabaseBrowserClient().functions.invoke("telegram-publishing-commands", {
      body: { action: "verify_channel", organization_id: workspace.organization.id, channel_reference: reference },
    });
    setWorking(false);
    if (invokeError) setError(await getSupabaseFunctionErrorMessage(invokeError, "تعذر التحقق من قناة Telegram."));
    else if (!data?.ok) setError(String(data?.message ?? "البوت لا يملك صلاحية النشر."));
    else { setNotice(String(data.message)); await refreshPublishing(workspace.organization.id, session.user.id); }
  }

  async function savePublication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!workspace || !session) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const selectedChannels = form.getAll("channel_ids").map(String);
    const onceValue = text(form, "once_at");
    const mediaSource = text(form, "media_source");
    if (mediaKind !== "none" && !mediaSource) {
      setError(mediaSourceMode === "library" ? "اختر ملفًا من مكتبة Telegram أولًا." : "أضف رابط HTTPS مباشرًا للملف.");
      return;
    }
    const publicationArgs = {
      target_content_item_id: text(form, "content_item_id") || null,
      post_name: text(form, "post_name"),
      post_text: text(form, "post_text"),
      post_link_url: text(form, "link_url"),
      post_media_kind: text(form, "media_kind"),
      post_media_source: mediaSource,
      post_disable_link_preview: form.get("disable_link_preview") === "on",
      target_schedule_type: scheduleType,
      target_once_at: scheduleType === "once" && onceValue ? new Date(onceValue).toISOString() : null,
      target_weekdays: scheduleType === "weekly" ? form.getAll("weekdays").map(Number) : null,
      target_time_local: scheduleType === "weekly" ? text(form, "time_local") : null,
      target_starts_on: scheduleType === "weekly" ? text(form, "starts_on") : null,
      target_ends_on: scheduleType === "weekly" ? text(form, "ends_on") || null : null,
      target_occurrence_limit: scheduleType === "weekly" ? Number(form.get("occurrence_limit") || 12) : 1,
      target_preview_policy: text(form, "preview_policy"),
      target_preview_lead_minutes: Number(form.get("preview_lead_minutes") || 60),
      target_missed_grace_minutes: Number(form.get("missed_grace_minutes") || 10),
      target_channel_ids: selectedChannels,
    };
    setWorking(true); setError(null); setNotice(null);
    const { error: rpcError } = editingSchedule
      ? await getSupabaseBrowserClient().rpc("revise_telegram_publication", {
          ...publicationArgs, target_schedule_id: editingSchedule.id,
        } as never)
      : await getSupabaseBrowserClient().rpc("create_telegram_publication", {
          ...publicationArgs, target_organization_id: workspace.organization.id,
        } as never);
    setWorking(false);
    if (rpcError) setError(rpcError.message);
    else {
      setNotice(editingSchedule
        ? "تم حفظ التعديلات وإلغاء النسخة القديمة بأمان. النسخ القادمة ستستخدم البيانات الجديدة."
        : "تم حفظ المنشور والجدول والنسخة القادمة معًا. العامل سيتولى المعاينة والنشر.");
      formElement.reset(); setShowComposer(false); setScheduleType("once"); setMediaKind("none");
      setEditingSchedule(null); setMediaSourceMode("library"); setSelectedAssetId(""); setManualMediaUrl("");
      await refreshPublishing(workspace.organization.id, session.user.id);
    }
  }

  async function toggleKillSwitch() {
    if (!workspace || !session) return;
    const enable = !control?.kill_switch;
    setWorking(true); setError(null); setNotice(null);
    const { error: rpcError } = await getSupabaseBrowserClient().rpc("set_publishing_kill_switch", {
      target_organization_id: workspace.organization.id,
      target_enabled: enable,
      target_reason: enable ? "أوقفه المدير من لوحة النشر" : "أعاد المدير تشغيل النشر",
    });
    setWorking(false);
    if (rpcError) setError(rpcError.message);
    else { setNotice(enable ? "تم إيقاف كل النشر قبل أي اتصال جديد بـTelegram." : "تم تشغيل النشر من جديد."); await refreshPublishing(workspace.organization.id, session.user.id); }
  }

  async function toggleSchedule(schedule: Schedule) {
    if (!workspace || !session) return;
    setWorking(true); setError(null);
    const { error: rpcError } = await getSupabaseBrowserClient().rpc("set_publishing_schedule_paused", {
      target_schedule_id: schedule.id, target_paused: !schedule.paused,
    });
    setWorking(false);
    if (rpcError) setError(rpcError.message);
    else await refreshPublishing(workspace.organization.id, session.user.id);
  }

  async function cancelOccurrence(id: string) {
    if (!workspace || !session) return;
    setWorking(true); setError(null);
    const { error: rpcError } = await getSupabaseBrowserClient().rpc("cancel_publishing_occurrence", { target_occurrence_id: id });
    setWorking(false);
    if (rpcError) setError(rpcError.message);
    else { setNotice("تم إلغاء هذه النسخة فقط."); await refreshPublishing(workspace.organization.id, session.user.id); }
  }

  async function connectTelegram() {
    if (!workspace) return;
    setWorking(true); setError(null);
    const { data, error: rpcError } = await getSupabaseBrowserClient().rpc("create_publishing_admin_link", {
      target_organization_id: workspace.organization.id,
    });
    setWorking(false);
    if (rpcError || !data) { setError(rpcError?.message ?? "تعذر إنشاء رابط الربط."); return; }
    window.open(`https://t.me/teamwhalesbot?start=${data}`, "_blank", "noopener,noreferrer");
    setNotice("فُتح البوت. اضغط Start خلال 15 دقيقة ليتم ربط المعاينات بحسابك.");
  }

  function resetComposerState() {
    setEditingSchedule(null); setScheduleType("once"); setMediaKind("none");
    setMediaSourceMode("library"); setSelectedAssetId(""); setManualMediaUrl("");
  }

  function startEditing(schedule: Schedule) {
    const post = postById.get(schedule.post_id);
    if (!post || schedule.deleted_at) return;
    const linkedAsset = telegramAssets.find((asset) => asset.telegram_file_id === post.media_source);
    setError(null); setNotice(null); setEditingSchedule(schedule);
    setScheduleType(schedule.schedule_type as ScheduleType); setMediaKind(post.media_kind);
    if (linkedAsset) {
      setMediaSourceMode("library"); setSelectedAssetId(linkedAsset.id); setManualMediaUrl("");
    } else {
      setMediaSourceMode("url"); setSelectedAssetId(""); setManualMediaUrl(post.media_source ?? "");
    }
    setShowComposer(true);
  }

  async function deleteSchedule() {
    if (!pendingDelete || !workspace || !session) return;
    setWorking(true); setError(null); setNotice(null);
    const { data, error: rpcError } = await getSupabaseBrowserClient().rpc("delete_publishing_schedule", {
      target_schedule_id: pendingDelete.schedule.id,
    });
    setWorking(false);
    if (rpcError) { setPendingDelete(null); setError(rpcError.message); return; }
    if (!data) { setPendingDelete(null); setError("لم يتم العثور على الجدول المطلوب حذفه."); return; }
    setPendingDelete(null); setNotice("تم حذف الجدول من القائمة وإلغاء كل النسخ القادمة. سجل النشر السابق محفوظ.");
    if (editingSchedule?.id === pendingDelete.schedule.id) { setShowComposer(false); resetComposerState(); }
    setQueueView("upcoming");
    await refreshPublishing(workspace.organization.id, session.user.id);
  }

  function toggleComposer() {
    setError(null); setNotice(null);
    if (showComposer) { setShowComposer(false); resetComposerState(); }
    else { resetComposerState(); setShowComposer(true); }
  }

  if (loading) return <section className="workspace-state"><LoaderCircle className="spin" size={24} /><div><h2>جارٍ تحميل مركز النشر</h2><p>نقرأ القنوات والجداول وسجل النشر الآمن.</p></div></section>;
  if (!session) return <section className="workspace-state workspace-onboarding"><LockKeyhole size={27} /><div><h2>سجّل الدخول أولًا</h2><p>إدارة القنوات والنشر متاحة لأعضاء الشركة الموثقين فقط.</p></div><Button href="/tasks">فتح تسجيل الدخول</Button></section>;
  if (!workspace) return <section className="workspace-state workspace-onboarding"><ShieldCheck size={27} /><div><h2>أنشئ مساحة الشركة أولًا</h2><p>ابدأ من قسم المهام ثم ارجع لمركز النشر.</p></div><Button href="/tasks">فتح المهام</Button></section>;

  const manager = canManageTasks(workspace.membership.role);
  const readyChannels = channels.filter((channel) => channel.verification_status === "ready" && channel.allowlisted && channel.bot_can_post);
  const upcoming = occurrences.filter((occurrence) => !terminalOccurrenceStatuses.has(occurrence.status));
  const history = occurrences.filter((occurrence) => terminalOccurrenceStatuses.has(occurrence.status));
  const visibleOccurrences = queueView === "upcoming" ? upcoming : history;
  const publishedCount = occurrences.filter((occurrence) => occurrence.status === "published").length;
  const problemCount = occurrences.filter((occurrence) => ["failed", "unknown", "held_changed"].includes(occurrence.status)).length;
  const activeMediaSource = mediaKind === "none" ? "" : mediaSourceMode === "library"
    ? selectedAsset?.telegram_file_id ?? ""
    : manualMediaUrl.trim();
  const editingPost = editingSchedule ? postById.get(editingSchedule.post_id) ?? null : null;
  const editingChannelIds = editingSchedule ? channelIdsBySchedule.get(editingSchedule.id) ?? new Set<string>() : new Set<string>();

  return <section className="publishing-workspace">
    <div className="workspace-toolbar">
      <div><p className="overline">{workspace.organization.name}</p><h2>غرفة عمليات النشر</h2><p>{readyChannels.length} قناة جاهزة · {upcoming.length} نسخة قادمة · التوقيت Africa/Cairo</p></div>
      <div className="toolbar-actions"><button className="icon-button" type="button" aria-label="تحديث" onClick={() => void refreshPublishing(workspace.organization.id, session.user.id)}><RefreshCw size={17} /></button>{manager ? <Button variant="secondary" type="button" onClick={() => void connectTelegram()}><MessageSquareText size={15} /> {connection?.connected_at ? "إعادة ربط التنبيهات" : "ربط تنبيهات Telegram"}</Button> : null}{manager ? <Button type="button" aria-controls="publishing-composer" aria-expanded={showComposer} onClick={toggleComposer}>{showComposer ? <OctagonX size={15} /> : <Plus size={15} />} {showComposer ? "إغلاق نموذج الجدولة" : "جدولة منشور"}</Button> : null}</div>
    </div>

    {notice ? <p className="form-notice success" role="status">{notice}</p> : null}
    {error ? <p className="form-notice error" role="alert">{error}</p> : null}

    <div className="publishing-kpis"><div><Send size={17} /><span>تم نشره</span><strong>{publishedCount}</strong></div><div className={upcoming.length ? "active" : ""}><CalendarClock size={17} /><span>قادم</span><strong>{upcoming.length}</strong></div><div className={problemCount ? "danger" : ""}><AlertTriangle size={17} /><span>يحتاج فحص</span><strong>{problemCount}</strong></div><button type="button" disabled={!manager || working} className={control?.kill_switch ? "kill active" : "kill"} onClick={() => void toggleKillSwitch()}>{control?.kill_switch ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}<span>إيقاف طوارئ</span><strong>{control?.kill_switch ? "مفعّل" : "متوقف"}</strong></button></div>

    <div className="publishing-setup-grid">
      <section className="panel publishing-channel-panel"><div className="section-heading"><div><p className="overline">Allowlist</p><h3>قنوات Telegram المسموح بها</h3></div><StatusBadge tone={readyChannels.length ? "success" : "warning"}>{readyChannels.length ? "جاهز" : "يلزم إعداد"}</StatusBadge></div>
        {channels.length ? <div className="publishing-channel-list">{channels.map((channel) => <div key={channel.id}><span className={channel.verification_status === "ready" ? "channel-dot ready" : "channel-dot"} /><div><strong>{channel.title}</strong><small dir="ltr">{channel.telegram_username ?? channel.telegram_chat_id}</small></div><StatusBadge tone={channel.verification_status === "ready" ? "success" : "danger"}>{channel.verification_status === "ready" ? "البوت ناشر" : "تحقق من الصلاحية"}</StatusBadge></div>)}</div> : <p className="publishing-empty">أضف البوت كـAdmin في قناة التجربة وفعّل Post Messages، ثم تحقق منها هنا.</p>}
        {manager ? <form className="publishing-channel-form" onSubmit={(event) => void verifyChannel(event)}><label><span>رابط القناة أو @username أو Channel ID</span><input name="channel_reference" dir="ltr" required placeholder="@samihhermestest أو -100…" /></label><Button type="submit" variant="secondary" disabled={working}>{working ? <LoaderCircle className="spin" size={14} /> : <ShieldCheck size={14} />} تحقق وأضف</Button></form> : null}
      </section>
      <section className="panel publishing-safety-panel"><div><ShieldCheck size={19} /><div><p className="overline">سياسة آمنة افتراضيًا</p><h3>المعاينة لا توقف العجلة</h3></div></div><ul><li><CheckCircle2 size={14} /> Claim فريد قبل أي اتصال بـTelegram.</li><li><CheckCircle2 size={14} /> تعديل المحتوى بعد المعاينة يوقف النشر.</li><li><CheckCircle2 size={14} /> Timeout بعد بدء الطلب يصبح «غير مؤكد» ولا يُعاد.</li><li><CheckCircle2 size={14} /> Kill switch يمنع أي اتصال جديد فورًا.</li></ul><div className="publishing-connection-state"><span className={connection?.connected_at ? "connected" : ""} />{connection?.connected_at ? `التنبيهات مربوطة منذ ${formatDate(connection.connected_at)}` : "المعاينات لن تصل لك قبل ربط البوت؛ الوضع الافتراضي سيظل ينشر في موعده."}</div></section>
    </div>

    <section className="panel publishing-media-library">
      <div className="section-heading">
        <div><p className="overline">Telegram Inbox</p><h2>مكتبة وسائط النشر</h2><p>أرسل أو اعمل Forward لصورة أو فيديو إلى <b dir="ltr">@teamwhalesbot</b> من الحساب المربوط؛ سيظهر هنا تلقائيًا.</p></div>
        <StatusBadge tone={telegramAssets.length ? "success" : "neutral"}>{telegramAssets.length ? `${telegramAssets.length} ملف` : "في انتظار أول ملف"}</StatusBadge>
      </div>
      {telegramAssets.length ? <div className="publishing-asset-strip">{telegramAssets.slice(0, 8).map((asset) => <article className="publishing-asset-card" key={asset.id}>
        <MediaAssetVisual asset={asset} previewUrl={asset.preview_object_path ? assetPreviewUrls[asset.preview_object_path] : undefined} />
        <span className="publishing-asset-copy"><strong>{asset.display_name}</strong><small>{mediaKindLabel(asset.media_kind)}{formatFileSize(asset.file_size) ? ` · ${formatFileSize(asset.file_size)}` : ""} · {formatDate(asset.created_at)}</small></span>
      </article>)}</div> : <div className="publishing-media-empty"><Library size={22} /><div><strong>مش محتاج تجيب رابط أو file_id</strong><p>{connection?.connected_at ? "ابعت الملف للبوت الآن، ولما يرد إنه اتحفظ اضغط تحديث لو لم يظهر فورًا." : "اربط تنبيهات Telegram أولًا، ثم أرسل الملف للبوت من نفس الحساب."}</p></div></div>}
    </section>

    {showComposer && manager ? <form key={editingSchedule?.id ?? "new-publication"} ref={composerRef} id="publishing-composer" className="panel publishing-composer" onSubmit={(event) => void savePublication(event)}><div className="section-heading"><div><p className="overline">{editingSchedule ? "تعديل آمن" : "منشور + جدول ذري"}</p><h2>{editingSchedule ? `تعديل: ${editingPost?.name ?? "المنشور"}` : "جدولة نشر جديد"}</h2></div><button className="text-button" type="button" onClick={() => { setShowComposer(false); resetComposerState(); }}>إغلاق</button></div>
      {editingSchedule ? <p className="publishing-edit-note"><ShieldCheck size={14} /> الحفظ سينشئ نسخة جديدة ويلغي النسخ القادمة القديمة؛ لن تتغير المنشورات التي نُشرت بالفعل.</p> : null}
      {!readyChannels.length ? <p className="form-notice error" role="alert">افتحنا النموذج، لكن الحفظ سيظل متوقفًا لحين وجود قناة Telegram جاهزة للنشر.</p> : null}
      <div className="form-grid">
        <label><span>اسم داخلي للمنشور</span><input name="post_name" minLength={2} maxLength={180} required defaultValue={editingPost?.name ?? ""} placeholder="مثال: إعلان ويبنار الأربعاء" /></label>
        <label><span>ربط بمحتوى موجود — اختياري</span><select name="content_item_id" defaultValue={editingPost?.content_item_id ?? ""}><option value="">بدون ربط</option>{contentItems.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>
        <label className="full-field"><span>نص المنشور</span><textarea name="post_text" maxLength={3800} rows={7} defaultValue={editingPost?.post_text ?? ""} placeholder="اكتب النص النهائي كما سيظهر على القناة…" /></label>
        <label><span>رابط CTA — اختياري</span><input name="link_url" type="url" dir="ltr" defaultValue={editingPost?.link_url ?? ""} placeholder="https://…" /></label>
        <label><span>نوع الوسائط</span><select name="media_kind" value={mediaKind} onChange={(event) => { setMediaKind(event.target.value); setSelectedAssetId(""); setManualMediaUrl(""); }}><option value="none">بدون صورة أو فيديو</option><option value="photo">صورة</option><option value="video">فيديو</option></select></label>
        <label className="publishing-check"><input name="disable_link_preview" type="checkbox" defaultChecked={editingPost?.disable_link_preview ?? false} /><span>إخفاء معاينة الروابط</span></label>
      </div>
      <input name="media_source" type="hidden" value={activeMediaSource} />
      {mediaKind !== "none" ? <section className="publishing-media-picker">
        <div className="section-heading"><div><p className="overline">الوسائط</p><h3>اختيار {mediaKindLabel(mediaKind)}</h3></div><div className="segmented-control"><button type="button" className={mediaSourceMode === "library" ? "active" : ""} onClick={() => setMediaSourceMode("library")}>مكتبة Telegram</button><button type="button" className={mediaSourceMode === "url" ? "active" : ""} onClick={() => setMediaSourceMode("url")}>رابط مباشر</button></div></div>
        {mediaSourceMode === "library" ? compatibleAssets.length ? <div className="publishing-asset-picker-grid">{compatibleAssets.map((asset) => <button type="button" className={selectedAssetId === asset.id ? "publishing-asset-card selected" : "publishing-asset-card"} onClick={() => setSelectedAssetId(asset.id)} key={asset.id}>
          <MediaAssetVisual asset={asset} previewUrl={asset.preview_object_path ? assetPreviewUrls[asset.preview_object_path] : undefined} />
          <span className="publishing-asset-copy"><strong>{asset.display_name}</strong><small>{formatFileSize(asset.file_size) ?? mediaKindLabel(asset.media_kind)} · {formatDate(asset.created_at)}</small></span>
          <span className="publishing-asset-check">{selectedAssetId === asset.id ? "✓ تم الاختيار" : "اختيار"}</span>
        </button>)}</div> : <div className="publishing-media-empty"><MessageSquareText size={22} /><div><strong>لا توجد ملفات من هذا النوع</strong><p>أرسل {mediaKindLabel(mediaKind)} إلى @teamwhalesbot ثم ارجع هنا. ستظهر تلقائيًا بدون أي رابط.</p></div></div> : <label className="publishing-direct-media"><span>رابط HTTPS مباشر للملف</span><input type="url" dir="ltr" value={manualMediaUrl} onChange={(event) => setManualMediaUrl(event.target.value)} placeholder={mediaKind === "photo" ? "https://example.com/image.jpg" : "https://example.com/video.mp4"} /><small>لا تستخدم رابط رسالة Telegram أو صفحة مشاهدة Google Drive.</small></label>}
        <p className="publishing-caption-limit">مع الصورة أو الفيديو يجب ألا يتجاوز نص المنشور ورابط CTA معًا 1024 حرفًا.</p>
      </section> : null}
      <fieldset className="publishing-channel-picker"><legend>القنوات</legend>{readyChannels.map((channel) => <label key={channel.id}><input aria-label={`اختيار قناة ${channel.title}`} type="checkbox" name="channel_ids" value={channel.id} defaultChecked={editingSchedule ? editingChannelIds.has(channel.id) : true} /><span><strong>{channel.title}</strong><small dir="ltr">{channel.telegram_username ?? channel.telegram_chat_id}</small></span></label>)}</fieldset>
      <div className="publishing-policy-grid">{(Object.keys(previewPolicyConfig) as PreviewPolicy[]).map((policy) => <label key={policy}><input aria-label={previewPolicyConfig[policy].label} type="radio" name="preview_policy" value={policy} defaultChecked={editingSchedule ? editingSchedule.preview_policy === policy : policy === "review_window"} /><span><strong>{previewPolicyConfig[policy].label}</strong><small>{previewPolicyConfig[policy].description}</small></span></label>)}</div>
      <div className="publishing-schedule-block"><div className="segmented-control"><button type="button" className={scheduleType === "once" ? "active" : ""} onClick={() => setScheduleType("once")}>مرة واحدة</button><button type="button" className={scheduleType === "weekly" ? "active" : ""} onClick={() => setScheduleType("weekly")}>أسبوعي متكرر</button></div>{scheduleType === "once" ? <label><span>موعد النشر — القاهرة</span><input name="once_at" type="datetime-local" defaultValue={cairoDateTimeInput(editingSchedule?.once_at ?? null)} required /></label> : <><fieldset className="weekday-picker"><legend>أيام الأسبوع</legend>{[[1,"الاثنين"],[2,"الثلاثاء"],[3,"الأربعاء"],[4,"الخميس"],[5,"الجمعة"],[6,"السبت"],[7,"الأحد"]].map(([value,label]) => <label key={value}><input type="checkbox" name="weekdays" value={value} defaultChecked={editingSchedule ? editingSchedule.weekdays?.includes(Number(value)) : value === 1} /><span>{label}</span></label>)}</fieldset><div className="form-grid"><label><span>الوقت — القاهرة</span><input name="time_local" type="time" defaultValue={editingSchedule?.time_local?.slice(0, 5) ?? "18:00"} required /></label><label><span>تاريخ البداية</span><input name="starts_on" type="date" defaultValue={editingSchedule?.starts_on ?? cairoDateInput()} required /></label><label><span>تاريخ النهاية — اختياري</span><input name="ends_on" type="date" defaultValue={editingSchedule?.ends_on ?? ""} /></label><label><span>أقصى عدد مرات</span><input name="occurrence_limit" type="number" min="1" max="1000" defaultValue={editingSchedule?.occurrence_limit ?? 12} required /></label></div></>}</div>
      <div className="publishing-advanced"><label><span>المعاينة قبل الموعد (دقيقة)</span><input name="preview_lead_minutes" type="number" min="5" max="10080" defaultValue={editingSchedule?.preview_lead_minutes ?? 60} /></label><label><span>مهلة تجاوز الموعد (دقيقة)</span><input name="missed_grace_minutes" type="number" min="1" max="1440" defaultValue={editingSchedule?.missed_grace_minutes ?? 10} /></label></div>
      <div className="form-actions"><Button type="submit" disabled={working || !readyChannels.length}>{working ? <LoaderCircle className="spin" size={15} /> : editingSchedule ? <Pencil size={15} /> : <CalendarClock size={15} />} {editingSchedule ? "حفظ التعديلات" : "حفظ وجدولة"}</Button><small>إما تُحفظ كل التغييرات والقنوات معًا، أو لا يتغير شيء.</small></div>
    </form> : null}

    <section className="publishing-queue">
      <div className="section-heading publishing-queue-heading"><div><p className="overline">Queue</p><h2>قائمة النشر</h2></div><div className="segmented-control" aria-label="عرض قائمة النشر"><button type="button" className={queueView === "upcoming" ? "active" : ""} onClick={() => setQueueView("upcoming")}>القادمة ({upcoming.length})</button><button type="button" className={queueView === "history" ? "active" : ""} onClick={() => setQueueView("history")}>السجل ({history.length})</button></div></div>
      {visibleOccurrences.length ? <div className="publishing-occurrence-list">{visibleOccurrences.map((occurrence) => {
        const post = postById.get(occurrence.post_id);
        const schedule = scheduleById.get(occurrence.schedule_id);
        const status = publicationStatus(occurrence.status);
        const occurrenceLogs = logsByOccurrence.get(occurrence.id) ?? [];
        const canChangeSchedule = Boolean(manager && schedule && post && !schedule.deleted_at && !["publishing", "unknown"].includes(occurrence.status));
        return <article className="panel publishing-occurrence" id={`occurrence-${occurrence.id}`} key={occurrence.id}><header><div><p className="overline">{schedule?.schedule_type === "weekly" ? "متكرر أسبوعيًا" : "مرة واحدة"}</p><h3>{post?.name ?? "منشور"}</h3><small>{formatDate(occurrence.scheduled_at)}</small></div><StatusBadge tone={status.tone}>{status.label}</StatusBadge></header>{post?.post_text ? <p className="publishing-post-excerpt">{post.post_text}</p> : null}{occurrence.error ? <p className="publishing-error"><AlertTriangle size={13} /> {occurrence.error}</p> : null}{occurrence.hold_reason ? <small className="publishing-hold">سبب التوقف: {occurrence.hold_reason}</small> : null}{occurrenceLogs.length ? <div className="publishing-results">{occurrenceLogs.map((log) => <div key={log.id}><span>{publicationStatus(log.status).label}</span>{log.message_url ? <a href={log.message_url} target="_blank" rel="noreferrer">فتح المنشور <ExternalLink size={11} /></a> : null}{log.error ? <small>{log.error}</small> : null}</div>)}</div> : null}{queueView === "upcoming" ? <footer>{schedule && !schedule.deleted_at ? <button className="text-button" type="button" disabled={!manager || working} onClick={() => void toggleSchedule(schedule)}>{schedule.paused ? <ToggleRight size={14} /> : <CirclePause size={14} />} {schedule.paused ? "تشغيل الجدول" : "إيقاف الجدول"}</button> : null}{canChangeSchedule && schedule ? <button className="text-button" type="button" disabled={working} onClick={() => startEditing(schedule)}><Pencil size={13} /> تعديل المنشور والجدول</button> : null}{canChangeSchedule && schedule && post ? <button className="text-button danger-text" type="button" disabled={working} onClick={() => setPendingDelete({ schedule, post })}><Trash2 size={13} /> حذف الجدول</button> : null}{manager && ["pending","previewing","previewed","awaiting_approval","approved","ready","held"].includes(occurrence.status) ? <button className="text-button danger-text" type="button" disabled={working} onClick={() => void cancelOccurrence(occurrence.id)}><OctagonX size={13} /> إلغاء هذه النسخة فقط</button> : null}</footer> : null}</article>;
      })}</div> : <section className="panel publishing-empty-state"><Send size={22} /><div><h3>{queueView === "upcoming" ? "لا توجد منشورات قادمة" : "لا يوجد سجل نشر بعد"}</h3><p>{queueView === "upcoming" ? "أنشئ جدولًا جديدًا، أو افتح السجل لمراجعة المنشورات السابقة والملغاة." : "ستظهر هنا المنشورات المكتملة والملغاة وحالات الفشل."}</p></div></section>}
    </section>

    {pendingDelete ? <div className="publishing-dialog-backdrop"><section className="publishing-dialog" role="dialog" aria-modal="true" aria-labelledby="publishing-delete-title"><header><div><p className="overline">تأكيد مطلوب</p><h2 id="publishing-delete-title">حذف «{pendingDelete.post.name}»؟</h2></div><button className="icon-button" type="button" aria-label="إغلاق نافذة الحذف" disabled={working} onClick={() => setPendingDelete(null)}><X size={17} /></button></header><div className="publishing-dialog-warning"><AlertTriangle size={19} /><p>سيُلغى هذا الجدول وكل نسخه القادمة ولن يُرسل النظام أي نسخة جديدة منه. المنشورات التي نُشرت بالفعل وسجل التدقيق سيظلان محفوظين.</p></div><footer><Button type="button" variant="secondary" disabled={working} onClick={() => setPendingDelete(null)}>رجوع</Button><Button type="button" className="publishing-delete-confirm" disabled={working} onClick={() => void deleteSchedule()}>{working ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />} نعم، احذف الجدول</Button></footer></section></div> : null}
  </section>;
}
