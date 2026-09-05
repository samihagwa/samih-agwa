"use client";

import { Film, LoaderCircle, Repeat2 } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import type { Database } from "../../lib/supabase/database.types";
import { getSupabaseBrowserClient } from "../../lib/supabase/client";
import { Button } from "../ui/Button";

type Person = { id: string; name: string };
type ContentFormat = "reel" | "post";
type ContentStep = Database["public"]["Enums"]["content_step"];

type Props = {
  organizationId: string;
  currentUserId: string;
  people: Person[];
  onSaved: () => Promise<void>;
};

type RoutineStage = {
  step: ContentStep;
  title: string;
  ownerId: string;
  offsetDays: number;
  estimatedMinutes: number;
};

function defaultPublishAt() {
  const result = new Date();
  result.setHours(18, 0, 0, 0);
  const daysUntilSaturday = (6 - result.getDay() + 7) % 7;
  result.setDate(result.getDate() + daysUntilSaturday);
  if (result.getTime() - Date.now() < 4 * 24 * 60 * 60 * 1000) result.setDate(result.getDate() + 7);
  const offset = result.getTimezoneOffset();
  return new Date(result.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function isoWeekday(value: Date) {
  return value.getDay() === 0 ? 7 : value.getDay();
}

function datePart(value: Date) {
  const offset = value.getTimezoneOffset();
  return new Date(value.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function timePart(value: Date) {
  const offset = value.getTimezoneOffset();
  return `${new Date(value.getTime() - offset * 60_000).toISOString().slice(11, 16)}:00`;
}

function shiftedDate(value: Date, days: number) {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "تعذّر حفظ المسار الأسبوعي.";
}

export function WeeklyContentRoutineForm({ organizationId, currentUserId, people, onSaved }: Props) {
  const [format, setFormat] = useState<ContentFormat>("reel");
  const [publishAt, setPublishAt] = useState(defaultPublishAt);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const defaultOwnerId = people.some((person) => person.id === currentUserId) ? currentUserId : people[0]?.id ?? "";
  const scheduleSummary = useMemo(() => format === "reel"
    ? "المادة الخام قبل النشر بـ3 أيام، والمونتاج والغلاف بالتوازي قبل النشر بيوم، ثم النشر."
    : "بيانات التقرير قبل النشر بيومين، والتصميم قبل النشر بيوم، ثم النشر.", [format]);

  async function saveRoutine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const title = String(form.get("bundle_title") ?? "").trim();
    const request = String(form.get("bundle_request") ?? "").trim();
    const publication = new Date(String(form.get("publish_at") ?? ""));
    const finalPublishDate = String(form.get("ends_on") ?? "").trim();
    if (title.length < 3 || request.length < 5 || Number.isNaN(publication.getTime())) {
      setError("اكتب اسم التسليم والطلب كاملًا واختر أول موعد نشر صحيحًا.");
      return;
    }
    const minimumLeadDays = format === "reel" ? 3 : 2;
    if (publication.getTime() - Date.now() < minimumLeadDays * 24 * 60 * 60 * 1000) {
      setError(`أول موعد نشر لازم يكون بعد ${minimumLeadDays.toLocaleString("ar-EG")} أيام على الأقل حتى يبدأ المسار من أوله.`);
      return;
    }
    const anchorEnd = finalPublishDate ? new Date(`${finalPublishDate}T${publishAt.slice(11, 16)}`) : null;
    if (anchorEnd && anchorEnd < publication) {
      setError("آخر موعد نشر لازم يكون بعد أول موعد.");
      return;
    }

    const sourceOwner = String(form.get("source_owner_id") ?? defaultOwnerId);
    const editingOwner = String(form.get("editing_owner_id") ?? defaultOwnerId);
    const designOwner = String(form.get("design_owner_id") ?? defaultOwnerId);
    const publishingOwner = String(form.get("publishing_owner_id") ?? defaultOwnerId);
    const stages: RoutineStage[] = format === "reel" ? [
      { step: "recording", title: `إرسال المادة الخام: ${title}`, ownerId: sourceOwner, offsetDays: -3, estimatedMinutes: 30 },
      { step: "editing", title: `مونتاج الريلز: ${title}`, ownerId: editingOwner, offsetDays: -1, estimatedMinutes: 180 },
      { step: "thumbnail", title: `غلاف الريلز: ${title}`, ownerId: designOwner, offsetDays: -1, estimatedMinutes: 90 },
      { step: "publishing", title: `نشر الريلز: ${title}`, ownerId: publishingOwner, offsetDays: 0, estimatedMinutes: 30 },
    ] : [
      { step: "caption", title: `تسليم بيانات التقرير: ${title}`, ownerId: sourceOwner, offsetDays: -2, estimatedMinutes: 45 },
      { step: "design", title: `تصميم التقرير: ${title}`, ownerId: designOwner, offsetDays: -1, estimatedMinutes: 120 },
      { step: "publishing", title: `نشر التقرير: ${title}`, ownerId: publishingOwner, offsetDays: 0, estimatedMinutes: 30 },
    ];
    if (stages.some((stage) => !people.some((person) => person.id === stage.ownerId))) {
      setError("اختر عضوًا صحيحًا لكل مرحلة.");
      return;
    }

    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      const bundleId = crypto.randomUUID();
      const rows = stages.map((stage) => {
        const due = shiftedDate(publication, stage.offsetDays);
        const lastDue = anchorEnd ? shiftedDate(anchorEnd, stage.offsetDays) : null;
        return {
          organization_id: organizationId,
          title: stage.title.slice(0, 180),
          description: request.slice(0, 5000),
          owner_id: stage.ownerId,
          created_by: currentUserId,
          acceptance_criteria: "",
          requires_review: false,
          estimated_minutes: stage.estimatedMinutes,
          priority: "normal" as const,
          weekday: isoWeekday(due),
          time_local: timePart(due),
          starts_on: datePart(due),
          ends_on: lastDue ? datePart(lastDue) : null,
          content_bundle_id: bundleId,
          content_bundle_title: title,
          content_bundle_request: request,
          content_bundle_format: format,
          content_step: stage.step,
          bundle_anchor_weekday: isoWeekday(publication),
          bundle_anchor_time: timePart(publication),
        };
      });
      const supabase = getSupabaseBrowserClient();
      const { error: insertError } = await supabase.from("recurring_task_templates").insert(rows);
      if (insertError) throw insertError;
      const { error: materializeError } = await supabase.rpc("materialize_recurring_tasks", {
        target_organization_id: organizationId,
      });
      await onSaved();
      setNotice(materializeError
        ? "تم حفظ المسار. سيظهر أول أسبوع تلقائيًا خلال ساعة."
        : "تم حفظ مسار واحد مترابط، وستظهر مراحله في أيامها بدون تكرار يدوي.");
      formElement.reset();
      setFormat("reel");
      setPublishAt(defaultPublishAt());
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setWorking(false);
    }
  }

  return <details className="panel weekly-content-routine">
    <summary><span><Film size={16} /><strong>مسار محتوى أسبوعي</strong><small>اطلبه مرة واحدة ووزّعه على الفريق تلقائيًا</small></span><span><Repeat2 size={14} /> إنشاء</span></summary>
    <form onSubmit={(event) => void saveRoutine(event)}>
      <div className="weekly-content-kind segmented-control" aria-label="نوع التسليم الأسبوعي">
        <button type="button" className={format === "reel" ? "active" : ""} onClick={() => setFormat("reel")}>ريلز أسبوعي</button>
        <button type="button" className={format === "post" ? "active" : ""} onClick={() => setFormat("post")}>تقرير أو بوست أسبوعي</button>
      </div>
      <p className="weekly-content-summary">{scheduleSummary}</p>
      <div className="form-grid">
        <label><span>اسم التسليم</span><input name="bundle_title" minLength={3} maxLength={140} required placeholder={format === "reel" ? "مثال: ريلز الأربعاء التعليمي" : "مثال: نتائج توصيات الأسبوع"} /></label>
        <label><span>أول موعد نشر — القاهرة</span><input name="publish_at" type="datetime-local" value={publishAt} onChange={(event) => setPublishAt(event.target.value)} required /></label>
        <label className="full-field"><span>كل المطلوب والروابط — في مكان واحد</span><textarea name="bundle_request" minLength={5} maxLength={12000} rows={8} required placeholder="الصق الطلب كاملًا كما سترسله في Telegram: البيانات، التعليمات، وروابط المصادر…" /></label>
        <label><span>{format === "reel" ? "صاحب المادة الخام" : "صاحب بيانات التقرير"}</span><select name="source_owner_id" defaultValue={defaultOwnerId} required>{people.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
        {format === "reel" ? <label><span>المونتاج</span><select name="editing_owner_id" defaultValue={defaultOwnerId} required>{people.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label> : null}
        <label><span>{format === "reel" ? "تصميم الغلاف" : "التصميم"}</span><select name="design_owner_id" defaultValue={defaultOwnerId} required>{people.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
        <label><span>النشر</span><select name="publishing_owner_id" defaultValue={defaultOwnerId} required>{people.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
        <label><span>آخر موعد نشر — اختياري</span><input name="ends_on" type="date" min={publishAt.slice(0, 10)} /></label>
      </div>
      {error ? <p className="form-notice error" role="alert">{error}</p> : null}
      {notice ? <p className="form-notice success" role="status">{notice}</p> : null}
      <div className="form-actions"><Button type="submit" disabled={working}>{working ? <LoaderCircle className="spin" size={15} /> : <Repeat2 size={15} />} حفظ المسار الأسبوعي</Button><small>كل أسبوع يظهر ككارت واحد، وداخل الكارت كل عضو يرى مرحلته وموعده.</small></div>
    </form>
  </details>;
}
