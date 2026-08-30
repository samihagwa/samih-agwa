"use client";

import { CheckCircle2, Link2, LoaderCircle, MessageSquareText, Sparkles } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { contentAssignmentFields } from "../../lib/content";
import { Button } from "../ui/Button";

type TeamPerson = { id: string; name: string };
type ApprovedBrandArticle = { id: string; title: string; version: number; categoryLabel: string };

export type QuickIntakePayload = {
  request_id: string;
  target_publish_at: string;
  content_title: string;
  content_request_text: string;
  telegram_source_url: string;
  raw_material_sent: boolean;
  brand_article_ids: string[];
  [ownerField: string]: unknown;
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

function isTelegramUrl(value: string) {
  if (!value) return true;
  try {
    const source = new URL(value);
    return source.protocol === "https:" && ["t.me", "telegram.me"].includes(source.hostname.toLowerCase());
  } catch {
    return false;
  }
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
  const [formError, setFormError] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);
  const fallbackOwnerId = people.some((person) => person.id === currentUserId)
    ? currentUserId
    : people[0]?.id ?? "";
  const ownerDefault = (field: string) => people.some((person) => person.id === defaultOwnerIds[field])
    ? defaultOwnerIds[field]
    : fallbackOwnerId;

  async function createRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const requestText = String(form.get("request_text") ?? "").trim();
    const telegramSource = String(form.get("telegram_source_url") ?? "").trim();
    const publishValue = String(form.get("publish_at") ?? "");
    const publishDate = new Date(publishValue);

    if (title.length < 3) {
      setFormError("اكتب عنوانًا واضحًا للطلب.");
      return;
    }
    if (requestText.length < 10) {
      setFormError("اكتب المطلوب كاملًا؛ النص قصير جدًا ولا يوضح المهمة.");
      return;
    }
    if (!publishValue || Number.isNaN(publishDate.getTime()) || publishDate.getTime() <= Date.now() + 60 * 60 * 1000) {
      setFormError("موعد النشر يجب أن يكون بعد ساعة على الأقل من الآن.");
      return;
    }
    if (!isTelegramUrl(telegramSource)) {
      setFormError("رابط الرسالة الاختياري يجب أن يكون رابط Telegram صحيحًا.");
      return;
    }

    requestId.current ??= globalThis.crypto.randomUUID();
    const payload: QuickIntakePayload = {
      request_id: requestId.current,
      target_publish_at: publishDate.toISOString(),
      content_title: title,
      content_request_text: requestText,
      telegram_source_url: telegramSource,
      raw_material_sent: form.get("raw_material_sent") === "on",
      brand_article_ids: form.getAll("brand_reference_ids").map(String),
      ...Object.fromEntries(contentAssignmentFields.map(({ name }) => [
        name,
        String(form.get(name) ?? ownerDefault(name)),
      ])),
    };

    const created = await onCreate(payload);
    if (!created) setFormError("لم يتم الحفظ. راجع رسالة الخطأ أعلى الصفحة ثم حاول مرة أخرى.");
  }

  return (
    <form className="panel quick-intake-form simplified-content-request" onSubmit={(event) => void createRequest(event)}>
      <div className="section-heading">
        <div><p className="overline">طلب واحد · مرجع واحد</p><h2>طلب ريلز كامل</h2></div>
        <button className="text-button" type="button" onClick={onCancel}>إغلاق</button>
      </div>

      <div className="quick-intake-intro">
        <MessageSquareText size={20} />
        <div>
          <strong>اكتب كما تكتب في جروب الشغل</strong>
          <p>الصق النص، التوقيتات، المنشن والروابط كلها في خانة واحدة. سيبقى النص كما هو ولن تتوزع الروابط على خانات أخرى.</p>
        </div>
      </div>

      <div className="form-grid simplified-request-core">
        <label><span>عنوان الطلب</span><input name="title" minLength={3} maxLength={180} required placeholder="مثال: نموذج 1234 لتأكيد تغير الاتجاه" /></label>
        <label><span>موعد النشر النهائي</span><input name="publish_at" type="datetime-local" defaultValue={defaultPublish} required /></label>
        <label className="full-field quick-intake-request">
          <span>كل المطلوب والروابط</span>
          <textarea name="request_text" minLength={10} maxLength={30000} rows={18} required placeholder="الصق الطلب كاملًا هنا: السكريبت، الحذف، الثواني، تعليمات المونتاج والغلاف، الروابط، وأي ملاحظات…" />
          <small>هذا هو المرجع الذي سيراه طالب المهمة والمنفذ. أي رابط تكتبه هنا سيظل في مكانه ويظهر قابلًا للفتح.</small>
        </label>
      </div>

      <label className="content-material-sent-toggle">
        <input name="raw_material_sent" type="checkbox" />
        <span><CheckCircle2 size={17} /><strong>تم إرسال المادة الخام على Telegram</strong><small>فعّلها لو أرسلت الملف بالفعل؛ لن ينشئ النظام مهمة إضافية لتجهيز المادة الخام.</small></span>
      </label>

      <details className="content-request-advanced">
        <summary>تعديل المسؤولين والتفاصيل الاختيارية</summary>
        <div className="content-request-advanced-body">
          <label className="quick-intake-source">
            <span>رابط رسالة Telegram الأصلية — اختياري</span>
            <input name="telegram_source_url" type="url" dir="ltr" placeholder="https://t.me/c/..." />
            <small>استخدمه فقط لو تريد فتح الرسالة الأصلية بضغطة. الروابط المكتوبة داخل الطلب لا تحتاج نقلًا إلى هنا.</small>
          </label>

          <div className="assignment-block intake-assignment-block">
            <div><p className="overline">التوزيع</p><h3>المسؤول عن كل نتيجة</h3><p>النظام اختار آخر توزيع استخدمته. غيّره هنا فقط لو هذا الطلب مختلف.</p></div>
            <div className="assignment-grid">{contentAssignmentFields.map(({ step, name, label }) => (
              <label key={step}><span>{label}</span><select name={name} defaultValue={ownerDefault(name)} required>{people.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label>
            ))}</div>
          </div>

          <BrandReferenceSelector articles={approvedBrandArticles} />
        </div>
      </details>

      {formError ? <p className="form-notice error" role="alert">{formError}</p> : null}
      <div className="form-actions">
        <Button type="submit" disabled={working}>{working ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />} إنشاء طلب الريلز وإسناده</Button>
        <small>الغلاف متاح فورًا، والمونتاج يبدأ عند وصول الخام. «مهامي» سيُظهر لكل عضو الجزء المسند إليه فقط.</small>
      </div>
    </form>
  );
}

function BrandReferenceSelector({ articles }: { articles: ApprovedBrandArticle[] }) {
  return <section className="brand-reference-selector">
    <div><p className="overline">اختياري</p><h3>مراجع البراند</h3><p>اربط مرجعًا فقط إذا كان هذا الطلب يحتاج قواعد محددة.</p></div>
    {articles.length ? <div>{articles.map((article) => <label key={article.id}><input type="checkbox" name="brand_reference_ids" value={article.id} aria-label={`ربط مرجع ${article.title}`} /><span><strong>{article.title}</strong><small>{article.categoryLabel} · النسخة {article.version}</small></span></label>)}</div> : <p className="brand-reference-empty"><Link2 size={13} /> لا توجد مراجع معتمدة بعد، ويمكن إنشاء الطلب بدونها.</p>}
  </section>;
}
