import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const source = await readFile(new URL("../lib/content-calendar.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {contentRequestDate, calendarDay} = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));

test("day-only intake accepts today after noon and rejects yesterday by Cairo day", () => {
  const now = new Date("2026-09-21T20:59:59Z"); // Cairo 23:59:59
  assert.equal(contentRequestDate("2026-09-21", now), "2026-09-21T09:00:00.000Z");
  assert.equal(contentRequestDate("2026-09-20", now), null);
  assert.equal(contentRequestDate("2026-09-21", new Date("2026-09-21T21:00:00Z")), null);
  assert.ok(contentRequestDate("2026-09-22", now));
  for (const day of ["", "2026-02-30", "2026-13-01", "not a date", "2026-9-21"]) {
    assert.equal(contentRequestDate(day, now), null);
  }
});
test("day serialization is independent of device timezone and follows Cairo DST", () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ["UTC", "America/Los_Angeles", "Asia/Tokyo", "Africa/Cairo"]) {
      process.env.TZ = zone;
      for (const [day, hour] of [["2026-01-20", "10"], ["2026-09-21", "09"], ["2026-10-30", "10"]]) {
        const value = contentRequestDate(day, new Date("2026-01-01T00:00:00Z"));
        assert.equal(value, `${day}T${hour}:00:00.000Z`);
        assert.equal(calendarDay(value), day);
      }
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
test("intake uses the shared day serializer and maps database date errors to 400", async () => {
  const form = await readFile(new URL("../components/content/VisualContentIntake.tsx",import.meta.url),"utf8");
  const edge = await readFile(new URL("../supabase/functions/create-content-workflow/index.ts",import.meta.url),"utf8");
  assert.match(form, /contentRequestDate\(String\(values.get\("publish"\)/);
  assert.doesNotMatch(form, /new Date\(/);
  assert.match(edge, /error.code === "22007"/);
});
test("both task views expose customer profile independently of follow-up completion", async () => {
  const actions = await readFile(new URL("../components/tasks/CrmTaskActions.tsx",import.meta.url),"utf8");
  assert.match(actions, /href=\{`\/crm\/\$\{contactId\}`\}/);
  assert.match(actions, /فتح ملف العميل/);
  assert.match(actions, /canComplete && status !== "done" && status !== "cancelled"/);
  for (const file of ["TaskDetailWorkspace", "TasksWorkspace"]) {
    const source = await readFile(new URL(`../components/tasks/${file}.tsx`,import.meta.url),"utf8");
    assert.match(source, /<CrmTaskActions contactId=\{task.crm_contact_id\}/);
  }
});
test("rendered CRM actions keep profile access on completed tasks and gate result entry", async () => {
  const moduleUrl = (source) => "data:text/javascript;base64," + Buffer.from(
    ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText
      .replaceAll('"react/jsx-runtime"', JSON.stringify(import.meta.resolve("react/jsx-runtime")))
      .replaceAll('"lucide-react"', JSON.stringify(import.meta.resolve("lucide-react")))
  ).toString("base64");
  const button = moduleUrl(await readFile(new URL("../components/ui/Button.tsx", import.meta.url), "utf8"));
  const source = (await readFile(new URL("../components/tasks/CrmTaskActions.tsx", import.meta.url), "utf8"))
    .replace('"../ui/Button"', JSON.stringify(button));
  const { CrmTaskActions } = await import(moduleUrl(source));
  for (const status of ["ready", "in_progress", "done", "cancelled"]) {
    for (const canComplete of [true, false]) {
      const html = renderToStaticMarkup(createElement(CrmTaskActions, { contactId: "customer-id", status, canComplete }));
      assert.match(html, /href="\/crm\/customer-id"/);
      assert.match(html, /فتح ملف العميل/);
      assert.equal(html.includes("action=complete-follow-up"), canComplete && !["done", "cancelled"].includes(status));
    }
  }
});
