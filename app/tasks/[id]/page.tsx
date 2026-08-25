import type { Metadata } from "next";
import { TaskDetailWorkspace } from "../../../components/tasks/TaskDetailWorkspace";
import { PageHeader } from "../../../components/ui/PageHeader";
import { StatusBadge } from "../../../components/ui/StatusBadge";

export const metadata: Metadata = { title: "ملف المهمة" };

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="page-stack">
      <PageHeader
        eyebrow="ملف المهمة"
        title="المهمة واضحة من الطلب حتى التنفيذ"
        description="التفاصيل، المسؤول، الموعد، طلبات التعديل، وسجل الحالة في صفحة واحدة بصلاحيات منفصلة لطالب المهمة والمنفّذ."
        actions={<StatusBadge tone="info">رابط مباشر للمهمة</StatusBadge>}
      />
      <TaskDetailWorkspace taskId={id} />
    </main>
  );
}
