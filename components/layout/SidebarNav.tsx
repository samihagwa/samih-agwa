"use client";

import { usePathname } from "next/navigation";
import { BarChart3, BookOpenCheck, CalendarRange, Clapperboard, FilePenLine, LayoutDashboard, MessageCircleMore, Rocket, Send, Settings, SquareKanban, UsersRound } from "lucide-react";
import type { WorkspaceSection } from "../../lib/access";

const items = [
  { id: "dashboard", href: "/", label: "مركز القيادة", icon: LayoutDashboard },
  { id: "tasks", href: "/tasks", label: "مهام الفريق", icon: SquareKanban },
  { id: "planning", href: "/planning", label: "الخطة وتقويم المحتوى", icon: CalendarRange },
  { id: "content", href: "/content", label: "مصنع المحتوى", icon: Clapperboard },
  { id: "scripts", href: "/scripts", label: "استوديو الاسكريبتات", icon: FilePenLine },
  { id: "publishing", href: "/publishing", label: "النشر التلقائي", icon: Send },
  { id: "brand", href: "/brand", label: "مركز معرفة البراند", icon: BookOpenCheck },
  { id: "campaigns", href: "/campaigns", label: "الحملات والإطلاقات", icon: Rocket },
  { id: "crm", href: "/crm", label: "العملاء والـCRM", icon: UsersRound },
  { id: "analytics", href: "/analytics", label: "النتائج والتحليلات", icon: BarChart3 },
  { id: "chat", href: "/chat", label: "مجتمع الفريق", icon: MessageCircleMore },
] satisfies Array<{ id: WorkspaceSection; href: string; label: string; icon: typeof LayoutDashboard }>;

export function SidebarNav({ allowedSections, onNavigate }: { allowedSections: WorkspaceSection[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const allowed = new Set(allowedSections);
  return (
    <nav className="sidebar-nav" aria-label="التنقل الرئيسي">
      <p className="nav-label">مساحة العمل</p>
      {items.filter(({ id }) => allowed.has(id)).map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === href : pathname.startsWith(href);
        return <a key={href} href={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined} onClick={onNavigate}><Icon size={19} /><span>{label}</span></a>;
      })}
      {allowed.has("team") || allowed.has("settings") ? <p className="nav-label nav-label-spaced">النظام</p> : null}
      {allowed.has("team") ? <a href="/team" className={pathname.startsWith("/team") ? "active" : ""} onClick={onNavigate}><UsersRound size={19} /><span>الفريق والصلاحيات</span></a> : null}
      {allowed.has("settings") ? <a href="/settings" className={pathname.startsWith("/settings") ? "active" : ""} onClick={onNavigate}><Settings size={19} /><span>الإعدادات والتكاملات</span></a> : null}
    </nav>
  );
}
