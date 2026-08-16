import { ArrowLeft, CircleCheck, LockKeyhole } from "lucide-react";
import { Button } from "../ui/Button";
import { PageHeader } from "../ui/PageHeader";
import { StatusBadge } from "../ui/StatusBadge";

export type SectionConfig = {
  eyebrow: string;
  title: string;
  description: string;
  status: string;
  statusTone: "info" | "warning" | "success";
  nextStep: string;
  capabilities: { title: string; description: string }[];
};

export function SectionOverview({ config }: { config: SectionConfig }) {
  return (
    <main className="page-stack">
      <PageHeader eyebrow={config.eyebrow} title={config.title} description={config.description} actions={<StatusBadge tone={config.statusTone}>{config.status}</StatusBadge>} />
      <section className="section-layout">
        <article className="panel span-two">
          <div className="section-heading"><div><p className="overline">القدرات الأساسية</p><h2>ما الذي سيديره هذا القسم؟</h2></div><StatusBadge tone="info">تصميم أولي</StatusBadge></div>
          <div className="capability-grid">
            {config.capabilities.map((item, index) => <div className="capability-card" key={item.title}><span>{String(index + 1).padStart(2, "0")}</span><h3>{item.title}</h3><p>{item.description}</p></div>)}
          </div>
        </article>
        <aside className="panel decision-card">
          <span className="icon-tile large"><ArrowLeft size={22} /></span>
          <p className="overline">الخطوة التالية</p>
          <h2>{config.nextStep}</h2>
          <p>لن يتم تفعيل أي إجراء تشغيلي قبل اعتماد الصلاحيات وقواعد التسليم.</p>
          <Button variant="secondary" disabled>قريبًا بعد ربط Supabase</Button>
        </aside>
      </section>
      <section className="empty-state">
        <div className="empty-visual"><LockKeyhole size={28} /></div>
        <div><h2>لا توجد بيانات تشغيل حقيقية بعد</h2><p>هذا مقصود. سنحافظ على بيئة نظيفة حتى اعتماد النموذج وإدخال الفريق رسميًا.</p></div>
        <span className="empty-proof"><CircleCheck size={17} /> لا توجد مهام وهمية</span>
      </section>
    </main>
  );
}
