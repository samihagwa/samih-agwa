import assert from "node:assert/strict";
import test from "node:test";

const protectedRoutes = [
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
  ["/crm/customers", "دليل موحّد لكل العملاء"],
  ["/crm/example", "ملف العميل"],
  ["/analytics", "الأرقام تقود القرار"],
  ["/chat", "دردشة داخلية منظمة"],
  ["/team", "دخول واضح"],
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

for (const [pathname, protectedHeading] of protectedRoutes) {
  test(`server-renders a private gate for ${pathname}`, async () => {
    const response = await render(pathname);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
    const html = await response.text();
    assert.match(html, /lang="ar"/);
    assert.match(html, /dir="rtl"/);
    assert.match(html, /جارٍ التحقق من الوصول/);
    assert.doesNotMatch(html, /<aside class="sidebar"/);
    assert.doesNotMatch(html, new RegExp(`<h1[^>]*>${protectedHeading}</h1>`));
  });
}

test("login is the only public workspace page and renders no sidebar", async () => {
  const response = await render("/login");
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /تسجيل دخول الفريق/);
  assert.match(html, /منصة داخلية بالدعوة فقط/);
  assert.doesNotMatch(html, /<aside class="sidebar"/);
});

test("invitation activation remains public without exposing the workspace shell", async () => {
  const response = await render("/join");
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /تفعيل حسابك داخل مساحة العمل/);
  assert.match(html, /دعوة من المالك/);
  assert.doesNotMatch(html, /<aside class="sidebar"/);
});
