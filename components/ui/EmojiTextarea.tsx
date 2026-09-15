"use client";
import { useEffect, useId, useRef, useState, type TextareaHTMLAttributes } from "react";
import { Smile, X } from "lucide-react";
import { emojiGroups, insertAtSelection } from "../../lib/emoji-symbols";

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value" | "defaultValue"> & { value: string; onValueChange: (text: string) => void; label: string };
export function EmojiTextarea({ value, onValueChange, label, maxLength = 30000, ...props }: Props) {
  const id = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLDetailsElement>(null);
  const selection = useRef({ start: value.length, end: value.length });
  const [group, setGroup] = useState(0);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    const element = picker.current;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !element?.open) return;
      event.preventDefault(); element.open = false; element.querySelector("summary")?.focus();
    };
    element?.addEventListener("keydown", onEscape);
    return () => element?.removeEventListener("keydown", onEscape);
  }, []);
  function insert(symbol: string) {
    if (props.disabled || props.readOnly) return;
    const next = insertAtSelection(value, symbol, selection.current.start, selection.current.end, maxLength);
    if (!next) { setMessage("وصل النص للحد الأقصى؛ احذف بعض النص أولًا."); return; }
    onValueChange(next.text);
    setMessage("");
    if (picker.current) picker.current.open = false;
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(next.caret, next.caret); selection.current = { start: next.caret, end: next.caret }; });
  }
  const choices = query.trim() ? emojiGroups.flatMap((entry) => [...entry.items]).filter(([symbol, name]) => `${symbol} ${name}`.includes(query.trim())) : emojiGroups[group].items;
  return <div className="emoji-textarea">
    <div className="emoji-textarea-tools"><label htmlFor={id}>{label}</label><details ref={picker} className="emoji-picker">
      <summary><Smile size={17} /> إيموجي ورموز</summary><div className="emoji-popover" role="dialog" tabIndex={-1} aria-label="مكتبة الإيموجي والرموز">
        <div className="emoji-search"><input aria-label="ابحث عن رمز" placeholder="ابحث: سهم، قلب، صح..." value={query} onChange={(e) => setQuery(e.target.value)} /><button type="button" aria-label="إغلاق مكتبة الرموز" onClick={() => { if (picker.current) { picker.current.open = false; picker.current.querySelector("summary")?.focus(); } }}><X size={16} /></button></div>
        <div className="emoji-categories">{emojiGroups.map((entry, index) => <button type="button" key={entry.name} aria-pressed={!query && index === group} onClick={() => { setGroup(index); setQuery(""); }}>{entry.name}</button>)}</div>
        <div className="emoji-grid">{choices.map(([symbol, name]) => <button key={symbol} type="button" title={name} aria-label={`إضافة ${name}`} onClick={() => insert(symbol)}>{symbol}</button>)}</div>{!choices.length ? <p>لا توجد رموز مطابقة.</p> : null}
      </div></details></div>
    <textarea {...props} id={id} ref={input} value={value} maxLength={maxLength} onSelect={(e) => { selection.current = { start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd }; }} onChange={(e) => { onValueChange(e.target.value); setMessage(""); }} />
    {message ? <p role="alert">{message}</p> : null}
  </div>;
}
