import assert from "node:assert/strict";
import test from "node:test";

const moduleUrl = new URL("../lib/content-intake.ts", import.meta.url);

test("Telegram-style production request extracts cuts, timed cues, assets, and cover brief", async () => {
  const { parseProductionRequest } = await import(moduleUrl);
  const parsed = parseProductionRequest(`
**بشكل عام مطلوب حذف السكاتات والهماس + استخراج النص ومراجعته لغويا**
**مطلوب حذف من**
**22-38**
**1.10-1.13**

# نموذج 1234 لتأكيد تغير الاتجاه
1234 دي مش أرقام عادية، لكن دي أبسط طريقة تتأكد بيها من تغير الاتجاه.
https://www.tradingview.com/x/example1
**الثانية 9 زوم ان على كلمة LQ + دائرة عليها**
**الثانية 12 سهم بيشاور لاعلي على المنطقة من 1-2**
**الثانية 1.01 الى 1.03 زوم ان على الخط الابيض**
كومنت بكلمة مهتم لو عاوز شرح تاني.

عاوز كفر لريل بالكلام اللي فوق وممكن تستخدم الصورة دي
https://www.tradingview.com/x/cover
1234 مش أرقام دي خطوات.
@HAMODD_74
`);

  assert.equal(parsed.title, "نموذج 1234 لتأكيد تغير الاتجاه");
  assert.equal(parsed.timeline.length, 5);
  assert.deepEqual(parsed.timeline.slice(0, 2).map((cue) => [cue.startSeconds, cue.endSeconds, cue.kind]), [
    [22, 38, "cut"],
    [70, 73, "cut"],
  ]);
  assert.equal(parsed.timeline[4].startSeconds, 61);
  assert.equal(parsed.timeline[4].endSeconds, 63);
  assert.match(parsed.editingBrief, /مراجعته لغويا/);
  assert.match(parsed.thumbnailBrief, /عاوز كفر/);
  assert.equal(parsed.assets.length, 2);
  assert.equal(parsed.assets[1].stage, "thumbnail");
  assert.deepEqual(parsed.mentions, ["@HAMODD_74"]);
  assert.match(parsed.cta, /كومنت/);
});

test("Arabic digits and missing sections produce an editable warning instead of fake certainty", async () => {
  const { parseProductionRequest } = await import(moduleUrl);
  const parsed = parseProductionRequest("# فكرة تعليمية\nالثانية ١٢ زوم على الشارت");
  assert.equal(parsed.timeline[0].startSeconds, 12);
  assert.ok(parsed.warnings.some((warning) => warning.includes("غلاف")));
  assert.ok(parsed.warnings.some((warning) => warning.includes("نصًا واضحًا")));
});
