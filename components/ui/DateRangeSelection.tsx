"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addCalendarDays, calendarDateLabel, calendarMonthDays } from "../../lib/content-calendar";

/** Day-only range selection; shared by date-range surfaces without navigation. */
export function DateRangeSelection({ start, end, onApply }: {start:string;end?:string;onApply:(start:string,end:string)=>void}) {
  const [from,setFrom]=useState(start);
  const [to,setTo]=useState(end||start);
  const [month,setMonth]=useState(start.slice(0,7)+"-01");
  const [hover,setHover]=useState("");
  const days=calendarMonthDays(month);
  const last=to||hover;
  const lo=last&&last<from?last:from, hi=last&&last>from?last:from;
  const tooLong=Boolean(to&&Date.parse(to)-Date.parse(from)>365*86400000);
  function move(delta:number){const date=new Date(`${month}T12:00:00Z`);date.setUTCMonth(date.getUTCMonth()+delta);setMonth(date.toISOString().slice(0,10));}
  function pick(day:string){if(!from||to){setFrom(day);setTo("");}else{setFrom(day<from?day:from);setTo(day>from?day:from);}setHover("");}
  return <div className="date-range-selection">
    <div className="date-picker-navigation">
      <select aria-label="شهر الفترة" value={month.slice(5,7)} onChange={event=>setMonth(`${month.slice(0,4)}-${event.target.value}-01`)}>{Array.from({length:12},(_,i)=><option key={i} value={String(i+1).padStart(2,"0")}>{calendarDateLabel(`2026-${String(i+1).padStart(2,"0")}-01`,{month:"long"})}</option>)}</select>
      <select aria-label="سنة الفترة" value={month.slice(0,4)} onChange={event=>setMonth(`${event.target.value}-${month.slice(5)}`)}>{Array.from({length:101},(_,i)=><option key={i} value={2000+i}>{2000+i}</option>)}</select>
      <button type="button" className="icon-button" aria-label="الشهر السابق" onClick={()=>move(-1)}><ChevronRight size={19}/></button><button type="button" className="icon-button" aria-label="الشهر التالي" onClick={()=>move(1)}><ChevronLeft size={19}/></button>
    </div>
    <p className="date-range-caption" aria-live="polite">{from?calendarDateLabel(from):"اختر بداية الفترة"}{to&&to!==from?` — ${calendarDateLabel(to)}`:" · اختر يومًا أو بداية ونهاية الفترة"}</p>
    <div className="date-picker-grid date-range-grid" role="grid" aria-label="أيام الفترة" onPointerLeave={()=>setHover("")}>
      {["س","ح","ن","ث","ر","خ","ج"].map((day,i)=><span role="columnheader" key={i}>{day}</span>)}
      {days.map(day=><button type="button" role="gridcell" key={day} data-range-day={day} aria-label={calendarDateLabel(day,{dateStyle:"full"})} aria-selected={day>=from&&day<=(to||from)} className={`${day.slice(0,7)!==month.slice(0,7)?"outside":""} ${day>=lo&&day<=hi?"in-range":""} ${day===from||day===to?"picked":""}`} onPointerEnter={()=>{if(!to)setHover(day);}} onClick={()=>pick(day)} onKeyDown={event=>{const delta=({ArrowLeft:1,ArrowRight:-1,ArrowUp:-7,ArrowDown:7} as Record<string,number>)[event.key];if(delta){event.preventDefault();const next=addCalendarDays(day,delta);const root=event.currentTarget.closest(".date-range-selection");if(next.slice(0,7)!==month.slice(0,7))setMonth(next.slice(0,7)+"-01");requestAnimationFrame(()=>root?.querySelector<HTMLButtonElement>(`[data-range-day="${next}"]`)?.focus());}}}>{Number(day.slice(8))}</button>)}
    </div>
    {tooLong?<p role="alert">اختر فترة لا تزيد عن سنة.</p>:null}
    <div className="calendar-dialog-actions"><button type="button" className="button button-primary" disabled={!from||tooLong} onClick={()=>onApply(from,to===from?"":to)}>عرض المحتوى</button><button type="button" className="text-button" onClick={()=>{setFrom("");setTo("");setHover("");}}>اختيار جديد</button></div>
  </div>;
}
