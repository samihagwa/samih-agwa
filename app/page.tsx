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
      title="لوحة القيادة"
      description="ملخص التشغيل، المواعيد والمخاطر التي تحتاج قرارًا الآن."
      actions={<><StatusBadge tone="success">البيانات محدثة</StatusBadge><Button href="/planning">الخطة والتقويم</Button></>}
    />
    <LeadershipDashboard />
  </main>;
}
