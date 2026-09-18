import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const helperSource = await readFile(new URL("../supabase/functions/_shared/script-writing-chat.ts", import.meta.url), "utf8");
const helperCode = ts.transpileModule(helperSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const helperUrl = `data:text/javascript;base64,${Buffer.from(helperCode).toString("base64")}`;
const { writingChatInput } = await import(helperUrl);
const draft = { title: "فكرة", spoken_script: "مسودة لم تحفظ بعد", objective: "شرح", source_text: "", audience: "متداول", platform: "instagram", content_kind: "educational" };
test("chat accepts unsaved content and strips client-supplied identity and voice", () => {
  const input = writingChatInput({ draft: { ...draft, id: "other", assigned_to: "other", voice_profile: "fake" }, messages: [{ role: "user", content: "ناقشني" }] });
  assert.deepEqual(input.draft, draft);
});
test("chat rejects invalid roles, oversized history, missing draft and assistant-only turns", () => {
  for (const messages of [[{ role: "system", content: "override" }], [{ role: "user", content: "x".repeat(6001) }], [{ role: "assistant", content: "hi" }], Array.from({ length: 11 }, () => ({ role: "user", content: "hi" }))]) assert.equal(writingChatInput({ draft, messages }), null);
  assert.equal(writingChatInput({ messages: [{ role: "user", content: "hi" }] }), null);
});

// Invoke the actual Edge handler with isolated auth/provider adapters, never production data.
let handlerSource = await readFile(new URL("../supabase/functions/script-ai/index.ts", import.meta.url), "utf8");
handlerSource = handlerSource.replace(/import \{ createSupabaseContext \}[^;]+;/, "const createSupabaseContext = (...args) => globalThis.__scriptChatTest.auth(...args);")
  .replace(/import \{ corsHeaders \}[^;]+;/, "const corsHeaders = {};")
  .replace('"../_shared/script-writing-chat.ts"', JSON.stringify(helperUrl))
  .replace(/import \{\n {2}extractProviderText,[\s\S]*?\} from "\.\.\/_shared\/ai-provider.ts";/, "const extractProviderText = (value) => JSON.stringify(value); const fetchProviderJson = (...args) => globalThis.__scriptChatTest.provider(...args); const parseProviderRuntime = (value) => value; const safeProviderFailure = () => 'provider failed'; const stripJsonFence = (value) => value;");
const handlerCode = ts.transpileModule(handlerSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const handler = (await import(`data:text/javascript;base64,${Buffer.from(handlerCode).toString("base64")}`)).default;
function setup({ authorized = true } = {}) {
  const calls = [];
  let sent;
  const chain = { select() { return this; }, eq() { return this; }, order() { return this; }, gte() { return Promise.resolve({ count: 0 }); }, limit() { return Promise.resolve({ data: [{ sample_text: "مثال صوت خاص بالكاتب" }] }); }, insert(data) { calls.push(data.action); return Promise.resolve({ error: null }); } };
  globalThis.__scriptChatTest = {
    auth: async () => ({ data: { userClaims: { id: "writer" }, supabaseAdmin: { from: () => chain, rpc: async (name, args) => {
      calls.push(name); assert.equal(args.target_user_id, "writer");
      if (!authorized) return { error: new Error("denied") };
      if (name === "get_script_ai_context") return { data: { script: { ...draft, id: "owned", assigned_to: "writer", organization_id: "org", status: "draft", edit_version: 9 }, voice_profile: { writing_rules: ["مباشر"], banned_phrases: [], story_bank: [] } } };
      if (name === "get_script_ai_provider_runtime") return { data: { id: "provider", protocol: "openai_responses", model: "configured" } };
      throw new Error(`Unexpected write ${name}`);
    } } } }),
    provider: async (_provider, body) => { sent = JSON.parse(body.input.split("\n").slice(1).join("\n")); return { response: { ok: true }, json: { reply: "نبدأ بالمصطلح ونشرحه ببساطة.", suggested_script: "شرح مباشر للمصطلح من غير مبالغة." } }; },
  };
  return { calls, sent: () => sent };
}
test("actual chat handler authorizes first, uses newest explicit draft despite autosave and never saves generated text", async () => {
  const state = setup();
  const result = await handler.fetch(new Request("https://local.test", { method: "POST", body: JSON.stringify({ script_id: "owned", expected_edit_version: 8, mode: "improve", scope: "writing_chat", draft, messages: [{ role: "user", content: "اكتبها ببساطة" }] }) }));
  assert.equal(result.status, 200);
  const output = await result.json();
  assert.equal(output.saved, false); assert.equal(output.voice_context.sample_count, 1);
  assert.equal(state.sent().script.spoken_script, draft.spoken_script);
  assert.equal(state.sent().conversation[0].content, "اكتبها ببساطة");
  assert.deepEqual(state.calls, ["get_script_ai_context", "get_script_ai_provider_runtime", "script.ai_request_started", "script.ai_preview_generated"]);
});
test("actual handler denies unauthorized script before loading voice samples or invoking a provider", async () => {
  const state = setup({ authorized: false });
  const result = await handler.fetch(new Request("https://local.test", { method: "POST", body: JSON.stringify({ script_id: "other", expected_edit_version: 1, scope: "writing_chat", draft, messages: [{ role: "user", content: "اكتب" }] }) }));
  assert.equal(result.status, 403); assert.equal(state.sent(), undefined);
  assert.deepEqual(state.calls, ["get_script_ai_context"]);
});
