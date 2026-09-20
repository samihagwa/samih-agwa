"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FileText } from "lucide-react";
import { getSupabaseBrowserClient } from "../../lib/supabase/client";
import type { SavedTeamReport, TeamActivityReport } from "../../lib/team-reports";
import { CenteredDialog } from "../ui/CenteredDialog";
import { Button } from "../ui/Button";
import { TeamReportView } from "./TeamReportView";

export function TeamReportInbox({ organizationId }: { organizationId: string }) {
  const search = useSearchParams(), reportId = search.get("report");
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [report, setReport] = useState<TeamActivityReport | null>(null), [items, setItems] = useState<SavedTeamReport[]>([]);
  const generation = useRef(0);
  const load = useCallback(async (id?: string) => {
    const request = ++generation.current; setOpen(true); setLoading(true); setError(""); setReport(null); setItems([]);
    const { data, error } = await getSupabaseBrowserClient().rpc("team_reports_command", { command: id ? "get" : "list", org: organizationId, payload: id ? { id } : {} });
    if (generation.current !== request) return;
    setLoading(false);
    if (error) setError("التقرير غير متاح لحسابك، أو خدمة التقارير لم تُفعّل بعد.");
    else if (id) setReport(data as unknown as TeamActivityReport);
    else setItems(data as unknown as SavedTeamReport[]);
  }, [organizationId]);
  useEffect(() => { if (!reportId || !/^[0-9a-f-]{36}$/i.test(reportId)) return; const timer = setTimeout(() => void load(reportId), 0); return () => clearTimeout(timer); }, [reportId, load]);
  return <><button type="button" className="report-inbox-button" title="تقاريري" aria-label="تقاريري" onClick={() => void load()}><FileText size={20} /></button>
    {open ? <CenteredDialog title="تقاريري" onClose={() => { generation.current++; setOpen(false); }}>
      {loading ? <p role="status">جارٍ تحميل التقرير…</p> : error ? <p role="alert">{error}</p> : report ? <><Button type="button" variant="ghost" onClick={() => void load()}>كل تقاريري</Button><TeamReportView report={report} /></> : <div className="report-inbox-list">{items.length ? items.map(item => <Button key={item.id} type="button" variant="secondary" onClick={() => void load(item.id)}>{item.cadence === "daily" ? "التقرير اليومي" : "التقرير الأسبوعي"} · {item.scope === "team" ? "الفريق" : "الشخصي"} · {item.period_start} — {item.period_end}</Button>) : <p>لا توجد تقارير مرسلة لك بعد. المالك يحدد المستلمين من الفريق والصلاحيات.</p>}</div>}
    </CenteredDialog> : null}
  </>;
}
