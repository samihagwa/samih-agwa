import assert from "node:assert/strict";
import test from "node:test";

const routes = [
  ["/", "خلّي الشغل يمشي كنظام"],
  ["/tasks", "كل شخص يعرف دوره"],
  ["/content", "من الفكرة إلى النشر"],
  ["/brand", "مرجع واحد معتمد"],
  ["/campaigns", "خطة إطلاق تُدار"],
  ["/crm", "كل عميل له مالك"],
  ["/analytics", "الأرقام تقود القرار"],
  ["/team", "أداء واضح"],
  ["/settings", "مركز تحكم واحد"],
];

async function render(pathname) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

for (const [pathname, expectedHeading] of routes) {
  test(`server-renders ${pathname}`, async () => {
    const response = await render(pathname);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
    const html = await response.text();
    assert.match(html, /lang="ar"/);
    assert.match(html, /dir="rtl"/);
    assert.match(html, new RegExp(expectedHeading));
    assert.match(html, /Market Whales/);
  });
}

test("dashboard reports onboarding truth without invented operational data", async () => {
  const response = await render("/");
  const html = await response.text();
  assert.match(html, /الفريق لم يبدأ onboarding/);
  assert.match(html, /لن نعرض أرقامًا وهمية/);
  assert.match(html, /أعضاء فعّالون/);
  assert.match(html, />0</);
});
