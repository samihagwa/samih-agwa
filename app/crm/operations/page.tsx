import type { Metadata } from "next";
import { CrmWorkspace } from "../../../components/crm/CrmWorkspace";
import { CrmSectionNav } from "../../../components/crm/CrmSectionNav";
import { PageHeader } from "../../../components/ui/PageHeader";

export const metadata: Metadata = { title: "إعداد متابعة العملاء" };

export default function CrmOperationsPage() {
  return (
    <main className="page-stack">
      <PageHeader
        eyebrow="العملاء والـCRM"
        title="إعداد المتابعة"
        description="مسار التوزيع والاستيراد وأداء السيلز في مساحة إدارية منفصلة عن قائمة العملاء اليومية."
      />
      <CrmSectionNav />
      <CrmWorkspace />
    </main>
  );
}
