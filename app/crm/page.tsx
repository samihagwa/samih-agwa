import type { Metadata } from "next";
import { CrmWorkspace } from "../../components/crm/CrmWorkspace";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatusBadge } from "../../components/ui/StatusBadge";

export const metadata: Metadata = { title: "العملاء والـCRM" };

export default function CrmPage() {
  return (
    <main className="page-stack">
      <PageHeader
        eyebrow="العملاء والـCRM"
        title="كل عميل له مالك وموعد وخطوة تالية"
        description="ملف موحّد للمصدر والاهتمام ووسيلة التواصل، مع سجل متابعة ومهمة تلقائية من غير استيراد أو رسائل قبل الاعتماد."
        actions={<StatusBadge tone="success">مرتبط ببورد المهام</StatusBadge>}
      />
      <CrmWorkspace />
    </main>
  );
}
