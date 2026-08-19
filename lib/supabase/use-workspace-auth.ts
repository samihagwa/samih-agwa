"use client";

import type { Session } from "@supabase/supabase-js";
import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import { workspaceIdentityChanged } from "./auth-session";
import { getSupabaseBrowserClient } from "./client";

type WorkspaceAuthOptions = {
  configured: boolean;
  loadWorkspace: (session: Session) => Promise<void>;
  clearWorkspace: () => void;
  setLoading: Dispatch<SetStateAction<boolean>>;
  clearTransientState?: () => void;
};

export function useWorkspaceAuth({
  configured,
  loadWorkspace,
  clearWorkspace,
  setLoading,
  clearTransientState,
}: WorkspaceAuthOptions) {
  const [session, setSession] = useState<Session | null>(null);
  const activeUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!configured) return;

    const supabase = getSupabaseBrowserClient();
    let disposed = false;
    let loadTimer: number | null = null;

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (disposed) return;

      const nextUserId = nextSession?.user.id ?? null;
      const identityChanged = workspaceIdentityChanged(activeUserId.current, nextUserId);
      activeUserId.current = nextUserId;
      setSession(nextSession);

      // SIGNED_IN may fire on tab focus and TOKEN_REFRESHED fires in the
      // background. Neither event should tear down and reload the same user's UI.
      if (!identityChanged) return;

      if (loadTimer !== null) window.clearTimeout(loadTimer);
      clearTransientState?.();
      clearWorkspace();

      if (!nextSession) {
        setLoading(false);
        return;
      }

      setLoading(true);
      loadTimer = window.setTimeout(() => {
        loadTimer = null;
        if (!disposed) void loadWorkspace(nextSession);
      }, 0);
    });

    return () => {
      disposed = true;
      if (loadTimer !== null) window.clearTimeout(loadTimer);
      data.subscription.unsubscribe();
    };
  }, [clearTransientState, clearWorkspace, configured, loadWorkspace, setLoading]);

  return session;
}
