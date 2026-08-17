import type { Metadata } from "next";
import { ArrowLeft, CircleCheck, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "../components/ui/Button";
import { PageHeader } from "../components/ui/PageHeader";
import { StatCard } from "../components/ui/StatCard";
import { StatusBadge } from "../components/ui/StatusBadge";
import { contentStepConfig, contentSteps, type ContentStep } from "../lib/content";

export const metadata: Metadata = { title: "مركز القيادة" };

const foundations = [
  { label: "هوية وصلاحيات الفريق", state: "جاهزة تقنيًا — لم يبدأ الفريق", icon: ShieldCheck },
  { label: "إدارة المهام والتسليم", state: "قواعد آمنة وبورد حقيقي", icon: CircleCheck },
  { label: "مصنع محتوى مترابط", state: "7 خطوات واعتماديات تلقائية", icon: CircleCheck },
];

const contentStepDescriptions: Record<ContentStep, string> = {
  brief: "الهدف والفكرة والـCTA",
  recording: "الخام واضح ومرفوع",
  editing: "نسخة مطابقة للبراند",
  thumbnail: "غلاف جاهز للنشر",
  caption: "نص وCTA معتمدان",
  approval: "فحص كل الأصول معًا",
  publishing: "جدولة وتأكيد فعلي",
};

export default function Home() {
  return (
    <main className="page-stack">
      <PageHeader
        eyebrow="مركز القيادة"
        title="خلّي الشغل يمشي كنظام، مش كسلسلة رسائل"
        description="نواة موحّدة لإدارة المحتوى والتاسكات والحملات والعملاء. الهوية وقاعدة المهام وخط إنتاج الريلز جاهزة تقنيًا، لكن الفريق لم يبدأ onboarding ولا نعرض أي بيانات على أنها حقيقية قبل إدخالها رسميًا."
        actions={
          <>
            <StatusBadge tone="success">قاعدة المهام جاهزة</StatusBadge>
            <Button href="/content">فتح مصنع المحتوى</Button>
          </>
        }
      />

      <section className="hero-grid" aria-label="حالة تأسيس النظام">
        <article className="hero-card">
          <div className="hero-orbit" aria-hidden="true"><Sparkles size={24} /></div>
          <p className="overline">المرحلة الحالية</p>
          <h2>نبني المصدر الوحيد للحقيقة</h2>
          <p>قبل إدخال الفريق، نثبت الصلاحيات ومسارات التسليم ومعايير القبول. بعدها كل شخص يرى فقط ما يحتاجه ويعرف الخطوة التالية بوضوح.</p>
          <div className="hero-actions">
            <Button href="/tasks">راجع سير العمل</Button>
            <Button href="/team" variant="secondary">خطة إدخال الفريق</Button>
          </div>
        </article>

        <aside className="foundation-card">
          <div className="section-heading compact">
            <div>
              <p className="overline">جاهزية الأساس</p>
              <h2>3 محاور قبل الإطلاق</h2>
            </div>
            <span className="progress-value">3/3</span>
          </div>
          <div className="progress-track progress-complete" aria-label="اكتملت محاور الأساس الثلاثة"><span /></div>
          <ul className="foundation-list">
            {foundations.map(({ label, state, icon: Icon }) => (
              <li key={label}>
                <span className="icon-tile"><Icon size={18} /></span>
                <span><strong>{label}</strong><small>{state}</small></span>
              </li>
            ))}
          </ul>
        </aside>
      </section>

      <section className="stats-grid" aria-label="مؤشرات جاهزية النظام">
        <StatCard label="حالات مهمة محكومة" value="7" note="كل انتقال يُفحص داخل قاعدة البيانات" />
        <StatCard label="صلاحيات أساسية" value="5" note="مالك، مدير، منفّذ، مراجع، مشاهد" />
        <StatCard label="مصادر بيانات" value="0" note="لن نعرض أرقامًا وهمية" tone="warning" />
        <StatCard label="أعضاء فعّالون" value="0" note="يبدأ بعد اعتماد onboarding" />
      </section>

      <section className="content-grid">
        <article className="panel span-two">
          <div className="section-heading">
            <div><p className="overline">خط التشغيل المقترح</p><h2>الريلز يتحرك تلقائيًا بين التخصصات</h2></div>
            <a className="text-link" href="/content">فتح خط المحتوى <ArrowLeft size={16} /></a>
          </div>
          <ol className="workflow-line">
            {contentSteps.map((step) => (
              <li key={step}><span>{String(contentStepConfig[step].order).padStart(2, "0")}</span><strong>{contentStepConfig[step].label}</strong><small>{contentStepDescriptions[step]}</small></li>
            ))}
          </ol>
        </article>

        <aside className="panel next-step-card">
          <p className="overline">القرار التالي</p>
          <h2>اختبار المالك قبل إدخال الفريق</h2>
          <p>سجّل الدخول بحسابك، أنشئ مساحة Market Whales، ثم جرّب مهمة وريلز تجريبيين. لن تُرسل أي دعوة ولن يُضاف أي عضو في هذه المرحلة.</p>
          <StatusBadge tone="warning">اختبار شخصي فقط</StatusBadge>
        </aside>
      </section>
    </main>
  );
}
