"use client";

import { usePathname } from "next/navigation";
import {
  BarChart3, BookOpenCheck, CalendarRange, Clapperboard, FilePenLine,
  LayoutDashboard, MessageCircleMore, Rocket, Send, Settings, SquareKanban, UsersRound,
} from "lucide-react";
import type { WorkspaceSection } from "../../lib/access";

type NavItem = { id: WorkspaceSection; href: string; label: string; icon: typeof LayoutDashboard };

const groups: Array<{ label: string; items: NavItem[] }> = [
  { label: "التشغيل", items: [
    { id: "dashboard", href: "/", label: "لوحة القيادة", icon: LayoutDashboard },
    { id: "tasks", href: "/tasks", label: "المهام", icon: SquareKanban },
  ] },
  { label: "إدارة المحتوى", items: [
    { id: "content", href: "/content", label: "طلبات المحتوى", icon: Clapperboard },
    { id: "scripts", href: "/scripts", label: "السكريبتات", icon: FilePenLine },
    { id: "planning", href: "/planning", label: "الخطة والتقويم", icon: CalendarRange },
    { id: "campaigns", href: "/campaigns", label: "الحملات والإطلاقات", icon: Rocket },
    { id: "publishing", href: "/publishing", label: "النشر التلقائي", icon: Send },
  ] },
  { label: "العملاء والقياس", items: [
    { id: "crm", href: "/crm", label: "العملاء وCRM", icon: UsersRound },
    { id: "analytics", href: "/analytics", label: "النتائج والتحليلات", icon: BarChart3 },
  ] },
  { label: "الفريق والمعرفة", items: [
    { id: "chat", href: "/chat", label: "دردشة الفريق", icon: MessageCircleMore },
    { id: "brand", href: "/brand", label: "معرفة البراند", icon: BookOpenCheck },
  ] },
  { label: "الإدارة", items: [
    { id: "team", href: "/team", label: "الفريق والصلاحيات", icon: UsersRound },
    { id: "settings", href: "/settings", label: "الإعدادات والتكاملات", icon: Settings },
  ] },
];

export function SidebarNav({ allowedSections, onNavigate }: { allowedSections: WorkspaceSection[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const allowed = new Set(allowedSections);
  return (
    <nav className="sidebar-nav" aria-label="التنقل الرئيسي">
      {groups.map((group) => {
        const visibleItems = group.items.filter(({ id }) => allowed.has(id));
        if (!visibleItems.length) return null;
        return <section className="sidebar-nav-group" key={group.label}>
          <p className="nav-label">{group.label}</p>
          {visibleItems.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === href : pathname.startsWith(href);
            return <a key={href} href={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined} onClick={onNavigate}><Icon size={18} /><span>{label}</span></a>;
          })}
        </section>;
      })}
    </nav>
  );
}
