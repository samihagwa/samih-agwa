import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const lib = await readFile(new URL("../lib/task-attention.ts", import.meta.url), "utf8");
const code = ts.transpileModule(lib, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { activeTaskAttention, attentionFields, taskAttentionError } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
test("attention state hides previous assignee and closed work, preserving current open work", () => {
  const state = { assignee_id: "current" };
  assert.equal(activeTaskAttention({ owner_id: "current", status: "ready" }, state), state);
  for (const status of ["done", "cancelled"]) assert.equal(activeTaskAttention({ owner_id: "current", status }, state), null);
  assert.equal(activeTaskAttention({ owner_id: "new", status: "ready" }, state), null);
  assert.equal(activeTaskAttention({ owner_id: "current", status: "ready" }, null), null);
});
test("JSON fields ignore null/non-text payloads and errors remain actionable Arabic", () => {
  assert.deepEqual(attentionFields({ id: "a", promised_at: null, injected: {}, count: 3 }), { id: "a" });
  assert.deepEqual(attentionFields([]), {});
  assert.match(taskAttentionError({ message: "Attention cooldown; wait 15 minutes" }), /15 دقيقة/);
  assert.match(taskAttentionError({ message: "Attention changed; refresh and retry" }), /تحديث جديد/);
  assert.doesNotMatch(taskAttentionError({ message: "SQL internal sensitive text" }), /SQL|sensitive/);
});
test("attention command boundary protects status, actors, revisions, notifications and audit", async () => {
  const sql = await readFile(new URL("../supabase/migrations/20260916181450_task_attention_signals.sql", import.meta.url), "utf8");
  assert.match(sql, /enable row level security/);
  assert.match(sql, /private\.can_read_task_actor/);
  assert.match(sql, /actor <> task_record\.created_by/);
  assert.match(sql, /actor <> task_record\.owner_id/);
  assert.match(sql, /actor_role = 'viewer'/);
  assert.match(sql, /expected_revision <> coalesce\(attention\.revision, 0\)/);
  assert.match(sql, /for update/g);
  assert.match(sql, /interval '15 minutes'/);
  assert.match(sql, /private\.add_notification/);
  assert.match(sql, /insert into public\.audit_events/);
  assert.doesNotMatch(sql, /update public\.tasks/);
  assert.match(sql, /language sql security invoker/);
});
test("shared controls use one RPC, guard double clicks, and both task entry points subscribe", async () => {
  const controls = await readFile(new URL("../components/tasks/TaskAttentionControls.tsx", import.meta.url), "utf8");
  assert.match(controls, /if \(submitting\.current\) return/);
  assert.match(controls, /finally \{/);
  assert.match(controls, /rpc\("change_task_attention"/);
  assert.match(controls, /role="alert"/);
  assert.match(controls, /minLength=\{3\}/);
  assert.doesNotMatch(controls, /\.update\(|\.insert\(/);
  for (const file of ["TasksWorkspace", "TaskDetailWorkspace"]) {
    const source = await readFile(new URL(`../components/tasks/${file}.tsx`, import.meta.url), "utf8");
    assert.match(source, /<TaskAttentionControls/);
    assert.match(source, /table: "task_attention"/);
  }
});
