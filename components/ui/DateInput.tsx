"use client";

import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { createPortal } from "react-dom";

const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const label = (day: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("ar-EG", { ...options, timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

/** Native form input remains the source of truth (validation, reset, keyboard and FormData). */
export function DateInput({ type = "date", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const timeInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState("");
  const [picked, setPicked] = useState("");
  const [clock, setClock] = useState("12:00");
  const [error, setError] = useState("");
  const title = props["aria-label"] ?? "اختيار التاريخ";
  useEffect(() => {
    const button = trigger.current;
    if (open) { dialog.current?.showModal(); return () => { button?.focus(); }; }
  }, [open]);
  function start() {
    const current = input.current?.value ?? "";
    const today = new Date();
    const local = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    setPicked(current.slice(0, 10)); setMonth((current || local).slice(0, 7) + "-01");
    setClock(current.slice(11, 16) || "12:00"); setError(""); setOpen(true);
  }
  function commit(day: string) {
    const node = input.current;
    if (!node) return;
    const value = day && type === "datetime-local" ? `${day}T${timeInput.current?.value || clock}` : day;
    const previous = node.value;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(node, value);
    if (!node.validity.valid) {
      setError(node.validationMessage); setter.call(node, previous); return;
    }
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    setOpen(false);
  }
  const first = month ? new Date(`${month}T12:00:00Z`) : new Date();
  const offset = (first.getUTCDay() + 1) % 7;
  const dates = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(first); date.setUTCDate(1 - offset + index); return dayKey(date);
  });
  const min = String(props.min ?? "").slice(0, 10), max = String(props.max ?? "").slice(0, 10);
  function navigate(delta: number) { const date = new Date(first); date.setUTCMonth(date.getUTCMonth() + delta); setMonth(dayKey(date)); }
  return <><span className="date-input-control">
    <input {...props} ref={input} type={type} />
    <button ref={trigger} className="date-input-trigger" type="button" disabled={props.disabled || props.readOnly} aria-label={`${title} — فتح التقويم`} onClick={start}><CalendarDays size={19} /></button>
    </span>{open ? createPortal(<dialog ref={dialog} className="date-picker-dialog" aria-label={String(title)} onCancel={event => { event.stopPropagation(); setOpen(false); }} onClose={event => { event.stopPropagation(); setOpen(false); }}>
      <div className="date-picker-header"><strong>{title}</strong><button type="button" className="icon-button" aria-label="إغلاق التقويم" onClick={() => setOpen(false)}><X size={18}/></button></div>
      <div className="date-picker-navigation">
        <select aria-label="الشهر" value={month.slice(5, 7)} onChange={event => setMonth(`${month.slice(0, 4)}-${event.target.value}-01`)}>{Array.from({length:12}, (_, index) => <option key={index} value={String(index+1).padStart(2,"0")}>{label(`2026-${String(index+1).padStart(2,"0")}-01`,{month:"long"})}</option>)}</select>
        <select aria-label="السنة" value={month.slice(0,4)} onChange={event => setMonth(`${event.target.value}-${month.slice(5)}`)}>{Array.from({length:201},(_,index)=><option key={1900+index} value={1900+index}>{1900+index}</option>)}</select>
        <button type="button" className="icon-button" aria-label="الشهر السابق" onClick={() => navigate(-1)}><ChevronRight size={19}/></button><button type="button" className="icon-button" aria-label="الشهر التالي" onClick={() => navigate(1)}><ChevronLeft size={19}/></button>
      </div>
      <div className="date-picker-grid" role="grid" aria-label={month ? label(month,{month:"long",year:"numeric"}) : "التاريخ"}>
        {["س","ح","ن","ث","ر","خ","ج"].map((day,index)=><span key={index} role="columnheader">{day}</span>)}
        {dates.map(day => <button key={day} type="button" role="gridcell" aria-label={label(day,{dateStyle:"full"})} aria-selected={picked===day} className={`${day.slice(0,7)!==month.slice(0,7)?"outside":""} ${picked===day?"picked":""}`} disabled={Boolean((min&&day<min)||(max&&day>max))} onClick={()=>{setPicked(day);if(type==="date")commit(day);}} onKeyDown={event=>{const delta = ({ArrowLeft:1,ArrowRight:-1,ArrowUp:-7,ArrowDown:7} as Record<string,number>)[event.key];if(delta){event.preventDefault();const date=new Date(`${day}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+delta);const next=dayKey(date);if(next.slice(0,7)!==month.slice(0,7))setMonth(next.slice(0,7)+"-01");requestAnimationFrame(()=>dialog.current?.querySelector<HTMLButtonElement>(`[data-day="${next}"]`)?.focus());}}} data-day={day}>{Number(day.slice(8))}</button>)}
      </div>
      {type==="datetime-local"?<label className="date-picker-time">الوقت<input ref={timeInput} type="time" value={clock} onChange={event=>setClock(event.target.value)} /></label>:null}
      {error?<p className="form-notice error" role="alert">{error}</p>:null}
      <div className="date-picker-footer"><button type="button" className="text-button" onClick={()=>{const now=new Date();const date=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10);setMonth(date.slice(0,7)+"-01");setPicked(date);}}>اليوم</button>{!props.required?<button type="button" className="text-button" onClick={()=>commit("")}>مسح التاريخ</button>:null}{type==="datetime-local"?<button type="button" className="button button-primary" disabled={!picked||!clock} onClick={()=>commit(picked)}>تأكيد التاريخ</button>:null}</div>
    </dialog>, document.body) : null}</>;
}
