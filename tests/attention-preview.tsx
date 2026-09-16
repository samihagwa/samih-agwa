import { useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "../app/globals.css";
import { TaskAttentionControls, TaskAttentionBadge } from "../components/tasks/TaskAttentionControls";
import type { Tables } from "../lib/supabase/database.types";
import { fixtureAttention, fixtureCalls } from "./attention-preview-backend";

const task = { id: "isolated", title: "تجهيز الفيديو للنشر", owner_id: "assignee", created_by: "requester", status: "ready", is_work_item: true } as Tables<"tasks">;
function Preview() {
  const [actor, setActor] = useState("requester");
  const [attention, setAttention] = useState(fixtureAttention);
  return <main style={{ maxWidth: 780, margin: "auto", padding: 16 }}>
    <p>اختبار معزول — لا توجد بيانات حقيقية أو اتصال بالموقع</p>
    <nav aria-label="دور الاختبار" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>{[["requester", "طالب المهمة"], ["assignee", "المسؤول"], ["viewer", "مشاهد فقط"]].map(([value, label]) => <button type="button" className="button button-secondary" key={value} onClick={() => setActor(value)}>{label}</button>)}</nav>
    <article className="task-card" style={{ padding: 20 }}><h1>{task.title}</h1><p>الموعد الأصلي: غدًا · الحالة: جاهزة</p><TaskAttentionBadge task={task} attention={attention} /><TaskAttentionControls key={actor} task={task} attention={attention} userId={actor} readOnly={actor === "viewer"} onChanged={async () => setAttention(fixtureAttention ? { ...fixtureAttention } : null)} /></article>
    <output aria-label="عدد أوامر المحاكاة">{fixtureCalls}</output>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
