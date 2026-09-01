"use client";

import { CalendarRange, Clapperboard, Rocket } from "lucide-react";
import { usePathname } from "next/navigation";
import type { WorkspaceSection } from "../../lib/access";

const views = [
  { id: "planning", href: "/planning", label: "الخطة — للمدير", icon: CalendarRange },
  { id: "content", href: "/content", label: "طلبات المحتوى", icon: Clapperboard },
  { id: "campaigns", href: "/campaigns", label: "الإطلاقات — للمدير", icon: Rocket },
] satisfies Array<{ id: Extract<WorkspaceSection, "planning" | "content" | "campaigns">; href: string; label: string; icon: typeof CalendarRange }>;

export function ContentSectionNav({ allowedSections }: { allowedSections: WorkspaceSection[] }) {
  const pathname = usePathname();
  const allowed = new Set(allowedSections);
  const visibleViews = views.filter(({ id }) => allowed.has(id));

  if (!visibleViews.length) return null;

  return (
    <nav className="workspace-view-switch content-section-nav" aria-label="أقسام المحتوى">
      <div>
        <strong>مسار المحتوى</strong>
        <small>العمل اليومي والتعديل والتسليم داخل «مهامي». هنا تنشئ طلب المحتوى مرة واحدة؛ الخطة والإطلاقات أدوات إدارة وليست مهامًا إضافية على الفريق.</small>
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
