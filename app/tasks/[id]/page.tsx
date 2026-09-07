import type { Metadata } from "next";
import { TaskDetailWorkspace } from "../../../components/tasks/TaskDetailWorkspace";

export const metadata: Metadata = { title: "ملف المهمة" };

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <main className="page-stack"><TaskDetailWorkspace taskId={id} /></main>;
}
