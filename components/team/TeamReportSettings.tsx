"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, LoaderCircle, Settings2 } from "lucide-react";
import { getSupabaseBrowserClient } from "../../lib/supabase/client";
import type { Json } from "../../lib/supabase/database.types";
import { cairoReportDay, shiftReportDay, type ReportSettings, type ReportRecipient, type TeamActivityReport } from "../../lib/team-reports";
import { Button } from "../ui/Button";
import { DateInput } from "../ui/DateInput";
import { TeamReportView } from "./TeamReportView";
type Person = { id: string; name: string; role: string };

export function TeamReportSettings({ organizationId, people }: { organizationId: string; people: Person[] }) {
  const [config, setConfig] = useState<ReportSettings | null>(null);
  const [editing, setEditing] = useState(false), [working, setWorking] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [start, setStart] = useState(() => shiftReportDay(cairoReportDay(), -1));
  const [end, setEnd] = useState(() => shiftReportDay(cairoReportDay(), -1));
  const [report, setReport] = useState<TeamActivityReport | null>(null);
  const inFlight = useRef(false);
  const load = useCallback(async () => {
    const { data, error } = await getSupabaseBrowserClient().rpc("team_reports_command", { command: "settings", org: organizationId });
    if (error) setError("إعداد التقارير غير متاح بعد. يلزم نشر تحديث قاعدة البيانات أولًا.");
    else { setError(""); setConfig(data as unknown as ReportSettings); }
  }, [organizationId]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);
  async function run(command: "save" | "preview") {
    if (inFlight.current || !config) return;
    inFlight.current = true; setWorking(true); setError(""); setNotice("");
    try {
      const { data, error } = await getSupabaseBrowserClient().rpc("team_reports_command", {
        command, org: organizationId, payload: (command === "save" ? config : { start, end }) as unknown as Json,
      });
      if (error) throw error;
      if (command === "save") { setConfig({ ...data as unknown as ReportSettings, scheduler_available: config.scheduler_available }); setNotice("تم حفظ إعدادات التقارير. الإرسال حسب المستلمين والمواعيد المحددة."); setEditing(false); }
      else setReport(data as unknown as TeamActivityReport);
    } catch (err) { setError(err instanceof Error ? err.message : (err as { message?: string }).message ?? "تعذّر تنفيذ الطلب"); }
    finally { inFlight.current = false; setWorking(false); }
  }
  function recipient(userId: string, scope: string) {
    if (!config) return;
    const current = config.recipients.find(r => r.user_id === userId);
    setConfig({ ...config, recipients: [...config.recipients.filter(r => r.user_id !== userId), ...(scope === "none" ? [] : [{ user_id: userId, scope: scope as ReportRecipient["scope"], telegram: current?.telegram ?? false }])] });
  }
  return <section className="panel team-activity-settings" aria-label="تقارير نشاط الفريق">
    <header className="team-report-heading"><div><p className="overline">تقارير الفريق</p><h2>اليوم والأسبوع في ملخص واضح</h2><p>اختار مين يدخل في التقرير، ومين يستلمه. التحكم للمالك فقط.</p></div><Button type="button" variant="secondary" disabled={!config || working} onClick={() => setEditing(!editing)}><Settings2 size={17} /> إعداد التقارير</Button></header>
    {error ? <p className="form-notice error" role="alert">{error} <Button variant="ghost" onClick={() => void load()}>إعادة تحميل الإعدادات</Button></p> : null}
    {notice ? <p className="form-notice success" role="status">{notice}</p> : null}
    {config ? <><p className="report-schedule-summary">اليومي: {config.daily_enabled ? "مفعّل" : "متوقف"} · الأسبوعي: {config.weekly_enabled ? "مفعّل" : "متوقف"} · {config.recipients.length} مستلم</p>
      {!config.scheduler_available ? <p className="form-notice error">الجدولة غير متاحة على قاعدة البيانات حاليًا. المعاينة متاحة؛ لا يمكن تفعيل الإرسال التلقائي.</p> : null}
      {editing ? <form onSubmit={event => { event.preventDefault(); void run("save"); }}><fieldset disabled={working}>
        <legend>الجدول — بتوقيت القاهرة</legend><div className="report-settings-controls">
          <label><input type="checkbox" disabled={!config.scheduler_available} checked={config.daily_enabled} onChange={e => setConfig({ ...config, daily_enabled: e.target.checked })} /> تقرير يومي عن اليوم السابق</label>
          <label><input type="checkbox" disabled={!config.scheduler_available} checked={config.weekly_enabled} onChange={e => setConfig({ ...config, weekly_enabled: e.target.checked })} /> تقرير أسبوعي عن 7 أيام مكتملة</label>
          <label>ساعة الوصول <select value={config.delivery_hour} onChange={e => setConfig({ ...config, delivery_hour: Number(e.target.value) })}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>)}</select></label>
          <label>يوم التقرير الأسبوعي <select value={config.weekly_day} onChange={e => setConfig({ ...config, weekly_day: Number(e.target.value) })}>{["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"].map((day, i) => <option key={day} value={i}>{day}</option>)}</select></label>
        </div>
        <p>كل تقرير محفوظ داخل الموقع. تفعيل تيليجرام يرسل الملخص للحساب المرتبط فقط، وليس لجروب الفريق. يمكن إيقافه لاحقًا؛ الرسائل التي وصلت بالفعل لا تُسحب.</p>
        <div className="report-people-options">{people.map(person => {
          const r = config.recipients.find(row => row.user_id === person.id), included = config.included_users.includes(person.id);
          return <div key={person.id}><strong>{person.name}</strong>
            <label><input type="checkbox" checked={included} onChange={e => setConfig({ ...config, included_users: e.target.checked ? [...config.included_users, person.id] : config.included_users.filter(id => id !== person.id) })} /> مشمول بالتقرير</label>
            <label>يستلم <select aria-label={`تقرير ${person.name}`} value={r?.scope ?? "none"} onChange={e => recipient(person.id, e.target.value)}><option value="none">لا يستلم</option><option value="self">تقريره الشخصي فقط</option>{["owner", "admin", "manager"].includes(person.role) ? <option value="team">تقرير الفريق الشامل</option> : null}</select></label>
            <label><input type="checkbox" disabled={!r} checked={r?.telegram ?? false} onChange={e => setConfig({ ...config, recipients: config.recipients.map(row => row.user_id === person.id ? { ...row, telegram: e.target.checked } : row) })} /> تيليجرام</label>
          </div>;
        })}</div>
        <Button type="submit" disabled={working}>{working ? <LoaderCircle size={16} className="spin" /> : null} حفظ الإعدادات</Button>
      </fieldset></form> : null}
      {editing ? <p>المعاينة تعتمد على آخر إعدادات محفوظة؛ احفظ تغييرات الأعضاء أولًا.</p> : null}
      <form className="report-preview-controls" onSubmit={event => { event.preventDefault(); void run("preview"); }}>
        <label>من <DateInput aria-label="بداية التقرير" required value={start} max={end} disabled={working} onChange={e => setStart(e.target.value)} /></label>
        <label>إلى <DateInput aria-label="نهاية التقرير" required value={end} min={start} max={cairoReportDay()} disabled={working} onChange={e => setEnd(e.target.value)} /></label>
        <Button type="submit" variant="secondary" disabled={working}><FileText size={17} /> {working ? "جارٍ التحضير…" : "معاينة بدون إرسال"}</Button>
        <Button type="button" variant="ghost" disabled={working} onClick={() => { setStart(shiftReportDay(cairoReportDay(), -7)); setEnd(shiftReportDay(cairoReportDay(), -1)); }}>آخر 7 أيام</Button>
      </form>
    </> : null}
    {report ? <TeamReportView report={report} /> : null}
  </section>;
}
