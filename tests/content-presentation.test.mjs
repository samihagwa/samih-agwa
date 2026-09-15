import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const modules = new Map();
async function sourceModule(url) {
  if (modules.has(url.href)) return modules.get(url.href);
  let code = ts.transpileModule(await readFile(url, "utf8"), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  for (const match of [...code.matchAll(/from "([^"]+)"/g)]) {
    const name = match[1];
    let target;
    if (name.startsWith(".")) {
      const base = new URL(name, url);
      let resolved;
      for (const ext of [".ts", ".tsx"]) { try { await access(base.pathname + ext); resolved = new URL(base.href + ext); break; } catch { /* Try the other TypeScript extension. */ } }
      if (!resolved) throw new Error("Missing source: " + base);
      target = await sourceModule(resolved);
    } else target = import.meta.resolve(name);
    code = code.replaceAll(`from "${name}"`, `from "${target}"`);
  }
  const result = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  modules.set(url.href, result);
  return result;
}
const load = async (path) => import(await sourceModule(new URL(path, import.meta.url)));
const { contentProgress, contentRequestText, filterContent, latestDeliveries, safeWebLink } = await load("../lib/content-presentation.ts");
const { insertAtSelection, emojiGroups } = await load("../lib/emoji-symbols.ts");
const { RequestText } = await load("../components/ui/RequestText.tsx");
const { ContentLibrary } = await load("../components/content/ContentLibrary.tsx");
const { ContentRequestView } = await load("../components/content/ContentRequestView.tsx");
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const item = { id: "qa-content", title: "طلب اختبار", status: "in_production", format: "reel", platforms: ["Instagram"], publish_at: "2026-09-15T12:00:00Z", version: 3, created_by: "owner",
  intake_request: "  تعليمات المونتاج:\nحذف من 14 إلى 17\n\n**الجلسة الأولى**\nhttps://www.tradingview.com/x/Azg8IJCk\n  " };
const tasks = [
  { id: "editing", owner_id: "editor", content_item_id: item.id, is_work_item: true, content_step: "editing", status: "done" },
  { id: "thumbnail", owner_id: "owner", content_item_id: item.id, is_work_item: true, content_step: "thumbnail", status: "ready" },
  { id: "publishing", owner_id: "owner", content_item_id: item.id, is_work_item: true, content_step: "publishing", status: "queued" },
  { id: "gate", owner_id: "owner", is_work_item: false, content_step: null, status: "done" },
];
const deliveries = [
  { id: "v1", task_id: "editing", step: "editing", version: 1, submitted_at: "2026-09-14T12:00:00Z", submitted_by: "editor", result_url: "https://example.com/v1" },
  { id: "v2", task_id: "editing", step: "editing", version: 2, submitted_at: "2026-09-15T12:00:00Z", submitted_by: "editor", result_url: "https://example.com/v2" },
];
const props = { item, tasks, deliveries, assets: [{ id: "raw", kind: "source", stage: "recording", title: "ملف الفيديو", url: "https://example.com/raw", created_by: "owner" }], revisions: [], timeline: [], people: [], userId: "owner", readOnly: false, platformAdmin: true, working: false, backHref: "/content", command: async () => true };

test("progress retains work-item math and does not count approval gates", () => {
  assert.equal(contentProgress(tasks, item.status).percent, 33);
  assert.equal(contentProgress(tasks, item.status).current, "غلاف");
  assert.equal(contentProgress([], "published").percent, 0);
  assert.equal(contentProgress([], "published").current, "منشور");
  assert.equal(tasks[0].id, "editing");
});
test("request text remains complete with timestamps, URLs, headings and whitespace", () => {
  assert.equal(contentRequestText(item), item.intake_request);
  assert.equal(contentRequestText({ goal: "أ", hook: "أ", copy_brief: "ب", design_brief: "ج" }), "أ\n\nب\n\nج");
});
test("latest delivery is independent of API order and earlier versions remain intact", () => {
  assert.equal(latestDeliveries(deliveries).get("editing").id, "v2");
  assert.equal(latestDeliveries([...deliveries].reverse()).get("editing").id, "v2");
  assert.equal(deliveries.length, 2);
});
test("links and bold render without executing saved HTML or unsafe URLs", () => {
  const html = render(RequestText, { text: '**عنوان**\n[الصورة](https://example.com/chart)\nhttps://example.com/video,\n<script>alert(1)</script>\n[jump](javascript:alert(1))' });
  assert.match(html, /<strong>عنوان<\/strong>/);
  assert.match(html, /href="https:\/\/example.com\/chart"/);
  assert.match(html, /href="https:\/\/example.com\/video"/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script|href="javascript/);
  for (const url of ["javascript:alert(1)", "data:text/html,hi", "https://user:pass@example.com", "/relative"]) assert.equal(safeWebLink(url), null);
});
test("search, archive, schedule and stage filters compose correctly", () => {
  const items = [item, { ...item, id: "scheduled", status: "scheduled" }, { ...item, id: "published", status: "published" }];
  const map = new Map([[item.id, tasks]]);
  assert.equal(filterContent(items, "active", "14 إلى 17", "", map).length, 2);
  assert.equal(filterContent(items, "archive", "", "", map)[0].id, "published");
  assert.equal(filterContent(items, "scheduled", "", "", map)[0].id, "scheduled");
  assert.equal(filterContent(items, "active", "", "thumbnail", map).length, 1);
  assert.equal(filterContent(items, "active", "", "editing", map).length, 0);
});
test("library renders 15 compact rows and accessible pages even on mobile", () => {
  const html = render(ContentLibrary, { items: Array.from({ length: 18 }, (_, i) => ({ ...item, id: "qa-" + i })), tasks: new Map(), view: "active" });
  assert.equal((html.match(/class="request-title"/g) ?? []).length, 15);
  assert.match(html, /عرض 1–15 من 18/);
  assert.match(html, /aria-label="الصفحة 2"/);
  assert.match(html, /تصفية/);
});
test("file exposes raw and newest delivery first, retains old versions in history, removes library and AI clutter", () => {
  const html = render(ContentRequestView, props);
  const top = html.slice(0, html.indexOf('class="request-document"'));
  assert.match(top, /فتح المادة الخام/);
  assert.match(top, /https:\/\/example.com\/v2/);
  assert.doesNotMatch(top, /https:\/\/example.com\/v1/);
  assert.match(html, /https:\/\/example.com\/v1/);
  assert.match(html, /aria-valuenow="33"/);
  assert.doesNotMatch(html, /مكتبة البراند|مركز الأصول|مراجع البراند|اقتراحات.*AI/);
});
test("viewer and unrelated member cannot see editing or write actions", () => {
  const html = render(ContentRequestView, { ...props, userId: "outsider", readOnly: true, platformAdmin: false });
  assert.doesNotMatch(html, /تعديل الطلب|إضافة رابط|إزالة الرابط|طلب تعديل/);
  const other = render(ContentRequestView, { ...props, userId: "outsider", readOnly: false, platformAdmin: false });
  assert.doesNotMatch(other, /تعديل الطلب|إضافة رابط|إزالة الرابط|طلب تعديل/);
});
test("emoji inserts/replaces at cursor including combined Unicode, with length guard", () => {
  assert.deepEqual(insertAtSelection("أبجد", "🔥", 2, 2, 20), { text: "أب🔥جد", caret: 4 });
  assert.deepEqual(insertAtSelection("abc", "1️⃣", 1, 2, 20), { text: "a1️⃣c", caret: 4 });
  assert.equal(insertAtSelection("abc", "🔥", 3, 3, 4), null);
  assert.equal(emojiGroups.flatMap((g) => g.items).length, 62);
});
