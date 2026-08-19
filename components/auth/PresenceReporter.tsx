"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";

const sectionByPrefix: Array<[string, string]> = [
  ["/tasks", "tasks"], ["/content", "content"], ["/brand", "brand"],
  ["/campaigns", "campaigns"], ["/crm", "crm"], ["/analytics", "analytics"],
  ["/team", "team"], ["/settings", "settings"],
];

function currentSection(pathname: string) {
  return sectionByPrefix.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? "dashboard";
}

export function PresenceReporter() {
  const pathname = usePathname();

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const supabase = getSupabaseBrowserClient();
    let stopped = false;
    let organizationId: string | null = null;

    const report = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      if (!organizationId) {
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData.session) return;
        const { data: membership } = await supabase.from("memberships")
          .select("organization_id")
          .eq("user_id", sessionData.session.user.id)
          .eq("status", "active")
          .limit(1)
          .maybeSingle();
        organizationId = membership?.organization_id ?? null;
      }
      if (organizationId) {
        await supabase.rpc("record_member_presence", {
          target_organization_id: organizationId,
          target_section: currentSection(pathname),
        });
      }
    };

    void report();
    const interval = window.setInterval(() => void report(), 60_000);
    const onVisibility = () => { if (document.visibilityState === "visible") void report(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pathname]);

  return null;
}
