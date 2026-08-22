import type { Metadata } from "next";
import { AiProvidersWorkspace } from "../../components/settings/AiProvidersWorkspace";
import { ExnessIntegrationWorkspace } from "../../components/settings/ExnessIntegrationWorkspace";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatusBadge } from "../../components/ui/StatusBadge";

export const metadata: Metadata = { title: "الإعدادات والتكاملات" };

export default function SettingsPage() {
  return <main className="page-stack">
    <PageHeader
      eyebrow="الإعدادات والتكاملات"
      title="مركز تحكم واحد للسيستم كله"
      description="أضف مزوّدي الذكاء الاصطناعي، وراجع حالة تكامل Exness والصلاحيات من مكان واحد بدون كشف المفاتيح أو البيانات المالية للفريق."
      actions={<StatusBadge tone="success">Vault + صلاحية المالك</StatusBadge>}
    />
    <AiProvidersWorkspace />
    <ExnessIntegrationWorkspace />
  </main>;
}
