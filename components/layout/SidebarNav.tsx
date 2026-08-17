"use client";

import { usePathname } from "next/navigation";
import { BarChart3, Clapperboard, LayoutDashboard, Rocket, Settings, SquareKanban, UsersRound } from "lucide-react";

const items = [
  { href: "/", label: "مركز القيادة", icon: LayoutDashboard },
  { href: "/tasks", label: "مهام الفريق", icon: SquareKanban },
  { href: "/content", label: "مصنع المحتوى", icon: Clapperboard },
  { href: "/campaigns", label: "الحملات والإطلاقات", icon: Rocket },
  { href: "/crm", label: "العملاء والـCRM", icon: UsersRound },
  { href: "/analytics", label: "النتائج والتحليلات", icon: BarChart3 },
];

export function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav className="sidebar-nav" aria-label="التنقل الرئيسي">
      <p className="nav-label">مساحة العمل</p>
      {items.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === href : pathname.startsWith(href);
        return <a key={href} href={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}><Icon size={19} /><span>{label}</span></a>;
      })}
      <p className="nav-label nav-label-spaced">النظام</p>
      <a href="/team" className={pathname.startsWith("/team") ? "active" : ""}><UsersRound size={19} /><span>الفريق والصلاحيات</span></a>
      <a href="/settings" className={pathname.startsWith("/settings") ? "active" : ""}><Settings size={19} /><span>الإعدادات والتكاملات</span></a>
    </nav>
  );
}
