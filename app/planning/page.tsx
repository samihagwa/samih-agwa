import type { Metadata } from "next";
import { PlanningWorkspace } from "../../components/planning/PlanningWorkspace";

export const metadata: Metadata = { title: "تقويم المحتوى" };

export default function PlanningPage() {
  return <main className="page-stack">
    <PlanningWorkspace />
  </main>;
}
