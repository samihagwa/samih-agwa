import type { Metadata } from "next";
import { ScriptEditor } from "../../../components/scripts/ScriptEditor";
import { PageHeader } from "../../../components/ui/PageHeader";
import { StatusBadge } from "../../../components/ui/StatusBadge";

export const metadata: Metadata = { title: "محرر الاسكريبت" };

export default async function ScriptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <main className="page-stack">
    <PageHeader
      eyebrow="محرر الاسكريبت"
      title="النسخة التي سيتكلم بها صانع المحتوى"
      description="الهوك، نص الكلام، الكابشن، وتعليمات التسجيل والمونتاج والغلاف في مكان واحد بنسخ محفوظة وقابلة للمراجعة."
      actions={<StatusBadge tone="info">حفظ بنسخ متتابعة</StatusBadge>}
    />
    <ScriptEditor scriptId={id} />
  </main>;
}
