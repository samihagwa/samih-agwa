import type { Metadata } from "next";
import { ContentWorkspace } from "../../components/content/ContentWorkspace";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatusBadge } from "../../components/ui/StatusBadge";

export const metadata: Metadata = { title: "طلبات التنفيذ" };

export default function ContentPage() {
  return (
    <main className="page-stack">
      <PageHeader
        eyebrow="إدارة المحتوى · طلبات التنفيذ"
        title="كل قطعة محتوى في طلب واحد"
        description="نفس النص والروابط يظلان المرجع المشترك، بينما يرى كل مسؤول مهمته فقط ويغلقها بتسليم واحد."
        actions={<StatusBadge tone="success">مرتبط ببورد المهام</StatusBadge>}
      />
      <ContentWorkspace />
    </main>
  );
}
