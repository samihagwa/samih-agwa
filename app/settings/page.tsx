import type { Metadata } from "next";
import { AiProvidersWorkspace } from "../../components/settings/AiProvidersWorkspace";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatusBadge } from "../../components/ui/StatusBadge";

export const metadata: Metadata = { title: "الإعدادات والتكاملات" };

export default function SettingsPage() {
  return <main className="page-stack">
    <PageHeader
      eyebrow="الإعدادات والتكاملات"
      title="مركز تحكم واحد للسيستم كله"
      description="أضف مزوّدي الذكاء الاصطناعي من مكان واحد، وغيّر الموديل الافتراضي بدون تعديل مصنع المحتوى أو كشف المفاتيح للفريق."
      actions={<StatusBadge tone="success">Vault + صلاحية المالك</StatusBadge>}
    />
    <AiProvidersWorkspace />
  </main>;
}
