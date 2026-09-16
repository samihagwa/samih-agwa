import type { TaskAttention } from "../lib/task-attention";
export let fixtureAttention: TaskAttention | null = null;
export let fixtureCalls = 0;
export function getSupabaseBrowserClient() {
  return { rpc: async (_name: string, args: { target_action: string; expected_revision: number; message?: string | null; reason?: string | null; promised_at?: string | null }) => {
    fixtureCalls++;
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (args.expected_revision !== (fixtureAttention?.revision ?? 0)) return { error: { message: "Attention changed; refresh and retry" } };
    if (args.target_action === "urgent" && fixtureAttention?.urgency) return { error: { message: "Attention cooldown; wait 15 minutes" } };
    const next = fixtureAttention ?? { task_id: "isolated", organization_id: "isolated", assignee_id: "assignee", revision: 0, urgency: {}, blocker: {}, updated_at: new Date().toISOString() };
    if (args.target_action === "urgent") next.urgency = { id: "ping", note: args.message ?? null, sent_at: new Date().toISOString(), sent_by: "requester" };
    if (args.target_action === "acknowledge") next.urgency = { ...next.urgency as object, acknowledged_at: new Date().toISOString(), promised_at: args.promised_at ?? null };
    if (args.target_action === "help") next.blocker = { id: "help", reason: args.reason ?? "other", details: args.message ?? "" };
    if (args.target_action === "resolve_help") next.blocker = { ...next.blocker as object, resolved_at: new Date().toISOString() };
    fixtureAttention = { ...next, revision: next.revision + 1 };
    return { error: null };
  } };
}
