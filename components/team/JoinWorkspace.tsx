"use client";

import type { Session } from "@supabase/supabase-js";
import { CheckCircle2, KeyRound, LoaderCircle, LockKeyhole, LogOut, MailCheck, ShieldCheck } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import { getSupabaseFunctionErrorMessage } from "../../lib/supabase/function-errors";
import { Button } from "../ui/Button";

const tokenStorageKey = "market-whales-team-invitation";

export function JoinWorkspace() {
  const configured = isSupabaseConfigured();
  const [session, setSession] = useState<Session | null>(null);
  const [token] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("code")?.trim()
      || window.sessionStorage.getItem(tokenStorageKey)?.trim()
      || "";
  });
  const [ready, setReady] = useState(!configured);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(configured ? null : "اتصال تسجيل الدخول غير متاح في هذه النسخة.");

  useEffect(() => {
    if (token) window.sessionStorage.setItem(tokenStorageKey, token);
    if (!configured) return;

    const supabase = getSupabaseBrowserClient();
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setReady(true);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [configured, token]);

  async function requestMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim().toLowerCase();
    if (!email || !token) return;
    setWorking(true);
    setError(null);
    setNotice(null);
    const { error: authError } = await getSupabaseBrowserClient().functions.invoke("request-access-link", {
      body: { email, invitation_token: token },
    });
    setWorking(false);
    if (authError) setError(await getSupabaseFunctionErrorMessage(authError, "تعذّر طلب رابط الدخول مؤقتًا."));
    else setNotice("لو البريد مطابقًا للدعوة المعتمدة، سيصلك رابط الدخول. أي بريد آخر لن يستلم شيئًا.");
  }

  async function acceptInvitation() {
    if (!session || !token) return;
    setWorking(true);
    setError(null);
    setNotice(null);
    const { error: invokeError } = await getSupabaseBrowserClient().functions.invoke("team-commands", {
      body: { action: "accept_invitation", token },
    });
    setWorking(false);
    if (invokeError) {
      setError(await getSupabaseFunctionErrorMessage(invokeError, "تعذّر تفعيل عضويتك. تأكد أنك تستخدم البريد المكتوب في الدعوة."));
      return;
    }
    window.sessionStorage.removeItem(tokenStorageKey);
    setNotice("تم تفعيل عضويتك. ننقلك الآن إلى أول قسم مسموح لحسابك.");
    window.setTimeout(() => window.location.assign("/login"), 500);
  }

  async function signOut() {
    await getSupabaseBrowserClient().auth.signOut();
    setSession(null);
    setNotice(null);
  }

  if (!ready) return <section className="workspace-state"><LoaderCircle className="spin" size={24} /><div><h2>جارٍ تجهيز الدعوة</h2><p>نتحقق من جلسة الدخول والرابط الآمن.</p></div></section>;
  if (!token) return <section className="workspace-state workspace-onboarding"><LockKeyhole size={27} /><div><h2>رابط الدعوة ناقص أو غير صالح</h2><p>افتح الرابط كاملًا كما استلمته من مالك مساحة Market Whales، ولا تنسخ جزءًا منه فقط.</p></div><Button href="/tasks" variant="secondary">فتح تسجيل الدخول</Button></section>;

  return <section className="join-workspace panel">
    <div className="join-workspace-heading"><span><KeyRound size={22} /></span><div><p className="overline">دعوة خاصة ومحددة بالبريد</p><h2>انضم لمساحة Market Whales</h2><p>الرابط وحده لا يكفي: يجب تسجيل الدخول بنفس البريد الذي حدده المالك، ثم تأكيد الانضمام بنفسك.</p></div></div>
    <div className="join-security-note"><ShieldCheck size={17} /><p>لن تنضم لقناة أو جروب، ولن تُرسل أي رسالة باسمك. هذه الخطوة تفعّل وصولك داخل نظام العمل فقط.</p></div>
    {error ? <p className="form-notice error" role="alert">{error}</p> : null}
    {notice ? <p className="form-notice success" role="status">{notice}</p> : null}
    {!session ? <form className="join-email-form" onSubmit={requestMagicLink}>
      <label><span>البريد المكتوب في الدعوة</span><input type="email" name="email" autoComplete="email" required placeholder="name@company.com" /></label>
      <Button type="submit" disabled={working}>{working ? <LoaderCircle className="spin" size={16} /> : <MailCheck size={16} />} إرسال رابط الدخول</Button>
    </form> : <div className="join-confirmation">
      <div><CheckCircle2 size={18} /><span><small>الحساب المسجل</small><strong>{session.user.email}</strong></span></div>
      <p>لو هذا هو البريد المكتوب في الدعوة، فعّل عضويتك. لو مختلف، سجّل الخروج وادخل بالبريد الصحيح.</p>
      <div className="form-actions"><Button type="button" disabled={working} onClick={() => void acceptInvitation()}>{working ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />} تفعيل عضويتي</Button><Button type="button" variant="ghost" onClick={() => void signOut()}><LogOut size={16} /> حساب مختلف</Button></div>
    </div>}
  </section>;
}
