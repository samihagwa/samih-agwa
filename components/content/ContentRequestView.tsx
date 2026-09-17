"use client";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, CheckCircle2, Eye, Link2, Pencil, Plus, Trash2 } from "lucide-react";
import { contentAssetKindConfig, contentRevisionSteps, contentFormatConfig, contentStepConfig, contentWorkflowSteps, type ContentAssetKind } from "../../lib/content";
import { contentRequestText, latestDeliveries, safeWebLink } from "../../lib/content-presentation";
import { contentSourceDeepLink, taskDeepLink, taskDeliveryDeepLink } from "../../lib/deep-links";
import { formatDateTime } from "../../lib/date-time";
import type { Tables } from "../../lib/supabase/database.types";
import { taskStatusLabel } from "../../lib/tasks";
import { Button } from "../ui/Button";
import { EmojiTextarea } from "../ui/EmojiTextarea";
import { RequestText } from "../ui/RequestText";
import { ContentProgress } from "./ContentLibrary";
import { ContentPublishTimes } from "./ContentPublishTimes";
import { CarouselImageGallery } from "./CarouselImages";

type Props = {
  item: Tables<"content_items">; tasks: Tables<"tasks">[]; assets: Tables<"content_assets">[];
  deliveries: Tables<"content_step_deliveries">[]; revisions: Tables<"content_revision_requests">[];
  timeline: Tables<"content_timeline_cues">[]; people: { id: string; name: string }[];
  userId: string; readOnly: boolean; platformAdmin: boolean; working: boolean; backHref: string;
  revisionId?: string | null;
  command: (body: Record<string, unknown>, notice: string) => Promise<boolean>;
};
function field(form: FormData, key: string) { return String(form.get(key) ?? "").trim(); }
function FileLink({ url, children }: { url: string; children: React.ReactNode }) {
  const href = /^\/content\?content=[a-z0-9-]+#content-[a-z0-9-]+$/i.test(url) ? url : safeWebLink(url);
  return href ? <a className="request-file-link" href={href} target="_blank" rel="noopener noreferrer"><Eye size={17} />{children}</a> : <span className="request-invalid-link">{children} — الرابط غير صالح</span>;
}

export function ContentRequestView({ item, tasks, assets, deliveries, revisions, timeline, people, userId, readOnly, platformAdmin, working, command, backHref, revisionId }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(contentRequestText(item));
  const [editVersion, setEditVersion] = useState(item.version);
  const [revisionText, setRevisionText] = useState("");
  const [addingLink, setAddingLink] = useState(false);
  const [requestingRevision, setRequestingRevision] = useState(false);
  const [formError, setFormError] = useState("");
  const canonical = contentRequestText(item);
  const canEdit = !readOnly && (platformAdmin || item.created_by === userId);
  const canAdd = !readOnly && (canEdit || tasks.some((task) => task.owner_id === userId));
  const latest = latestDeliveries(deliveries);
  const stages = contentWorkflowSteps(item.format);
  const revisionOptions = contentRevisionSteps(item.format).filter((step) => tasks.some((task) => task.content_step === step && ["review", "done"].includes(task.status)));
  const person = (id: string) => people.find((member) => member.id === id)?.name ?? "عضو فريق";
  // Intake raw media and recording deliveries stay visible at the top, irrespective of old asset-kind labels.
  const rawAssets = assets.filter((asset) => asset.stage === "recording" || ["raw_video", "audio"].includes(asset.kind));
  const extraAssets = assets.filter((asset) => !rawAssets.includes(asset));
  const stageResults = stages.flatMap((step) => tasks.filter((task) => task.content_step === step).map((task) => ({ task, delivery: latest.get(task.id) })));
  const designerText = [...new Set([item.thumbnail_brief, item.design_brief])].filter((text) => text?.trim() && !canonical.includes(text.trim())).join("\n\n");
  useEffect(() => {
    if (!revisionId) return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(`revision-${revisionId}`);
      target?.scrollIntoView({ block: "center" });
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [revisionId, revisions.length]);

  async function saveRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setFormError("");
    const form = new FormData(event.currentTarget);
    const saved = await command({ action: "update_request_text", content_item_id: item.id, expected_content_version: editVersion, content_request_text: draft, request_source_url: field(form, "source") }, "تم حفظ نص الطلب.");
    if (saved) setEditing(false); else setFormError("لم يُحفظ التعديل؛ النص ما زال موجودًا هنا. راجع رسالة الخطأ.");
  }
  async function addLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setFormError("");
    const form = new FormData(event.currentTarget);
    const url = field(form, "url");
    if (!safeWebLink(url)) { setFormError("أضف رابط http أو https صحيحًا."); return; }
    if (await command({ action: "add_asset", content_item_id: item.id, asset_kind: field(form, "kind"), asset_stage: field(form, "stage"), asset_title: field(form, "title"), asset_url: url, asset_notes: field(form, "notes") }, "تمت إضافة الرابط للطلب.")) setAddingLink(false);
  }
  async function revise(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setFormError("");
    const form = new FormData(event.currentTarget);
    if (await command({ action: "request_revision", content_item_id: item.id, target_stage: field(form, "stage"), revision_instructions: revisionText }, "تم إرسال التعديل لصاحب المرحلة.")) { setRequestingRevision(false); setRevisionText(""); }
  }

  return <article className="request-file" id={`content-${item.id}`}>
    <Button href={backHref} variant="ghost"><ArrowRight size={16} />{backHref === "/tasks" ? "العودة لمهامي" : "طلبات المحتوى"}</Button>
    <header className="request-file-heading"><div><h1>{item.title}</h1><p>{contentFormatConfig[item.format].label}</p><ContentPublishTimes item={item}/></div>
      {canEdit ? <Button type="button" variant="ghost" onClick={() => { setDraft(canonical); setEditVersion(item.version); setFormError(""); setEditing(!editing); }} disabled={working}><Pencil size={15} />{editing ? "إلغاء التعديل" : "تعديل الطلب"}</Button> : null}
    </header>
    <ContentProgress tasks={tasks} status={item.status} />
    <div className="request-files-bar" aria-label="المادة الخام والتسليمات">
      {rawAssets.map((asset, i) => <FileLink key={asset.id} url={asset.url}>فتح المادة الخام{rawAssets.length > 1 ? ` ${i + 1}` : ""}</FileLink>)}
      {stageResults.filter(({ delivery }) => delivery?.result_url).map(({ task, delivery }) => <FileLink key={task.id} url={delivery!.result_url!}>{task.content_step === "recording" ? "فتح التسجيل" : task.content_step === "publishing" ? "فتح المنشور" : `مشاهدة ${contentStepConfig[task.content_step!].label}`}<small>إصدار {delivery!.version}</small></FileLink>)}
      {extraAssets.map((asset) => <FileLink key={asset.id} url={asset.url}>{asset.title}</FileLink>)}
      {!rawAssets.length && !stageResults.some(({ task, delivery }) => task.content_step === "recording" && delivery?.result_url) ? <span>المادة الخام: لم تُرفق بعد</span> : null}
      {stageResults.filter(({ task, delivery }) => ["editing", "thumbnail", "design"].includes(task.content_step!) && !delivery?.result_url).map(({ task }) => <span key={task.id}>{contentStepConfig[task.content_step!].label}: {task.status === "done" ? "تم التسليم كنص" : "لم يُسلّم بعد"}</span>)}
      {canAdd ? <button className="text-button" type="button" onClick={() => { setAddingLink(!addingLink); setFormError(""); }}><Plus size={15} /> إضافة رابط</button> : null}
    </div>
    {item.format==="carousel"?stageResults.filter(({delivery})=>delivery?.step==="design").map(({delivery})=><CarouselImageGallery key={delivery!.id} images={delivery!.result_images}/>):null}
    {addingLink && canAdd ? <form className="request-inline-form" onSubmit={addLink}>
      <label>اسم الرابط<input name="title" minLength={2} maxLength={160} required /></label>
      <label>الرابط<input name="url" type="url" dir="ltr" maxLength={2000} required /></label>
      <div className="request-form-pair"><label>النوع<select name="kind" defaultValue="raw_video">{Object.entries(contentAssetKindConfig).map(([key, config]) => <option key={key} value={key}>{config.label}</option>)}</select></label><label>الاستخدام<select name="stage" defaultValue={item.format === "post" ? "design" : "recording"}>{stages.map((step) => <option value={step} key={step}>{contentStepConfig[step].label}</option>)}</select></label></div>
      <label>ملاحظة — اختياري<input name="notes" maxLength={2000} /></label>
      {formError ? <p role="alert">{formError}</p> : null}<Button type="submit" disabled={working}>حفظ الرابط</Button><Button type="button" variant="ghost" onClick={() => setAddingLink(false)}>إلغاء</Button>
    </form> : null}

    <section className="request-document" aria-label="نص الطلب">
      {editing && canEdit ? <form onSubmit={saveRequest} className="request-inline-form">
        <EmojiTextarea label="نص الطلب" name="request_text" value={draft} onValueChange={setDraft} rows={22} minLength={10} maxLength={30000} required disabled={working} />
        <label>المصدر الأصلي — اختياري<input name="source" type="url" dir="ltr" maxLength={2000} defaultValue={item.intake_source_url ?? ""} /></label>
        {formError ? <p role="alert">{formError}</p> : null}<Button type="submit" disabled={working}>{working ? "جارٍ الحفظ..." : "حفظ الطلب"}</Button>
      </form> : <><h2>نص الطلب</h2><RequestText text={canonical || "لا يوجد نص إضافي لهذا الطلب."} /></>}
      {item.intake_source_url && !editing ? <FileLink url={contentSourceDeepLink(item.id, item.intake_source_url)}>المصدر الأصلي</FileLink> : null}
      {designerText ? <details className="request-disclosure"><summary>للمصمم</summary><RequestText text={designerText} /></details> : null}
    </section>

    <div className="request-bottom-actions">
      {tasks.filter((task) => task.owner_id === userId && task.is_work_item && ["ready", "in_progress", "blocked", "review"].includes(task.status)).map((task) => <Button key={task.id} href={task.status === "in_progress" ? taskDeliveryDeepLink(task.id) : taskDeepLink(task.id)} variant="secondary"><Link2 size={15} />{task.status === "in_progress" ? "تسليم" : "فتح مهمتي:"} {task.content_step ? contentStepConfig[task.content_step].label : task.title}</Button>)}
      {canEdit && revisionOptions.length ? <Button type="button" variant="secondary" onClick={() => { setRequestingRevision(!requestingRevision); setFormError(""); }}><Pencil size={15} /> طلب تعديل</Button> : null}
    </div>
    {requestingRevision && canEdit ? <form onSubmit={revise} className="request-inline-form">
      <label>التعديل على<select name="stage">{revisionOptions.map((step) => <option key={step} value={step}>{contentStepConfig[step].label}</option>)}</select></label>
      <EmojiTextarea label="التعديل المطلوب" value={revisionText} onValueChange={setRevisionText} minLength={5} maxLength={5000} rows={5} required />
      {formError ? <p role="alert">{formError}</p> : null}<Button type="submit" disabled={working}>إرسال التعديل</Button><Button type="button" variant="ghost" onClick={() => setRequestingRevision(false)}>إلغاء</Button>
    </form> : null}

    {/* Existing structured cues can be mandatory for legacy deliveries; keep their controls reachable. */}
    {timeline.length ? <details className="request-disclosure"><summary>تعليمات التوقيت المسجّلة ({timeline.filter((cue) => Boolean(cue.completed_at)).length}/{timeline.length})</summary><ul className="request-history">{timeline.map((cue) => <li key={cue.id}><span>{cue.start_seconds}{cue.end_seconds !== null ? `–${cue.end_seconds}` : ""} ثانية</span><RequestText text={cue.action} />{cue.source_url ? <FileLink url={cue.source_url}>فتح الرابط</FileLink> : null}{!readOnly && (platformAdmin || tasks.some((task) => task.content_step === "editing" && task.owner_id === userId)) ? <button className="text-button" type="button" disabled={working} onClick={() => void command({ action: "change_timeline_cue", cue_id: cue.id, completed: !cue.completed_at }, "تم تحديث التعليمة.")}>{cue.completed_at ? "إعادة فتح" : "تم التنفيذ"}</button> : <span>{cue.completed_at ? "تم التنفيذ" : "لم تُنفذ بعد"}</span>}</li>)}</ul></details> : null}
    <details className="request-disclosure" open={Boolean(revisionId)}><summary>سجل التسليمات والتعديلات</summary>
      <ul className="request-history">{tasks.filter((task) => task.is_work_item).map((task) => <li key={task.id}><strong>{task.content_step ? contentStepConfig[task.content_step].label : task.title}</strong><span>{person(task.owner_id)} · {taskStatusLabel(task.status, task.content_step)}</span><Button variant="ghost" href={taskDeepLink(task.id)}>فتح المهمة</Button>{latest.get(task.id)?.result_note ? <RequestText text={latest.get(task.id)!.result_note!} /> : null}</li>)}</ul>
      {deliveries.map((delivery) => <div className="request-history-entry" key={delivery.id}><strong>{contentStepConfig[delivery.step].label} · إصدار {delivery.version}</strong><small>{person(delivery.submitted_by)} · {formatDateTime(delivery.submitted_at)}</small>{delivery.result_url ? <FileLink url={delivery.result_url}>فتح التسليم</FileLink> : null}{delivery.result_note ? <RequestText text={delivery.result_note} /> : null}</div>)}
      {revisions.map((revision) => <div className="request-history-entry" id={`revision-${revision.id}`} key={revision.id} tabIndex={-1}><strong>تعديل {revision.round} · {contentStepConfig[revision.stage].label}</strong><RequestText text={revision.instructions} /><Button href={taskDeepLink(revision.task_id)} variant="ghost">فتح مهمة التعديل</Button></div>)}
      {item.caption_brief ? <div className="request-history-entry"><strong>نص النشر المحفوظ</strong><RequestText text={item.caption_brief} /></div> : null}
      {assets.map((asset) => <div className="request-history-entry" key={asset.id}><FileLink url={asset.url}>{asset.title}</FileLink><small>{contentAssetKindConfig[asset.kind as ContentAssetKind].label} · {person(asset.created_by)}</small>{asset.notes ? <RequestText text={asset.notes} /> : null}{!readOnly && (platformAdmin || asset.created_by === userId) ? <button className="text-button" type="button" disabled={working} onClick={() => { if (window.confirm(`إزالة الرابط «${asset.title}» من الطلب؟ الملف الأصلي لن يُحذف.`)) void command({ action: "remove_asset", asset_id: asset.id }, "أُزيل الرابط من الطلب؛ الملف الأصلي لم يُحذف."); }}><Trash2 size={13} /> إزالة الرابط</button> : null}</div>)}
      {!deliveries.length && !revisions.length ? <p><CheckCircle2 size={14} /> لا توجد تسليمات أو تعديلات مسجّلة بعد.</p> : null}
    </details>
  </article>;
}
