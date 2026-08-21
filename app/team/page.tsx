import type { Metadata } from "next";
import { TeamWorkspace } from "../../components/team/TeamWorkspace";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatusBadge } from "../../components/ui/StatusBadge";

export const metadata: Metadata = { title: "الفريق والأداء" };

export default function TeamPage() {
  return <main className="page-stack"><PageHeader eyebrow="الفريق والصلاحيات" title="دخول واضح، صلاحية محددة، وأداء مبني على السجل" description="المالك يجهّز رابط دخول يدويًا من غير إرسال تلقائي، والعضو يبدأ بتعريف قصير ثم يستلم شغله. الحضور والإنجاز والتأخير تُقاس من الأحداث الفعلية فقط." actions={<StatusBadge tone="success">دعوة آمنة + سجل تدقيق</StatusBadge>} /><TeamWorkspace /></main>;
}
