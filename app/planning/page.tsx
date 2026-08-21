import type { Metadata } from "next";
import { PlanningWorkspace } from "../../components/planning/PlanningWorkspace";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatusBadge } from "../../components/ui/StatusBadge";

export const metadata: Metadata = { title: "الخطة وتقويم المحتوى" };

export default function PlanningPage() {
  return <main className="page-stack">
    <PageHeader
      eyebrow="التخطيط الربع سنوي"
      title="نعرف لماذا وماذا ومتى قبل فتح خط الإنتاج"
      description="خطة واحدة تربط الهدف والجمهور والعرض بأعمدة المحتوى وتقويم واضح، ثم تتابع التنفيذ الحقيقي من مصنع المحتوى."
      actions={<StatusBadge tone="success">خطة ← تقويم ← تنفيذ</StatusBadge>}
    />
    <PlanningWorkspace />
  </main>;
}
