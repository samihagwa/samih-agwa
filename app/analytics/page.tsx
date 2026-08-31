import type { Metadata } from "next";
import { AnalyticsWorkspace } from "../../components/analytics/AnalyticsWorkspace";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatusBadge } from "../../components/ui/StatusBadge";

export const metadata: Metadata = { title: "النتائج والتحليلات" };

export default function AnalyticsPage() {
  return <main className="page-stack">
    <PageHeader
      eyebrow="النتائج والتحليلات"
      title="اعرف ما تم، وما تأخر، وما يحتاج تدخلًا"
      description="قياس تشغيلي حقيقي من المهام والمحتوى وCRM والنشر التلقائي. أرقام المنصات الخارجية لا تظهر قبل ربط مصدرها رسميًا."
      actions={<StatusBadge tone="success">بيانات فعلية فقط</StatusBadge>}
    />
    <AnalyticsWorkspace />
  </main>;
}
