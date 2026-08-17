import type { Metadata } from "next";
import { BrandWorkspace } from "../../components/brand/BrandWorkspace";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatusBadge } from "../../components/ui/StatusBadge";

export const metadata: Metadata = { title: "مركز معرفة البراند" };

export default function BrandPage() {
  return <main className="page-stack">
    <PageHeader
      eyebrow="مركز معرفة البراند"
      title="مرجع واحد معتمد لكل قرار إبداعي"
      description="المصمم والمونتير والكاتب والناشر يرجعون لنفس النسخة المعتمدة: المطلوب، الممنوع، الأمثلة، وروابط الأصول — مع تاريخ واضح لأي تعديل."
      actions={<StatusBadge tone="success">نسخ معتمدة ومؤرشفة</StatusBadge>}
    />
    <BrandWorkspace />
  </main>;
}
