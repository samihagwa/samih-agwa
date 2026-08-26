"use client";

import { LogIn, LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";

export function SessionChip() {
  const configured = isSupabaseConfigured();
  const [email, setEmail] = useState<string | null>(null);
  const [fullName, setFullName] = useState<string | null>(null);
  const [ready, setReady] = useState(!configured);

  useEffect(() => {
    if (!configured) return;

    const supabase = getSupabaseBrowserClient();
    async function loadIdentity(userId: string | null, userEmail: string | null) {
      setEmail(userEmail);
      if (!userId) { setFullName(null); return; }
      const { data } = await supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle();
      setFullName(data?.full_name?.trim() || null);
    }

    void supabase.auth.getSession().then(async ({ data }) => {
      await loadIdentity(data.session?.user.id ?? null, data.session?.user.email ?? null);
      setReady(true);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      void loadIdentity(session?.user.id ?? null, session?.user.email ?? null).finally(() => setReady(true));
      setReady(true);
    });

    return () => data.subscription.unsubscribe();
  }, [configured]);

  if (!ready) {
    return <div className="user-chip user-chip-muted" aria-label="جارٍ فحص جلسة الدخول"><span>…</span><div><strong>جارٍ التحقق</strong><small>لحظة واحدة</small></div></div>;
  }

  if (!email) {
    return <a className="user-chip user-chip-link" href="/login"><span><LogIn size={16} /></span><div><strong>تسجيل الدخول</strong><small>من البوابة الآمنة</small></div></a>;
  }

  const displayName = fullName ?? email;
  const initial = displayName.slice(0, 1).toUpperCase();

  return (
    <div className="user-chip">
      <span>{initial}</span>
      <div><strong>{displayName}</strong><small>{fullName ? email : "حساب موثّق"}</small></div>
      <button
        type="button"
        className="session-signout"
        aria-label="تسجيل الخروج"
        title="تسجيل الخروج"
        onClick={() => void getSupabaseBrowserClient().auth.signOut()}
      >
        <LogOut size={15} />
      </button>
    </div>
  );
}
