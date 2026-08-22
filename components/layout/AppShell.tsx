"use client";

import type { Session } from "@supabase/supabase-js";
import { LoaderCircle, LockKeyhole, LogOut, ShieldCheck } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  canAccessWorkspaceSection,
  firstAllowedSectionHref,
  membershipSections,
  sectionForPathname,
  type WorkspaceMembership,
} from "../../lib/access";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import { LoginWorkspace } from "../auth/LoginWorkspace";
import { SessionChip } from "../auth/SessionChip";
import { PresenceReporter } from "../auth/PresenceReporter";
import { NotificationCenter } from "../auth/NotificationCenter";
import { Button } from "../ui/Button";
import { SidebarNav } from "./SidebarNav";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const configured = isSupabaseConfigured();
  const [ready, setReady] = useState(!configured);
  const [session, setSession] = useState<Session | null>(null);
  const [membership, setMembership] = useState<WorkspaceMembership | null>(null);
  const [accessError, setAccessError] = useState<string | null>(configured ? null : "خدمة الدخول غير متاحة مؤقتًا.");

  const loadAccess = useCallback(async (nextSession: Session | null) => {
    setSession(nextSession);
    setMembership(null);
    setAccessError(null);
    if (!nextSession) {
      setReady(true);
      return;
    }

    const { data, error } = await getSupabaseBrowserClient()
      .from("memberships")
      .select("role, status, allowed_sections")
      .eq("user_id", nextSession.user.id)
      .limit(1)
      .maybeSingle();
    if (error) setAccessError("تعذّر التحقق من صلاحية الحساب. أعد تحميل الصفحة.");
    else setMembership(data);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!configured) return;
    const supabase = getSupabaseBrowserClient();
    let active = true;
    let timer: number | null = null;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) void loadAccess(data.session);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => { if (active) void loadAccess(nextSession); }, 0);
    });
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
      data.subscription.unsubscribe();
    };
  }, [configured, loadAccess]);

  useEffect(() => {
    if (!configured || !session) return;
    const supabase = getSupabaseBrowserClient();
    const channel = supabase.channel(`shell-access:${session.user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "memberships", filter: `user_id=eq.${session.user.id}` }, () => void loadAccess(session))
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [configured, loadAccess, session]);

  useEffect(() => {
    if (ready && session && membership?.status === "active" && pathname === "/login") {
      window.location.replace(firstAllowedSectionHref(membership));
    }
  }, [membership, pathname, ready, session]);

  const publicJoinRoute = pathname.startsWith("/join");
  if (publicJoinRoute) return <div className="public-access-shell"><div className="public-access-container">{children}</div></div>;
  if (!ready && pathname === "/login") return <LoginWorkspace />;
  if (!ready) return <main className="secure-login-page secure-loading"><LoaderCircle className="spin" size={28} /><h1>جارٍ التحقق من الوصول</h1><p>لن نعرض مساحة العمل قبل اعتماد الحساب.</p></main>;
  if (!session) return <LoginWorkspace />;

  if (accessError) return <main className="secure-login-page"><section className="secure-login-card"><LockKeyhole size={28} /><h1>تعذّر التحقق من الصلاحية</h1><p>{accessError}</p><Button type="button" onClick={() => window.location.reload()}>إعادة المحاولة</Button></section></main>;

  if (!membership || membership.status !== "active") return <main className="secure-login-page">
    <section className="secure-login-card">
      <LockKeyhole size={29} />
      <p className="overline">وصول مرفوض</p>
      <h1>هذا الحساب غير مضاف للفريق</h1>
      <p>تم التحقق من البريد، لكنه لا يملك عضوية فعالة. اطلب من مالك المنصة إضافته وتحديد دوره والأقسام المسموحة.</p>
      <strong dir="ltr">{session.user.email}</strong>
      <Button type="button" variant="secondary" onClick={() => void getSupabaseBrowserClient().auth.signOut()}><LogOut size={16} /> تسجيل الخروج</Button>
    </section>
  </main>;

  if (pathname === "/login") {
    return <main className="secure-login-page secure-loading"><LoaderCircle className="spin" size={26} /><h1>جارٍ فتح مساحة عملك</h1></main>;
  }

  const requestedSection = sectionForPathname(pathname);
  const allowedSections = membershipSections(membership);
  const sectionAllowed = canAccessWorkspaceSection(membership, requestedSection);

  return (
    <div className="app-shell">
      {sectionAllowed ? <PresenceReporter /> : null}
      <aside className="sidebar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">MW</span>
          <span><strong>Market Whales</strong><small>Operating System</small></span>
        </div>
        <SidebarNav allowedSections={allowedSections} />
        <div className="sidebar-note">
          <span className="signal-dot" aria-hidden="true" />
          <div><strong>عضوية بالدعوة فقط</strong><small>لا إرسال أو تفعيل تلقائي لأي عضو</small></div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="topbar-status"><ShieldCheck size={17} /><span>وصول خاص محكوم بالصلاحيات</span></div>
          <div className="topbar-actions">
            <NotificationCenter />
            <SessionChip />
          </div>
        </header>
        <div className="page-container">{sectionAllowed ? children : <section className="workspace-state workspace-onboarding"><LockKeyhole size={27} /><div><p className="overline">خارج صلاحيات حسابك</p><h2>هذا القسم غير متاح لك</h2><p>مالك المنصة يحدد الأقسام لكل عضو. لو تحتاج هذا القسم اطلب تعديل صلاحيتك.</p></div><Button href={firstAllowedSectionHref(membership)} variant="secondary">العودة لمساحة عملي</Button></section>}</div>
      </div>
    </div>
  );
}
