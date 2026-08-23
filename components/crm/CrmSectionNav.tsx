"use client";

import { usePathname } from "next/navigation";
import { LayoutList, SquareKanban } from "lucide-react";

const items = [
  { href: "/crm", label: "لوحة المتابعة", icon: SquareKanban },
  { href: "/crm/customers", label: "دليل العملاء", icon: LayoutList },
];

export function CrmSectionNav() {
  const pathname = usePathname();
  return (
    <nav className="crm-section-nav" aria-label="أقسام العملاء والـCRM">
      {items.map(({ href, label, icon: Icon }) => {
        const active = href === "/crm" ? pathname === href : pathname.startsWith(href);
        return <a href={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined} key={href}><Icon aria-hidden="true" size={15} /> {label}</a>;
      })}
    </nav>
  );
}
