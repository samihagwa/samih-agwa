import type { Metadata } from "next";
import { ScriptsWorkspace } from "../../components/scripts/ScriptsWorkspace";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatusBadge } from "../../components/ui/StatusBadge";

export const metadata: Metadata = { title: "استوديو الاسكريبتات" };

export default function ScriptsPage() {
  return <main className="page-stack">
    <PageHeader
      eyebrow="استوديو الاسكريبتات"
      title="فكرتك تبقى اسكريبت جاهز للتنفيذ"
      description="كل عضو يرى اسكريبتاته وبصمته فقط، بما في ذلك أمام مالك المنصة. اكتب يدويًا أو استعِن بالـAI، ثم حوّل النسخة النهائية بنفسك إلى طلب تنفيذ واحد."
      actions={<StatusBadge tone="success">خصوصية على مستوى قاعدة البيانات</StatusBadge>}
    />
    <ScriptsWorkspace />
  </main>;
}
