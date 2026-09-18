import { createRoot } from "react-dom/client";
import { useState } from "react";
import { ScriptLibrary } from "../components/scripts/ScriptLibrary";
import { ScriptWritingAssistant, type WritingDraft } from "../components/scripts/ScriptWritingAssistant";
import { ScriptToolPanel } from "../components/scripts/ScriptToolPanel";
import { scriptDraftStage, scriptDisplayStatus } from "../lib/scripts";
import type { Tables } from "../lib/supabase/database.types";
import "../app/globals.css";
import "../app/scripts-notebook.css";
type Script = Tables<"scripts">;
const fixtures = ["شرح المؤشر", "ليه التحليل الصح ممكن يخسرك؟", "فن اختيار الاستراتيجية"].map((title, index) => ({ id: `qa-${index}`, title, status: "draft", draft_stage: index === 0 ? "idea" : "draft", spoken_script: index === 0 ? "" : "نص سكريبت تجريبي للاختبار المعزول فقط بدون قاعدة بيانات", assigned_to: "writer", content_kind: "educational", duration_seconds: 60, updated_at: "2026-09-17T12:00:00Z", content_item_id: null } as Script));
function AssistantPreview() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<WritingDraft>({ title: "فكرة محلية", spoken_script: "مسودة غير محفوظة", objective: "شرح مبسط", source_text: "", audience: "متداول", platform: "instagram", content_kind: "educational" });
  return <section><button className="button" onClick={() => setOpen(true)}>اختبار مساعد الكتابة</button><label>النص التجريبي<textarea value={draft.spoken_script} onChange={(event) => setDraft({ ...draft, spoken_script: event.target.value })} /></label>
    <ScriptWritingAssistant open={open} onClose={() => setOpen(false)} disabled={false} draft={draft}
      request={async (snapshot) => ({ generated: { reply: "اختبار معزول: قرأت المسودة الحالية: " + snapshot.spoken_script, suggested_script: "اقتراح تجريبي لا يتم وضعه في المحرر إلا باختيارك." }, voice_context: { sample_count: 2, rules_count: 3 } })}
      onApply={(text, base) => { if (base !== JSON.stringify(draft)) return false; setDraft({ ...draft, spoken_script: text }); return true; }}
    /></section>;
}
function Preview() {
  const [scripts, setScripts] = useState(fixtures);
  const [notice, setNotice] = useState("");
  const [create, setCreate] = useState<string | null>(null);
  return <main dir="rtl" style={{ padding: 24, minWidth: 0 }}><p>اختبار محلي معزول — لا يتصل بالإنتاج</p><p role="status">{notice}</p><ScriptLibrary scripts={scripts} tasks={[]} userId="writer" canWrite search="" onSearch={() => {}} filters={[{ value: "idea", label: "أفكار" }, { value: "draft", label: "قيد الكتابة" }, { value: "ready_to_record", label: "جاهز للتصوير" }, { value: "published", label: "تم النشر" }]} statusFilter="all" onFilter={() => {}} counts={new Map()} stageOf={(script) => script.status === "draft" ? scriptDraftStage(script) === "idea" ? "idea" : "draft" : script.status === "handed_off" ? "ready_to_record" : script.status} statusOf={scriptDisplayStatus} workingId={null} onStatus={async (script, stage) => { setScripts((rows) => rows.map((row) => row.id === script.id ? { ...row, status: stage === "idea" ? "draft" : stage, draft_stage: stage === "idea" ? "idea" : "draft" } : row)); setNotice(`حُفظت المرحلة: ${stage}`); }} onDelete={async () => {}} onCreate={(stage) => setCreate(stage ?? "idea")} createForm={create ? <ScriptToolPanel title="صفحة سكريبت جديدة" onClose={() => setCreate(null)}><label>عنوان السكريبت<input placeholder="اكتب الفكرة" /></label><button type="button" className="button" onClick={() => setCreate(null)}>إنشاء</button></ScriptToolPanel> : null} /><AssistantPreview /></main>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
