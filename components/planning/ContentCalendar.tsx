"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent } from "react";
import { AlertTriangle, CalendarDays, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, Clock3, ExternalLink, Filter, GripVertical, Plus, RefreshCw, X } from "lucide-react";
import { addCalendarDays, calendarDateLabel, calendarDay, calendarDropTime, calendarInstant, calendarLanes, calendarMinutes, calendarMonthDays, calendarState, calendarTime, calendarWall, calendarWeek, type CalendarEntry } from "../../lib/content-calendar";
import { contentFormatConfig, contentPlatformLabel } from "../../lib/content";
import { contentPlanItemKindConfig } from "../../lib/planning";
import { Button } from "../ui/Button";
import { StatusBadge } from "../ui/StatusBadge";

export type CalendarDetails = { progress: number; done: number; total: number; current: string; owner: string; fileUrl: string | null; requestUrl: string; loading?: boolean; error?: string };
type Props = {
  entries: CalendarEntry[]; canEdit: boolean; working: boolean; error: string | null; notice: string | null;
  details: CalendarDetails | null; selectedKey: string | null; undoAvailable: boolean;
  onSelect: (key: string | null) => void; onMove: (entry: CalendarEntry, time: string | null) => Promise<boolean>;
  onUndo: () => void; onRefresh: () => void; onCreate: () => void;
};
const HOUR_HEIGHT = 72;
const hours = Array.from({ length: 24 }, (_, index) => index);
type Drag = { key: string; offset: number };

function kindLabel(kind: string) {
  return contentFormatConfig[kind as keyof typeof contentFormatConfig]?.label ?? contentPlanItemKindConfig[kind as keyof typeof contentPlanItemKindConfig]?.label ?? "محتوى";
}

export function ContentCalendar({ entries, canEdit, working, error, notice, details, selectedKey, undoAvailable, onSelect, onMove, onUndo, onRefresh, onCreate }: Props) {
  const [anchor, setAnchor] = useState(() => calendarDay(new Date()));
  const [view, setView] = useState<"week" | "month" | "list">("week");
  const [filterOpen, setFilterOpen] = useState(false);
  const [platform, setPlatform] = useState("");
  const [product, setProduct] = useState("");
  const [state, setState] = useState("");
  const [search, setSearch] = useState("");
  const [showUnscheduled, setShowUnscheduled] = useState(false);
  const [moving, setMoving] = useState<CalendarEntry | null>(null);
  const [timeValue, setTimeValue] = useState("");
  const [localError, setLocalError] = useState("");
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dropPreview, setDropPreview] = useState<{ day: string; minutes: number } | null>(null);
  const [touchGhost, setTouchGhost] = useState<{ x: number; y: number; title: string } | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const touchDrag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const weekStart = calendarWeek(anchor);
  const week = Array.from({ length: 7 }, (_, index) => addCalendarDays(weekStart, index));
  const month = calendarMonthDays(anchor);
  const selected = entries.find((entry) => entry.key === selectedKey) ?? null;
  const related = selected ? entries.filter((entry) => entry.source === selected.source && entry.sourceId === selected.sourceId) : [];
  const filtered = useMemo(() => entries.filter((entry) => (!platform || entry.platform === platform) && (!product || entry.product === product) && (!state || calendarState(entry).tone === state) && (!search.trim() || entry.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))), [entries, platform, product, state, search]);
  const unscheduled = filtered.filter((entry) => !entry.scheduledAt);
  const inWeek = filtered.filter((entry) => entry.scheduledAt && week.includes(calendarDay(entry.scheduledAt)));
  const platforms = [...new Set(entries.map((entry) => entry.platform))];
  const products = [...new Set(entries.map((entry) => entry.product))];

  useEffect(() => { if (scroll.current && view === "week") scroll.current.scrollTop = HOUR_HEIGHT * 10; }, [view]);
  useEffect(() => { if (moving) dialog.current?.showModal(); else dialog.current?.close(); }, [moving]);
  function openMove(entry: CalendarEntry) { setLocalError(""); setTimeValue(entry.scheduledAt ? calendarWall(entry.scheduledAt) : `${anchor}T18:00`); setMoving(entry); }
  function changeRange(direction: number) {
    if (view !== "month") { setAnchor(addCalendarDays(anchor, direction * 7)); return; }
    const date = new Date(`${anchor.slice(0, 7)}-01T12:00:00Z`); date.setUTCMonth(date.getUTCMonth() + direction); setAnchor(date.toISOString().slice(0, 10));
  }
  function clearDrag() { setDrag(null); setDropPreview(null); setTouchGhost(null); touchDrag.current = null; }
  function targetAt(target: HTMLElement, clientY: number, item: Drag) {
    const day = target.dataset.calendarDay!;
    const original = entries.find((entry) => entry.key === item.key);
    const minutes = target.dataset.calendarTimed ? Math.round(((clientY - target.getBoundingClientRect().top) / HOUR_HEIGHT * 60 - item.offset) / 15) * 15 : original?.scheduledAt ? calendarMinutes(original.scheduledAt) : 18 * 60;
    return { day, minutes: Math.max(0, Math.min(1425, minutes)) };
  }
  async function finishDrop(item: Drag, target: { day: string; minutes: number }) {
    const entry = entries.find((value) => value.key === item.key);
    const instant = calendarDropTime(target.day, target.minutes);
    clearDrag();
    if (!entry || !canEdit || !entry.editable || working) return;
    if (!instant) { setLocalError("الساعة المختارة غير متاحة بسبب تغيير التوقيت الصيفي. اختار ساعة أخرى."); return; }
    await onMove(entry, instant);
  }
  function nativeDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    if (drag) void finishDrop(drag, targetAt(event.currentTarget, event.clientY, drag));
  }
  function touchMove(event: PointerEvent<HTMLButtonElement>) {
    if (!touchDrag.current) return;
    const item = entries.find((entry) => entry.key === touchDrag.current!.key);
    setTouchGhost({ x: event.clientX, y: event.clientY, title: item?.title ?? "" });
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-calendar-day]");
    if (target) setDropPreview(targetAt(target, event.clientY, touchDrag.current));
    else setDropPreview(null);
    const scroller = scroll.current;
    if (scroller) { const rect = scroller.getBoundingClientRect(); if (event.clientY > rect.bottom - 50) scroller.scrollTop += 15; else if (event.clientY < rect.top + 50) scroller.scrollTop -= 15; }
  }
  function card(entry: CalendarEntry, compact = false) {
    const status = calendarState(entry);
    const editable = canEdit && entry.editable && !working;
    return <article key={entry.key} className={`calendar-event ${status.tone} ${selectedKey === entry.key ? "selected" : ""} ${drag?.key === entry.key ? "dragging" : ""} ${compact ? "compact" : ""}`} draggable={editable}
      onDragStart={(event) => { if (!editable) { event.preventDefault(); return; } const item = { key: entry.key, offset: Math.max(0, (event.clientY - event.currentTarget.getBoundingClientRect().top) / HOUR_HEIGHT * 60) }; event.dataTransfer.setData("text/plain", entry.key); event.dataTransfer.effectAllowed = "move"; setDrag(item); }} onDragEnd={clearDrag}>
      <button type="button" className="calendar-event-open" onClick={() => { onSelect(entry.key); if(window.matchMedia("(max-width:950px)").matches)requestAnimationFrame(()=>document.querySelector(".calendar-detail")?.scrollIntoView({block:"start"})); }} aria-label={`${entry.title} — ${contentPlatformLabel(entry.platform)} — ${entry.scheduledAt ? calendarTime(entry.scheduledAt) : "بدون موعد"}`}>
        <span className="calendar-event-top"><time>{entry.scheduledAt ? calendarTime(entry.scheduledAt) : "بدون موعد"}</time><span>{kindLabel(entry.kind)}</span></span>
        <strong>{entry.title}</strong><span className="calendar-platform">{contentPlatformLabel(entry.platform)}</span>
        <span className={`calendar-state ${status.tone}`}>{status.tone === "success" ? <CheckCircle2 size={12} /> : <Clock3 size={12} />}{status.label}</span>
      </button>
      {editable ? <div className="calendar-event-actions"><button className="calendar-drag-handle" type="button" aria-label={`سحب ${entry.title}؛ أو اضغط لتغيير الموعد`} onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } if (!touchDrag.current) openMove(entry); }}
        onPointerDown={(event) => { if (event.pointerType === "mouse") return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); touchDrag.current = { key: entry.key, offset: 0 }; setDrag(touchDrag.current); }}
        onPointerMove={touchMove} onPointerUp={(event) => { const item = touchDrag.current; if (!item) return; suppressClick.current = true; event.preventDefault(); const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-calendar-day]"); if (target) void finishDrop(item, targetAt(target, event.clientY, item)); else { clearDrag(); openMove(entry); } }} onPointerCancel={clearDrag}><GripVertical size={15} /></button>
        <button type="button" className="calendar-move-link" onClick={() => openMove(entry)} aria-label={`تغيير موعد ${entry.title}`}><CalendarClock size={13} /></button></div> : null}
    </article>;
  }

  function agenda() {
    return <div className="calendar-agenda">{(view === "month" ? month.filter((day) => day.slice(0,7) === anchor.slice(0,7)) : week).map((day) => <section key={day} data-calendar-day={day} onDragOver={(event) => { if (drag) { event.preventDefault(); setDropPreview(targetAt(event.currentTarget, event.clientY, drag)); } }} onDrop={nativeDrop} className={`${dropPreview?.day === day ? "calendar-drop-day" : ""} ${!filtered.some((entry)=>entry.scheduledAt&&calendarDay(entry.scheduledAt)===day)?"calendar-empty-section":""}`}>
      <h3>{calendarDateLabel(day)}{day === calendarDay(new Date()) ? <span>اليوم</span> : null}</h3>
      {filtered.filter((entry) => entry.scheduledAt && calendarDay(entry.scheduledAt) === day).map((entry) => card(entry))}
      {!filtered.some((entry) => entry.scheduledAt && calendarDay(entry.scheduledAt) === day) ? <p className="calendar-empty-day">لا يوجد محتوى مجدول</p> : null}
    </section>)}</div>;
  }
  return <section className="content-calendar-desk">
    <header className="calendar-heading"><div><h1>تقويم المحتوى</h1><p>كل المحتوى ومواعيد نشره في مكان واحد</p></div><div className="toolbar-actions"><button className="icon-button" aria-label="تحديث التقويم" type="button" disabled={working} onClick={onRefresh}><RefreshCw size={18} /></button>{canEdit ? <Button type="button" disabled={working} onClick={onCreate}><Plus size={16} /> إضافة محتوى</Button> : null}</div></header>
    <div className="calendar-controls"><div className="segmented-control" aria-label="طريقة عرض التقويم">{([['week','أسبوع'],['month','شهر'],['list','قائمة']] as const).map(([key,label]) => <button key={key} type="button" aria-pressed={view===key} className={view===key ? "active" : ""} onClick={() => { setView(key); clearDrag(); }}>{label}</button>)}</div>
      <div className="calendar-range"><button className="icon-button" type="button" aria-label="الفترة السابقة" onClick={() => changeRange(-1)}><ChevronRight size={18} /></button><strong>{view === "month" ? calendarDateLabel(anchor,{month:"long",year:"numeric"}) : `${calendarDateLabel(week[0],{day:"numeric"})} – ${calendarDateLabel(week[6],{day:"numeric",month:"long",year:"numeric"})}`}</strong><button className="icon-button" type="button" aria-label="الفترة التالية" onClick={() => changeRange(1)}><ChevronLeft size={18} /></button><button className="text-button" type="button" onClick={() => setAnchor(calendarDay(new Date()))}>اليوم</button></div>
      <div className="calendar-filters-toggle"><small>توقيت القاهرة</small><Button variant="secondary" type="button" onClick={() => setFilterOpen(!filterOpen)} aria-expanded={filterOpen}><Filter size={15} />تصفية{[platform,product,state,search].filter(Boolean).length ? ` (${[platform,product,state,search].filter(Boolean).length})` : ""}</Button></div></div>
    {filterOpen ? <div className="calendar-filters"><label>بحث<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="عنوان المحتوى" /></label><label>المنصة<select value={platform} onChange={(event) => setPlatform(event.target.value)}><option value="">كل المنصات</option>{platforms.map((value) => <option key={value} value={value}>{contentPlatformLabel(value)}</option>)}</select></label><label>المنتج / الخطة<select value={product} onChange={(event) => setProduct(event.target.value)}><option value="">كل الخطط</option>{products.map((value) => <option key={value}>{value}</option>)}</select></label><label>التجهيز<select value={state} onChange={(event) => setState(event.target.value)}><option value="">كل الحالات</option><option value="neutral">مخطط</option><option value="warning">قيد التجهيز</option><option value="success">جاهز / منشور</option></select></label><button type="button" className="text-button" onClick={() => { setPlatform(""); setProduct(""); setState(""); setSearch(""); }}>إزالة الفلاتر</button></div> : null}
    {error || localError ? <p className="form-notice error" role="alert">{error || localError}</p> : null}
    {notice ? <div className="calendar-save-notice" role="status">{working ? <RefreshCw size={14} /> : <CheckCircle2 size={14} />}{notice}{undoAvailable ? <button type="button" className="text-button" disabled={working} onClick={onUndo}>تراجع عن النقل</button> : null}</div> : null}
    <div className={`calendar-layout ${selected ? "with-details" : ""}`}>
      <div className="calendar-main">
        {view === "week" ? <div className="calendar-desktop-week"><div className="calendar-week-header"><span /><div>{week.map((day) => <div key={day} className={day === calendarDay(new Date()) ? "today" : ""}><strong>{calendarDateLabel(day,{weekday:"long"})}</strong><span>{calendarDateLabel(day,{day:"numeric",month:"short"})}</span></div>)}</div></div>
          <div className="calendar-time-scroll" ref={scroll}><div className="calendar-time-grid"><div className="calendar-hours">{hours.map((hour) => <span key={hour} style={{top:hour*HOUR_HEIGHT}}>{String(hour).padStart(2,"0")}:00</span>)}</div><div className="calendar-columns">{week.map((day) => {
            const daily = inWeek.filter((entry) => calendarDay(entry.scheduledAt!) === day);
            const lanes = calendarLanes(daily);
            return <div key={day} className="calendar-day-column" data-calendar-day={day} data-calendar-timed="true" onDragOver={(event) => { if (!drag) return; event.preventDefault(); event.dataTransfer.dropEffect="move"; setDropPreview(targetAt(event.currentTarget,event.clientY,drag)); const rect=scroll.current?.getBoundingClientRect(); if(rect&&scroll.current){if(event.clientY>rect.bottom-45) scroll.current.scrollTop+=18; else if(event.clientY<rect.top+45) scroll.current.scrollTop-=18;} }} onDrop={nativeDrop}>
              {daily.map((entry,index) => { const minute=calendarMinutes(entry.scheduledAt!); const {lane,count}=lanes.get(entry.key)!; return <div className="calendar-positioned-event" key={entry.key} style={{top:minute/60*HOUR_HEIGHT, insetInlineStart:`calc(${lane/count*100}% + 3px)`,width:`calc(${100/count}% - 6px)`,zIndex:index+1}}>{card(entry,true)}</div>; })}
              {dropPreview?.day===day ? <div className="calendar-drop-line" style={{top:dropPreview.minutes/60*HOUR_HEIGHT}}><span>{String(Math.floor(dropPreview.minutes/60)).padStart(2,"0")}:{String(dropPreview.minutes%60).padStart(2,"0")}</span></div> : null}
            </div>;
          })}</div></div></div></div> : null}
        {view === "month" ? <div className="calendar-month"><div className="calendar-month-weekdays">{week.map((day) => <strong key={day}>{calendarDateLabel(day,{weekday:"short"})}</strong>)}</div><div className="calendar-month-grid">{month.map((day) => <section key={day} data-calendar-day={day} className={`${day.slice(0,7)!==anchor.slice(0,7)?"other-month":""} ${dropPreview?.day===day?"calendar-drop-day":""}`} onDragOver={(event) => {if(drag){event.preventDefault();setDropPreview(targetAt(event.currentTarget,event.clientY,drag));}}} onDrop={nativeDrop}><button className="calendar-day-number" type="button" onClick={() => {setAnchor(day);setView("list");}}>{calendarDateLabel(day,{day:"numeric"})}</button>{filtered.filter((entry) => entry.scheduledAt&&calendarDay(entry.scheduledAt)===day).map((entry)=>card(entry,true))}</section>)}</div></div> : null}
        <div className={view === "list" ? "" : "calendar-mobile-agenda"}>{agenda()}</div>
        {!filtered.length ? <p className="calendar-empty" role="status"><CalendarDays size={22} />{entries.length ? "لا توجد نتائج مطابقة للفلاتر." : "التقويم جاهز. أضف أول محتوى أو حدد موعدًا لطلب موجود."}</p> : null}
        <section className="calendar-unscheduled"><button type="button" className="text-button" aria-expanded={showUnscheduled} onClick={() => setShowUnscheduled(!showUnscheduled)}>محتوى بدون موعد ({unscheduled.length}) <ChevronLeft size={15}/></button>{showUnscheduled ? <div className="calendar-unscheduled-list">{unscheduled.map((entry)=>card(entry))}{!unscheduled.length ? <small>كل المحتوى له موعد نشر.</small>:null}</div>:null}</section>
      </div>
      {selected ? <aside className="calendar-detail" aria-label="تفاصيل المحتوى"><header><strong>تفاصيل المحتوى</strong><button className="icon-button" type="button" aria-label="إغلاق التفاصيل" onClick={() => onSelect(null)}><X size={19}/></button></header><h2>{selected.title}</h2><p>{kindLabel(selected.kind)} · {selected.product}</p><StatusBadge tone={calendarState(selected).tone}>{calendarState(selected).label}</StatusBadge>
        <h3>مواعيد النشر</h3><div className="calendar-platform-times">{related.map((entry)=><div key={entry.key}><strong>{contentPlatformLabel(entry.platform)}</strong><span>{entry.scheduledAt?`${calendarDateLabel(calendarDay(entry.scheduledAt))} · ${calendarTime(entry.scheduledAt)}`:"بدون موعد"}</span>{canEdit&&entry.editable?<button className="text-button" type="button" disabled={working} onClick={()=>openMove(entry)}>تغيير الموعد</button>:null}</div>)}</div>
        {details?.loading ? <p role="status">جارٍ تحميل تفاصيل التنفيذ...</p> : details?.error ? <p role="alert">{details.error}</p> : details ? <><h3>حالة التجهيز</h3><div className="calendar-progress" role="progressbar" aria-valuenow={details.progress} aria-valuemin={0} aria-valuemax={100} aria-label="تقدم التنفيذ"><span style={{width:`${details.progress}%`}}/></div><small>{details.total ? `${details.done} من ${details.total} خطوات مكتملة` : "لم تُنشأ مهام تنفيذ بعد"}</small>{details.current&&selected.status!=="published"?<p className="calendar-readiness"><AlertTriangle size={16}/>{details.current}</p>:null}<Button href={details.requestUrl} variant="secondary">{selected.contentId?"فتح طلب التنفيذ":"فتح بند الخطة"}<ExternalLink size={15}/></Button>{details.fileUrl?<a className="button button-ghost" href={details.fileUrl} target="_blank" rel="noopener noreferrer">فتح ملف الفيديو <ExternalLink size={15}/></a>:null}<p className="calendar-owner">مسؤول النشر: {details.owner}</p></>:null}
      </aside>:null}
    </div>
    {canEdit?<p className="calendar-hint"><GripVertical size={14}/> اسحب الكارت لتغيير الموعد، أو استخدم زر تغيير الموعد. كل منصة مستقلة؛ مواعيد مهام التنفيذ لا تتغير.</p>:null}
    {touchGhost?<div className="calendar-touch-ghost" style={{left:touchGhost.x,top:touchGhost.y}}>{touchGhost.title}</div>:null}
<dialog ref={dialog} className="calendar-move-dialog" onCancel={(event)=>{if(working)event.preventDefault();else setMoving(null);}} onClose={()=>setMoving(null)}><form onSubmit={async(event)=>{event.preventDefault();if(!moving||working)return;const submittedTime=String(new FormData(event.currentTarget).get("scheduledTime") ?? "");setTimeValue(submittedTime);const instant=calendarInstant(submittedTime);if(!instant){setLocalError("الوقت غير صالح بتوقيت القاهرة. اختار ساعة أخرى.");return;}if(await onMove(moving,instant))setMoving(null);}}><header><h2>تغيير الموعد</h2><button className="icon-button" type="button" aria-label="إغلاق" disabled={working} onClick={()=>setMoving(null)}><X size={18}/></button></header><strong>{moving?.title}</strong><p>{moving?contentPlatformLabel(moving.platform):""} فقط</p><label>التاريخ والساعة — القاهرة<input name="scheduledTime" type="datetime-local" value={timeValue} onChange={(event)=>{setLocalError("");setTimeValue(event.target.value);}} required/></label>{localError||error?<p className="form-notice error" role="alert">{localError||error}</p>:null}<div className="calendar-dialog-actions"><Button type="submit" disabled={working}>{working?"جارٍ الحفظ…":"حفظ الموعد"}</Button><Button variant="ghost" type="button" disabled={working} onClick={()=>setMoving(null)}>إلغاء</Button></div>{moving?.scheduledAt?<button className="text-button" type="button" disabled={working} onClick={async()=>{if(moving&&await onMove(moving,null))setMoving(null);}}>نقل إلى محتوى بدون موعد</button>:null}</form></dialog>
  </section>;
}
