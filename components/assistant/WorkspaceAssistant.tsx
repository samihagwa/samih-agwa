"use client";

import { Bot, LoaderCircle, Send, Sparkles, X } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "../../lib/supabase/client";
import { getSupabaseFunctionErrorMessage } from "../../lib/supabase/function-errors";

type AssistantMessage = { id: string; role: "user" | "assistant"; text: string; provider?: string };
const starters = ["إيه المهام اللي عليّا النهارده؟", "إيه أقرب موعد تسليم عندي؟", "أوصل للقسم اللي محتاجه إزاي؟"];

function AnswerText({ value }: { value: string }) {
  const parts = value.split(/((?:^|\s)\/[A-Za-z0-9/_?#=&.%:-]+)/g);
  return <p>{parts.map((part, index) => {
    const trimmed = part.trim();
    if (trimmed.startsWith("/") && /^\/[A-Za-z0-9/_?#=&.%:-]+$/.test(trimmed)) {
      const leading = part.slice(0, part.indexOf("/"));
      return <span key={`${part}-${index}`}>{leading}<a href={trimmed}>{trimmed}</a></span>;
    }
    return <span key={`${part}-${index}`}>{part}</span>;
  })}</p>;
}

export function WorkspaceAssistant() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) endRef.current?.scrollIntoView({ block: "end" }); }, [messages, open, working]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  async function ask(question: string) {
    const cleanQuestion = question.trim();
    if (!cleanQuestion || working) return;
    const userMessage: AssistantMessage = { id: crypto.randomUUID(), role: "user", text: cleanQuestion };
    setMessages((current) => [...current, userMessage]); setDraft(""); setWorking(true); setError(null);
    const result = await getSupabaseBrowserClient().functions.invoke("workspace-assistant", { body: { question: cleanQuestion } });
    setWorking(false);
    if (result.error) {
      setError(await getSupabaseFunctionErrorMessage(result.error, "تعذّر الوصول لمساعد التشغيل."));
      return;
    }
    const payload = result.data as { answer?: unknown; provider?: { name?: unknown; model?: unknown } };
    const answer = typeof payload.answer === "string" ? payload.answer.trim() : "";
    if (!answer) { setError("وصل رد فارغ من المساعد."); return; }
    const provider = [payload.provider?.name, payload.provider?.model].filter((value): value is string => typeof value === "string").join(" · ");
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: answer, provider }]);
  }

  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void ask(draft); }

  return <>
    <button className="assistant-launcher" type="button" aria-label="فتح مساعد Market Whales" aria-expanded={open} onClick={() => setOpen(true)}>
      <Sparkles size={20} /><span>اسأل AI</span>
    </button>
    <button className={`assistant-backdrop ${open ? "visible" : ""}`} type="button" aria-label="إغلاق المساعد" tabIndex={open ? 0 : -1} onClick={() => setOpen(false)} />
    <aside className={`workspace-assistant ${open ? "open" : ""}`} aria-label="مساعد تشغيل Market Whales" aria-hidden={!open}>
      <header><div><span><Bot size={21} /></span><div><strong>مساعد Market Whales</strong><small>يقرأ المسموح لحسابك فقط</small></div></div><button type="button" aria-label="إغلاق" onClick={() => setOpen(false)}><X size={20} /></button></header>
      <div className="assistant-trust-note"><Sparkles size={15} /><p>يساعدك تفهم شغلك وتوصل للمعلومة. لا يغيّر أي بيانات أو ينفذ مهمة من نفسه.</p></div>
      <div className="assistant-messages" role="log" aria-live="polite">
        {!messages.length ? <section className="assistant-welcome"><Bot size={28} /><h2>تحب تعرف إيه؟</h2><p>اسأل عن مهامك، مواعيدك، مكان أي خطوة، أو معلومة موجودة في الأقسام المتاحة لك.</p><div>{starters.map((starter) => <button type="button" key={starter} onClick={() => void ask(starter)}>{starter}</button>)}</div></section> : null}
        {messages.map((message) => <article key={message.id} className={`assistant-message ${message.role}`}><strong>{message.role === "assistant" ? "المساعد" : "أنت"}</strong><AnswerText value={message.text} />{message.provider ? <small>{message.provider}</small> : null}</article>)}
        {working ? <article className="assistant-message assistant thinking"><LoaderCircle className="spin" size={16} /><span>براجع البيانات المسموحة لحسابك…</span></article> : null}
        {error ? <p className="form-notice error" role="alert">{error}</p> : null}
        <div ref={endRef} />
      </div>
      <form className="assistant-composer" onSubmit={submit}><textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} maxLength={1500} placeholder="اسأل عن شغلك أو أي قسم…" disabled={working} /><button type="submit" aria-label="إرسال السؤال" disabled={working || !draft.trim()}>{working ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}</button></form>
    </aside>
  </>;
}
