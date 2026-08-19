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
        description="أصل محتوى واحد يسلك المسار المناسب لنوعه؛ الريلز يمر بالتسجيل والمونتاج والغلاف، والبوست يوزع الكابشن والتصميم بالتوازي ثم المراجعة والجدولة والنشر."
        actions={<StatusBadge tone="success">مرتبط ببورد المهام</StatusBadge>}
      />
      <ContentWorkspace />
    </main>
  );
}
