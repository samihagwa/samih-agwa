"use client";

import { CheckCircle2, LoaderCircle, UserRoundCheck } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { crmContactIdentityKinds, crmConversationChannelConfig, crmIdentityKindConfig, crmInterestConfig, crmTradingExperienceConfig, type CrmConversationChannel, type CrmIdentityKind, type CrmInterest, type CrmSource, type CrmTradingExperience } from "../../lib/crm";
import { getSupabaseBrowserClient } from "../../lib/supabase/client";
import { getSupabaseFunctionErrorMessage } from "../../lib/supabase/function-errors";
import { Button } from "../ui/Button";
import { CrmPurchaseFields, readCrmPurchase } from "./CrmPurchaseFields";

type Person = { id: string; name: string };
type CustomerKind = "prospect" | "current";

function text(form: FormData, key: string) { return String(form.get(key) ?? "").trim(); }
function sourceForChannel(channel: CrmConversationChannel | ""): CrmSource {
  if (channel === "messenger" || channel === "facebook") return "facebook";
  if (["instagram", "telegram", "whatsapp", "tiktok", "meta_business", "email"].includes(channel)) return channel as CrmSource;
  return "manual";
}
function tomorrow() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function CrmCreateLeadDialog({ organizationId, actorId, people, manager, onClose, onCreated }: {
  organizationId: string;
  actorId: string;
  people: Person[];
  manager: boolean;
  onClose: () => void;
  onCreated: (kind: CustomerKind) => void;
}) {
  const [kind, setKind] = useState<CustomerKind>("prospect");
  const [interest, setInterest] = useState<CrmInterest>("indicator");
  const [channel, setChannel] = useState<CrmConversationChannel | "">("");
  const [experience, setExperience] = useState<CrmTradingExperience>("unknown");
  const [needsFollowUp, setNeedsFollowUp] = useState(true);
  const [withoutLink, setWithoutLink] = useState(false);
  const [primaryKind, setPrimaryKind] = useState<CrmIdentityKind>("phone");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const requestId = useRef<string | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const [defaultFollowUp] = useState(tomorrow);
  const availablePeople = people.some((person) => person.id === actorId) ? people : [{ id: actorId, name: "أنا" }, ...people];

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    nameInput.current?.focus();
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !submitting.current) onClose(); };
    document.addEventListener("keydown", escape);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", escape); };
  }, [onClose]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = new FormData(event.currentTarget);
    const ownerId = manager ? text(form, "owner_id") : actorId;
    if (!availablePeople.some((person) => person.id === ownerId)) return setError("اختر مسؤولًا صحيحًا للعميل.");
    const followUp = needsFollowUp ? new Date(text(form, "follow_up_at")) : null;
    if (needsFollowUp && (!followUp || !Number.isFinite(followUp.getTime()) || followUp.getTime() <= Date.now())) return setError("حدد موعد متابعة صحيحًا في المستقبل.");
    if (!withoutLink && (!channel || !text(form, "conversation_url"))) return setError("أضف لينك المحادثة أو اختر «بدون لينك محادثة».");
    const purchaseResult = kind === "current" ? readCrmPurchase(form) : null;
    if (purchaseResult?.error) return setError(purchaseResult.error);
    const identities: Array<{ kind: CrmIdentityKind; value: string }> = crmContactIdentityKinds
      .map((identityKind) => ({ kind: identityKind, value: text(form, `identity_${identityKind}`) }))
      .filter((identity) => identity.value);
    const exnessAccount = text(form, "identity_exness_account");
    if (exnessAccount) identities.push({ kind: "exness_account", value: exnessAccount });
    const selectedPrimary = identities.some((identity) => identity.kind === primaryKind) ? primaryKind : identities[0]?.kind ?? "";
    submitting.current = true;
    requestId.current ??= crypto.randomUUID();
    setWorking(true);
    setError(null);
    try {
      const { error: commandError } = await getSupabaseBrowserClient().functions.invoke("crm-commands", {
        body: {
          action: "create_lead", request_id: requestId.current, organization_id: organizationId,
          full_name: text(form, "full_name"), source: sourceForChannel(channel), source_detail: "",
          interest, interest_detail: text(form, "interest_detail"), owner_id: ownerId,
          consent_status: "unknown", identities, primary_identity_kind: selectedPrimary,
          trading_experience: experience, initial_stage: kind === "current" ? "won" : "new",
          follow_up_at: followUp?.toISOString() ?? null, notes: text(form, "notes"),
          conversation_channel: channel, conversation_url: text(form, "conversation_url"),
          without_conversation_link: withoutLink, purchase: purchaseResult?.purchase ?? null,
        },
      });
      if (commandError) {
        setError(await getSupabaseFunctionErrorMessage(commandError, "تعذّر حفظ العميل. حاول مرة أخرى دون إعادة فتح النموذج."));
        return;
      }
      onCreated(kind);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذّر حفظ العميل. حاول مرة أخرى.");
    } finally {
      submitting.current = false;
      setWorking(false);
    }
  }

  return <div className="crm-create-dialog-backdrop">
    <button className="crm-create-dialog-dismiss" type="button" aria-label="إغلاق نافذة إضافة العميل" disabled={working} onClick={onClose} />
    <form id="crm-create-dialog" className="panel crm-create-form crm-simple-intake" role="dialog" aria-modal="true" aria-labelledby="crm-create-dialog-title" onSubmit={(event) => void create(event)}>
      <div className="section-heading"><div><p className="overline">تسجيل سريع</p><h2 id="crm-create-dialog-title">إضافة عميل</h2><p>سجّل ما تعرفه الآن، ثم ستبقى في قائمة العملاء.</p></div><button className="text-button" type="button" disabled={working} onClick={onClose}>إغلاق</button></div>
      <fieldset className="crm-customer-kind"><legend>حالة العميل الآن</legend><div role="group" aria-label="حالة العميل"><button type="button" aria-pressed={kind === "prospect"} className={kind === "prospect" ? "active" : ""} onClick={() => { setKind("prospect"); setNeedsFollowUp(true); }}><strong>عميل محتمل</strong><small>لسه بنتواصل معاه</small></button><button type="button" aria-pressed={kind === "current"} className={kind === "current" ? "active" : ""} onClick={() => { setKind("current"); setNeedsFollowUp(false); }}><strong>عميل حالي</strong><small>اشترى أو اشترك بالفعل</small></button></div></fieldset>
      {error ? <p className="form-notice error crm-dialog-notice" role="alert">{error}</p> : null}
      <div className="form-grid crm-simple-intake-grid">
        <label><span>اسم العميل</span><input ref={nameInput} name="full_name" minLength={2} maxLength={160} required placeholder="الاسم كما تعرفه" /></label>
        <label><span>بتتكلم معاه فين؟</span><select value={channel} required={!withoutLink} onChange={(event) => setChannel(event.target.value as CrmConversationChannel | "")}><option value="">اختر المنصة</option>{(Object.keys(crmConversationChannelConfig) as CrmConversationChannel[]).map((option) => <option value={option} key={option}>{crmConversationChannelConfig[option].label}</option>)}</select></label>
        <label><span>مهتم بإيه؟</span><select value={interest} onChange={(event) => setInterest(event.target.value as CrmInterest)}>{(Object.keys(crmInterestConfig) as CrmInterest[]).map((option) => <option value={option} key={option}>{crmInterestConfig[option].label}</option>)}</select></label>
        {interest === "other" ? <label><span>سبب التسجيل</span><input name="interest_detail" minLength={2} maxLength={160} required /></label> : null}
        {interest === "cashback" ? <label><span>رقم حساب Exness — اختياري</span><input name="identity_exness_account" dir="ltr" minLength={5} maxLength={32} /></label> : null}
        <label><span>خبرة التداول</span><select value={experience} onChange={(event) => setExperience(event.target.value as CrmTradingExperience)}>{(Object.keys(crmTradingExperienceConfig) as CrmTradingExperience[]).map((option) => <option value={option} key={option}>{crmTradingExperienceConfig[option].label}</option>)}</select></label>
        <label><span>لينك المحادثة{withoutLink ? " — تم الاستثناء" : " — مطلوب"}</span><input name="conversation_url" type="url" dir="ltr" maxLength={2000} required={!withoutLink} disabled={withoutLink} placeholder={channel ? crmConversationChannelConfig[channel].placeholder : "https://..."} /></label>
        <label className="crm-checkbox crm-chat-link-exception"><input type="checkbox" checked={withoutLink} onChange={(event) => setWithoutLink(event.target.checked)} /><span>بدون لينك محادثة</span></label>
        {manager ? <label><span>مسؤول المتابعة</span><select name="owner_id" defaultValue={actorId} required>{availablePeople.map((person) => <option value={person.id} key={person.id}>{person.id === actorId ? `${person.name} — أنا` : person.name}</option>)}</select></label> : <input name="owner_id" type="hidden" value={actorId} />}
        {kind === "current" ? <CrmPurchaseFields key={interest} defaultProduct={interest} /> : null}
        <fieldset className="crm-follow-up-decision crm-create-follow-up-decision"><legend>هل يحتاج متابعة مرة أخرى؟</legend><div><button type="button" className={needsFollowUp ? "active" : ""} aria-pressed={needsFollowUp} onClick={() => setNeedsFollowUp(true)}>نعم</button><button type="button" className={!needsFollowUp ? "active" : ""} aria-pressed={!needsFollowUp} onClick={() => setNeedsFollowUp(false)}>لا</button></div></fieldset>
        {needsFollowUp ? <label><span>موعد المتابعة</span><input name="follow_up_at" type="datetime-local" defaultValue={defaultFollowUp} required /></label> : <div className="crm-current-customer-note"><CheckCircle2 size={17} /><span><strong>بدون متابعة مجدولة</strong><small>يمكن تحديد موعد لاحقًا من ملف العميل.</small></span></div>}
        <label className="full-field"><span>ملاحظة سريعة — اختياري</span><textarea name="notes" maxLength={5000} rows={3} /></label>
      </div>
      <details className="crm-optional-contact-details"><summary>عندي رقم أو بريد أو اسم مستخدم</summary><fieldset className="crm-identities-fieldset"><legend>بيانات إضافية اختيارية</legend><div>{crmContactIdentityKinds.map((identityKind) => <label key={identityKind}><span>{crmIdentityKindConfig[identityKind].label}</span><input name={`identity_${identityKind}`} type={crmIdentityKindConfig[identityKind].inputType} dir="ltr" minLength={3} maxLength={identityKind === "tradingview" ? 100 : 320} placeholder={crmIdentityKindConfig[identityKind].placeholder} /></label>)}</div><label className="crm-primary-select"><span>البيان الأساسي لو أدخلت أكثر من واحد</span><select value={primaryKind} onChange={(event) => setPrimaryKind(event.target.value as CrmIdentityKind)}>{crmContactIdentityKinds.map((identityKind) => <option value={identityKind} key={identityKind}>{crmIdentityKindConfig[identityKind].label}</option>)}</select></label></fieldset></details>
      <div className="form-actions"><Button type="submit" disabled={working}>{working ? <LoaderCircle className="spin" size={16} /> : <UserRoundCheck size={16} />} {kind === "current" ? "حفظ كعميل حالي" : needsFollowUp ? "حفظ وإنشاء المتابعة" : "حفظ العميل"}</Button><small>بعد الحفظ ستعود لنفس القائمة.</small></div>
    </form>
  </div>;
}
