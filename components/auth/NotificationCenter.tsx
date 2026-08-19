"use client";

import { Bell, CheckCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Tables } from "../../lib/supabase/database.types";

type Notification = Tables<"notifications">;

function formatNotificationTime(value: string) {
  return new Intl.DateTimeFormat("ar-EG", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export function NotificationCenter() {
  const router = useRouter();
  const configured = isSupabaseConfigured();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const refresh = useCallback(async (targetUserId: string) => {
    const { data } = await getSupabaseBrowserClient().from("notifications")
      .select("*")
      .eq("user_id", targetUserId)
      .order("created_at", { ascending: false })
      .limit(25);
    setNotifications(data ?? []);
  }, []);

  useEffect(() => {
    if (!configured) return;
    const supabase = getSupabaseBrowserClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
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
      setOrganizationId(membership?.organization_id ?? null);
      await refresh(sessionUserId);
      channel = supabase.channel(`notifications:${sessionUserId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${sessionUserId}` }, () => void refresh(sessionUserId))
        .subscribe();
    });
    return () => {
      active = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [configured, refresh]);

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
    setOpen(false);
    router.push(notification.url);
  }

  if (!userId) return null;

  return <div className="notification-center">
    <button className="icon-button notification-trigger" type="button" aria-label={`الإشعارات${unreadCount ? `: ${unreadCount} غير مقروء` : ""}`} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <Bell size={17} />{unreadCount ? <span>{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
    </button>
    {open ? <section className="notification-popover" aria-label="مركز الإشعارات">
      <header><div><strong>الإشعارات</strong><small>{unreadCount ? `${unreadCount} غير مقروء` : "أنت متابع كل جديد"}</small></div>{unreadCount ? <button type="button" onClick={() => void markAllRead()}><CheckCheck size={13} /> تعليم الكل كمقروء</button> : null}</header>
      {notifications.length ? <ol>{notifications.map((notification) => <li className={notification.read_at ? "" : "unread"} key={notification.id}>
        <button className="notification-link" type="button" onClick={() => void openNotification(notification)}><strong>{notification.title}</strong><p>{notification.body}</p><small>{formatNotificationTime(notification.created_at)}</small></button>
      </li>)}</ol> : <p className="notification-empty">لا توجد إشعارات حتى الآن.</p>}
    </section> : null}
  </div>;
}
