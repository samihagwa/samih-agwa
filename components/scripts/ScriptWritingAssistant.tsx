"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Send, Sparkles } from "lucide-react";
import { Button } from "../ui/Button";
import { ScriptToolPanel } from "./ScriptToolPanel";

export type WritingDraft = { title: string; spoken_script: string; objective: string; source_text: string; audience: string; platform: string; content_kind: string };
type Message = { role: "user" | "assistant"; content: string; suggestion?: string; base?: string };
type Props = {
  open: boolean; onClose: () => void; draft: WritingDraft; disabled: boolean;
  request: (draft: WritingDraft, messages: { role: string; content: string }[]) => Promise<Record<string, unknown>>;
  onApply: (text: string, base: string) => boolean;
};

export function ScriptWritingAssistant({ open, onClose, draft, disabled, request, onApply }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const conversationEnd = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) conversationEnd.current?.scrollIntoView({ block: "nearest" }); }, [messages, open]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [voice, setVoice] = useState<{ sample_count: number; rules_count: number } | null>(null);
  async function send(prompt = input) {
    if (!prompt.trim() || disabled || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null); setNotice(null);
    const snapshot = { ...draft };
    const next: Message[] = [...messages, { role: "user", content: prompt.trim() }];
    // Bound conversation cost without discarding the current full draft.
    const history = next.slice(-9).map((message) => ({ role: message.role, content: (message.content + (message.suggestion ? `\nاقتراح سابق:\n${message.suggestion}` : "")).slice(0, 6000) }));
    while (history.length > 1 && history.reduce((size, message) => size + message.content.length, 0) > 24000) history.shift();
    setMessages(next); setInput("");
    try {
      const result = await request(snapshot, history);
      const output = result.generated as { reply?: string; suggested_script?: string } | undefined;
      if (!output?.reply) throw new Error("لم يصل رد كامل. النص الأصلي لم يتغير.");
      setMessages([...next, { role: "assistant", content: output.reply, suggestion: output.suggested_script, base: JSON.stringify(snapshot) }]);
      setVoice(result.voice_context as typeof voice ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر الاتصال بالمساعد."); setInput(prompt); setMessages(messages); }
    finally { inFlight.current = false; setBusy(false); }
  }
  if (!open) return null;
  return <ScriptToolPanel title="اكتب مع مساعدك" onClose={onClose} error={error} notice={notice}>
    <div className="script-chat-intro"><p>ناقشه بطريقتك. بيقرأ المسودة الحالية، ومش بيغيّرها غير لما تختار اقتراحه.</p><a href="/scripts?tab=voice" target="_blank" rel="noreferrer">ضبط بصمتي وعينات كتابتي ↗</a>
      {voice ? <small>{voice.sample_count ? `يستخدم ${voice.sample_count} عينات معتمدة من نفس نوع المحتوى و${voice.rules_count} قواعد من بصمتك.` : "لا توجد عينات معتمدة لهذا النوع بعد؛ أضف مثالًا من كتابتك لبصمتك عشان النتيجة تكون أقرب لك."}</small> : <small>بصمتك خاصة بك. المحادثة هنا مؤقتة حتى مغادرة صفحة السكريبت.</small>}</div>
    <div className="script-chat-messages" aria-label="محادثة الكتابة" aria-live="polite">{messages.map((message, index) => <article key={index} className={`script-chat-message ${message.role}`}><strong>{message.role === "user" ? "أنت" : "مساعد الكتابة"}</strong><p>{message.content}</p>
      {message.suggestion ? <div className="script-chat-suggestion"><strong>معاينة النص المقترح</strong><p>{message.suggestion}</p><div className="form-actions">
        <Button type="button" disabled={busy || disabled || message.base !== JSON.stringify(draft)} onClick={() => { if (onApply(message.suggestion!, message.base!)) setNotice("تم وضع الاقتراح في المحرر باختيارك؛ يمكنك تعديله، ويعمل حفظ المسودة المعتاد."); else setError("المسودة اتغيرت؛ اطلب اقتراحًا على النسخة الحالية."); }}>استخدم بدل النص</Button>
        <Button type="button" variant="secondary" onClick={() => { void navigator.clipboard.writeText(message.suggestion!).then(() => setNotice("تم نسخ الاقتراح")).catch(() => setError("تعذّر النسخ؛ يمكنك تحديد النص ونسخه.")); }}><Copy size={16} /> نسخ</Button>
      </div>{message.base !== JSON.stringify(draft) ? <small>المسودة تغيّرت منذ الاقتراح؛ الاستبدال مقفول لحماية تعديلك.</small> : null}</div> : null}
    </article>)}<div ref={conversationEnd} /></div>
    {!messages.length ? <div className="script-chat-shortcuts">{["اقترح زوايا مختلفة للفكرة وناقشني فيها", "راجع المسودة وقولي إيه اللي محتاج يتحسن", "اكتب مسودة بأسلوبي من الفكرة الحالية"].map((prompt) => <Button type="button" key={prompt} variant="secondary" disabled={busy || disabled} onClick={() => void send(prompt)}><Sparkles size={15} />{prompt}</Button>)}</div> : null}
    <form className="script-chat-compose" onSubmit={(event) => { event.preventDefault(); void send(); }}><label><span>عايز نعمل إيه؟</span><textarea value={input} maxLength={6000} onChange={(event) => setInput(event.target.value)} placeholder="مثلًا: البداية دي مش شبهي، خليها مباشرة ومن غير مبالغة…" /></label><div className="form-actions"><Button type="submit" disabled={busy || disabled || !input.trim()}><Send size={16} />{busy ? "بيجهّز الرد…" : "إرسال"}</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => { setMessages([]); setError(null); setNotice(null); }}>محادثة جديدة</Button></div></form>
  </ScriptToolPanel>;
}
