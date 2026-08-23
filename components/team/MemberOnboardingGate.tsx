"use client";

import { BookOpenCheck, CheckCircle2, ClipboardCheck, LoaderCircle, LogOut, ShieldCheck, UserCog } from "lucide-react";
import { useMemo, useState } from "react";
import type { Json, Tables } from "../../lib/supabase/database.types";
import { getSupabaseBrowserClient } from "../../lib/supabase/client";
import { getSupabaseFunctionErrorMessage } from "../../lib/supabase/function-errors";
import { Button } from "../ui/Button";
import { StatusBadge } from "../ui/StatusBadge";

type Membership = Pick<Tables<"memberships">, "organization_id" | "role" | "onboarding_acknowledgements">;
type Step = "role" | "workflow" | "brand";

const roleLabels: Record<Tables<"memberships">["role"], string> = {
  owner: "مالك المنصة",
  admin: "مدير منصة",
  manager: "مدير فريق",
  member: "عضو فريق",
  viewer: "مشاهد",
};

function completedSteps(value: Json) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { role: false, workflow: false, brand: false };
  return {
    role: value.role === true,
    workflow: value.workflow === true,
    brand: value.brand === true,
  };
}

export function MemberOnboardingGate({ membership, onChanged }: { membership: Membership; onChanged: () => Promise<void> }) {
  const [workingStep, setWorkingStep] = useState<Step | null>(null);
  const [error, setError] = useState<string | null>(null);
  const state = useMemo(() => completedSteps(membership.onboarding_acknowledgements), [membership.onboarding_acknowledgements]);
  const completeCount = Object.values(state).filter(Boolean).length;

  async function acknowledge(step: Step) {
    setWorkingStep(step); setError(null);
    const result = await getSupabaseBrowserClient().functions.invoke("team-commands", {
      body: { action: "acknowledge_onboarding", organization_id: membership.organization_id, step },
    });
    if (result.error) setError(await getSupabaseFunctionErrorMessage(result.error, "تعذّر حفظ خطوة البداية."));
    else await onChanged();
    setWorkingStep(null);
  }

  return <main className="secure-login-page team-onboarding-gate">
    <section className="secure-login-brand" aria-label="Market Whales OS"><span className="secure-login-mark" aria-hidden="true">MW</span><div><strong>Market Whales</strong><small>Operating System</small></div></section>
    <section className="panel team-onboarding-panel">
      <div className="section-heading"><div><p className="overline">أول دخول على السيستم</p><h1>3 اتفاقات قبل استلام الشغل</h1><p>نثبت طريقة التشغيل مرة واحدة على حسابك، وبعدها تفتح الأقسام التي حددها المالك فقط.</p></div><StatusBadge tone="warning">{completeCount}/3</StatusBadge></div>
      {error ? <p className="form-notice error" role="alert">{error}</p> : null}
      <div className="onboarding-step-grid">
        <article className={state.role ? "complete" : ""}><UserCog size={20} /><div><strong>دوري وصلاحيتي واضحان</strong><p>دورك الحالي: {roleLabels[membership.role]}. سترى فقط الأقسام التي حددها مالك المنصة.</p></div><Button type="button" variant="secondary" disabled={Boolean(workingStep) || state.role} onClick={() => void acknowledge("role")}>{workingStep === "role" ? <LoaderCircle className="spin" size={15} /> : state.role ? <CheckCircle2 size={15} /> : null}{state.role ? "تم" : "فهمت دوري"}</Button></article>
        <article className={state.workflow ? "complete" : ""}><ClipboardCheck size={20} /><div><strong>المهمة تُنفذ وتُسلّم من مكانها</strong><p>أفتح مهمتي المحددة، أرفق النتيجة أو الرابط، وأتعامل مع التعديلات داخل نفس ملف العمل.</p></div><Button type="button" variant="secondary" disabled={Boolean(workingStep) || state.workflow} onClick={() => void acknowledge("workflow")}>{workingStep === "workflow" ? <LoaderCircle className="spin" size={15} /> : state.workflow ? <CheckCircle2 size={15} /> : null}{state.workflow ? "تم" : "فهمت التسليم"}</Button></article>
        <article className={state.brand ? "complete" : ""}><BookOpenCheck size={20} /><div><strong>مرجع البراند قبل التنفيذ</strong><p>أراجع التعليمات المتاحة لحسابي قبل التصميم أو المونتاج؛ تليجرام للخام والتنبيه، والموقع لحالة الشغل.</p></div><Button type="button" variant="secondary" disabled={Boolean(workingStep) || state.brand} onClick={() => void acknowledge("brand")}>{workingStep === "brand" ? <LoaderCircle className="spin" size={15} /> : state.brand ? <CheckCircle2 size={15} /> : null}{state.brand ? "تم" : "فهمت المرجع"}</Button></article>
      </div>
      <aside className="secure-login-note"><ShieldCheck size={17} /><span>إكمال الخطوات لا يغيّر دورك أو صلاحياتك، ولا يفتح أي قسم غير معتمد لك.</span></aside>
      <Button type="button" variant="ghost" onClick={() => void getSupabaseBrowserClient().auth.signOut()}><LogOut size={15} /> تسجيل الخروج</Button>
    </section>
  </main>;
}
