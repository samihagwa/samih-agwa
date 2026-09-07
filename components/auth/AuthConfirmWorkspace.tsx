"use client";

import { CheckCircle2, LoaderCircle, LockKeyhole } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import { Button } from "../ui/Button";

export function AuthConfirmWorkspace() {
  const configured = isSupabaseConfigured();
  const [error, setError] = useState<string | null>(configured ? null : "خدمة تسجيل الدخول غير متاحة مؤقتًا.");
  const magicLinkVerification = useRef<ReturnType<ReturnType<typeof getSupabaseBrowserClient>["auth"]["verifyOtp"]> | null>(null);

  useEffect(() => {
    if (!configured) return;
    let active = true;
    const query = new URLSearchParams(window.location.search);
    const tokenHash = query.get("token_hash")?.trim();
    const type = query.get("type")?.trim();

    if (!tokenHash || type !== "magiclink") {
      queueMicrotask(() => { if (active) setError("رابط الدخول غير صالح أو ناقص. اطلب رسالة جديدة."); });
      return () => { active = false; };
    }

    const supabase = getSupabaseBrowserClient();
    magicLinkVerification.current ??= supabase.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
    void magicLinkVerification.current.then(({ error: verificationError }) => {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete("token_hash");
      cleanUrl.searchParams.delete("type");
      window.history.replaceState({}, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
      if (!active) return;
      if (verificationError) {
        setError("رابط الدخول غير صالح أو انتهت صلاحيته. اطلب رسالة جديدة.");
        return;
      }
      window.location.replace("/tasks");
    });

    return () => { active = false; };
  }, [configured]);

  return <main className="secure-login-page">
    <section className="secure-login-brand" aria-label="Market Whales OS"><span className="secure-login-mark" aria-hidden="true">MW</span><div><strong>Market Whales</strong><small>Operating System</small></div></section>
    <section className="secure-login-card auth-choice-card">
      <span className="icon-tile large">{error ? <LockKeyhole size={23} /> : <CheckCircle2 size={23} />}</span>
      <p className="overline">تسجيل دخول آمن</p>
      <h1>{error ? "تعذّر فتح رابط الدخول" : "جارٍ فتح مساحة عملك"}</h1>
      {error ? <><p className="form-notice error" role="alert">{error}</p><Button href="/login" variant="secondary">العودة لتسجيل الدخول</Button></> : <p><LoaderCircle className="spin" size={18} /> نتحقق من الرسالة وننقلك إلى مهامك.</p>}
    </section>
  </main>;
}
