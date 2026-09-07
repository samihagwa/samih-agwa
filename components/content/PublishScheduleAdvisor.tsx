"use client";

import { AlertTriangle, CalendarDays, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { contentFormatConfig, contentPlatformLabel } from "../../lib/content";
import { cairoDateKey, formatDayMonth, formatTime, formatWeekday } from "../../lib/date-time";
import { getSupabaseBrowserClient } from "../../lib/supabase/client";
import type { Tables } from "../../lib/supabase/database.types";

type ScheduledItem = Pick<Tables<"content_items">, "id" | "title" | "publish_at" | "status" | "format" | "platforms">;

function dayStart(value: string) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() - 3);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function PublishScheduleAdvisor({ organizationId, value, onChange }: { organizationId: string; value: string; onChange: (value: string) => void }) {
  const [items, setItems] = useState<ScheduledItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const selectedKey = value.slice(0, 10);
  const rangeStart = useMemo(() => dayStart(selectedKey || new Date().toISOString().slice(0, 10)), [selectedKey]);
  const days = useMemo(() => Array.from({ length: 10 }, (_, index) => {
    const date = new Date(rangeStart);
    date.setDate(date.getDate() + index);
    return date;
  }), [rangeStart]);

  useEffect(() => {
    let active = true;
    const start = new Date(rangeStart);
    const end = new Date(rangeStart);
    end.setDate(end.getDate() + 10);
    void getSupabaseBrowserClient().from("content_items")
      .select("id, title, publish_at, status, format, platforms")
      .eq("organization_id", organizationId)
      .gte("publish_at", start.toISOString())
      .lt("publish_at", end.toISOString())
      .neq("status", "cancelled")
      .order("publish_at")
      .then(({ data, error: queryError }) => {
        if (!active) return;
        setItems(data ?? []);
        setError(queryError ? "تعذّر تحميل المواعيد الحالية؛ ما زال بإمكانك اختيار الموعد يدويًا." : null);
        setLoading(false);
      });
    return () => { active = false; };
  }, [organizationId, rangeStart]);

  function chooseDay(day: Date) {
    const time = value.slice(11, 16) || "18:00";
    onChange(`${cairoDateKey(day)}T${time}`);
  }

  const selectedDayItems = items.filter((item) => cairoDateKey(item.publish_at) === selectedKey);

  return <section className="publish-schedule-advisor" aria-label="تقويم مواعيد المحتوى">
    <header><div><CalendarDays size={16} /><strong>اختار يومًا وأنت شايف الخطة</strong></div>{loading ? <LoaderCircle className="spin" size={15} /> : null}</header>
    {error ? <p><AlertTriangle size={13} /> {error}</p> : null}
    <div>{days.map((day) => {
      const key = cairoDateKey(day);
      const dayItems = items.filter((item) => cairoDateKey(item.publish_at) === key);
      const firstItem = dayItems[0];
      return <button type="button" className={key === selectedKey ? "active" : ""} aria-pressed={key === selectedKey} aria-label={`اختيار ${formatDayMonth(day)}؛ ${dayItems.length ? `${dayItems.length} محتوى مجدول` : "اليوم متاح"}`} onClick={() => chooseDay(day)} key={key}>
        <span>{formatWeekday(day, "short")}</span><strong>{formatDayMonth(day)}</strong>
        {firstItem ? <span className="publish-schedule-day-preview"><b>{contentFormatConfig[firstItem.format].label}</b><em>{firstItem.title}</em></span> : <small>متاح</small>}
        {dayItems.length > 1 ? <small>+{dayItems.length - 1} محتوى آخر</small> : firstItem ? <small>{formatTime(firstItem.publish_at)}</small> : null}
      </button>;
    })}</div>
    {selectedDayItems.length ? <div className="publish-schedule-selected-day">
      <header><strong>المجدول في {formatDayMonth(value)}</strong><small>{selectedDayItems.length} محتوى</small></header>
      <ul>{selectedDayItems.map((item) => <li key={item.id}>
        <span>{contentFormatConfig[item.format].label}</span>
        <div><strong>{item.title}</strong><small>{item.platforms.map(contentPlatformLabel).join(" + ") || "المنصة غير محددة"} · <bdi dir="ltr">{formatTime(item.publish_at)}</bdi></small></div>
      </li>)}</ul>
    </div> : <div className="publish-schedule-selected-day empty"><strong>اليوم المختار متاح</strong><small>لا يوجد محتوى آخر مجدول فيه حاليًا.</small></div>}
    <small>اختيار اليوم يغيّر التاريخ فقط ويحافظ على الساعة التي حددتها.</small>
  </section>;
}
