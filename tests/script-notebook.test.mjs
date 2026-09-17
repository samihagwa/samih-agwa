import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Render the real presentation component with isolated records; no database or auth bypass.
async function sourceModule(url) {
  const source = await readFile(url, "utf8");
  let code = ts.transpileModule(source, { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  for (const match of [...code.matchAll(/from "([^"]+)"/g)]) {
    const specifier = match[1];
    let target;
    if (specifier.startsWith(".")) {
      const resolved = new URL(specifier, url);
      const extension = specifier.endsWith("/lib/scripts") ? ".ts" : ".tsx";
      target = await sourceModule(new URL(resolved.href + extension));
    } else target = import.meta.resolve(specifier);
    code = code.replaceAll(`from "${specifier}"`, `from "${target}"`);
  }
  return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
}
const { ScriptLibrary } = await import(await sourceModule(new URL("../components/scripts/ScriptLibrary.tsx", import.meta.url)));
const { scriptDraftStage, scriptDisplayStatus } = await import(await sourceModule(new URL("../lib/scripts.ts", import.meta.url)));
const fixtures = Array.from({ length: 18 }, (_, index) => ({
  id: `qa-${index + 1}`, title: `فكرة سكريبت ${index + 1}`, content_kind: "educational",
  status: "draft", spoken_script: "", assigned_to: "writer", duration_seconds: 60,
  updated_at: "2026-09-15T12:00:00Z", content_item_id: null,
}));
const props = { scripts: fixtures, tasks: [], userId: "writer", canWrite: true,
  search: "", onSearch() {}, statusFilter: "active", onFilter() {},
  filters: [{ value: "active", label: "العمل الحالي" }], counts: new Map([["active", 18]]),
  stageOf: () => "idea", statusOf: () => ({ label: "فكرة", tone: "neutral" }),
  workingId: null, async onStatus() {}, async onDelete() {}, onCreate() {}, createForm: null };

test("notebook opens as compact numbered rows with direct document links and bounded pages", () => {
  const html = renderToStaticMarkup(React.createElement(ScriptLibrary, props));
  assert.equal((html.match(/data-stage="idea"/g) ?? []).length, 15);
  assert.match(html, /href="\/scripts\/qa-1"/);
  assert.match(html, /1–15 \/ 18/);
  assert.match(html, /سكريبت جديد/);
  assert.match(html, /aria-label="الصفحة التالية"/);
  assert.doesNotMatch(html, /class="script-row-menu"/);
  assert.doesNotMatch(html, /حذف نهائي/);
  assert.match(html, /تغيير حالة فكرة سكريبت 1/);
  assert.match(html, /value="ready_to_record" disabled/);
});
test("review-only and empty lists do not expose creation", () => {
  const html = renderToStaticMarkup(React.createElement(ScriptLibrary, { ...props, scripts: [], canWrite: false }));
  assert.match(html, /لا توجد سكريبتات مطابقة/);
  assert.doesNotMatch(html, /class="script-inline-add"/);
  assert.match(html, /0–0 \/ 0/);
});
test("explicit idea/writing choice is persisted without deriving a destructive text change", () => {
  assert.equal(scriptDraftStage({ spoken_script: "" }), "idea");
  assert.equal(scriptDraftStage({ spoken_script: "", draft_stage: "draft" }), "draft");
  const longText = "نص محفوظ طويل لا يجب مسحه عند إعادة السكريبت للأفكار";
  assert.equal(scriptDraftStage({ spoken_script: longText, draft_stage: "idea" }), "idea");
  assert.equal(scriptDisplayStatus({ status: "draft", spoken_script: longText, draft_stage: "idea" }).label, "فكرة");
});
test("reviewers get a label instead of status writes and writer selectors expose keyboard alternatives", () => {
  const html = renderToStaticMarkup(React.createElement(ScriptLibrary, { ...props, userId: "reviewer" }));
  assert.doesNotMatch(html, /تغيير حالة/);
  assert.match(html, /مشاركة للمراجعة/);
});
test("board, nested pages and copy use scoped commands with conflict and leave protection", async () => {
  const [board, pages, editor, migration] = await Promise.all([
    readFile(new URL("../components/scripts/ScriptLibrary.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/scripts/ScriptPages.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/scripts/ScriptEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260917184952_script_board_and_nested_pages.sql", import.meta.url), "utf8"),
  ]);
  assert.match(board, /onDrop=/);
  assert.match(board, /canDrop\(script, group\.value\)/);
  assert.match(pages, /expected_version: active\.edit_version/);
  assert.match(pages, /window\.addEventListener\("beforeunload"/);
  assert.match(editor, /navigator\.clipboard\.writeText\(form\.spoken_script\)/);
  assert.match(migration, /alter table public\.script_pages enable row level security/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /p\.parent_id is distinct from parent_page_id/);
  assert.match(migration, /s\.content_item_id is not null and destination <> 'archived'/);
});
test("document tools are on demand, accessible, and retain explicit AI acceptance", async () => {
  const editor = await readFile(new URL("../components/scripts/ScriptEditor.tsx", import.meta.url), "utf8");
  const panel = await readFile(new URL("../components/scripts/ScriptToolPanel.tsx", import.meta.url), "utf8");
  for (const name of ["properties", "assistant", "hooks", "production", "versions", "review", "actions"]) {
    assert.match(editor, new RegExp(`editorPanel === "${name}"`));
  }
  assert.match(editor, /spokenTextInput\.current/);
  assert.match(editor, /window\.addEventListener\("beforeunload"/);
  assert.match(editor, /form\.spoken_script !== rewritePreview\.base/);
  assert.match(editor, /onClick=\{acceptRewrite\}/);
  assert.match(panel, /showModal\(\)/);
  assert.match(panel, /trigger\?\.focus\(\)/);
  assert.match(panel, /role="alert"/);
  assert.match(editor, /new ResizeObserver/);
  assert.match(editor, /document\.fonts\.ready\.then\(fitText\)/);
  const css = await readFile(new URL("../app/scripts-notebook.css", import.meta.url), "utf8");
  assert.match(css, /scripts-tabs button\.active \{ color: var\(--ink-950\)/);
  assert.match(css, /border: 0 !important; border-radius: 0 !important/);
});
