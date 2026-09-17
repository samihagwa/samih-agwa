"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDownUp, CalendarDays, ChevronLeft, ChevronRight, FileText, Columns3, GripVertical, MoreHorizontal, Plus, Search, SlidersHorizontal, Table2 } from "lucide-react";
import type { Tables } from "../../lib/supabase/database.types";
import { scriptContentKindConfig, type ScriptContentKind, type WritableScriptStage } from "../../lib/scripts";
import { ScriptStatusControl } from "./ScriptStatusControl";
import { Button } from "../ui/Button";
import { StatusBadge } from "../ui/StatusBadge";

type Script = Tables<"scripts">;
type Task = Tables<"tasks">;
type Stage = "idea" | "draft" | "ready_to_record" | "production" | "recorded" | "ready_to_publish" | "published" | "archived";
type Filter = "active" | Stage | "all";
type Props = {
  scripts: Script[]; tasks: Task[]; userId: string; canWrite: boolean; search: string;
  onSearch: (value: string) => void; filters: { value: Filter; label: string }[];
  statusFilter: Filter; onFilter: (value: Filter) => void; counts: Map<Filter, number>;
  stageOf: (script: Script, tasks: Task[]) => Stage;
  statusOf: (script: Script, tasks: Task[]) => { label: string; tone: "neutral" | "success" | "warning" | "info" | "danger" };
  workingId: string | null;
  onStatus: (script: Script, status: WritableScriptStage) => Promise<void>;
  onDelete: (script: Script) => Promise<void>;
  onCreate: (stage?: WritableScriptStage) => void; createForm: ReactNode; ideaItems?: ReactNode;
};

const pageSize = 15;
const dateLabel = (value: string) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));

// Domain-specific presentation only. All writes keep the existing server commands and RLS.
export function ScriptLibrary(props: Props) {
  const [view, setView] = useState<"table" | "board" | "calendar">("table");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropStage, setDropStage] = useState<string | null>(null);
  const [boardNotice, setBoardNotice] = useState("");
  const [kind, setKind] = useState("");
  const [sort, setSort] = useState("updated");
  const [page, setPage] = useState(1);
  const [openRow, setOpenRow] = useState<string | null>(null);
  useEffect(() => {
    if (!openRow) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpenRow(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [openRow]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const rows = useMemo(() => props.scripts.filter((script) => !kind || script.content_kind === kind).sort((a, b) =>
    sort === "title" ? a.title.localeCompare(b.title, "ar") : sort === "oldest"
      ? a.updated_at.localeCompare(b.updated_at) : b.updated_at.localeCompare(a.updated_at)), [props.scripts, kind, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pages);
  const start = (currentPage - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);
  const changeView = (next: typeof view) => { setView(next); setOpenRow(null); setPage(1); };
  const activeFilterCount = Number(props.statusFilter !== "active") + Number(Boolean(kind));
  const groups = props.filters.filter((filter) => !["active", "all"].includes(filter.value));
  function canDrop(script: Script, stage: string) {
    return props.canWrite && script.assigned_to === props.userId && !props.workingId
      && ["idea", "draft", "ready_to_record", "archived"].includes(stage)
      && (!script.content_item_id || stage === "archived")
      && (stage !== "ready_to_record" || script.spoken_script.trim().length >= 20);
  }
  const statusControl = (script: Script) => props.canWrite && script.assigned_to === props.userId
    ? <ScriptStatusControl script={script} label={props.statusOf(script, props.tasks).label} disabled={Boolean(props.workingId)} onChange={(stage) => void props.onStatus(script, stage)} />
    : <StatusBadge tone={props.statusOf(script, props.tasks).tone}>{props.statusOf(script, props.tasks).label}</StatusBadge>;
  function table(scripts: Script[]) {
    return <table className="script-library-table">
      <thead><tr><th scope="col">#</th><th scope="col">عنوان السكريبت</th><th scope="col">النوع</th><th scope="col">الحالة</th><th scope="col">المدة</th><th scope="col">آخر تعديل</th><th scope="col"><span className="sr-only">إجراءات</span></th></tr></thead>
      <tbody>{scripts.map((script) => {
        const own = props.canWrite && script.assigned_to === props.userId;
        const busy = props.workingId === script.id;
        return <tr key={script.id} data-stage={props.stageOf(script, props.tasks)}>
          <td className="script-row-number" dir="ltr">{rows.findIndex((row) => row.id === script.id) + 1}</td>
          <td className="script-row-title"><a href={`/scripts/${script.id}`}><FileText size={17} /><span>{script.title}</span></a>{script.assigned_to !== props.userId ? <small>مشاركة للمراجعة</small> : null}</td>
          <td className="script-row-kind">{scriptContentKindConfig[script.content_kind as ScriptContentKind] ?? script.content_kind}</td>
          <td className="script-row-status">{statusControl(script)}</td>
          <td className="script-row-duration" dir="ltr">{script.duration_seconds}s</td>
          <td className="script-row-date" dir="ltr">{dateLabel(script.updated_at)}</td>
          <td className="script-row-actions">
            <button type="button" className="script-row-menu-button" aria-label={`إجراءات ${script.title}`} aria-expanded={openRow === script.id} onClick={() => setOpenRow(openRow === script.id ? null : script.id)}><MoreHorizontal size={20} /></button>
            {openRow === script.id ? <div className="script-row-menu" role="group" aria-label="إجراءات السكريبت">
              <a href={`/scripts/${script.id}`}>فتح السكريبت</a>
              {own && script.status === "draft" && script.spoken_script.trim().length >= 20 ? <button type="button" disabled={busy} onClick={() => { setOpenRow(null); void props.onStatus(script, "ready_to_record"); }}>جاهز للتصوير</button> : null}
              {own && (script.status === "ready_to_record" || (script.status === "archived" && !script.content_item_id)) ? <button type="button" disabled={busy} onClick={() => { setOpenRow(null); void props.onStatus(script, "draft"); }}>إرجاع للكتابة</button> : null}
              {own && script.status !== "archived" ? <button type="button" disabled={busy} onClick={() => { setOpenRow(null); void props.onStatus(script, "archived"); }}>أرشفة</button> : null}
              {own && script.status === "archived" && !script.content_item_id ? <button type="button" className="danger-text" disabled={busy} onClick={() => { setOpenRow(null); void props.onDelete(script); }}>حذف نهائي</button> : null}
              <button type="button" onClick={() => setOpenRow(null)}>إغلاق</button>
            </div> : null}
          </td>
        </tr>;
      })}</tbody>
    </table>;
  }
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  return <div className="script-library">
    <header className="script-library-heading"><h1>السكريبتات</h1>{props.canWrite ? <Button type="button" onClick={() => props.onCreate()}><Plus size={17} /> جديد</Button> : null}</header>
    <div className="script-library-toolbar">
      <div className="script-view-tabs" role="group" aria-label="طريقة العرض">
        <button type="button" aria-pressed={view === "table"} onClick={() => changeView("table")}><Table2 size={17} /> جدول</button>
        <button type="button" aria-pressed={view === "board"} onClick={() => changeView("board")}><Columns3 size={17} /> بورد</button>
        <button type="button" aria-pressed={view === "calendar"} onClick={() => changeView("calendar")}><CalendarDays size={17} /> التقويم</button>
      </div>
      <div className="script-library-controls">
        <label className="search-field"><Search size={16} /><input aria-label="ابحث عن سكريبت" value={props.search} onChange={(event) => { props.onSearch(event.target.value); setPage(1); }} placeholder="ابحث عن سكريبت…" /></label>
        <Button type="button" variant="secondary" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={16} /> تصفية{activeFilterCount ? ` (${activeFilterCount})` : ""}</Button>
        <label className="script-sort"><ArrowDownUp size={16} /><span className="sr-only">ترتيب السكريبتات</span><select aria-label="ترتيب السكريبتات" value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}><option value="updated">الأحدث</option><option value="oldest">الأقدم</option><option value="title">العنوان</option></select></label>
      </div>
    </div>
    {filtersOpen ? <div className="script-library-filters">
      <label>الحالة<select value={props.statusFilter} onChange={(event) => { props.onFilter(event.target.value as Filter); setPage(1); }}>{props.filters.map((filter) => <option key={filter.value} value={filter.value}>{filter.label} ({props.counts.get(filter.value) ?? 0})</option>)}</select></label>
      <label>النوع<select value={kind} onChange={(event) => { setKind(event.target.value); setPage(1); }}><option value="">كل الأنواع</option>{Object.entries(scriptContentKindConfig).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <Button type="button" variant="ghost" onClick={() => { setKind(""); props.onFilter("active"); setPage(1); }}>إزالة التصفية</Button>
    </div> : null}
    {props.statusFilter !== "active" || kind ? <div className="script-filter-summary">{props.filters.find((filter) => filter.value === props.statusFilter)?.label}{kind ? ` · ${scriptContentKindConfig[kind as ScriptContentKind]}` : ""}</div> : null}
    {view === "board" ? <>
      <p className="script-board-help">اسحب الكارت بين مراحل الكتابة، أو اضغط على حالته. مراحل التنفيذ والنشر تتحدث من المهام.</p>
      <span className="sr-only" role="status">{boardNotice}</span>
      <div className="script-board" aria-label="بورد السكريبتات">{groups.filter((group) => group.value !== "archived" || ["all", "archived"].includes(props.statusFilter)).map((group) => {
        const matches = rows.filter((script) => props.stageOf(script, props.tasks) === group.value);
        const dragged = rows.find((script) => script.id === dragId);
        const editable = ["idea", "draft", "ready_to_record"].includes(group.value);
        return <section key={group.value} className="script-board-column" data-stage={group.value} data-drop={dropStage === group.value || undefined}
          onDragOver={(event) => { if (dragged && canDrop(dragged, group.value)) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropStage(group.value); } }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropStage(null); }}
          onDrop={(event) => { event.preventDefault(); setDropStage(null); setDragId(null); const script = rows.find((item) => item.id === event.dataTransfer.getData("application/x-script-id")); if (script && canDrop(script, group.value) && props.stageOf(script, props.tasks) !== group.value) { void props.onStatus(script, group.value as WritableScriptStage); setBoardNotice(`جارٍ نقل ${script.title} إلى ${group.label}`); } }}>
          <header><h2>{group.label}</h2><span>{matches.length}</span></header>
          <div className="script-board-cards">{matches.map((script) => <article className="script-board-card" key={script.id}>
            <div className="script-board-card-title"><span className="script-drag-handle" draggable={canDrop(script, "archived")} role="img" aria-label="مقبض السحب؛ لتغيير الحالة بدون سحب استخدم قائمة الحالة"
              onDragStart={(event) => { event.dataTransfer.setData("application/x-script-id", script.id); event.dataTransfer.effectAllowed = "move"; setDragId(script.id); }} onDragEnd={() => { setDragId(null); setDropStage(null); }}><GripVertical size={18} /></span><a href={`/scripts/${script.id}`}>{script.title}</a></div>
            {statusControl(script)}
            {script.content_item_id ? <a className="script-board-execution" href={`/content?content=${script.content_item_id}`}>فتح التنفيذ</a> : null}
          </article>)}{group.value === "idea" ? props.ideaItems : null}</div>
          {props.canWrite && editable ? <button type="button" className="script-inline-add" onClick={() => props.onCreate(group.value as WritableScriptStage)}><Plus size={16} /> صفحة جديدة</button> : null}
        </section>;
      })}</div>
    </> : view === "calendar" ? <section className="script-calendar" aria-label="تقويم آخر تعديل">
      <header><h2>{new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(month)}</h2><span>حسب آخر تعديل — ليس موعد النشر</span><Button type="button" variant="ghost" aria-label="الشهر السابق" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronRight size={18} /></Button><Button type="button" variant="ghost" aria-label="الشهر التالي" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronLeft size={18} /></Button></header>
      <div className="script-calendar-grid">{["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"].map((day) => <strong key={day}>{day}</strong>)}
        {Array.from({ length: month.getDay() }, (_, index) => <div className="script-calendar-blank" key={`blank-${index}`} />)}
        {Array.from({ length: daysInMonth }, (_, index) => <div className="script-calendar-day" key={index}><time>{index + 1}</time>{rows.filter((script) => { const date = new Date(script.updated_at); return date.getFullYear() === month.getFullYear() && date.getMonth() === month.getMonth() && date.getDate() === index + 1; }).map((script) => <a key={script.id} href={`/scripts/${script.id}`}>{script.title}</a>)}</div>)}
      </div>
    </section> : <div className="script-library-results">
      {rows.length ? table(pageRows) : <p className="script-library-empty">لا توجد سكريبتات مطابقة. أضف فكرة أو غيّر التصفية.</p>}
      {props.ideaItems}
    </div>}
    {props.createForm || (props.canWrite && view !== "board" ? <button type="button" className="script-inline-add" onClick={() => props.onCreate()}><Plus size={18} /> سكريبت جديد <span>اكتب فكرة وابدأ…</span></button> : null)}
    {view === "table" ? <footer className="script-pagination"><span dir="ltr">{rows.length ? start + 1 : 0}–{Math.min(start + pageSize, rows.length)} / {rows.length}</span><div><Button type="button" variant="ghost" aria-label="الصفحة السابقة" disabled={currentPage === 1} onClick={() => { setPage(currentPage - 1); setOpenRow(null); }}><ChevronRight size={18} /></Button><span dir="ltr">{currentPage} / {pages}</span><Button type="button" variant="ghost" aria-label="الصفحة التالية" disabled={currentPage === pages} onClick={() => { setPage(currentPage + 1); setOpenRow(null); }}><ChevronLeft size={18} /></Button></div></footer> : null}
  </div>;
}
