"use client";

import { KeyRound, LoaderCircle, LockKeyhole, MailCheck, ShieldCheck } from "lucide-react";
import { type FormEvent, useState } from "react";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import { getSupabaseFunctionErrorMessage } from "../../lib/supabase/function-errors";
import { Button } from "../ui/Button";

export function LoginWorkspace() {
  const configured = isSupabaseConfigured();
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(configured ? null : "خدمة تسجيل الدخول غير متاحة مؤقتًا.");

  async function requestAccessLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim().toLowerCase();
    if (!email || !configured) return;

    setWorking(true);
    setNotice(null);
    setError(null);
    const { error: invokeError } = await getSupabaseBrowserClient().functions.invoke("request-access-link", {
      body: { email },
    });
    setWorking(false);

    if (invokeError) {
      setError(await getSupabaseFunctionErrorMessage(invokeError, "تعذّر طلب رابط الدخول مؤقتًا."));
      return;
    }
    setNotice("لو البريد مضافًا إلى الفريق، سيصلك رابط دخول آمن. أي بريد غير معتمد لن يستلم شيئًا.");
  }

  return <main className="secure-login-page">
    <section className="secure-login-brand" aria-label="Market Whales OS">
      <span className="secure-login-mark" aria-hidden="true">MW</span>
      <div><strong>Market Whales</strong><small>Operating System</small></div>
    </section>
    <section className="secure-login-card">
      <span className="icon-tile large"><LockKeyhole size={23} /></span>
      <p className="overline">منصة داخلية بالدعوة فقط</p>
      <h1>تسجيل دخول الفريق</h1>
      <p>اكتب البريد الذي أضافه مالك المنصة. لن يظهر أي قسم أو بيانات قبل التحقق من عضويتك وصلاحياتك.</p>
      <form className="stacked-form" onSubmit={requestAccessLink}>
        <label htmlFor="workspace-login-email">البريد المعتمد</label>
        <input id="workspace-login-email" name="email" type="email" autoComplete="email" required placeholder="name@company.com" dir="ltr" />
        <Button type="submit" disabled={working || !configured}>{working ? <LoaderCircle className="spin" size={16} /> : <MailCheck size={16} />} إرسال رابط الدخول</Button>
      </form>
      {notice ? <p className="form-notice success" role="status">{notice}</p> : null}
      {error ? <p className="form-notice error" role="alert">{error}</p> : null}
      <div className="secure-login-note"><ShieldCheck size={17} /><span>الرابط وحده لا يمنح صلاحية؛ الحساب يجب أن يكون مسجلًا مسبقًا داخل فريق Market Whales.</span></div>
    </section>
    <footer><KeyRound size={14} /> وصول خاص ومراقب بسجل تدقيق</footer>
  </main>;
}

