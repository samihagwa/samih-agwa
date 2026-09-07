"use client";

import { KeyRound, LoaderCircle, LockKeyhole, LogIn, ShieldCheck, UserPlus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import { getSupabaseFunctionErrorMessage } from "../../lib/supabase/function-errors";
import { Button } from "../ui/Button";

type AuthMode = "login" | "register" | "forgot";

function readInitialMode(): AuthMode {
  if (typeof window === "undefined") return "login";
  const mode = new URLSearchParams(window.location.search).get("mode");
  return mode === "register" || mode === "forgot" ? mode : "login";
}

function readInitialNotice() {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("password") === "updated"
    ? "تم تغيير كلمة المرور. سجّل دخولك بالكلمة الجديدة."
    : null;
}

export function LoginWorkspace() {
  const configured = isSupabaseConfigured();
  const [mode, setMode] = useState<AuthMode>(readInitialMode);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string | null>(readInitialNotice);
  const [error, setError] = useState<string | null>(configured ? null : "خدمة تسجيل الدخول غير متاحة مؤقتًا.");

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError(null);
    setNotice(null);
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured) return;
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const password = String(form.get("password") ?? "");
    setWorking(true); setError(null); setNotice(null);
    const { error: authError } = await getSupabaseBrowserClient().auth.signInWithPassword({ email, password });
    setWorking(false);
    if (authError) {
      setError("البريد أو كلمة المرور غير صحيحين. لو نسيت الكلمة اطلب استعادتها.");
      return;
    }
    window.location.assign("/tasks");
  }

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured) return;
    const form = new FormData(event.currentTarget);
    const fullName = String(form.get("full_name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const password = String(form.get("password") ?? "");
    const passwordConfirmation = String(form.get("password_confirmation") ?? "");
    if (password !== passwordConfirmation) {
      setError("كلمتا المرور غير متطابقتين.");
      return;
    }
    setWorking(true); setError(null); setNotice(null);
    const { error: requestError } = await getSupabaseBrowserClient().functions.invoke("account-access", {
      body: { action: "register", full_name: fullName, email, password },
    });
    if (requestError) {
      setWorking(false);
      setError(await getSupabaseFunctionErrorMessage(requestError, "تعذّر إنشاء طلب الانضمام مؤقتًا."));
      return;
    }
    const { error: authError } = await getSupabaseBrowserClient().auth.signInWithPassword({ email, password });
    setWorking(false);
    if (authError) {
      setNotice("تم إنشاء طلبك. ارجع لتسجيل الدخول واستخدم نفس كلمة المرور.");
      setMode("login");
      return;
    }
    window.location.assign("/tasks");
  }

  async function requestRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured) return;
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim().toLowerCase();
    setWorking(true); setError(null); setNotice(null);
    const { error: requestError } = await getSupabaseBrowserClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setWorking(false);
    if (requestError) {
      setError(requestError.message.includes("rate limit")
        ? "تم طلب رسائل كثيرة لهذا البريد. انتظر دقيقة ثم حاول مرة أخرى."
        : "تعذّر إرسال رابط الاستعادة مؤقتًا. حاول مرة أخرى بعد قليل.");
      return;
    }
    setNotice("لو البريد مسجل عندنا، أرسلنا له رابط تغيير كلمة المرور. راجع الوارد والرسائل غير المرغوب فيها.");
  }

  return <main className="secure-login-page">
    <section className="secure-login-brand" aria-label="Market Whales OS">
      <span className="secure-login-mark" aria-hidden="true">MW</span>
      <div><strong>Market Whales</strong><small>Operating System</small></div>
    </section>
    <section className="secure-login-card auth-choice-card">
      <span className="icon-tile large"><LockKeyhole size={23} /></span>
      <p className="overline">منصة الفريق الداخلية</p>
      <h1>{mode === "login" ? "ادخل بحسابك" : mode === "register" ? "أنشئ حسابًا" : "استعادة كلمة المرور"}</h1>
      <p>{mode === "login"
        ? "الدخول الآن بالبريد وكلمة المرور من أي جهاز، بدون انتظار رسالة في كل مرة."
        : mode === "register"
          ? "بعد التسجيل سيصل طلبك للمالك. لن يظهر لك أي قسم قبل الموافقة وتحديد صلاحياتك."
          : "اكتب بريد حسابك وسنرسل لك رابطًا آمنًا لتعيين كلمة مرور جديدة."}</p>

      {mode !== "forgot" ? <div className="auth-mode-tabs" role="tablist" aria-label="اختيار طريقة الدخول">
        <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => changeMode("login")}><LogIn size={16} /> تسجيل الدخول</button>
        <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => changeMode("register")}><UserPlus size={16} /> إنشاء حساب</button>
      </div> : null}

      {mode === "login" ? <form className="stacked-form auth-password-form" onSubmit={signIn}>
        <label htmlFor="workspace-login-email">البريد الإلكتروني</label>
        <input id="workspace-login-email" name="email" type="email" autoComplete="email" required placeholder="name@example.com" dir="ltr" />
        <label htmlFor="workspace-login-password">كلمة المرور</label>
        <input id="workspace-login-password" name="password" type="password" autoComplete="current-password" required placeholder="••••••••" dir="ltr" />
        <Button type="submit" disabled={working || !configured}>{working ? <LoaderCircle className="spin" size={16} /> : <LogIn size={16} />} دخول</Button>
        <button className="auth-inline-link" type="button" onClick={() => changeMode("forgot")}>نسيت كلمة المرور؟</button>
      </form> : null}

      {mode === "register" ? <form className="stacked-form auth-password-form" onSubmit={register}>
        <label htmlFor="workspace-register-name">اسمك الظاهر للفريق</label>
        <input id="workspace-register-name" name="full_name" autoComplete="name" minLength={2} maxLength={120} required placeholder="الاسم الكامل" />
        <label htmlFor="workspace-register-email">البريد الإلكتروني</label>
        <input id="workspace-register-email" name="email" type="email" autoComplete="email" required placeholder="name@example.com" dir="ltr" />
        <label htmlFor="workspace-register-password">كلمة المرور</label>
        <input id="workspace-register-password" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required placeholder="8 أحرف على الأقل" dir="ltr" />
        <label htmlFor="workspace-register-password-confirmation">تأكيد كلمة المرور</label>
        <input id="workspace-register-password-confirmation" name="password_confirmation" type="password" autoComplete="new-password" minLength={8} maxLength={128} required placeholder="أعد كتابة كلمة المرور" dir="ltr" />
        <Button type="submit" disabled={working || !configured}>{working ? <LoaderCircle className="spin" size={16} /> : <UserPlus size={16} />} إنشاء الحساب وإرسال الطلب</Button>
      </form> : null}

      {mode === "forgot" ? <form className="stacked-form auth-password-form" onSubmit={requestRecovery}>
        <label htmlFor="workspace-recovery-email">بريد الحساب</label>
        <input id="workspace-recovery-email" name="email" type="email" autoComplete="email" required placeholder="name@example.com" dir="ltr" />
        <Button type="submit" disabled={working || !configured}>{working ? <LoaderCircle className="spin" size={16} /> : <KeyRound size={16} />} طلب رابط الاستعادة</Button>
        <button className="auth-inline-link" type="button" onClick={() => changeMode("login")}>العودة لتسجيل الدخول</button>
      </form> : null}

      {notice ? <p className="form-notice success" role="status">{notice}</p> : null}
      {error ? <p className="form-notice error" role="alert">{error}</p> : null}
      <div className="secure-login-note"><ShieldCheck size={17} /><span>إنشاء الحساب لا يفتح المنصة. عضوية قاعدة البيانات وموافقة المالك هما مصدر الصلاحية الوحيد.</span></div>
    </section>
    <footer><KeyRound size={14} /> دخول محمي وصلاحيات مسجلة</footer>
  </main>;
}
