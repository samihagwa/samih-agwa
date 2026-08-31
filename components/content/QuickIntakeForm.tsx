"use client";

import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Film,
  Link2,
  LoaderCircle,
  MessageSquareText,
  Mic2,
  Plus,
  Sparkles,
  Trash2,
  UserRoundCheck,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";

type TeamPerson = { id: string; name: string };
type ApprovedBrandArticle = { id: string; title: string; version: number; categoryLabel: string };
type RawMaterialKind = "raw_video" | "audio" | "source";
type RawMaterialDraft = { id: string; kind: RawMaterialKind; url: string };

export type QuickIntakePayload = {
  request_id: string;
  target_publish_at: string;
  content_title: string;
  content_request_text: string;
  raw_materials: Array<{ kind: RawMaterialKind; url: string }>;
  editing_owner_id: string;
  thumbnail_owner_id: string;
  publishing_owner_id: string;
  brand_article_ids: string[];
};

type Props = {
  currentUserId: string;
  defaultOwnerIds: Record<string, string>;
  defaultPublish: string;
  people: TeamPerson[];
  approvedBrandArticles: ApprovedBrandArticle[];
  working: boolean;
  onCancel: () => void;
  onCreate: (payload: QuickIntakePayload) => Promise<boolean>;
};

const wizardSteps = [
  { label: "العنوان", hint: "اسم الريلز" },
  { label: "الموعد", hint: "موعد النشر" },
  { label: "الطلب", hint: "كل المطلوب" },
  { label: "الخامات", hint: "روابط Telegram" },
  { label: "المونتاج", hint: "المسؤول" },
  { label: "الغلاف", hint: "المصمم" },
  { label: "النشر", hint: "من سينشر" },
  { label: "المراجعة", hint: "تأكيد نهائي" },
] as const;

const rawMaterialLabels: Record<RawMaterialKind, string> = {
  raw_video: "فيديو",
  audio: "ملف صوتي",
  source: "مصدر أو ملف آخر",
};

function isTelegramUrl(value: string) {
  try {
    const source = new URL(value);
    return source.protocol === "https:"
      && ["t.me", "telegram.me"].includes(source.hostname.toLowerCase())
      && !source.username
      && !source.password
      && !source.port
      && source.pathname !== "/";
  } catch {
    return false;
  }
}

function formatReviewDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "موعد غير صالح";
  return new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function QuickIntakeForm({
  currentUserId,
  defaultOwnerIds,
  defaultPublish,
  people,
  approvedBrandArticles,
  working,
  onCancel,
  onCreate,
}: Props) {
  const fallbackOwnerId = people.some((person) => person.id === currentUserId)
    ? currentUserId
    : people[0]?.id ?? "";
  const ownerDefault = (field: string) => people.some((person) => person.id === defaultOwnerIds[field])
    ? defaultOwnerIds[field]
    : fallbackOwnerId;
  const otherPublishers = people.filter((person) => person.id !== currentUserId);
  const defaultTeamPublisher = otherPublishers.some((person) => person.id === defaultOwnerIds.publishing_owner_id)
    ? defaultOwnerIds.publishing_owner_id
    : otherPublishers[0]?.id ?? "";

  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [publishAt, setPublishAt] = useState(defaultPublish);
  const [requestText, setRequestText] = useState("");
  const [rawMaterials, setRawMaterials] = useState<RawMaterialDraft[]>([
    { id: "raw-material-1", kind: "raw_video", url: "" },
  ]);
  const [editingOwnerId, setEditingOwnerId] = useState(() => ownerDefault("editing_owner_id"));
  const [thumbnailOwnerId, setThumbnailOwnerId] = useState(() => ownerDefault("thumbnail_owner_id"));
  const [publishingMode, setPublishingMode] = useState<"self" | "member">("self");
  const [publishingOwnerId, setPublishingOwnerId] = useState(defaultTeamPublisher);
  const [brandArticleIds, setBrandArticleIds] = useState<string[]>([]);
  const [stepError, setStepError] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);
  const rawMaterialCounter = useRef(1);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const progress = Math.round(((step + 1) / wizardSteps.length) * 100);

  useEffect(() => {
    stepHeadingRef.current?.focus({ preventScroll: true });
  }, [step]);

  function validateStep(targetStep: number) {
    if (targetStep === 0 && title.trim().length < 3) return "اكتب عنوانًا واضحًا للريلز من 3 حروف على الأقل.";
    if (targetStep === 1) {
      const publishDate = new Date(publishAt);
      if (!publishAt || Number.isNaN(publishDate.getTime())) {
        return "اختر تاريخًا ووقتًا صحيحين للنشر.";
      }
    }
    if (targetStep === 2 && requestText.trim().length < 10) {
      return "اكتب المطلوب كاملًا؛ النص الحالي قصير ولا يوضح المهمة.";
    }
    if (targetStep === 3) {
      if (!rawMaterials.length) return "أضف رابط مادة خام واحدًا على الأقل قبل المتابعة.";
      const invalidMaterial = rawMaterials.find((material) => !isTelegramUrl(material.url.trim()));
      if (invalidMaterial) return "كل مادة خام تحتاج رابط Telegram صحيحًا يبدأ بـ https://t.me/.";
      const normalizedLinks = rawMaterials.map((material) => material.url.trim().toLowerCase());
      if (new Set(normalizedLinks).size !== normalizedLinks.length) return "يوجد رابط مادة خام مكرر. احذفه أو استبدله برابط آخر.";
    }
    if (targetStep === 4 && !people.some((person) => person.id === editingOwnerId)) return "اختر عضوًا مسؤولًا عن المونتاج.";
    if (targetStep === 5 && !people.some((person) => person.id === thumbnailOwnerId)) return "اختر عضوًا مسؤولًا عن تصميم الغلاف.";
    if (targetStep === 6 && publishingMode === "member" && !otherPublishers.some((person) => person.id === publishingOwnerId)) {
      return otherPublishers.length ? "اختر عضوًا مسؤولًا عن النشر." : "لا يوجد عضو آخر متاح للنشر؛ اختر «سأنشره بنفسي».";
    }
    return null;
  }

  function goToStep(nextStep: number) {
    setStepError(null);
    setStep(Math.max(0, Math.min(nextStep, wizardSteps.length - 1)));
  }

  function goNext() {
    const validationError = validateStep(step);
    if (validationError) {
      setStepError(validationError);
      return;
    }
    goToStep(step + 1);
  }

  function addRawMaterial() {
    if (rawMaterials.length >= 10) {
      setStepError("يمكن إضافة 10 روابط مادة خام كحد أقصى داخل الطلب الواحد.");
      return;
    }
    rawMaterialCounter.current += 1;
    setRawMaterials((current) => [...current, {
      id: `raw-material-${rawMaterialCounter.current}`,
      kind: "raw_video",
      url: "",
    }]);
    setStepError(null);
  }

  function updateRawMaterial(id: string, patch: Partial<Pick<RawMaterialDraft, "kind" | "url">>) {
    setRawMaterials((current) => current.map((material) => material.id === id ? { ...material, ...patch } : material));
    setStepError(null);
  }

  function removeRawMaterial(id: string) {
    setRawMaterials((current) => current.filter((material) => material.id !== id));
    setStepError(null);
  }

  function toggleBrandArticle(articleId: string) {
    setBrandArticleIds((current) => {
      if (current.includes(articleId)) return current.filter((id) => id !== articleId);
      if (current.length >= 8) {
        setStepError("يمكن ربط 8 مراجع براند كحد أقصى.");
        return current;
      }
      setStepError(null);
      return [...current, articleId];
    });
  }

  async function createRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step < wizardSteps.length - 1) {
      goNext();
      return;
    }

    for (let targetStep = 0; targetStep < wizardSteps.length - 1; targetStep += 1) {
      const validationError = validateStep(targetStep);
      if (validationError) {
        setStep(targetStep);
        setStepError(validationError);
        return;
      }
    }

    requestId.current ??= globalThis.crypto.randomUUID();
    const payload: QuickIntakePayload = {
      request_id: requestId.current,
      target_publish_at: new Date(publishAt).toISOString(),
      content_title: title.trim(),
      content_request_text: requestText.trim(),
      raw_materials: rawMaterials.map(({ kind, url }) => ({ kind, url: url.trim() })),
      editing_owner_id: editingOwnerId,
      thumbnail_owner_id: thumbnailOwnerId,
      publishing_owner_id: publishingMode === "self" ? currentUserId : publishingOwnerId,
      brand_article_ids: brandArticleIds,
    };

    const created = await onCreate(payload);
    if (!created) setStepError("لم يتم الحفظ. راجع رسالة الخطأ أعلى الصفحة ثم حاول مرة أخرى.");
  }

  return (
    <form className="panel quick-intake-form content-request-wizard" onSubmit={(event) => void createRequest(event)}>
      <div className="section-heading quick-intake-heading">
        <div><p className="overline">طلب واحد · خطوة بخطوة</p><h2>طلب ريلز كامل</h2></div>
        <button className="text-button" type="button" onClick={onCancel}>إغلاق</button>
      </div>

      <div className="quick-intake-progress" aria-label={`الخطوة ${step + 1} من ${wizardSteps.length}`}>
        <div><strong>الخطوة {step + 1} من {wizardSteps.length}</strong><span>{wizardSteps[step].label} · {wizardSteps[step].hint}</span></div>
        <span className="quick-intake-progress-track" role="progressbar" aria-valuemin={1} aria-valuemax={wizardSteps.length} aria-valuenow={step + 1}><span style={{ width: `${progress}%` }} /></span>
      </div>

      <section className="quick-intake-step" aria-labelledby={`quick-intake-step-${step}`}>
        {step === 0 ? <>
          <div className="quick-intake-step-heading"><Film size={20} /><div><p className="overline">أول خطوة</p><h3 id="quick-intake-step-0" ref={stepHeadingRef} tabIndex={-1}>ما عنوان الريلز؟</h3><p>اكتب اسمًا قصيرًا يعرّف الطلب داخل البورد والمهام.</p></div></div>
          <label className="quick-intake-main-field"><span>عنوان الريلز</span><input value={title} onChange={(event) => { setTitle(event.target.value); setStepError(null); }} minLength={3} maxLength={180} required placeholder="مثال: نموذج 1234 لتأكيد تغير الاتجاه" /></label>
        </> : null}

        {step === 1 ? <>
          <div className="quick-intake-step-heading"><CalendarClock size={20} /><div><p className="overline">موعد واضح</p><h3 id="quick-intake-step-1" ref={stepHeadingRef} tabIndex={-1}>إمتى الريلز ينزل؟</h3><p>ده موعد النشر النهائي، والنظام هيحسب مواعيد التسليم بناءً عليه.</p></div></div>
          <label className="quick-intake-main-field"><span>موعد النشر النهائي</span><input value={publishAt} onChange={(event) => { setPublishAt(event.target.value); setStepError(null); }} type="datetime-local" required /></label>
        </> : null}

        {step === 2 ? <>
          <div className="quick-intake-step-heading"><MessageSquareText size={20} /><div><p className="overline">المرجع الأساسي</p><h3 id="quick-intake-step-2" ref={stepHeadingRef} tabIndex={-1}>اكتب كل المطلوب والروابط</h3><p>الصق نفس الرسالة التي كنت سترسلها في جروب الشغل؛ ستظل كما هي للجميع.</p></div></div>
          <label className="quick-intake-main-field quick-intake-request"><span>شرح الطلب بالكامل</span><textarea value={requestText} onChange={(event) => { setRequestText(event.target.value); setStepError(null); }} minLength={10} maxLength={30000} rows={16} required placeholder="السكريبت، الحذف، الثواني، تعليمات المونتاج والغلاف، روابط الصور والمصادر، وأي ملاحظات…" /><small>أي رابط داخل النص سيظل في مكانه ويظهر قابلًا للفتح.</small></label>
        </> : null}

        {step === 3 ? <>
          <div className="quick-intake-step-heading"><Link2 size={20} /><div><p className="overline">بوابة إجبارية</p><h3 id="quick-intake-step-3" ref={stepHeadingRef} tabIndex={-1}>فين المادة الخام على Telegram؟</h3><p>لن تخرج أي مهمة للفريق قبل إضافة رابط خام صحيح واحد على الأقل.</p></div></div>
          <div className="raw-material-list">
            {rawMaterials.map((material, index) => <article key={material.id}>
              <header><div>{material.kind === "audio" ? <Mic2 size={15} /> : material.kind === "raw_video" ? <Film size={15} /> : <Link2 size={15} />}<strong>مادة خام {index + 1}</strong></div><button type="button" onClick={() => removeRawMaterial(material.id)} aria-label={`حذف المادة الخام ${index + 1}`}><Trash2 size={14} /> حذف</button></header>
              <div>
                <label><span>النوع</span><select value={material.kind} onChange={(event) => updateRawMaterial(material.id, { kind: event.target.value as RawMaterialKind })}>{(Object.keys(rawMaterialLabels) as RawMaterialKind[]).map((kind) => <option key={kind} value={kind}>{rawMaterialLabels[kind]}</option>)}</select></label>
                <label><span>رابط Telegram</span><input value={material.url} onChange={(event) => updateRawMaterial(material.id, { url: event.target.value })} type="url" inputMode="url" dir="ltr" maxLength={2000} placeholder="https://t.me/c/..." /></label>
              </div>
            </article>)}
            {!rawMaterials.length ? <p className="raw-material-empty"><Link2 size={15} /> لا توجد خامات. أضف رابطًا حتى تقدر تكمل.</p> : null}
          </div>
          <Button type="button" variant="secondary" className="raw-material-add" onClick={addRawMaterial}><Plus size={15} /> إضافة مادة خام أخرى</Button>
        </> : null}

        {step === 4 ? <>
          <div className="quick-intake-step-heading"><UserRoundCheck size={20} /><div><p className="overline">مسؤول واحد</p><h3 id="quick-intake-step-4" ref={stepHeadingRef} tabIndex={-1}>مين هيعمل المونتاج؟</h3><p>المادة الخام جاهزة، لذلك المهمة ستظهر للمسؤول فور إنشاء الطلب.</p></div></div>
          <label className="quick-intake-main-field"><span>مسؤول المونتاج</span><select value={editingOwnerId} onChange={(event) => { setEditingOwnerId(event.target.value); setStepError(null); }} required>{people.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
        </> : null}

        {step === 5 ? <>
          <div className="quick-intake-step-heading"><Sparkles size={20} /><div><p className="overline">يعمل بالتوازي</p><h3 id="quick-intake-step-5" ref={stepHeadingRef} tabIndex={-1}>مين هيصمم الغلاف؟</h3><p>مهمة الغلاف تبدأ مع المونتاج بعد حفظ الطلب، من غير انتظار إنهاء المونتاج.</p></div></div>
          <label className="quick-intake-main-field"><span>مسؤول تصميم الغلاف</span><select value={thumbnailOwnerId} onChange={(event) => { setThumbnailOwnerId(event.target.value); setStepError(null); }} required>{people.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
        </> : null}

        {step === 6 ? <>
          <div className="quick-intake-step-heading"><UserRoundCheck size={20} /><div><p className="overline">آخر مرحلة</p><h3 id="quick-intake-step-6" ref={stepHeadingRef} tabIndex={-1}>مين مسؤول عن النشر؟</h3><p>مهمة النشر لن تفتح قبل اكتمال المونتاج والغلاف.</p></div></div>
          <fieldset className="publishing-owner-choice">
            <legend>طريقة النشر</legend>
            <label aria-label="سأنشره بنفسي"><input aria-label="سأنشره بنفسي" type="radio" name="publishing_mode" value="self" checked={publishingMode === "self"} onChange={() => { setPublishingMode("self"); setStepError(null); }} /><span><strong>سأنشره بنفسي</strong><small>{peopleById.get(currentUserId)?.name ?? "حسابي الحالي"}</small></span></label>
            <label aria-label="عضو من الفريق"><input aria-label="عضو من الفريق" type="radio" name="publishing_mode" value="member" checked={publishingMode === "member"} onChange={() => { setPublishingMode("member"); setPublishingOwnerId((current) => current || defaultTeamPublisher); setStepError(null); }} disabled={!otherPublishers.length} /><span><strong>عضو من الفريق</strong><small>{otherPublishers.length ? "اختر المسؤول من القائمة" : "لا يوجد عضو آخر متاح حاليًا"}</small></span></label>
          </fieldset>
          {publishingMode === "member" ? <label className="quick-intake-main-field"><span>مسؤول النشر</span><select value={publishingOwnerId} onChange={(event) => { setPublishingOwnerId(event.target.value); setStepError(null); }} required>{otherPublishers.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label> : null}
        </> : null}

        {step === 7 ? <>
          <div className="quick-intake-step-heading"><CheckCircle2 size={20} /><div><p className="overline">قبل الإنشاء</p><h3 id="quick-intake-step-7" ref={stepHeadingRef} tabIndex={-1}>راجع الطلب مرة أخيرة</h3><p>لحد اللحظة دي لم يُرسل شيء للفريق. الإنشاء فقط هو الذي يحفظ ويفتح المهام.</p></div></div>
          <div className="quick-intake-review-grid">
            <ReviewItem label="العنوان" value={title} onEdit={() => goToStep(0)} />
            <ReviewItem label="موعد النشر" value={formatReviewDate(publishAt)} onEdit={() => goToStep(1)} />
            <ReviewItem label="المونتاج" value={peopleById.get(editingOwnerId)?.name ?? "غير محدد"} onEdit={() => goToStep(4)} />
            <ReviewItem label="الغلاف" value={peopleById.get(thumbnailOwnerId)?.name ?? "غير محدد"} onEdit={() => goToStep(5)} />
            <ReviewItem label="النشر" value={publishingMode === "self" ? peopleById.get(currentUserId)?.name ?? "بنفسي" : peopleById.get(publishingOwnerId)?.name ?? "غير محدد"} onEdit={() => goToStep(6)} />
            <ReviewItem label="المواد الخام" value={`${rawMaterials.length} رابط Telegram`} onEdit={() => goToStep(3)} />
            <ReviewItem label="كل المطلوب" value={requestText} onEdit={() => goToStep(2)} wide />
          </div>
          <BrandReferenceSelector articles={approvedBrandArticles} selectedIds={brandArticleIds} onToggle={toggleBrandArticle} />
          <p className="quick-intake-submit-proof"><CheckCircle2 size={15} /> بمجرد الإنشاء سيصل للمونتاج والغلاف طلبان واضحان، والنشر ينتظر اكتمالهما.</p>
        </> : null}
      </section>

      {stepError ? <p className="form-notice error quick-intake-inline-error" role="alert">{stepError}</p> : null}
      <div className="form-actions quick-intake-navigation">
        {step > 0 ? <Button type="button" variant="secondary" disabled={working} onClick={() => goToStep(step - 1)}><ArrowRight size={15} /> رجوع</Button> : null}
        {step < wizardSteps.length - 1
          ? <Button key="quick-intake-next" type="button" disabled={working} onClick={(event) => { event.preventDefault(); goNext(); }}>التالي</Button>
          : <Button key="quick-intake-submit" type="submit" disabled={working}>{working ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />} إنشاء الطلب وإسناده</Button>}
        <small>{step < wizardSteps.length - 1 ? "لن يتم حفظ أو إرسال أي شيء الآن." : "الحفظ يتم مرة واحدة: الطلب والخامات والمهام معًا."}</small>
      </div>
    </form>
  );
}

function ReviewItem({ label, value, onEdit, wide = false }: { label: string; value: string; onEdit: () => void; wide?: boolean }) {
  return <article className={wide ? "wide" : undefined}><div><span>{label}</span><p>{value || "—"}</p></div><button type="button" onClick={onEdit}>تعديل</button></article>;
}

function BrandReferenceSelector({ articles, selectedIds, onToggle }: { articles: ApprovedBrandArticle[]; selectedIds: string[]; onToggle: (articleId: string) => void }) {
  return <section className="brand-reference-selector quick-intake-brand-references">
    <div><p className="overline">اختياري</p><h3>مراجع البراند</h3><p>اربط مرجعًا فقط إذا كان هذا الطلب يحتاج قواعد محددة.</p></div>
    {articles.length ? <div>{articles.map((article) => <label key={article.id}><input type="checkbox" checked={selectedIds.includes(article.id)} onChange={() => onToggle(article.id)} aria-label={`ربط مرجع ${article.title}`} /><span><strong>{article.title}</strong><small>{article.categoryLabel} · النسخة {article.version}</small></span></label>)}</div> : <p className="brand-reference-empty"><Link2 size={13} /> لا توجد مراجع معتمدة بعد، ويمكن إنشاء الطلب بدونها.</p>}
  </section>;
}
