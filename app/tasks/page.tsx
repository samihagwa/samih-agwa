import type { Metadata } from "next";
import { TasksWorkspace } from "../../components/tasks/TasksWorkspace";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatusBadge } from "../../components/ui/StatusBadge";

export const metadata: Metadata = { title: "مهامي" };

export default function TasksPage() {
  return (
    <main className="page-stack">
      <PageHeader
        eyebrow="مهامي"
        title="كل شخص يعرف دوره والخطوة التالية"
        description="كل عضو يرى المطلوب منه وموعده وزر الإجراء التالي. المدير يفتح متابعة الفريق عند الحاجة، ومعيار القبول والمراجعة اختياريان."
        actions={<StatusBadge tone="success">متصل بقاعدة آمنة</StatusBadge>}
      />
      <TasksWorkspace />
    </main>
  );
}
