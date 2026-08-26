"use client";

import {
  AlertTriangle, Bot, ChevronLeft, ChevronRight,
  Clock3, LoaderCircle, RefreshCw, Save, Settings2, UsersRound,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "../../lib/supabase/client";
import type { Json } from "../../lib/supabase/database.types";
import { Button } from "../ui/Button";

type CapacityMember = {
  id: string;
  name: string;
  role: string;
  daily_capacity_minutes: number;
  max_parallel_tasks: number;
};
type CapacityTask = {
  id: string;
  title: string;
  owner_id: string;
  due_at: string;
  status: string;
  estimated_minutes: number;
  content_item_id: string | null;
  source_plan_item_id: string | null;
  url: string;
};
type CapacityPlanItem = {
  id: string;
  title: string;
  owner_id: string;
  publish_at: string;
  status: string;
  kind: string;
  estimated_minutes: number;
  content_item_id: string | null;
  url: string;
};
type CapacityPayload = {
  members: CapacityMember[];
  tasks: CapacityTask[];
  planned_items: CapacityPlanItem[];
};

function dateKey(value: Date | string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(typeof value === "string" ? new Date(value) : value);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function startOfWeek(value = new Date()) {
  const date = new Date(value);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - date.getDay());
  return date;
}

function shiftDays(value: Date, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function asRecord(value: Json | null): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray<T>(value: Json | undefined) {
  return Array.isArray(value) ? value as T[] : [];
}

function hoursLabel(minutes: number) {
  if (minutes < 60) return `${minutes.toLocaleString("ar-EG")} د`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours.toLocaleString("ar-EG")} س${rest ? ` و${rest.toLocaleString("ar-EG")} د` : ""}`;
}

export function TeamCapacityCalendar({ organizationId }: { organizationId: string }) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek());
  const [payload, setPayload] = useState<CapacityPayload>({ members: [], tasks: [], planned_items: [] });
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => shiftDays(weekStart, index)), [weekStart]);
  const startsOn = dateKey(days[0]);
  const endsOn = dateKey(days[6]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const { data, error: rpcError } = await getSupabaseBrowserClient().rpc("get_team_capacity_calendar", {
      target_organization_id: organizationId,
      range_starts_on: startsOn,
      range_ends_on: endsOn,
    });
    setLoading(false);
    if (rpcError) { setError(rpcError.message); return; }
    const record = asRecord(data);
    setPayload({
      members: asArray<CapacityMember>(record.members),
      tasks: asArray<CapacityTask>(record.tasks),
      planned_items: asArray<CapacityPlanItem>(record.planned_items),
    });
  }, [endsOn, organizationId, startsOn]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const reload = () => void load();
    let channel = supabase.channel(`capacity-calendar:${organizationId}`);
    for (const table of ["tasks", "content_plan_items", "team_capacity_settings"] as const) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `organization_id=eq.${organizationId}` }, reload);
    }
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [load, organizationId]);

  const cellData = useMemo(() => {
    const map = new Map<string, { tasks: CapacityTask[]; plans: CapacityPlanItem[]; minutes: number; count: number }>();
    for (const member of payload.members) for (const day of days) map.set(`${member.id}:${dateKey(day)}`, { tasks: [], plans: [], minutes: 0, count: 0 });
    for (const task of payload.tasks) {
      const cell = map.get(`${task.owner_id}:${dateKey(task.due_at)}`);
      if (!cell) continue;
      cell.tasks.push(task); cell.minutes += task.estimated_minutes; cell.count += 1;
    }
    for (const item of payload.planned_items) {
      const cell = map.get(`${item.owner_id}:${dateKey(item.publish_at)}`);
      if (!cell) continue;
      cell.plans.push(item);
      if (!item.content_item_id) { cell.minutes += item.estimated_minutes; cell.count += 1; }
    }
    return map;
  }, [days, payload]);

  const overloads = useMemo(() => payload.members.flatMap((member) => days.flatMap((day) => {
    const cell = cellData.get(`${member.id}:${dateKey(day)}`);
    return cell && (cell.minutes > member.daily_capacity_minutes || cell.count > member.max_parallel_tasks)
      ? [{ member, day, cell }]
      : [];
  })), [cellData, days, payload.members]);

  function askAi() {
    window.dispatchEvent(new CustomEvent("workspace-ai:ask", { detail: {
      question: `راجع ضغط الفريق في تقويم الأسبوع من ${startsOn} إلى ${endsOn}. وضّح أيام الحمل الزائد، واقترح توزيعًا واقعيًا بدون تغيير أي مهمة من نفسك.`,
    } }));
  }

  async function saveCapacity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const rows = payload.members.map((member) => ({
      organization_id: organizationId,
      user_id: member.id,
      daily_capacity_minutes: Number(form.get(`minutes:${member.id}`) ?? member.daily_capacity_minutes),
      max_parallel_tasks: Number(form.get(`parallel:${member.id}`) ?? member.max_parallel_tasks),
    }));
    setWorking(true); setError(null); setNotice(null);
    const { error: saveError } = await getSupabaseBrowserClient().from("team_capacity_settings")
      .upsert(rows, { onConflict: "organization_id,user_id" });
    setWorking(false);
    if (saveError) { setError(saveError.message); return; }
    setNotice("تم تحديث سعة الفريق، وأعيد حساب التحذيرات.");
    await load();
  }

  return <section className="panel team-capacity-panel">
    <div className="section-heading">
      <div><p className="overline">Team capacity</p><h2>تقويم الفريق وحمل التنفيذ</h2><p>المهام بمواعيد تسليمها، والمحتوى بمواعيد نشره. الأحمر تحذير قرار، وليس منعًا تلقائيًا.</p></div>
      <div className="toolbar-actions">
        <Button type="button" variant="secondary" onClick={askAi}><Bot size={14} /> اسأل AI عن التوزيع</Button>
        <button className="icon-button" type="button" aria-label="تحديث تقويم الفريق" onClick={() => void load()}><RefreshCw size={16} /></button>
      </div>
    </div>

    {error ? <p className="form-notice error" role="alert">{error}</p> : null}
    {notice ? <p className="form-notice success" role="status">{notice}</p> : null}
    {overloads.length ? <div className="capacity-alert" role="status"><AlertTriangle size={17} /><div><strong>{overloads.length.toLocaleString("ar-EG")} يوم عليه حمل زائد</strong><p>{overloads.slice(0, 3).map(({ member, day }) => `${member.name} — ${new Intl.DateTimeFormat("ar-EG", { weekday: "long", day: "numeric", month: "short", timeZone: "Africa/Cairo" }).format(day)}`).join(" · ")}</p></div></div> : <div className="capacity-clear"><UsersRound size={16} /><span>لا يوجد حمل زائد ظاهر في هذا الأسبوع.</span></div>}

    <div className="capacity-week-toolbar">
      <div><button type="button" aria-label="الأسبوع السابق" onClick={() => setWeekStart((current) => shiftDays(current, -7))}><ChevronRight size={17} /></button><button type="button" onClick={() => setWeekStart(startOfWeek())}>هذا الأسبوع</button><button type="button" aria-label="الأسبوع التالي" onClick={() => setWeekStart((current) => shiftDays(current, 7))}><ChevronLeft size={17} /></button></div>
      <strong>{new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "short", timeZone: "Africa/Cairo" }).format(days[0])} — {new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Cairo" }).format(days[6])}</strong>
    </div>

    {loading ? <div className="capacity-loading"><LoaderCircle className="spin" size={20} /> بنجمع حمل الأسبوع…</div> : <div className="capacity-board-wrap">
      <div className="capacity-board" role="table" aria-label="تقويم حمل الفريق الأسبوعي">
        <div className="capacity-row capacity-header-row" role="row"><div role="columnheader"><UsersRound size={14} /> عضو الفريق</div>{days.map((day) => <div role="columnheader" className={dateKey(day) === dateKey(new Date()) ? "today" : ""} key={dateKey(day)}><strong>{new Intl.DateTimeFormat("ar-EG", { weekday: "short", timeZone: "Africa/Cairo" }).format(day)}</strong><small>{new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "short", timeZone: "Africa/Cairo" }).format(day)}</small></div>)}</div>
        {payload.members.map((member) => <div className="capacity-row" role="row" key={member.id}>
          <div className="capacity-member" role="rowheader"><strong>{member.name}</strong><small>{hoursLabel(member.daily_capacity_minutes)} · حتى {member.max_parallel_tasks.toLocaleString("ar-EG")} مهام</small></div>
          {days.map((day) => {
            const cell = cellData.get(`${member.id}:${dateKey(day)}`) ?? { tasks: [], plans: [], minutes: 0, count: 0 };
            const percent = Math.round((cell.minutes / member.daily_capacity_minutes) * 100);
            const overloaded = cell.minutes > member.daily_capacity_minutes || cell.count > member.max_parallel_tasks;
            return <div className={`capacity-cell ${overloaded ? "overloaded" : ""}`} role="cell" key={dateKey(day)}>
              <div className="capacity-cell-summary"><span><Clock3 size={11} /> {hoursLabel(cell.minutes)}</span><strong>{Math.min(999, percent)}%</strong></div>
              <div className="capacity-meter" aria-label={`حمل ${member.name} ${percent}%`}><span style={{ width: `${Math.min(100, percent)}%` }} /></div>
              <div className="capacity-entry-list">
                {cell.tasks.slice(0, 3).map((task) => <a href={task.url} className="task" title={task.title} key={`task:${task.id}`}><span>مهمة</span>{task.title}</a>)}
                {cell.plans.slice(0, Math.max(0, 3 - cell.tasks.length)).map((item) => <a href={item.url} className="plan" title={item.title} key={`plan:${item.id}`}><span>نشر</span>{item.title}</a>)}
                {cell.tasks.length + cell.plans.length > 3 ? <small>+{(cell.tasks.length + cell.plans.length - 3).toLocaleString("ar-EG")} أخرى</small> : null}
              </div>
            </div>;
          })}
        </div>)}
      </div>
    </div>}

    <details className="capacity-settings">
      <summary><Settings2 size={14} /> ضبط سعة الفريق</summary>
      <form onSubmit={(event) => void saveCapacity(event)}><p>السعة تعني وقت إنتاج مركز يوميًا، وليست ساعات الحضور.</p><div>{payload.members.map((member) => <section key={member.id}><strong>{member.name}</strong><label><span>دقائق يومية</span><input name={`minutes:${member.id}`} type="number" min="60" max="1440" step="30" defaultValue={member.daily_capacity_minutes} /></label><label><span>أقصى مهام متوازية</span><input name={`parallel:${member.id}`} type="number" min="1" max="30" defaultValue={member.max_parallel_tasks} /></label></section>)}</div><Button type="submit" disabled={working}>{working ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />} حفظ السعة</Button></form>
    </details>
  </section>;
}
