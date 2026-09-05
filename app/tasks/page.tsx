import type { Metadata } from "next";
import { TasksWorkspace } from "../../components/tasks/TasksWorkspace";

export const metadata: Metadata = { title: "مهامي" };

export default function TasksPage() {
  return (
    <main className="page-stack">
      <TasksWorkspace />
    </main>
  );
}
