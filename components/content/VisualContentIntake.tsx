"use client";
import { useRef, useState, type FormEvent } from "react";
import { DateInput } from "../ui/DateInput";
import { EmojiTextarea } from "../ui/EmojiTextarea";
import { Button } from "../ui/Button";
import type { QuickIntakePayload } from "./QuickIntakeForm";
import { contentPlatformLabel } from "../../lib/content";
import { contentRequestDate } from "../../lib/content-calendar";

export function VisualContentIntake({format,people,currentUserId,defaultPublish,working,onCreate,onCancel}:{
  format:"carousel"|"long_video"; people:{id:string;name:string}[];currentUserId:string;defaultPublish:string;working:boolean;
  onCreate:(payload:QuickIntakePayload)=>Promise<boolean>;onCancel:()=>void;
}) {
  const carousel=format==="carousel";
  const ahmed=people.find(person=>["ahmed shaban","احمد شعبان","أحمد شعبان"].includes(person.name.trim().toLowerCase()))?.id??"";
  const [brief,setBrief]=useState("");
  const [error,setError]=useState("");
  const requestId=useRef<string|null>(null);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(working)return;
    const values=new FormData(event.currentTarget);
    const platforms=values.getAll("platforms").map(String);
    const raw=String(values.get("raw")??"").trim();
    if(!platforms.length){setError("اختر منصة واحدة على الأقل.");return;}
    if(brief.trim().length<10){setError("اكتب تفاصيل الطلب بوضوح.");return;}
    const publishAt=contentRequestDate(String(values.get("publish")??""));
    if(!publishAt){setError("اختر يوم النشر الحالي أو يومًا قادمًا بتوقيت القاهرة.");return;}
    requestId.current??=crypto.randomUUID();
    setError("");
    const owner=String(values.get("owner"));
    const saved=await onCreate({request_id:requestId.current,request_format:format,request_platforms:platforms,
      content_title:String(values.get("title")).trim(),content_request_text:brief.trim(),
      target_publish_at:publishAt,
      raw_materials:raw?[{kind:carousel?"source":"raw_video",url:raw}]:[],
      editing_owner_id:owner,thumbnail_owner_id:carousel?owner:String(values.get("thumbnail")),
      publishing_owner_id:String(values.get("publisher")),brand_article_ids:[]});
    if(!saved)setError("لم يتم إنشاء الطلب. راجع رسالة الخطأ؛ البيانات ما زالت هنا.");
  }
  return <form className="panel request-inline-form" onSubmit={submit}>
    <h2>{carousel?"طلب كاروسيل":"طلب فيديو يوتيوب"}</h2>
    <label>عنوان الطلب<input name="title" required minLength={3} maxLength={180}/></label>
    <EmojiTextarea label={carousel?"نص الشرائح والتعليمات":"نص الطلب والتعليمات"} value={brief} onValueChange={setBrief} required minLength={10} maxLength={30000} rows={12} placeholder={carousel?"الصفحة الأولى…\n\nالصفحة الثانية…\n\nضع النص والروابط وتعليمات التصميم كما في رسالة الشغل.":"الصق الطلب كاملًا: السكريبت والتعليمات والتوقيتات والروابط."}/>
    <label>{carousel?"مرجع أو صور مساعدة — اختياري":"رابط المادة الخام"}<input name="raw" type="url" dir="ltr" maxLength={2000} required={!carousel} placeholder="https://…"/></label>
    <div className="request-form-pair">
      <label>{carousel?"مسؤول التصميم":"مسؤول المونتاج"}<select name="owner" defaultValue={carousel?ahmed:currentUserId} required><option value="">اختر المسؤول</option>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>{carousel?<small>{ahmed?"أحمد شعبان محدد تلقائيًا؛ يمكنك تغييره.":"أحمد شعبان غير متاح ضمن أعضاء التنفيذ؛ اختر المسؤول."}</small>:null}</label>
      {!carousel?<label>مسؤول الغلاف<select name="thumbnail" defaultValue={ahmed||currentUserId} required>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>:null}
      <label>مسؤول النشر<select name="publisher" defaultValue={currentUserId} required>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>يوم النشر<DateInput name="publish" type="date" defaultValue={defaultPublish.slice(0,10)} required/></label>
    </div>
    <fieldset><legend>المنصات</legend><div className="calendar-platform-checkboxes">{["instagram","facebook","youtube","tiktok","telegram","x","linkedin"].map(p=><label key={p}><input name="platforms" type="checkbox" value={p} defaultChecked={p===(carousel?"instagram":"youtube")}/>{contentPlatformLabel(p)}</label>)}</div></fieldset>
    <p>{carousel?"مهمة تصميم واحدة لكل الشرائح، ثم النشر بعد التسليم. لا توجد مهمة مونتاج أو غلاف منفصلة.":"المونتاج والغلاف يعملان بالتوازي، ثم النشر بعد اكتمالهما."}</p>
    {error?<p role="alert" className="form-notice error">{error}</p>:null}
    <div className="form-actions"><Button type="submit" disabled={working}>{working?"جارٍ الإنشاء…":"إنشاء الطلب وإسناده"}</Button><Button type="button" variant="ghost" disabled={working} onClick={onCancel}>إلغاء</Button></div>
  </form>;
}
