"use client";

import { CheckCircle2, ExternalLink, Link2, LoaderCircle, MessageSquareText, Plus, Sparkles, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import {
  contentAssignmentFields,
  contentCueKindConfig,
  contentStepConfig,
  type ContentCueKind,
} from "../../lib/content";
import {
  formatTimelineSeconds,
  parseProductionRequest,
  type IntakeTimelineCue,
  type ParsedProductionRequest,
} from "../../lib/content-intake";
import { Button } from "../ui/Button";

type TeamPerson = { id: string; name: string };
type ApprovedBrandArticle = { id: string; title: string; version: number; categoryLabel: string };

export type QuickIntakePayload = {
  target_publish_at: string;
  intake_request_text: string;
  telegram_source_url: string;
  content_title: string;
  content_goal: string;
  content_hook: string;
  content_cta: string;
  content_script_outline: string;
  content_editing_brief: string;
  content_thumbnail_brief: string;
  content_brand_notes: string;
  brand_article_ids: string[];
  parsed_timeline: Array<{
    start_seconds: number;
    end_seconds: number | null;
    kind: ContentCueKind;
    action: string;
    source_url: string | null;
  }>;
  parsed_assets: Array<{
    kind: "reference" | "thumbnail";
    stage: "editing" | "thumbnail";
    title: string;
    url: string;
    notes: string;
  }>;
  [ownerField: string]: unknown;
};

type Props = {
  currentUserId: string;
  defaultPublish: string;
  people: TeamPerson[];
  approvedBrandArticles: ApprovedBrandArticle[];
  working: boolean;
  onCancel: () => void;
  onCreate: (payload: QuickIntakePayload) => Promise<boolean>;
};

function updateTimelineCue(
  draft: ParsedProductionRequest,
  index: number,
  patch: Partial<IntakeTimelineCue>,
) {
  return {
    ...draft,
    timeline: draft.timeline.map((cue, cueIndex) => cueIndex === index ? { ...cue, ...patch } : cue),
  };
}

export function QuickIntakeForm({ currentUserId, defaultPublish, people, approvedBrandArticles, working, onCancel, onCreate }: Props) {
  const [rawRequest, setRawRequest] = useState("");
  const [telegramUrl, setTelegramUrl] = useState("");
  const [draft, setDraft] = useState<ParsedProductionRequest | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  function analyzeRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (rawRequest.trim().length < 20) {
      setFormError("ألصق طلب الشغل كاملًا من Telegram أولًا.");
      return;
    }
    try {
      const source = new URL(telegramUrl);
      if (source.protocol !== "https:" || !["t.me", "telegram.me"].includes(source.hostname.toLowerCase())) throw new Error("invalid");
    } catch {
      setFormError("أضف رابط رسالة المادة الخام على Telegram حتى يظل الأصل محفوظًا في مكانه.");
      return;
    }
    setDraft(parseProductionRequest(rawRequest));
    setFormError(null);
  }

  async function distributeRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const form = new FormData(event.currentTarget);
    const publishValue = String(form.get("publish_at") ?? "");
    const publishDate = new Date(publishValue);
    if (!publishValue || Number.isNaN(publishDate.getTime()) || publishDate.getTime() <= Date.now() + 60 * 60 * 1000) {
      setFormError("موعد النشر يجب أن يكون بعد ساعة على الأقل من الآن.");
      return;
    }
    if ([draft.title, draft.goal, draft.hook, draft.cta, draft.scriptOutline, draft.editingBrief, draft.thumbnailBrief].some((value) => value.trim().length < 3)) {
      setFormError("راجع الحقول المستخرجة؛ يوجد جزء أساسي فارغ أو غير واضح.");
      return;
    }
    if (draft.timeline.some((cue) => cue.startSeconds < 0 || (cue.endSeconds !== null && cue.endSeconds < cue.startSeconds) || cue.action.trim().length < 3)) {
      setFormError("راجع توقيتات الـTimeline؛ وقت النهاية يجب ألا يسبق البداية وكل سطر يحتاج إجراءً واضحًا.");
      return;
    }

    const payload: QuickIntakePayload = {
      target_publish_at: publishDate.toISOString(),
      intake_request_text: rawRequest.trim(),
      telegram_source_url: telegramUrl.trim(),
      content_title: draft.title.trim(),
      content_goal: draft.goal.trim(),
      content_hook: draft.hook.trim(),
      content_cta: draft.cta.trim(),
      content_script_outline: draft.scriptOutline.trim(),
      content_editing_brief: draft.editingBrief.trim(),
      content_thumbnail_brief: draft.thumbnailBrief.trim(),
      content_brand_notes: draft.brandNotes.trim(),
      brand_article_ids: form.getAll("brand_reference_ids").map(String),
      parsed_timeline: draft.timeline.map((cue) => ({
        start_seconds: cue.startSeconds,
        end_seconds: cue.endSeconds,
        kind: cue.kind,
        action: cue.action.trim(),
        source_url: cue.sourceUrl,
      })),
      parsed_assets: draft.assets,
      ...Object.fromEntries(contentAssignmentFields.map(({ name }) => [name, String(form.get(name) ?? "")])),
    };
    const created = await onCreate(payload);
    if (!created) setFormError("لم يتم الحفظ. راجع رسالة الخطأ أعلى الصفحة ثم حاول مرة أخرى.");
  }

  if (!draft) {
    return (
      <form className="panel quick-intake-form" onSubmit={analyzeRequest}>
        <div className="section-heading"><div><p className="overline">Telegram → خطة تنفيذ</p><h2>ألصق الطلب كما هو</h2></div><button className="text-button" type="button" onClick={onCancel}>إغلاق</button></div>
        <div className="quick-intake-intro"><MessageSquareText size={20} /><div><strong>لا ترتّب الرسالة بنفسك</strong><p>انسخ المطلوب كاملًا بالروابط والتوقيتات وكلام الغلاف. سنحوّله إلى مسودة منظمة، ولن يتوزع أي شيء قبل مراجعتك.</p></div></div>
        <label className="quick-intake-source"><span>رابط رسالة المادة الخام على Telegram</span><input value={telegramUrl} onChange={(event) => setTelegramUrl(event.target.value)} type="url" dir="ltr" required placeholder="https://t.me/c/..." /><small>من Telegram اختر الرسالة أو الملف ثم «نسخ الرابط». الملف يظل على Telegram في هذه المرحلة.</small></label>
        <label className="quick-intake-request"><span>نص طلب الشغل كاملًا</span><textarea value={rawRequest} onChange={(event) => setRawRequest(event.target.value)} minLength={20} maxLength={30000} rows={16} required placeholder="الصق الرسالة كما كتبتها: التعليمات العامة، الحذف، الثواني، الروابط، السكريبت، وكلام الكفر…" /></label>
        {formError ? <p className="form-notice error" role="alert">{formError}</p> : null}
        <div className="form-actions"><Button type="submit"><Sparkles size={16} /> تحليل وترتيب الطلب</Button><small>المحلل ينشئ مسودة قابلة للتعديل، ولا يحفظ مهمة الآن.</small></div>
      </form>
    );
  }

  return (
    <form className="panel quick-intake-form quick-intake-review" onSubmit={(event) => void distributeRequest(event)}>
      <div className="section-heading"><div><p className="overline">مراجعة قبل التوزيع</p><h2>راجع ما فهمه النظام</h2></div><button className="text-button" type="button" onClick={() => setDraft(null)}>رجوع للنص الأصلي</button></div>

      <div className="intake-review-summary"><span><CheckCircle2 size={15} /> {draft.timeline.length} تعليمة زمنية</span><span><Link2 size={15} /> {draft.assets.length + 1} رابط ومادة خام</span><span><MessageSquareText size={15} /> {draft.mentions.length ? `ذِكر: ${draft.mentions.join("، ")}` : "اختر المسؤولين يدويًا"}</span></div>
      {draft.warnings.length ? <ul className="intake-warnings">{draft.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}

      <div className="form-grid intake-core-fields">
        <label><span>عنوان الريلز</span><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} minLength={3} maxLength={180} required /></label>
        <label><span>موعد النشر النهائي</span><input name="publish_at" type="datetime-local" defaultValue={defaultPublish} required /></label>
        <label className="full-field"><span>الهدف</span><textarea value={draft.goal} onChange={(event) => setDraft({ ...draft, goal: event.target.value })} minLength={5} maxLength={1000} rows={2} required /></label>
        <label className="full-field"><span>الـHook</span><textarea value={draft.hook} onChange={(event) => setDraft({ ...draft, hook: event.target.value })} minLength={3} maxLength={1000} rows={2} required /></label>
        <label className="full-field"><span>الـCTA</span><textarea value={draft.cta} onChange={(event) => setDraft({ ...draft, cta: event.target.value })} minLength={2} maxLength={500} rows={2} required /></label>
        <label className="full-field"><span>السكريبت المستخرج</span><textarea value={draft.scriptOutline} onChange={(event) => setDraft({ ...draft, scriptOutline: event.target.value })} minLength={10} maxLength={8000} rows={7} required /></label>
        <label className="full-field"><span>التعليمات العامة للمونتاج</span><textarea value={draft.editingBrief} onChange={(event) => setDraft({ ...draft, editingBrief: event.target.value })} minLength={10} maxLength={8000} rows={5} required /></label>
        <label className="full-field"><span>تعليمات الغلاف المستخرجة</span><textarea value={draft.thumbnailBrief} onChange={(event) => setDraft({ ...draft, thumbnailBrief: event.target.value })} minLength={10} maxLength={4000} rows={4} required /></label>
        <label className="full-field"><span>استثناءات أو ملاحظات خاصة بهذا الريلز — اختياري</span><textarea value={draft.brandNotes} onChange={(event) => setDraft({ ...draft, brandNotes: event.target.value })} maxLength={4000} rows={2} placeholder="اكتب فقط ما يختلف عن قواعد البراند المعتمدة لهذا الطلب" /></label>
      </div>

      <BrandReferenceSelector articles={approvedBrandArticles} />

      <section className="intake-timeline-editor">
        <div className="production-tool-heading"><div><MessageSquareText size={16} /><div><p className="overline">Timeline</p><h4>تعليمات التنفيذ بالثانية</h4></div></div><button className="text-button" type="button" onClick={() => setDraft({ ...draft, timeline: [...draft.timeline, { startSeconds: 0, endSeconds: null, kind: "note", action: "", sourceUrl: null }] })}><Plus size={13} /> إضافة سطر</button></div>
        {draft.timeline.length ? <div className="intake-timeline-rows">{draft.timeline.map((cue, index) => <div className="intake-timeline-row" key={`${index}-${cue.startSeconds}`}>
          <label><span>من</span><input type="number" min={0} max={86399} value={cue.startSeconds} onChange={(event) => setDraft(updateTimelineCue(draft, index, { startSeconds: Number(event.target.value) }))} /><small>{formatTimelineSeconds(cue.startSeconds)}</small></label>
          <label><span>إلى</span><input type="number" min={0} max={86399} value={cue.endSeconds ?? ""} onChange={(event) => setDraft(updateTimelineCue(draft, index, { endSeconds: event.target.value === "" ? null : Number(event.target.value) }))} /><small>{cue.endSeconds === null ? "لحظة واحدة" : formatTimelineSeconds(cue.endSeconds)}</small></label>
          <label><span>النوع</span><select value={cue.kind} onChange={(event) => setDraft(updateTimelineCue(draft, index, { kind: event.target.value as ContentCueKind }))}>{(Object.keys(contentCueKindConfig) as ContentCueKind[]).map((kind) => <option value={kind} key={kind}>{contentCueKindConfig[kind].label}</option>)}</select></label>
          <label className="cue-action-field"><span>الإجراء المطلوب</span><textarea rows={2} value={cue.action} onChange={(event) => setDraft(updateTimelineCue(draft, index, { action: event.target.value }))} required /></label>
          <div className="cue-source-preview">{cue.sourceUrl ? <a href={cue.sourceUrl} target="_blank" rel="noreferrer">المصدر <ExternalLink size={11} /></a> : <span>بدون رابط خاص</span>}<button type="button" aria-label={`حذف تعليمة رقم ${index + 1}`} onClick={() => setDraft({ ...draft, timeline: draft.timeline.filter((_item, cueIndex) => cueIndex !== index) })}><Trash2 size={13} /></button></div>
        </div>)}</div> : <p className="tool-empty">لم تُستخرج توقيتات. أضف السطور يدويًا قبل التوزيع إن كان الطلب يحتاجها.</p>}
      </section>

      {draft.assets.length ? <section className="intake-assets-preview"><p className="overline">الروابط المستخرجة</p><ul>{draft.assets.map((asset) => <li key={`${asset.stage}-${asset.url}`}><span>{asset.stage === "thumbnail" ? "غلاف" : "مونتاج"}</span><a href={asset.url} target="_blank" rel="noreferrer">{asset.title} <ExternalLink size={11} /></a></li>)}</ul></section> : null}

      <div className="assignment-block intake-assignment-block">
        <div><p className="overline">التوزيع</p><h3>راجع المسؤول عن كل خطوة</h3><p>الأسماء المذكورة في Telegram تظهر كتلميح فقط؛ التوزيع الفعلي يظل من أعضاء النظام.</p></div>
        <div className="assignment-grid">{contentAssignmentFields.map(({ step, name }) => <label key={step}><span>{contentStepConfig[step].label}</span><select name={name} defaultValue={currentUserId} required>{people.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>)}</div>
      </div>

      {formError ? <p className="form-notice error" role="alert">{formError}</p> : null}
      <div className="intake-future-note"><strong>رفع الملفات المباشر: ضمن الخطة التالية</strong><p>النسخة الحالية تحفظ رابط رسالة المادة الخام على Telegram. لن ننسخ أو نرفع الملف إلى الموقع الآن.</p></div>
      <div className="form-actions"><Button type="submit" disabled={working}>{working ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />} اعتماد وإنشاء خط الإنتاج</Button><small>بعد الاعتماد فقط تُنشأ المهام والـTimeline والروابط معًا.</small></div>
    </form>
  );
}

function BrandReferenceSelector({ articles }: { articles: ApprovedBrandArticle[] }) {
  return <section className="brand-reference-selector">
    <div><p className="overline">قواعد التنفيذ</p><h3>مراجع البراند المعتمدة</h3><p>اختر القواعد التي يجب أن يفتحها المصمم والمونتير والكاتب مع هذا الريلز.</p></div>
    {articles.length ? <div>{articles.map((article) => <label key={article.id}><input type="checkbox" name="brand_reference_ids" value={article.id} aria-label={`ربط مرجع ${article.title}`} /><span><strong>{article.title}</strong><small>{article.categoryLabel} · النسخة {article.version}</small></span></label>)}</div> : <p className="brand-reference-empty">لا يوجد مرجع معتمد بعد. يمكنك إنشاء الطلب الآن، أو اعتماد أول مرجع من <a href="/brand">مركز البراند</a>.</p>}
  </section>;
}
