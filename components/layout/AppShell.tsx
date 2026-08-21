import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { SessionChip } from "../auth/SessionChip";
import { PresenceReporter } from "../auth/PresenceReporter";
import { NotificationCenter } from "../auth/NotificationCenter";
import { SidebarNav } from "./SidebarNav";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <PresenceReporter />
      <aside className="sidebar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">MW</span>
          <span><strong>Market Whales</strong><small>Operating System</small></span>
        </div>
        <SidebarNav />
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
        <div className="page-container">{children}</div>
      </div>
    </div>
  );
}
