import { createRoot } from "react-dom/client";
import { useState } from "react";
import { ScriptLibrary } from "../components/scripts/ScriptLibrary";
import { ScriptPages } from "../components/scripts/ScriptPages";
import { scriptDraftStage, scriptDisplayStatus } from "../lib/scripts";
import type { Tables } from "../lib/supabase/database.types";
import "../app/globals.css";
import "../app/scripts-notebook.css";
type Script = Tables<"scripts">;
const fixtures = ["شرح المؤشر", "ليه التحليل الصح ممكن يخسرك؟", "فن اختيار الاستراتيجية"].map((title, index) => ({ id: `qa-${index}`, title, status: "draft", draft_stage: index === 0 ? "idea" : "draft", spoken_script: index === 0 ? "" : "نص سكريبت تجريبي للاختبار المعزول فقط بدون قاعدة بيانات", assigned_to: "writer", content_kind: "educational", duration_seconds: 60, updated_at: "2026-09-17T12:00:00Z", content_item_id: null } as Script));
function Preview() {
  const [scripts, setScripts] = useState(fixtures);
  const [notice, setNotice] = useState("");
  const [pages, setPages] = useState(false);
  return <main dir="rtl" style={{ padding: 24, minWidth: 0 }}><p>اختبار محلي معزول — لا يتصل بالإنتاج</p><p role="status">{notice}</p><ScriptLibrary scripts={scripts} tasks={[]} userId="writer" canWrite search="" onSearch={() => {}} filters={[{ value: "idea", label: "أفكار" }, { value: "draft", label: "قيد الكتابة" }, { value: "ready_to_record", label: "جاهز للتصوير" }, { value: "production", label: "قيد التنفيذ" }, { value: "published", label: "تم النشر" }]} statusFilter="all" onFilter={() => {}} counts={new Map()} stageOf={(script) => script.status === "draft" ? scriptDraftStage(script) === "idea" ? "idea" : "draft" : script.status === "handed_off" ? "production" : script.status} statusOf={scriptDisplayStatus} workingId={null} onStatus={async (script, stage) => { setScripts((rows) => rows.map((row) => row.id === script.id ? { ...row, status: stage === "idea" ? "draft" : stage, draft_stage: stage === "idea" ? "idea" : "draft" } : row)); setNotice(`حُفظت المرحلة: ${stage}`); }} onDelete={async () => {}} onCreate={(stage) => setNotice(`إنشاء في: ${stage ?? "idea"}`)} createForm={null} /><button className="button" onClick={() => setPages(true)}>اختبار الصفحات الداخلية</button>{pages ? <ScriptPages scriptId="qa-0" readOnly={false} onClose={() => setPages(false)} /> : null}</main>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
