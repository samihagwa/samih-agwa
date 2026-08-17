import type { Metadata } from "next";
import { ContentWorkspace } from "../../components/content/ContentWorkspace";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatusBadge } from "../../components/ui/StatusBadge";

export const metadata: Metadata = { title: "مصنع المحتوى" };

export default function ContentPage() {
  return (
    <main className="page-stack">
      <PageHeader
        eyebrow="مصنع المحتوى"
        title="من الفكرة إلى النشر في مسار واحد"
        description="أصل محتوى واحد يولّد brief وتسجيلًا ومونتاجًا وغلافًا وكابشن ومراجعة ونشرًا، وكل خطوة لها مسؤول وموعد واعتماديات تلقائية."
        actions={<StatusBadge tone="success">مرتبط ببورد المهام</StatusBadge>}
      />
      <ContentWorkspace />
    </main>
  );
}
