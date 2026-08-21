import type { Metadata } from "next";
import { JoinWorkspace } from "../../components/team/JoinWorkspace";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatusBadge } from "../../components/ui/StatusBadge";

export const metadata: Metadata = { title: "الانضمام للفريق" };

export default function JoinPage() {
  return <main className="page-stack">
    <PageHeader
      eyebrow="دخول الفريق"
      title="تفعيل حسابك داخل مساحة العمل"
      description="الدخول يتم بدعوة من المالك، وبريد موثّق، ورابط يستخدم مرة واحدة وينتهي تلقائيًا."
      actions={<StatusBadge tone="success">وصول محدود بالصلاحية</StatusBadge>}
    />
    <JoinWorkspace />
  </main>;
}
