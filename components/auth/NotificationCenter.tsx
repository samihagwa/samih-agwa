"use client";

import { AtSign, Bell, CheckCheck, LoaderCircle, Send, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Tables } from "../../lib/supabase/database.types";

type Notification = Tables<"notifications">;
type TelegramConnection = Tables<"publishing_admin_connections">;

function formatNotificationTime(value: string) {
  return new Intl.DateTimeFormat("ar-EG", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export function NotificationCenter() {
  const configured = isSupabaseConfigured();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [liveAlert, setLiveAlert] = useState<Notification | null>(null);
  const [telegramConnection, setTelegramConnection] = useState<TelegramConnection | null>(null);
  const [telegramWorking, setTelegramWorking] = useState(false);
  const [telegramUsername, setTelegramUsername] = useState("");
  const [telegramNotice, setTelegramNotice] = useState<string | null>(null);
  const [telegramError, setTelegramError] = useState<string | null>(null);
  const knownNotificationIds = useRef<Set<number>>(new Set());
  const hasLoadedNotifications = useRef(false);

  const refresh = useCallback(async (targetUserId: string, showNewAlert = false) => {
    const { data } = await getSupabaseBrowserClient().from("notifications")
      .select("*")
      .eq("user_id", targetUserId)
      .order("created_at", { ascending: false })
      .limit(25);
    const rows = data ?? [];
    if (showNewAlert && hasLoadedNotifications.current) {
      const newestUnread = rows.find((notification) => !notification.read_at && !knownNotificationIds.current.has(notification.id));
      if (newestUnread) setLiveAlert(newestUnread);
    }
    knownNotificationIds.current = new Set(rows.map((notification) => notification.id));
    hasLoadedNotifications.current = true;
    setNotifications(rows);
  }, []);

  const refreshTelegramConnection = useCallback(async (targetOrganizationId: string, targetUserId: string) => {
    const { data } = await getSupabaseBrowserClient().from("publishing_admin_connections")
      .select("*")
      .eq("organization_id", targetOrganizationId)
      .eq("user_id", targetUserId)
      .maybeSingle();
    const nextConnection = data ?? null;
    setTelegramConnection(nextConnection);
    setTelegramUsername((current) => current || nextConnection?.workflow_expected_username || nextConnection?.telegram_username || "");
  }, []);

  useEffect(() => {
    if (!configured) return;
    const supabase = getSupabaseBrowserClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let pollInterval: number | null = null;
    let onVisibility: (() => void) | null = null;
    let active = true;
    void supabase.auth.getSession().then(async ({ data }) => {
      const sessionUserId = data.session?.user.id ?? null;
      if (!active || !sessionUserId) return;
      setUserId(sessionUserId);
      const { data: membership } = await supabase.from("memberships")
        .select("organization_id")
        .eq("user_id", sessionUserId)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      if (!active) return;
      const activeOrganizationId = membership?.organization_id ?? null;
      setOrganizationId(activeOrganizationId);
      await refresh(sessionUserId);
      if (activeOrganizationId) await refreshTelegramConnection(activeOrganizationId, sessionUserId);
      channel = supabase.channel(`notifications:${sessionUserId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${sessionUserId}` }, () => void refresh(sessionUserId, true))
        .subscribe();
      pollInterval = window.setInterval(() => void refresh(sessionUserId, true), 30_000);
      onVisibility = () => {
        if (document.visibilityState === "visible") {
          void refresh(sessionUserId, true);
          if (activeOrganizationId) void refreshTelegramConnection(activeOrganizationId, sessionUserId);
        }
      };
      document.addEventListener("visibilitychange", onVisibility);
    });
    return () => {
      active = false;
      if (channel) void supabase.removeChannel(channel);
      if (pollInterval) window.clearInterval(pollInterval);
      if (onVisibility) document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [configured, refresh, refreshTelegramConnection]);

  useEffect(() => {
    if (!liveAlert) return;
    const timeout = window.setTimeout(() => setLiveAlert(null), 7_000);
    return () => window.clearTimeout(timeout);
  }, [liveAlert]);

  const unreadCount = useMemo(() => notifications.filter((notification) => !notification.read_at).length, [notifications]);

  async function markAllRead() {
    if (!organizationId || !userId) return;
    await getSupabaseBrowserClient().rpc("mark_all_notifications_read", { target_organization_id: organizationId });
    await refresh(userId);
  }

  async function markRead(notification: Notification) {
    if (!notification.read_at && userId) {
      await getSupabaseBrowserClient().rpc("mark_notification_read", { target_notification_id: notification.id });
      await refresh(userId);
    }
  }

  async function openNotification(notification: Notification) {
    await markRead(notification);
    setLiveAlert(null);
    setOpen(false);
    window.location.assign(notification.url);
  }

  async function connectTelegram() {
    if (!organizationId || !userId || telegramWorking) return;
    const normalizedUsername = telegramUsername.trim().replace(/^@/, "");
    if (!/^[A-Za-z0-9_]{5,32}$/.test(normalizedUsername)) {
      setTelegramError("اكتب يوزرنيم Telegram صحيحًا، مثل @samihagwa، ثم حاول مرة أخرى.");
      return;
    }
    const telegramWindow = window.open("about:blank", "_blank");
    setTelegramWorking(true);
    setTelegramNotice(null);
    setTelegramError(null);
    const { data, error } = await getSupabaseBrowserClient().rpc("create_member_telegram_link", {
      target_organization_id: organizationId,
      target_telegram_username: normalizedUsername,
    });
    setTelegramWorking(false);
    if (error || !data) {
      telegramWindow?.close();
      const message = error?.message ?? "";
      setTelegramError(/Publishing section access/i.test(message)
        ? "صلاحية ربط إشعارات الأعضاء لم تُحدّث بعد. حدّث الصفحة ثم حاول مرة أخرى."
        : /valid Telegram username/i.test(message)
          ? "يوزرنيم Telegram غير صحيح. اكتبه كما يظهر في حسابك."
          : "تعذّر إنشاء رابط الربط. حدّث الصفحة وتأكد أنك داخل بحساب عضو فعّال.");
      return;
    }
    const target = `https://t.me/teamwhalesbot?start=notify_${data}`;
    if (telegramWindow) telegramWindow.location.href = target;
    else window.location.assign(target);
    setTelegramNotice(`افتح البوت من @${normalizedUsername} واضغط Start خلال 15 دقيقة، ثم ارجع للمنصة. لن تصلك إشعارات قديمة.`);
    window.setTimeout(() => void refreshTelegramConnection(organizationId, userId), 4_000);
    window.setTimeout(() => void refreshTelegramConnection(organizationId, userId), 12_000);
  }

  async function sendTelegramTest() {
    if (!organizationId || !userId || telegramWorking || !telegramConnection?.workflow_notifications_enabled) return;
    setTelegramWorking(true);
    setTelegramNotice(null);
    setTelegramError(null);
    const { error } = await getSupabaseBrowserClient().rpc("send_member_telegram_test_notification", {
      target_organization_id: organizationId,
    });
    if (error) {
      setTelegramError(/Wait before sending another/i.test(error.message)
        ? "استنى 30 ثانية قبل إرسال اختبار تاني."
        : "تعذّر تجهيز الإشعار التجريبي. تأكد إنك عملت Start وإن الإشعارات مفعّلة.");
    } else {
      setTelegramNotice("تم تجهيز إشعار تجريبي، وهيوصلك على الخاص خلال دقيقة.");
      await refresh(userId);
    }
    await refreshTelegramConnection(organizationId, userId);
    setTelegramWorking(false);
  }

  async function setTelegramDelivery(enabled: boolean) {
    if (!organizationId || !userId || telegramWorking) return;
    setTelegramWorking(true);
    setTelegramNotice(null);
    setTelegramError(null);
    const { error } = await getSupabaseBrowserClient().rpc("set_member_telegram_workflow_notifications", {
      target_organization_id: organizationId,
      target_enabled: enabled,
    });
    if (error) setTelegramError(enabled
      ? "تعذّر تشغيل الإشعارات. أعد ربط Telegram ثم حاول مرة أخرى."
      : "تعذّر إيقاف الإشعارات. حاول مرة أخرى.");
    else setTelegramNotice(enabled ? "تم تشغيل إشعارات الشغل على Telegram." : "تم إيقاف إشعارات Telegram لهذا الحساب.");
    await refreshTelegramConnection(organizationId, userId);
    setTelegramWorking(false);
  }

  if (!userId) return null;

  return <div className="notification-center">
    <button className="icon-button notification-trigger" type="button" aria-label={`الإشعارات${unreadCount ? `: ${unreadCount} غير مقروء` : ""}`} aria-expanded={open} onClick={() => {
      setOpen((value) => !value);
      if (!open && organizationId) void refreshTelegramConnection(organizationId, userId);
    }}>
      <Bell size={17} />{unreadCount ? <span>{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
    </button>
    {open ? <section className="notification-popover" aria-label="مركز الإشعارات">
      <header><div><strong>الإشعارات</strong><small>{unreadCount ? `${unreadCount} غير مقروء` : "أنت متابع كل جديد"}</small></div>{unreadCount ? <button type="button" onClick={() => void markAllRead()}><CheckCheck size={13} /> تعليم الكل كمقروء</button> : null}</header>
      <div className={`notification-telegram-card${telegramConnection?.workflow_notifications_enabled ? " active" : ""}`}>
        <span className="notification-telegram-icon" aria-hidden="true"><Send size={17} /></span>
        <div className="notification-telegram-copy">
          <strong>{telegramConnection?.workflow_notifications_enabled
            ? "إشعارات Telegram مفعّلة"
            : telegramConnection?.connected_at ? "Telegram مربوط" : "اربط Telegram"}</strong>
          <small>{telegramConnection?.workflow_notifications_enabled
            ? "المهام والتعديلات التي تخصك فقط، وبرابط مباشر."
            : telegramConnection?.connected_at
              ? "الربط محفوظ، ويمكنك تشغيل إشعارات الشغل الآن."
              : "استقبل المهمة أو التعديل على الخاص فور حدوثه."}</small>
          {telegramConnection?.workflow_last_sent_at ? <small>آخر إرسال: {formatNotificationTime(telegramConnection.workflow_last_sent_at)}</small> : null}
          {telegramConnection?.connected_at && telegramConnection.telegram_username ? <small dir="ltr">@{telegramConnection.telegram_username.replace(/^@/, "")}</small> : null}
          {telegramConnection?.workflow_last_error ? <small className="notification-telegram-warning">آخر إرسال لم يكتمل؛ أعد الربط إذا استمرت المشكلة.</small> : null}
        </div>
        {!telegramConnection?.connected_at ? <label className="notification-telegram-username"><span><AtSign size={12} /> يوزرنيم Telegram</span><input type="text" dir="ltr" autoComplete="off" value={telegramUsername} onChange={(event) => setTelegramUsername(event.target.value)} placeholder="@username" disabled={telegramWorking} /></label> : null}
        <div className="notification-telegram-actions">
          {!telegramConnection?.connected_at
            ? <button className="notification-telegram-action" type="button" disabled={telegramWorking} onClick={() => void connectTelegram()}>{telegramWorking ? <LoaderCircle className="spin" size={14} /> : null} فتح البوت وعمل Start</button>
            : <button className="notification-telegram-action" type="button" disabled={telegramWorking} onClick={() => void setTelegramDelivery(!telegramConnection.workflow_notifications_enabled)}>{telegramWorking ? <LoaderCircle className="spin" size={14} /> : null}{telegramConnection.workflow_notifications_enabled ? "إيقاف" : "تشغيل"}</button>}
          {telegramConnection?.workflow_notifications_enabled ? <button className="notification-telegram-action test" type="button" disabled={telegramWorking} onClick={() => void sendTelegramTest()}>إرسال اختبار</button> : null}
        </div>
        {telegramNotice ? <p className="notification-telegram-feedback" role="status">{telegramNotice}</p> : null}
        {telegramError ? <p className="notification-telegram-feedback error" role="alert">{telegramError}</p> : null}
      </div>
      {notifications.length ? <ol>{notifications.map((notification) => <li className={notification.read_at ? "" : "unread"} key={notification.id}>
        <button className="notification-link" type="button" onClick={() => void openNotification(notification)}><strong>{notification.title}</strong><p>{notification.body}</p><small>{formatNotificationTime(notification.created_at)}</small></button>
      </li>)}</ol> : <p className="notification-empty">لا توجد إشعارات حتى الآن.</p>}
    </section> : null}
    {liveAlert ? <aside className="notification-toast" role="status" aria-live="polite">
      <button className="notification-toast-main" type="button" onClick={() => void openNotification(liveAlert)}><Bell size={16} /><span><strong>{liveAlert.title}</strong><small>{liveAlert.body}</small></span></button>
      <button className="notification-toast-close" type="button" aria-label="إغلاق التنبيه" onClick={() => setLiveAlert(null)}><X size={14} /></button>
    </aside> : null}
  </div>;
}
