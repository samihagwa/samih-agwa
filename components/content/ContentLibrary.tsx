"use client";
import { useState } from "react";
import { ArrowLeft, Search, SlidersHorizontal } from "lucide-react";
import type { Tables } from "../../lib/supabase/database.types";
import { contentFormatConfig, contentStepConfig } from "../../lib/content";
import { contentDeepLink } from "../../lib/deep-links";
import { formatDateTime } from "../../lib/date-time";
import { contentProgress, filterContent } from "../../lib/content-presentation";

export function ContentProgress({ tasks, status, compact = false }: { tasks: Tables<"tasks">[]; status: Tables<"content_items">["status"]; compact?: boolean }) {
  const progress = contentProgress(tasks, status);
  return <div className={`request-progress ${compact ? "compact" : ""}`}>
    <strong>{progress.percent}%</strong><span className="request-progress-track" role="progressbar" aria-label="تقدم تنفيذ الطلب" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}><span style={{ width: `${progress.percent}%` }} /></span>
    <small>{progress.done} من {progress.total} مكتمل</small>{!compact ? <span className="request-current">الخطوة الحالية: <b>{progress.current}</b></span> : null}
  </div>;
}

export function ContentLibrary({ items, tasks, view }: { items: Tables<"content_items">[]; tasks: Map<string, Tables<"tasks">[]>; view: string }) {
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const [page, setPage] = useState(1);
  const filtered = filterContent(items, view, search, stage, tasks);
  const pages = Math.max(1, Math.ceil(filtered.length / 15));
  const currentPage = Math.min(page, pages);
  const start = (currentPage - 1) * 15;
  const visiblePages = [...new Set([1, currentPage - 1, currentPage, currentPage + 1, pages])].filter((value) => value > 0 && value <= pages);
  return <>
    <div className="request-search"><label><Search size={17} /><input aria-label="ابحث عن طلب" placeholder="ابحث عن طلب..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></label>
      <button type="button" className="button button-secondary" aria-expanded={showFilter} onClick={() => setShowFilter(!showFilter)}><SlidersHorizontal size={16} /> تصفية{stage ? " (١)" : ""}</button>
      {showFilter ? <label>الخطوة الحالية<select aria-label="تصفية بالخطوة الحالية" value={stage} onChange={(e) => { setStage(e.target.value); setPage(1); }}><option value="">كل الخطوات</option>{Object.entries(contentStepConfig).map(([key, config]) => <option key={key} value={key}>{config.label}</option>)}</select></label> : null}
    </div>
    <div className="request-table-wrap"><table className="request-table"><thead><tr><th>الطلب</th><th>التقدم</th><th>الخطوة الحالية</th><th>موعد النشر</th><th><span className="sr-only">فتح الطلب</span></th></tr></thead>
      <tbody>{filtered.slice(start, start + 15).map((item) => <tr key={item.id}>
        <td><a className="request-title" href={contentDeepLink(item.id)}>{item.title}</a><small>{contentFormatConfig[item.format].label} · {item.platforms.join(" · ")}</small></td>
        <td><ContentProgress tasks={tasks.get(item.id) ?? []} status={item.status} compact /></td>
        <td className="request-stage">{contentProgress(tasks.get(item.id) ?? [], item.status).current}</td>
        <td><time dateTime={item.publish_at}>{formatDateTime(item.publish_at)}</time></td>
        <td><a className="button button-secondary" href={contentDeepLink(item.id)}>فتح الطلب <ArrowLeft size={14} /></a></td>
      </tr>)}</tbody></table>
      {!filtered.length ? <p className="request-empty">لا توجد طلبات مطابقة{search || stage ? "؛ جرّب تغيير البحث أو التصفية." : "."}</p> : null}
    </div>
    <nav className="request-pagination" aria-label="صفحات الطلبات"><span>عرض {filtered.length ? start + 1 : 0}–{Math.min(start + 15, filtered.length)} من {filtered.length}</span><div>
      <button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>السابق</button>
      {visiblePages.map((value, i) => <span key={value}>{i > 0 && value > visiblePages[i - 1] + 1 ? " … " : null}<button type="button" aria-label={`الصفحة ${value}`} aria-current={value === currentPage ? "page" : undefined} onClick={() => setPage(value)}>{value}</button></span>)}
      <button type="button" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>التالي</button>
    </div></nav>
  </>;
}
