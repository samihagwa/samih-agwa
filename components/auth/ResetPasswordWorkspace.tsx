"use client";

import type { Session } from "@supabase/supabase-js";
import { CheckCircle2, KeyRound, LoaderCircle, LockKeyhole } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import { Button } from "../ui/Button";

export function ResetPasswordWorkspace() {
  const configured = isSupabaseConfigured();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!configured);
  const [working, setWorking] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(configured ? null : "خدمة الحسابات غير متاحة مؤقتًا.");
  const recoveryVerification = useRef<ReturnType<ReturnType<typeof getSupabaseBrowserClient>["auth"]["verifyOtp"]> | null>(null);

  useEffect(() => {
    if (!configured) return;
    const supabase = getSupabaseBrowserClient();
    let active = true;
    const query = new URLSearchParams(window.location.search);
    const tokenHash = query.get("token_hash")?.trim();
    const type = query.get("type")?.trim();

    const finish = (nextSession: Session | null, nextError: string | null = null) => {
      if (!active) return;
      setSession(nextSession);
      setError(nextError);
      setReady(true);
    };

    if (tokenHash) {
      if (type !== "recovery") {
        finish(null, "رابط الاستعادة غير صالح. اطلب رسالة جديدة من صفحة الدخول.");
      } else {
        recoveryVerification.current ??= supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
        void recoveryVerification.current.then(({ data, error: verificationError }) => {
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete("token_hash");
          cleanUrl.searchParams.delete("type");
          window.history.replaceState({}, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
          finish(
            verificationError ? null : data.session,
            verificationError ? "رابط الاستعادة غير صالح أو انتهت صلاحيته. اطلب رسالة جديدة من صفحة الدخول." : null,
          );
        });
      }
    } else {
      void supabase.auth.getSession().then(({ data }) => finish(data.session));
    }
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setReady(true);
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, [configured]);

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("password_confirmation") ?? "");
    if (password !== confirmation) { setError("كلمتا المرور غير متطابقتين."); return; }
    setWorking(true); setError(null);
    const supabase = getSupabaseBrowserClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setWorking(false);
      setError(updateError.message.includes("same") ? "اختر كلمة مرور جديدة مختلفة." : "تعذّر تغيير كلمة المرور. اطلب رابطًا جديدًا من صفحة الدخول.");
      return;
    }
    await supabase.functions.invoke("team-commands", { body: { action: "complete_password_recovery" } });
    await supabase.auth.signOut();
    setWorking(false);
    setComplete(true);
    window.setTimeout(() => window.location.replace("/login?password=updated"), 900);
  }

  if (!ready) return <main className="secure-login-page secure-loading"><LoaderCircle className="spin" size={28} /><h1>جارٍ التحقق من رابط الاستعادة</h1></main>;

  return <main className="secure-login-page">
    <section className="secure-login-brand" aria-label="Market Whales OS"><span className="secure-login-mark" aria-hidden="true">MW</span><div><strong>Market Whales</strong><small>Operating System</small></div></section>
    <section className="secure-login-card auth-choice-card">
      <span className="icon-tile large">{complete ? <CheckCircle2 size={23} /> : <LockKeyhole size={23} />}</span>
      <p className="overline">استعادة الحساب</p>
      <h1>{complete ? "تم تغيير كلمة المرور" : "اختر كلمة مرور جديدة"}</h1>
      {complete ? <p>ننقلك الآن إلى تسجيل الدخول.</p> : session ? <>
        <p>اكتب كلمة جديدة من 8 أحرف على الأقل. يمكنك استخدام مدير كلمات المرور واللصق بشكل طبيعي.</p>
        <form className="stacked-form auth-password-form" onSubmit={updatePassword}>
          <label htmlFor="new-password">كلمة المرور الجديدة</label>
          <input id="new-password" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required dir="ltr" />
          <label htmlFor="new-password-confirmation">تأكيد كلمة المرور</label>
          <input id="new-password-confirmation" name="password_confirmation" type="password" autoComplete="new-password" minLength={8} maxLength={128} required dir="ltr" />
          <Button type="submit" disabled={working}>{working ? <LoaderCircle className="spin" size={16} /> : <KeyRound size={16} />} حفظ كلمة المرور</Button>
        </form>
      </> : <><p>الرابط غير صالح أو انتهت صلاحيته. اطلب رسالة استعادة جديدة من صفحة الدخول.</p><Button href="/login?mode=forgot" variant="secondary">إرسال رسالة جديدة</Button></>}
      {error ? <p className="form-notice error" role="alert">{error}</p> : null}
    </section>
  </main>;
}
