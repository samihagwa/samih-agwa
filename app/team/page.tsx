import type { Metadata } from "next";
import { TeamWorkspace } from "../../components/team/TeamWorkspace";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatusBadge } from "../../components/ui/StatusBadge";

export const metadata: Metadata = { title: "الفريق والأداء" };

export default function TeamPage() {
  return <main className="page-stack"><PageHeader eyebrow="الفريق والصلاحيات" title="أداء واضح من غير مراقبة عشوائية" description="الحضور التشغيلي، المهام المطلوبة والمنفذة، الالتزام بالمواعيد وجولات التعديل في تقرير واحد قابل للتحديد بالأسبوع أو الشهر أو أي مدة." actions={<StatusBadge tone="success">مبني على سجل حقيقي</StatusBadge>} /><TeamWorkspace /></main>;
}
