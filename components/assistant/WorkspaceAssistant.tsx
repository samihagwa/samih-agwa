"use client";

import { Bot, ExternalLink, LoaderCircle, Send, Sparkles, X } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "../../lib/supabase/client";
import { getSupabaseFunctionErrorMessage } from "../../lib/supabase/function-errors";

type AssistantLink = { label: string; url: string };
type AssistantMessage = { id: string; role: "user" | "assistant"; text: string; provider?: string; links: AssistantLink[] };
const starters = ["إيه المهام اللي عليّا النهارده؟", "إيه أقرب موعد تسليم عندي؟", "هل في ضغط زائد في تقويم الفريق؟", "أوصل للقسم اللي محتاجه إزاي؟"];

function AnswerText({ value }: { value: string }) {
  const pattern = /\[([^\]]+)\]\((\/[A-Za-z0-9/_?#=&.%:-]+)\)|(\/[A-Za-z0-9/_?#=&.%:-]+)/g;
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push(value.slice(cursor, index));
    const url = match[2] || match[3];
    parts.push(<a href={url} key={`${url}-${index}`}>{match[1] || url}</a>);
    cursor = index + match[0].length;
  }
  if (cursor < value.length) parts.push(value.slice(cursor));
  return <p>{parts}</p>;
}

function parseLinks(value: unknown): AssistantLink[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const link = item as Record<string, unknown>;
    return typeof link.label === "string" && typeof link.url === "string" && link.url.startsWith("/")
      ? [{ label: link.label, url: link.url }]
      : [];
  });
}

export function WorkspaceAssistant() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [working, setWorking] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) endRef.current?.scrollIntoView({ block: "end" }); }, [messages, open, working]);
  useEffect(() => {
    if (!open || historyLoaded) return;
    let cancelled = false;
    void (async () => {
      setHistoryLoading(true);
      const supabase = getSupabaseBrowserClient();
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData.user?.id;
      if (!userId || cancelled) { setHistoryLoading(false); setHistoryLoaded(true); return; }
      const { data: conversation } = await supabase.from("assistant_conversations")
        .select("id").eq("user_id", userId).maybeSingle();
      if (!conversation || cancelled) { setHistoryLoading(false); setHistoryLoaded(true); return; }
      const { data: rows } = await supabase.from("assistant_messages")
        .select("id, role, body, provider_label, links, created_at")
        .eq("conversation_id", conversation.id)
        .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(100);
      if (cancelled) return;
      setConversationId(conversation.id);
      setMessages((rows ?? []).reverse().flatMap((row) => row.role === "user" || row.role === "assistant" ? [{
        id: String(row.id), role: row.role, text: row.body,
        provider: row.provider_label ?? undefined, links: parseLinks(row.links),
      }] : []));
      setHistoryLoading(false);
      setHistoryLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [historyLoaded, open]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  useEffect(() => {
    const openWithQuestion = (event: Event) => {
      const question = (event as CustomEvent<{ question?: unknown }>).detail?.question;
      if (typeof question !== "string" || !question.trim()) return;
      setOpen(true); setDraft(question.trim()); setError(null);
    };
    window.addEventListener("workspace-ai:ask", openWithQuestion);
    return () => window.removeEventListener("workspace-ai:ask", openWithQuestion);
  }, []);

  async function ask(question: string) {
    const cleanQuestion = question.trim();
    if (!cleanQuestion || working) return;
    const userMessage: AssistantMessage = { id: crypto.randomUUID(), role: "user", text: cleanQuestion, links: [] };
    setMessages((current) => [...current, userMessage]); setDraft(""); setWorking(true); setError(null);
    const result = await getSupabaseBrowserClient().functions.invoke("workspace-assistant", { body: { question: cleanQuestion, conversation_id: conversationId } });
    setWorking(false);
    if (result.error) {
      setError(await getSupabaseFunctionErrorMessage(result.error, "تعذّر الوصول لمساعد التشغيل."));
      return;
    }
    const payload = result.data as { answer?: unknown; conversation_id?: unknown; message_ids?: { assistant?: unknown }; links?: unknown; provider?: { name?: unknown; model?: unknown }; source?: { label?: unknown } };
    const answer = typeof payload.answer === "string" ? payload.answer.trim() : "";
    if (!answer) { setError("وصل رد فارغ من المساعد."); return; }
    const provider = typeof payload.source?.label === "string"
      ? payload.source.label
      : [payload.provider?.name, payload.provider?.model].filter((value): value is string => typeof value === "string").join(" · ");
    if (typeof payload.conversation_id === "string") setConversationId(payload.conversation_id);
    setMessages((current) => [...current, {
      id: typeof payload.message_ids?.assistant === "number" ? String(payload.message_ids.assistant) : crypto.randomUUID(),
      role: "assistant", text: answer, provider, links: parseLinks(payload.links),
    }]);
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
        {historyLoading ? <section className="assistant-welcome"><LoaderCircle className="spin" size={24} /><p>برجع محادثتك السابقة…</p></section> : null}
        {!historyLoading && !messages.length ? <section className="assistant-welcome"><Bot size={28} /><h2>تحب تعرف إيه؟</h2><p>اسأل عن مهامك، مواعيدك، مكان أي خطوة، أو معلومة موجودة في الأقسام المتاحة لك.</p><div>{starters.map((starter) => <button type="button" key={starter} onClick={() => void ask(starter)}>{starter}</button>)}</div></section> : null}
        {messages.map((message) => <article key={message.id} className={`assistant-message ${message.role}`}><strong>{message.role === "assistant" ? "المساعد" : "أنت"}</strong><AnswerText value={message.text} />{message.links.length ? <div className="assistant-message-links">{message.links.map((link) => <a href={link.url} key={link.url}><ExternalLink size={13} />{link.label}</a>)}</div> : null}{message.provider ? <small>{message.provider}</small> : null}</article>)}
        {working ? <article className="assistant-message assistant thinking"><LoaderCircle className="spin" size={16} /><span>براجع البيانات المسموحة لحسابك…</span></article> : null}
        {error ? <p className="form-notice error" role="alert">{error}</p> : null}
        <div ref={endRef} />
      </div>
      <form className="assistant-composer" onSubmit={submit}><textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} maxLength={1500} placeholder="اسأل عن شغلك أو أي قسم…" disabled={working || historyLoading} /><button type="submit" aria-label="إرسال السؤال" disabled={working || historyLoading || !draft.trim()}>{working ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}</button></form>
    </aside>
  </>;
}
