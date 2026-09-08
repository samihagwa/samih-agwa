"use client";

import { usePathname } from "next/navigation";
import { Building2, LayoutList, Settings2 } from "lucide-react";

const items = [
  { href: "/crm", label: "العملاء", icon: LayoutList },
  { href: "/crm/exness", label: "فحص الوكالة", icon: Building2 },
  { href: "/crm/operations", label: "إعداد المتابعة", icon: Settings2 },
];

export function CrmSectionNav() {
  const pathname = usePathname();
  return (
    <nav className="crm-section-nav" aria-label="أقسام العملاء والـCRM">
      {items.map(({ href, label, icon: Icon }) => {
        const active = href === "/crm" ? pathname === href || pathname.startsWith("/crm/customers") : pathname.startsWith(href);
        return <a href={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined} key={href}><Icon aria-hidden="true" size={15} /> {label}</a>;
      })}
    </nav>
  );
}
