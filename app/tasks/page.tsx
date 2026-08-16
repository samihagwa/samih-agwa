import type { Metadata } from "next";
import { TasksWorkspace } from "../../components/tasks/TasksWorkspace";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatusBadge } from "../../components/ui/StatusBadge";

export const metadata: Metadata = { title: "مهام الفريق" };

export default function TasksPage() {
  return (
    <main className="page-stack">
      <PageHeader
        eyebrow="مهام الفريق"
        title="كل شخص يعرف دوره والخطوة التالية"
        description="بورد حقيقي بمسؤول واحد وموعد ومعيار قبول وانتقالات مسموحة وسجل تدقيق لكل تغيير. لا توجد مهام تجريبية مخفية."
        actions={<StatusBadge tone="success">متصل بقاعدة آمنة</StatusBadge>}
      />
      <TasksWorkspace />
    </main>
  );
}
