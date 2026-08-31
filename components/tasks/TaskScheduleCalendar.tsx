"use client";

import { CalendarClock, ChevronLeft, ChevronRight, LoaderCircle, Repeat2, Route } from "lucide-react";
import { useEffect, useState } from "react";
import { taskDeepLink } from "../../lib/deep-links";
import { getSupabaseBrowserClient } from "../../lib/supabase/client";
import type { Database, Tables } from "../../lib/supabase/database.types";
import { taskStatusConfig, taskStatusLabel } from "../../lib/tasks";
import { StatusBadge } from "../ui/StatusBadge";

type Task = Tables<"tasks">;
type ScheduledRoutine = Database["public"]["Functions"]["get_recurring_task_schedule"]["Returns"][number];
type Person = { id: string; name: string };

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

function localDateKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("ar-EG", {
    timeZone: "Africa/Cairo",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function TaskScheduleCalendar({ organizationId, currentUserId, manager, people, tasks }: Props) {
  const [monthDate, setMonthDate] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [ownerId, setOwnerId] = useState(manager ? "" : currentUserId);
  const [routines, setRoutines] = useState<ScheduledRoutine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const rangeStart = localDateKey(year, month, 1);
  const rangeEnd = localDateKey(year, month, daysInMonth);

  useEffect(() => {
    let active = true;
    const timeout = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void getSupabaseBrowserClient().rpc("get_recurring_task_schedule", {
        target_organization_id: organizationId,
        range_starts_on: rangeStart,
        range_ends_on: rangeEnd,
        target_owner_id: (ownerId || null) as unknown as string,
      }).then(({ data, error: scheduleError }) => {
        if (!active) return;
        if (scheduleError) {
          setError(scheduleError.message);
          setRoutines([]);
        } else {
          setRoutines(data ?? []);
        }
        setLoading(false);
      });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [organizationId, ownerId, rangeEnd, rangeStart]);

  const peopleById = new Map(people.map((person) => [person.id, person.name]));
  const entries = (() => {
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
  })();

  const entriesByDate = (() => {
    const grouped = new Map<string, CalendarEntry[]>();
    for (const entry of entries) {
      const key = dateKeyInCairo(entry.dueAt);
      grouped.set(key, [...(grouped.get(key) ?? []), entry]);
    }
    return grouped;
  })();

  const firstDayOffset = (new Date(year, month, 1).getDay() + 1) % 7;
  const calendarCells = [
    ...Array.from({ length: firstDayOffset }, (_, index) => ({ key: `blank:${index}`, day: null as number | null })),
    ...Array.from({ length: daysInMonth }, (_, index) => ({ key: `day:${index + 1}`, day: index + 1 })),
  ];
  while (calendarCells.length % 7) calendarCells.push({ key: `blank:end:${calendarCells.length}`, day: null });

  return <section className="task-month-schedule" aria-label="الجدول الشهري للمهام">
    <header className="task-month-toolbar">
      <div><p className="overline">كل المواعيد في مكان واحد</p><h2>{new Intl.DateTimeFormat("ar-EG", { month: "long", year: "numeric" }).format(monthDate)}</h2><p>يعرض المهام العادية والمواعيد الأسبوعية القادمة، حتى قبل إنشاء كارت المهمة الفعلي.</p></div>
      <div className="task-month-controls">
        {manager ? <label><span>العضو</span><select value={ownerId} onChange={(event) => setOwnerId(event.target.value)}><option value="">كل الفريق</option>{people.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label> : null}
        <button type="button" aria-label="الشهر السابق" onClick={() => setMonthDate(new Date(year, month - 1, 1))}><ChevronRight size={17} /></button>
        <button type="button" onClick={() => setMonthDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>هذا الشهر</button>
        <button type="button" aria-label="الشهر التالي" onClick={() => setMonthDate(new Date(year, month + 1, 1))}><ChevronLeft size={17} /></button>
      </div>
    </header>

    {error ? <p className="form-notice error" role="alert">تعذّر تحميل الجدول الشهري: {error}</p> : null}
    {loading ? <div className="task-month-loading"><LoaderCircle className="spin" size={20} /> جارٍ ترتيب الشهر…</div> : <>
      <div className="task-month-weekdays" aria-hidden="true">{weekdayLabels.map((label) => <strong key={label}>{label}</strong>)}</div>
      <div className="task-month-grid">{calendarCells.map((cell) => {
        if (!cell.day) return <span className="task-month-blank" key={cell.key} aria-hidden="true" />;
        const dayKey = localDateKey(year, month, cell.day);
        const dayEntries = entriesByDate.get(dayKey) ?? [];
        return <article className={dayEntries.length ? "has-work" : ""} key={cell.key}>
          <header><strong>{cell.day.toLocaleString("ar-EG")}</strong><small>{dayEntries.length ? `${dayEntries.length.toLocaleString("ar-EG")} مهمة` : "متاح"}</small></header>
          <div>{dayEntries.map((entry) => {
            const content = <><span><b>{formatTime(entry.dueAt)}</b>{entry.recurring ? <Repeat2 size={11} /> : <CalendarClock size={11} />}</span><strong>{entry.title}</strong>{manager ? <small>{peopleById.get(entry.ownerId) ?? "عضو فريق"}</small> : null}<StatusBadge tone={entry.projected ? "neutral" : taskStatusConfig[entry.status].tone}>{entry.projected ? "موعد أسبوعي قادم" : taskStatusLabel(entry.status)}</StatusBadge></>;
            return entry.taskId ? <a href={taskDeepLink(entry.taskId)} key={entry.key}>{content}<Route size={11} /></a> : <div className="projected" key={entry.key}>{content}<small>يتحول لمهمة تلقائيًا قبل الموعد.</small></div>;
          })}</div>
        </article>;
      })}</div>
      {!entries.length ? <div className="task-month-empty"><CalendarClock size={23} /><div><strong>لا توجد مواعيد في هذا الشهر</strong><p>{manager ? "أنشئ مهمة مرة واحدة أو مهمة أسبوعية ثابتة من عرض «المطلوب الآن»." : "عندما تُسند إليك مهمة ستظهر هنا حسب يوم التسليم."}</p></div></div> : null}
    </>}
  </section>;
}
