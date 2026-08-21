import type { Metadata } from "next";
import { LeadershipDashboard } from "../components/dashboard/LeadershipDashboard";
import { Button } from "../components/ui/Button";
import { PageHeader } from "../components/ui/PageHeader";
import { StatusBadge } from "../components/ui/StatusBadge";

export const metadata: Metadata = { title: "مركز القيادة" };

export default function Home() {
  return <main className="page-stack">
    <PageHeader
      eyebrow="مركز القيادة"
      title="اعرف أين الشغل واقف وما القرار التالي"
      description="المهام والمحتوى والخطة والإطلاقات والعملاء تُقرأ من مصادرها الفعلية. لا أرقام شكلية، ولا حاجة لفتح كل قسم لمعرفة الخطر الحالي."
      actions={<><StatusBadge tone="success">بيانات تشغيل فعلية</StatusBadge><Button href="/planning">فتح خطة المحتوى</Button></>}
    />
    <LeadershipDashboard />
  </main>;
}
