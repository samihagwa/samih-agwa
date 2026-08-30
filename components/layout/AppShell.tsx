"use client";

import type { Session } from "@supabase/supabase-js";
import { LoaderCircle, LockKeyhole, LogOut, Menu, ShieldCheck, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
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
import { WorkspaceAssistant } from "../assistant/WorkspaceAssistant";
import { MemberOnboardingGate } from "../team/MemberOnboardingGate";
import { ContentSectionNav } from "./ContentSectionNav";
import { SidebarNav } from "./SidebarNav";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const configured = isSupabaseConfigured();
  const [ready, setReady] = useState(!configured);
  const [session, setSession] = useState<Session | null>(null);
  const [membership, setMembership] = useState<WorkspaceMembership | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(configured ? null : "خدمة الدخول غير متاحة مؤقتًا.");
  const loadedUserId = useRef<string | null>(null);

  const loadAccess = useCallback(async (nextSession: Session | null) => {
    const nextUserId = nextSession?.user.id ?? null;
    if (loadedUserId.current !== nextUserId) setMembership(null);
    loadedUserId.current = nextUserId;
    setSession(nextSession);
    setAccessError(null);
    if (!nextSession) {
      setMembership(null);
      setReady(true);
      return;
    }

    const { data, error } = await getSupabaseBrowserClient()
      .from("memberships")
      .select("organization_id, role, status, allowed_sections, onboarding_acknowledgements, onboarding_completed_at")
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

  useEffect(() => {
    if (!mobileNavOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileNavOpen]);

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

  if (!membership.onboarding_completed_at) {
    return <MemberOnboardingGate membership={membership} onChanged={() => loadAccess(session)} />;
  }

  if (pathname === "/login") {
    return <main className="secure-login-page secure-loading"><LoaderCircle className="spin" size={26} /><h1>جارٍ فتح مساحة عملك</h1></main>;
  }

  const requestedSection = sectionForPathname(pathname);
  const allowedSections = membershipSections(membership);
  const sectionAllowed = canAccessWorkspaceSection(membership, requestedSection);
  const contentSectionOpen = requestedSection === "planning" || requestedSection === "content";

  return (
    <div className="app-shell">
      {sectionAllowed ? <PresenceReporter /> : null}
      <button className={`mobile-nav-backdrop ${mobileNavOpen ? "visible" : ""}`} type="button" aria-label="إغلاق قائمة الأقسام" tabIndex={mobileNavOpen ? 0 : -1} onClick={() => setMobileNavOpen(false)} />
      <aside className={`sidebar ${mobileNavOpen ? "mobile-open" : ""}`} aria-label="قائمة أقسام المنصة">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">MW</span>
          <span><strong>Market Whales</strong><small>Operating System</small></span>
          <button className="mobile-nav-close" type="button" aria-label="إغلاق القائمة" onClick={() => setMobileNavOpen(false)}><X size={20} /></button>
        </div>
        <SidebarNav allowedSections={allowedSections} onNavigate={() => setMobileNavOpen(false)} />
        <div className="sidebar-note">
          <span className="signal-dot" aria-hidden="true" />
          <div><strong>عضوية بالدعوة فقط</strong><small>لا إرسال أو تفعيل تلقائي لأي عضو</small></div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="topbar-start"><button className="mobile-nav-trigger" type="button" aria-label="فتح قائمة الأقسام" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(true)}><Menu size={21} /><span>الأقسام</span></button><div className="topbar-status"><ShieldCheck size={17} /><span>وصول خاص محكوم بالصلاحيات</span></div></div>
          <div className="topbar-actions">
            <NotificationCenter />
            <SessionChip />
          </div>
        </header>
        <div className="page-container">{sectionAllowed
          ? contentSectionOpen
            ? <div className="page-stack"><ContentSectionNav allowedSections={allowedSections} />{children}</div>
            : children
          : <section className="workspace-state workspace-onboarding"><LockKeyhole size={27} /><div><p className="overline">خارج صلاحيات حسابك</p><h2>هذا القسم غير متاح لك</h2><p>مالك المنصة يحدد الأقسام لكل عضو. لو تحتاج هذا القسم اطلب تعديل صلاحيتك.</p></div><Button href={firstAllowedSectionHref(membership)} variant="secondary">العودة لمساحة عملي</Button></section>}</div>
      </div>
      <WorkspaceAssistant />
    </div>
  );
}
