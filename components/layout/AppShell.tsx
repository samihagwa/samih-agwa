import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { SessionChip } from "../auth/SessionChip";
import { SidebarNav } from "./SidebarNav";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">MW</span>
          <span><strong>Market Whales</strong><small>Operating System</small></span>
        </div>
        <SidebarNav />
        <div className="sidebar-note">
          <span className="signal-dot" aria-hidden="true" />
          <div><strong>نسخة تشغيل آمنة</strong><small>الفريق لم يبدأ onboarding بعد</small></div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="topbar-status"><ShieldCheck size={17} /><span>وضع الاختبار الشخصي</span></div>
          <div className="topbar-actions">
            <SessionChip />
          </div>
        </header>
        <div className="page-container">{children}</div>
      </div>
    </div>
  );
}
