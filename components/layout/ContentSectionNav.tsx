"use client";

import { CalendarRange, Clapperboard } from "lucide-react";
import { usePathname } from "next/navigation";
import type { WorkspaceSection } from "../../lib/access";

const views = [
  { id: "planning", href: "/planning", label: "الخطة والتقويم", icon: CalendarRange },
  { id: "content", href: "/content", label: "طلبات التنفيذ", icon: Clapperboard },
] satisfies Array<{ id: Extract<WorkspaceSection, "planning" | "content">; href: string; label: string; icon: typeof CalendarRange }>;

export function ContentSectionNav({ allowedSections }: { allowedSections: WorkspaceSection[] }) {
  const pathname = usePathname();
  const allowed = new Set(allowedSections);
  const visibleViews = views.filter(({ id }) => allowed.has(id));

  if (!visibleViews.length) return null;

  return (
    <nav className="workspace-view-switch content-section-nav" aria-label="أقسام إدارة المحتوى">
      <div>
        <strong>إدارة المحتوى</strong>
        <small>الخطة تحدد ماذا ومتى، وطلبات التنفيذ تعرض كل قطعة مرة واحدة. قسم المهام يعرض لكل شخص الجزء المسند إليه فقط.</small>
      </div>
      <div className="page-actions">
        {visibleViews.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <a key={href} href={href} className={`button ${active ? "button-primary" : "button-secondary"}`} aria-current={active ? "page" : undefined}>
              <Icon size={15} /> {label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
