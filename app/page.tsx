import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CircleCheck, Clock3, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "../components/ui/Button";
import { PageHeader } from "../components/ui/PageHeader";
import { StatCard } from "../components/ui/StatCard";
import { StatusBadge } from "../components/ui/StatusBadge";

export const metadata: Metadata = { title: "مركز القيادة" };

const foundations = [
  { label: "هوية وصلاحيات الفريق", state: "جاهزة تقنيًا — لم يبدأ الفريق", icon: ShieldCheck },
  { label: "إدارة المهام والتسليم", state: "قواعد آمنة وبورد حقيقي", icon: CircleCheck },
  { label: "قياس النتائج والحملات", state: "بانتظار مصادر البيانات", icon: Clock3 },
];

export default function Home() {
  return (
    <main className="page-stack">
      <PageHeader
        eyebrow="مركز القيادة"
        title="خلّي الشغل يمشي كنظام، مش كسلسلة رسائل"
        description="نواة موحّدة لإدارة المحتوى والتاسكات والحملات والعملاء. الهوية وقاعدة المهام جاهزتان تقنيًا، لكن الفريق لم يبدأ onboarding ولا نعرض أي بيانات على أنها حقيقية قبل إدخالها رسميًا."
        actions={
          <>
            <StatusBadge tone="success">قاعدة المهام جاهزة</StatusBadge>
            <Button href="/tasks">فتح بورد المهام</Button>
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
            <span className="progress-value">2/3</span>
          </div>
          <div className="progress-track progress-two" aria-label="اكتمل محوران من ثلاثة"><span /></div>
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
            <Link className="text-link" href="/content">فتح خط المحتوى <ArrowLeft size={16} /></Link>
          </div>
          <ol className="workflow-line">
            {[
              ["01", "Brief معتمد", "الهدف، الفكرة، CTA والموعد"],
              ["02", "تسجيل", "استلام الخام وربطه بالمحتوى"],
              ["03", "مونتاج", "نسخة أولى ثم مراجعة واضحة"],
              ["04", "تصميم", "غلاف وقالب مطابق للبراند"],
              ["05", "نشر", "كابشن، جدولة، فحص الروابط"],
              ["06", "قياس", "نتائج بعد 24 ساعة و7 أيام"],
            ].map(([number, title, description]) => (
              <li key={number}><span>{number}</span><strong>{title}</strong><small>{description}</small></li>
            ))}
          </ol>
        </article>

        <aside className="panel next-step-card">
          <p className="overline">القرار التالي</p>
          <h2>تفعيل حساب المالك ثم إدخال الفريق</h2>
          <p>أول دخول موثّق ينشئ مساحة Market Whales مرة واحدة، وبعدها يدخل باقي الفريق بالدعوات والصلاحيات المحددة فقط.</p>
          <StatusBadge tone="warning">لم يبدأ onboarding</StatusBadge>
        </aside>
      </section>
    </main>
  );
}
