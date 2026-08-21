import assert from "node:assert/strict";
import test from "node:test";

const routes = [
  ["/", "اعرف أين الشغل واقف"],
  ["/tasks", "كل شخص يعرف دوره"],
  ["/content", "من الفكرة إلى النشر"],
  ["/planning", "نعرف لماذا وماذا ومتى"],
  ["/scripts", "فكرتك تبقى اسكريبت"],
  ["/scripts/example", "النسخة التي سيتكلم بها"],
  ["/publishing", "جدولة Telegram بلا نشر مكرر"],
  ["/brand", "مرجع واحد معتمد"],
  ["/campaigns", "خطة إطلاق تُدار"],
  ["/crm", "كل عميل له مالك"],
  ["/analytics", "الأرقام تقود القرار"],
  ["/team", "دخول واضح"],
  ["/join", "تفعيل حسابك"],
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

test("dashboard withholds operational data until a verified workspace session", async () => {
  const response = await render("/");
  const html = await response.text();
  assert.match(html, /بيانات تشغيل فعلية/);
  assert.match(html, /لا أرقام شكلية/);
  assert.match(html, /فتح خطة المحتوى/);
});
