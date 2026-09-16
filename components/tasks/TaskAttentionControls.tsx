"use client";

import { AlertTriangle, BellRing, CheckCircle2, LoaderCircle } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { formatDateTime } from "../../lib/date-time";
import { activeTaskAttention, attentionFields, helpReasons, taskAttentionError, type AttentionAction, type TaskAttention } from "../../lib/task-attention";
import { getSupabaseBrowserClient } from "../../lib/supabase/client";
import type { Tables } from "../../lib/supabase/database.types";
import { Button } from "../ui/Button";
import { StatusBadge } from "../ui/StatusBadge";

type Props = {
  task: Tables<"tasks">;
  attention?: TaskAttention | null;
  userId: string;
  readOnly: boolean;
  onChanged: () => Promise<void>;
};

export function TaskAttentionBadge({ task, attention }: Pick<Props, "task" | "attention">) {
  const active = activeTaskAttention(task, attention);
  const urgency = attentionFields(active?.urgency ?? {});
  const blocker = attentionFields(active?.blocker ?? {});
  return <span className="task-attention-badges">
    {urgency.id ? <StatusBadge tone={urgency.acknowledged_at ? "info" : "danger"}><BellRing size={12} /> {urgency.acknowledged_at ? "العاجل: تم استلام التنبيه" : "تنبيه عاجل"}</StatusBadge> : null}
    {blocker.id && !blocker.resolved_at ? <StatusBadge tone="warning"><AlertTriangle size={12} /> محتاج مساعدة</StatusBadge> : null}
  </span>;
}

export function TaskAttentionControls({ task, attention, userId, readOnly, onChanged }: Props) {
  const [form, setForm] = useState<AttentionAction | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const submitting = useRef(false);
  const formElement = useRef<HTMLFormElement | null>(null);
  const id = useId();
  const active = activeTaskAttention(task, attention);
  const urgency = attentionFields(active?.urgency ?? {});
  const blocker = attentionFields(active?.blocker ?? {});
  const canSend = !readOnly && userId === task.created_by && userId !== task.owner_id;
  const canRespond = !readOnly && userId === task.owner_id;
  const canHelp = canRespond && ["ready", "in_progress", "blocked"].includes(task.status);
  const hasBlocker = Boolean(blocker.id && !blocker.resolved_at);
  const waitingAck = Boolean(urgency.id && !urgency.acknowledged_at);

  useEffect(() => {
    if (form) formElement.current?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select")?.focus();
  }, [form]);

  async function act(action: AttentionAction, values?: FormData) {
    if (submitting.current) return;
    const localTime = String(values?.get("promised_at") ?? "");
    const date = localTime ? new Date(localTime) : null;
    if (date && (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now())) {
      setError("اختار موعد إنجاز في المستقبل."); return;
    }
    submitting.current = true; setWorking(true); setError(null); setNotice(null);
    try {
      const { error: actionError } = await getSupabaseBrowserClient().rpc("change_task_attention", {
        target_task_id: task.id, target_action: action, expected_revision: attention?.revision ?? 0,
        message: String(values?.get("message") ?? "") || null,
        reason: String(values?.get("reason") ?? "") || null,
        promised_at: date?.toISOString() ?? null,
      });
      if (actionError) throw actionError;
      setForm(null);
      await onChanged();
      setNotice(action === "urgent" ? "اتبعت التنبيه للمسؤول عن المهمة." : action === "acknowledge" ? "اتسجل استلامك للتنبيه ووصل الرد لطالب المهمة." : action === "help" ? "اتحفظ سبب التعطيل." : "اتسجل إن العائق اتحل.");
    } catch (actionError) {
      setError(taskAttentionError(actionError));
      // Refresh after conflicts/timeouts too: the request may have committed.
      try { await onChanged(); } catch { /* Keep the actionable inline error. */ }
    } finally {
      submitting.current = false; setWorking(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form) void act(form, new FormData(event.currentTarget));
  }

  if (["done", "cancelled"].includes(task.status) || !task.is_work_item) return null;
  if (!canSend && !canRespond && !urgency.id && !hasBlocker) return null;

  return <section className="task-attention" aria-label="تنبيهات المهمة والمساعدة" aria-busy={working}>
    {urgency.id ? <div className="task-attention-message" data-tone="urgent">
      <strong><BellRing size={16} /> {urgency.acknowledged_at ? "المسؤول شاف التنبيه العاجل" : "تنبيه عاجل — بانتظار تأكيد المسؤول"}</strong>
      {urgency.note ? <p>{urgency.note}</p> : null}
      <small>{formatDateTime(urgency.acknowledged_at || urgency.sent_at)}</small>
      {urgency.promised_at ? <p>الإنجاز المتوقع: <bdi>{formatDateTime(urgency.promised_at)}</bdi><small>الموعد الأصلي للمهمة لم يتغيّر.</small></p> : null}
    </div> : null}
    {hasBlocker ? <div className="task-attention-message" data-tone="help">
      <strong><AlertTriangle size={16} /> {helpReasons[blocker.reason as keyof typeof helpReasons] ?? "محتاج مساعدة"}</strong>
      <p>{blocker.details}</p>
      {canRespond ? <Button type="button" variant="secondary" disabled={working} onClick={() => void act("resolve_help")}><CheckCircle2 size={15} /> اتحلت — أقدر أكمل</Button> : null}
    </div> : null}
    <div className="task-attention-actions">
      {canSend ? <Button type="button" variant="secondary" disabled={working} aria-expanded={form === "urgent"} onClick={() => { setForm("urgent"); setError(null); setNotice(null); }}><BellRing size={15} /> {urgency.id ? "إعادة التنبيه العاجل" : "تنبيه عاجل"}</Button> : null}
      {canRespond && waitingAck ? <Button type="button" disabled={working} aria-expanded={form === "acknowledge"} onClick={() => { setForm("acknowledge"); setError(null); setNotice(null); }}><CheckCircle2 size={15} /> شفت التنبيه</Button> : null}
      {canHelp && !hasBlocker ? <Button type="button" variant="secondary" disabled={working} aria-expanded={form === "help"} onClick={() => { setForm("help"); setError(null); setNotice(null); }}><AlertTriangle size={15} /> محتاج حاجة عشان أكمل</Button> : null}
    </div>
    {form ? <form ref={formElement} className="task-attention-form" onSubmit={submit}>
      {form === "urgent" ? <label htmlFor={`${id}-note`}>رسالة للمسؤول — اختياري<textarea id={`${id}-note`} name="message" rows={2} maxLength={1000} placeholder="مثال: محتاجين التسليم قبل ميعاد النشر." disabled={working} /></label> : null}
      {form === "acknowledge" ? <label htmlFor={`${id}-eta`}>هتخلص إمتى؟ — اختياري<input id={`${id}-eta`} name="promised_at" type="datetime-local" disabled={working} /><small>تأكيد الاستلام لا يبدأ التنفيذ ولا يغيّر موعد المهمة.</small></label> : null}
      {form === "help" ? <>
        <label htmlFor={`${id}-reason`}>إيه اللي معطّلك؟<select id={`${id}-reason`} name="reason" required defaultValue="" disabled={working}><option value="" disabled>اختار السبب</option>{Object.entries(helpReasons).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label htmlFor={`${id}-details`}>محتاج إيه بالظبط؟<textarea id={`${id}-details`} name="message" required minLength={3} maxLength={1000} rows={3} placeholder="اكتب المطلوب عشان تقدر تكمل المهمة." disabled={working} /></label>
      </> : null}
      <div className="task-attention-actions"><Button type="submit" disabled={working}>{working ? <LoaderCircle size={15} className="spin" /> : null}{form === "urgent" ? "إرسال التنبيه" : form === "acknowledge" ? "تأكيد الاستلام" : "إرسال طلب المساعدة"}</Button><Button type="button" variant="ghost" disabled={working} onClick={() => { setForm(null); setError(null); }}>إلغاء</Button></div>
    </form> : null}
    {error ? <p className="form-notice error" role="alert">{error}</p> : null}
    {notice ? <p className="form-notice success" role="status">{notice}</p> : null}
  </section>;
}
