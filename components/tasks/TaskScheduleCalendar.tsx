"use client";

import { AlertTriangle, CalendarClock, ChevronLeft, ChevronRight, LoaderCircle, Repeat2, Route, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { taskDeepLink } from "../../lib/deep-links";
import { getSupabaseBrowserClient } from "../../lib/supabase/client";
import type { Database, Tables } from "../../lib/supabase/database.types";
import { taskStatusConfig, taskStatusLabel } from "../../lib/tasks";
import { StatusBadge } from "../ui/StatusBadge";

type Task = Tables<"tasks">;
type ScheduledRoutine = Database["public"]["Functions"]["get_recurring_task_schedule"]["Returns"][number];
type Person = { id: string; name: string };
type ScheduleView = "week" | "month";

type CapacityMember = {
  id: string;
  daily_capacity_minutes: number;
  max_parallel_tasks: number;
};

type CapacityWork = {
  id: string;
  owner_id: string;
  due_at?: string;
  publish_at?: string;
  estimated_minutes: number;
};

type CapacityCalendar = {
  members?: CapacityMember[];
  tasks?: CapacityWork[];
  planned_items?: CapacityWork[];
};

type Props = {
  organizationId: string;
  currentUserId: string;
  manager: boolean;
  people: Person[];
  tasks: Task[];
};

type CalendarEntry = {
  key: string;
  taskId: string | null;
  ownerId: string;
  title: string;
  dueAt: string;
  status: Task["status"];
  recurring: boolean;
  projected: boolean;
};

const weekdayLabels = ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];

function dateKeyInCairo(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function localDateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function addDays(value: Date, days: number) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + days);
}

function startOfWorkWeek(value: Date) {
  const offsetFromSaturday = (value.getDay() + 1) % 7;
  return addDays(value, -offsetFromSaturday);
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("ar-EG", {
    timeZone: "Africa/Cairo",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDay(value: Date) {
  return new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "short" }).format(value);
}

function workTimestamp(item: CapacityWork) {
  return item.due_at ?? item.publish_at ?? "";
}

export function TaskScheduleCalendar({ organizationId, currentUserId, manager, people, tasks }: Props) {
  const [view, setView] = useState<ScheduleView>("week");
  const [cursor, setCursor] = useState(() => new Date());
  const [ownerId, setOwnerId] = useState(manager ? "" : currentUserId);
  const [routines, setRoutines] = useState<ScheduledRoutine[]>([]);
  const [capacity, setCapacity] = useState<CapacityCalendar | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => {
    if (view === "week") {
      const start = startOfWorkWeek(cursor);
      return { start, end: addDays(start, 6) };
    }
    return {
      start: new Date(cursor.getFullYear(), cursor.getMonth(), 1),
      end: new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0),
    };
  }, [cursor, view]);
  const rangeStart = localDateKey(range.start);
  const rangeEnd = localDateKey(range.end);

  useEffect(() => {
    let active = true;
    const timeout = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      const supabase = getSupabaseBrowserClient();
      const schedulePromise = supabase.rpc("get_recurring_task_schedule", {
        target_organization_id: organizationId,
        range_starts_on: rangeStart,
        range_ends_on: rangeEnd,
        target_owner_id: (ownerId || null) as unknown as string,
      });
      const capacityPromise = manager
        ? supabase.rpc("get_team_capacity_calendar", {
          target_organization_id: organizationId,
          range_starts_on: rangeStart,
          range_ends_on: rangeEnd,
        })
        : Promise.resolve({ data: null, error: null });

      void Promise.all([schedulePromise, capacityPromise]).then(([scheduleResult, capacityResult]) => {
        if (!active) return;
        if (scheduleResult.error) {
          setError(scheduleResult.error.message);
          setRoutines([]);
        } else {
          setRoutines(scheduleResult.data ?? []);
        }
        setCapacity(capacityResult.error ? null : capacityResult.data as CapacityCalendar | null);
        setLoading(false);
      });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [manager, organizationId, ownerId, rangeEnd, rangeStart]);

  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person.name])), [people]);
  const entries = useMemo(() => {
    const projected: CalendarEntry[] = routines.map((routine) => ({
      key: routine.task_id ? `task:${routine.task_id}` : `routine:${routine.template_id}:${routine.scheduled_at}`,
      taskId: routine.task_id,
      ownerId: routine.owner_id,
      title: routine.title,
      dueAt: routine.scheduled_at,
      status: routine.status,
      recurring: true,
      projected: !routine.materialized,
    }));
    const recurringTaskIds = new Set(projected.flatMap((entry) => entry.taskId ? [entry.taskId] : []));
    const concrete: CalendarEntry[] = tasks
      .filter((task) => !recurringTaskIds.has(task.id))
      .filter((task) => dateKeyInCairo(task.due_at) >= rangeStart && dateKeyInCairo(task.due_at) <= rangeEnd)
      .filter((task) => manager ? !ownerId || task.owner_id === ownerId : task.owner_id === currentUserId)
      .map((task) => ({
        key: `task:${task.id}`,
        taskId: task.id,
        ownerId: task.owner_id,
        title: task.title,
        dueAt: task.due_at,
        status: task.status,
        recurring: Boolean(task.recurring_template_id),
        projected: false,
      }));
    return [...projected, ...concrete].sort((left, right) => new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime());
  }, [currentUserId, manager, ownerId, rangeEnd, rangeStart, routines, tasks]);

  const entriesByDate = useMemo(() => {
    const grouped = new Map<string, CalendarEntry[]>();
    for (const entry of entries) {
      const key = dateKeyInCairo(entry.dueAt);
      grouped.set(key, [...(grouped.get(key) ?? []), entry]);
    }
    return grouped;
  }, [entries]);

  const loadByMemberDay = useMemo(() => {
    const grouped = new Map<string, { count: number; minutes: number; overloaded: boolean }>();
    const settings = new Map((capacity?.members ?? []).map((member) => [member.id, member]));
    for (const item of [...(capacity?.tasks ?? []), ...(capacity?.planned_items ?? [])]) {
      const timestamp = workTimestamp(item);
      if (!timestamp) continue;
      const key = `${item.owner_id}:${dateKeyInCairo(timestamp)}`;
      const current = grouped.get(key) ?? { count: 0, minutes: 0, overloaded: false };
      current.count += 1;
      current.minutes += item.estimated_minutes;
      const member = settings.get(item.owner_id);
      current.overloaded = Boolean(member && (current.count > member.max_parallel_tasks || current.minutes > member.daily_capacity_minutes));
      grouped.set(key, current);
    }
    return grouped;
  }, [capacity]);

  const days = view === "week"
    ? Array.from({ length: 7 }, (_, index) => addDays(range.start, index))
    : Array.from({ length: range.end.getDate() }, (_, index) => new Date(range.start.getFullYear(), range.start.getMonth(), index + 1));
  const title = view === "week"
    ? `${formatDay(range.start)} — ${formatDay(range.end)}`
    : new Intl.DateTimeFormat("ar-EG", { month: "long", year: "numeric" }).format(cursor);

  return <section className="task-schedule" aria-label="جدول مهام الفريق">
    <header className="task-schedule-toolbar">
      <div><p className="overline">خارطة التنفيذ</p><h2>{title}</h2></div>
      <div className="task-schedule-controls">
        {manager ? <label><span>العضو</span><select value={ownerId} onChange={(event) => setOwnerId(event.target.value)}><option value="">كل الفريق</option>{people.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label> : null}
        <div className="segmented-control" aria-label="مدة عرض الجدول"><button type="button" className={view === "week" ? "active" : ""} onClick={() => { setView("week"); setCursor(new Date()); }}>أسبوع</button><button type="button" className={view === "month" ? "active" : ""} onClick={() => { setView("month"); setCursor(new Date()); }}>شهر</button></div>
        <button type="button" aria-label={view === "week" ? "الأسبوع السابق" : "الشهر السابق"} onClick={() => setCursor(view === "week" ? addDays(cursor, -7) : new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}><ChevronRight size={17} /></button>
        <button type="button" onClick={() => setCursor(new Date())}>اليوم</button>
        <button type="button" aria-label={view === "week" ? "الأسبوع التالي" : "الشهر التالي"} onClick={() => setCursor(view === "week" ? addDays(cursor, 7) : new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}><ChevronLeft size={17} /></button>
      </div>
    </header>

    {error ? <p className="form-notice error" role="alert">تعذّر تحميل الجدول: {error}</p> : null}
    {loading ? <div className="task-schedule-loading"><LoaderCircle className="spin" size={20} /> جارٍ ترتيب المواعيد…</div> : <>
      <div className={`task-schedule-grid ${view}`}>{days.map((day, index) => {
        const dayKey = localDateKey(day);
        const dayEntries = entriesByDate.get(dayKey) ?? [];
        const ownerIds = ownerId ? [ownerId] : [...new Set(dayEntries.map((entry) => entry.ownerId))];
        const overload = ownerIds.some((id) => loadByMemberDay.get(`${id}:${dayKey}`)?.overloaded);
        return <article className={dayEntries.length ? "has-work" : ""} data-overloaded={overload || undefined} key={dayKey}>
          <header><div><strong>{view === "week" ? weekdayLabels[index] : new Intl.DateTimeFormat("ar-EG", { weekday: "short" }).format(day)}</strong><small>{formatDay(day)}</small></div>{overload ? <span><AlertTriangle size={12} /> حمل زائد</span> : <small>{dayEntries.length ? `${dayEntries.length.toLocaleString("ar-EG")} مهمة` : "متاح"}</small>}</header>
          <div>{dayEntries.map((entry) => {
            const content = <><span><b>{formatTime(entry.dueAt)}</b>{entry.recurring ? <Repeat2 size={11} /> : <CalendarClock size={11} />}</span><strong>{entry.title}</strong>{manager ? <small><UsersRound size={11} /> {peopleById.get(entry.ownerId) ?? "عضو فريق"}</small> : null}<StatusBadge tone={entry.projected ? "neutral" : taskStatusConfig[entry.status].tone}>{entry.projected ? "موعد أسبوعي قادم" : taskStatusLabel(entry.status)}</StatusBadge></>;
            return entry.taskId ? <a href={taskDeepLink(entry.taskId)} key={entry.key}>{content}<Route size={11} /></a> : <div className="projected" key={entry.key}>{content}</div>;
          })}</div>
        </article>;
      })}</div>
      {!entries.length ? <div className="task-schedule-empty"><CalendarClock size={23} /><div><strong>لا توجد مواعيد في الفترة دي</strong><p>{manager ? "أضف مهمة مرة واحدة أو قاعدة أسبوعية من زر الإضافة." : "عندما تُسند إليك مهمة ستظهر هنا في يوم تسليمها."}</p></div></div> : null}
    </>}
  </section>;
}
