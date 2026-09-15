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
      const extension = specifier.includes("/scripts") ? ".ts" : ".tsx";
      target = await sourceModule(new URL(resolved.href + extension));
    } else target = import.meta.resolve(specifier);
    code = code.replaceAll(`from "${specifier}"`, `from "${target}"`);
  }
  return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
}
const { ScriptLibrary } = await import(await sourceModule(new URL("../components/scripts/ScriptLibrary.tsx", import.meta.url)));
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
  assert.doesNotMatch(html, /حذف نهائي|جاهز للتصوير/);
});
test("review-only and empty lists do not expose creation", () => {
  const html = renderToStaticMarkup(React.createElement(ScriptLibrary, { ...props, scripts: [], canWrite: false }));
  assert.match(html, /لا توجد سكريبتات مطابقة/);
  assert.doesNotMatch(html, /class="script-inline-add"/);
  assert.match(html, /0–0 \/ 0/);
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
});
