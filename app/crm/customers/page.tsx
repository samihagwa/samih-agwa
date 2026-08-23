import type { Metadata } from "next";
import { CrmCustomerDirectory } from "../../../components/crm/CrmCustomerDirectory";
import { CrmSectionNav } from "../../../components/crm/CrmSectionNav";
import { PageHeader } from "../../../components/ui/PageHeader";
import { StatusBadge } from "../../../components/ui/StatusBadge";

export const metadata: Metadata = { title: "دليل العملاء" };

export default function CrmCustomersPage() {
  return (
    <main className="page-stack">
      <PageHeader
        eyebrow="العملاء والـCRM"
        title="دليل موحّد لكل العملاء"
        description="اعرض العملاء من كل المصادر في جدول واحد، ثم افتح ملف العميل أو مهمته المحددة مباشرة."
        actions={<StatusBadge tone="success">مرتبط بملفات العملاء</StatusBadge>}
      />
      <CrmSectionNav />
      <CrmCustomerDirectory />
    </main>
  );
}
