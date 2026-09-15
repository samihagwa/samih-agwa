import { useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "../app/globals.css";
import "../app/scripts-notebook.css";
import "../app/content-workspace.css";
import { ContentLibrary } from "../components/content/ContentLibrary";
import { ContentRequestView } from "../components/content/ContentRequestView";
import { QuickIntakeForm } from "../components/content/QuickIntakeForm";
import type { Tables } from "../lib/supabase/database.types";

const base = { id: "00000000-0000-4000-8000-000000000001", title: "أبسط استراتيجية ICT — تعليمات المونتاج", format: "reel", status: "in_production", platforms: ["Instagram"], created_by: "owner", version: 2, publish_at: "2026-09-18T12:00:00Z", intake_request: "بشكل عام محتاج كتابة الشغل كله على الفيديو ومراجعته لغويًا\n\nحذف من 14 إلى 17\nومن 25 إلى 29\nومن 54 إلى 59\n\n**أبسط استراتيجية ICT ممكن تطلع منها بصفقة قوية هي الـ Open Range Breakout.**\nكمل معايا وهقولك بالضبط إزاي تطبقها. 👇\n\nالثانية 15 إلى 21 سهم بيشاور على الجزء الشمال من الصورة اللي لونه أصفر.\n\nhttps://www.tradingview.com/x/Azg8IJCk\n\nبعدها ننتظر السعر يكسر قمة أو قاع الجلسة السابقة.\nالثانية 34 إلى 39 دائرة على الكلمتين LQ.\n\n**ولو عايز تعرف السر الحقيقي اعمل Follow. 🔥**" } as unknown as Tables<"content_items">;
const taskRows = [{ id: "edit", content_item_id: base.id, content_step: "editing", owner_id: "owner", is_work_item: true, status: "done" }, { id: "cover", content_item_id: base.id, content_step: "thumbnail", owner_id: "owner", is_work_item: true, status: "in_progress" }, { id: "publish", content_item_id: base.id, content_step: "publishing", owner_id: "owner", is_work_item: true, status: "queued" }] as Tables<"tasks">[];
function Preview() {
  const [view, setView] = useState("list");
  const [item, setItem] = useState(base);
  const [notice, setNotice] = useState("");
  const command = async (body: Record<string, unknown>) => { if (body.action === "update_request_text") setItem({ ...item, intake_request: String(body.content_request_text), version: item.version + 1 }); setNotice("تمت المحاكاة محليًا فقط؛ لا يوجد اتصال بقاعدة البيانات."); return true; };
  return <main style={{ maxWidth: 1300, margin: "auto", padding: 20 }}><p role="status">بيانات اختبار معزولة — لا تحفظ على الموقع</p><nav style={{ display: "flex", gap: 12, marginBottom: 28 }}>{[["list", "القائمة"], ["file", "فتح نموذج الطلب"], ["create", "إنشاء تجريبي"]].map(([key, label]) => <button key={key} type="button" className="button button-secondary" onClick={() => setView(key)}>{label}</button>)}</nav><section className="content-desk"><p role="status">{notice}</p>
    {view === "list" ? <><h1>طلبات المحتوى</h1><ContentLibrary items={Array.from({ length: 18 }, (_, i) => ({ ...base, id: "qa-" + i, title: i === 0 ? base.title : "طلب محتوى تجريبي " + (i + 1) }))} tasks={new Map(Array.from({ length: 18 }, (_, i) => ["qa-" + i, taskRows]))} view="active" /></> : view === "create" ? <QuickIntakeForm organizationId="test" currentUserId="owner" people={[{ id: "owner", name: "عضو الاختبار" }]} defaultOwnerIds={{}} defaultPublish="2026-12-15T12:00" working={false} onCancel={() => setView("list")} onCreate={async () => { setNotice("تم إنشاء طلب في المحاكاة فقط"); setView("list"); return true; }} /> : <ContentRequestView item={item} tasks={taskRows} assets={[{ id: "raw", title: "فيديو", stage: "recording", kind: "source", url: "https://example.com/raw", created_by: "owner" } as Tables<"content_assets">]} deliveries={[{ id: "v2", task_id: "edit", step: "editing", version: 2, submitted_by: "owner", submitted_at: "2026-09-15T12:00:00Z", result_url: "https://example.com/v2" } as Tables<"content_step_deliveries">]} revisions={[]} timeline={[]} people={[{ id: "owner", name: "عضو الاختبار" }]} userId="owner" readOnly={false} platformAdmin={true} working={false} command={command} backHref="/tests/content-preview.html" />}</section></main>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
