"use client";

import { scriptDraftStage, type WritableScriptStage } from "../../lib/scripts";
import type { Tables } from "../../lib/supabase/database.types";

export function ScriptStatusControl({ script, label, disabled, onChange }: {
  script: Tables<"scripts">; label: string; disabled: boolean;
  onChange: (stage: WritableScriptStage) => void;
}) {
  const value = script.status === "draft" ? scriptDraftStage(script) : script.status;
  return <select className="script-status-select" aria-label={`تغيير حالة ${script.title}`} value={value} disabled={disabled}
    onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}
    onChange={(event) => { event.stopPropagation(); onChange(event.target.value as WritableScriptStage); }}>
    {script.status === "handed_off" ? <option value="handed_off">{label} · من طلب التنفيذ</option> : null}
    <option value="idea" disabled={Boolean(script.content_item_id)}>فكرة</option>
    <option value="draft" disabled={Boolean(script.content_item_id)}>قيد الكتابة</option>
    <option value="ready_to_record" disabled={Boolean(script.content_item_id) || script.spoken_script.trim().length < 20}>جاهز للتصوير</option>
    <option value="archived">مؤرشف</option>
  </select>;
}
