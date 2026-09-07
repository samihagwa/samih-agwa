export const CAIRO_TIME_ZONE = "Africa/Cairo";

type DateValue = string | number | Date;

function safeDate(value: DateValue | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(value: DateValue | null | undefined) {
  const date = safeDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: CAIRO_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date).replace(", ", " · ");
}

export function formatDateOnly(value: DateValue | null | undefined) {
  const date = safeDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: CAIRO_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatDayMonth(value: DateValue | null | undefined) {
  const date = safeDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: CAIRO_TIME_ZONE,
    day: "2-digit",
    month: "short",
  }).format(date);
}

export function formatTime(value: DateValue | null | undefined) {
  const date = safeDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: CAIRO_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export function formatWeekday(value: DateValue | null | undefined, style: "short" | "long" = "short") {
  const date = safeDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: CAIRO_TIME_ZONE,
    weekday: style,
  }).format(date);
}

export function formatMonthYear(value: DateValue | null | undefined) {
  const date = safeDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: CAIRO_TIME_ZONE,
    month: "long",
    year: "numeric",
  }).format(date);
}

export function cairoDateKey(value: DateValue) {
  const date = safeDate(value);
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CAIRO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function formatDeadlineDistance(value: DateValue, now = Date.now()) {
  const date = safeDate(value);
  if (!date) return { label: "موعد غير صالح", overdue: false };
  const milliseconds = date.getTime() - now;
  const overdue = milliseconds < 0;
  const totalMinutes = Math.max(0, Math.floor(Math.abs(milliseconds) / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const units = [
    days ? `${days} يوم` : "",
    hours ? `${hours} ساعة` : "",
    !days && minutes ? `${minutes} دقيقة` : "",
  ].filter(Boolean).slice(0, 2);
  const distance = units.join(" و") || "أقل من دقيقة";
  return { label: overdue ? `متأخرة ${distance}` : `متبقي ${distance}`, overdue };
}
