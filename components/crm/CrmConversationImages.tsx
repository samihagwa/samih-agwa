"use client";
/* eslint-disable @next/next/no-img-element -- Private in-memory blob URLs must never be sent to an image optimizer. */

import { useCallback, useEffect, useRef, useState, type ClipboardEvent } from "react";
import { Archive, ImagePlus, LockKeyhole, LoaderCircle, RotateCcw, Upload, X } from "lucide-react";
import { CRM_IMAGE_BUCKET, imageHash, imageSize, prepareCrmImage, type CrmImage, type CrmImagePage, type PreparedCrmImage, type Redaction } from "../../lib/crm-images";
import { getSupabaseBrowserClient } from "../../lib/supabase/client";
import type { Json } from "../../lib/supabase/database.types";
import { Button } from "../ui/Button";
import { CenteredDialog } from "../ui/CenteredDialog";

function errorText(error: unknown) { return error && typeof error === "object" && "message" in error ? String(error.message) : "تعذر إكمال العملية. حاول مرة أخرى."; }
async function command<T>(contactId: string, action: string, payload: Json = {}): Promise<T> {
  const { data, error } = await getSupabaseBrowserClient().rpc("crm_images_command", { action, target_contact: contactId, payload });
  if (error) throw error; return data as T;
}
function PhotoTile({ image, onOpen }: { image: CrmImage; onOpen: (url: string) => void }) {
  const ref = useRef<HTMLDivElement>(null), [visible, setVisible] = useState(false), [url, setUrl] = useState(""), [error, setError] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } });
    if (ref.current) observer.observe(ref.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let active = true, objectUrl = "";
    // Authenticated download rechecks RLS; no permanent public or signed links.
    void getSupabaseBrowserClient().storage.from(CRM_IMAGE_BUCKET).download(image.object_path).then(({ data, error }) => {
      if (!active) return;
      if (error || !data) { setError(true); return; }
      objectUrl = URL.createObjectURL(data); setUrl(objectUrl); setError(false);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [image.object_path, visible, retry]);
  return <div className="crm-photo-tile" ref={ref}>
    <button type="button" className="crm-photo-thumbnail" disabled={!url && !error} aria-label={error ? "إعادة تحميل الصورة" : `تكبير صورة المحادثة: ${image.caption || image.author_name}`} onClick={() => error ? (setError(false),setRetry(n => n+1)) : onOpen(url)}>
      {error ? <span>تعذر التحميل · إعادة المحاولة</span> : url ? <img src={url} alt={image.caption || "لقطة من محادثة العميل"} width={240} height={160} /> : <LoaderCircle className="spin" aria-label="تحميل الصورة" size={20} />}
    </button>
    <div><strong>{image.caption || "صورة المحادثة"}</strong><small>{image.author_name}</small><small>{new Intl.DateTimeFormat("ar-EG",{dateStyle:"medium",timeStyle:"short"}).format(new Date(image.created_at))}</small></div>
  </div>;
}

function RedactImage({ image, onApply, onCancel }: { image: PreparedCrmImage; onApply: (value: PreparedCrmImage) => void; onCancel: () => void }) {
  const [mask,setMask] = useState<Redaction>({x:0,y:0,width:100,height:15}), [busy,setBusy] = useState(false), [error,setError] = useState("");
  async function apply() {
    setBusy(true); setError("");
    try { onApply(await prepareCrmImage(image.blob,mask)); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <div className="crm-photo-redact">
    <p>حرّك مساحة الإخفاء فوق البيانات الحساسة. الإخفاء يُطبّق على الصورة نفسها قبل الرفع.</p>
    <div className="crm-photo-mask-preview"><img src={image.url} alt="معاينة موضع الإخفاء" /><span aria-hidden="true" style={{left:`${mask.x}%`,top:`${mask.y}%`,width:`${mask.width}%`,height:`${mask.height}%`}} /></div>
    <div className="crm-photo-mask-controls">{([
      ["y","المسافة من أعلى",99],["height","ارتفاع الإخفاء",100],["x","المسافة من اليسار",99],["width","عرض الإخفاء",100],
    ] as const).map(([key,label,max]) => <label key={key}><span>{label} · {mask[key]}٪</span><input type="range" min={key==="height" || key==="width" ? 1:0} max={max} value={mask[key]} disabled={busy} onChange={e => setMask({...mask,[key]:Number(e.target.value)})}/></label>)}</div>
    {error ? <p role="alert">{error}</p>:null}
    <div className="crm-photo-actions"><Button type="button" disabled={busy} onClick={() => void apply()}>تطبيق الإخفاء</Button><Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>إلغاء</Button></div>
  </div>;
}

function ImageUploader({ contactId, onClose, onSaved }: { contactId: string; onClose: () => void; onSaved: () => void }) {
  const [images,setImages] = useState<PreparedCrmImage[]>([]), [caption,setCaption] = useState(""), [busy,setBusy] = useState(false), [status,setStatus] = useState(""), [error,setError] = useState(""), [redactId,setRedactId] = useState<string|null>(null);
  const imagesRef = useRef(images), lock = useRef(false), mounted = useRef(true);
  useEffect(() => { imagesRef.current=images; },[images]);
  useEffect(() => { mounted.current=true; return () => { mounted.current=false; imagesRef.current.forEach(image => URL.revokeObjectURL(image.url)); }; },[]);
  async function choose(files: File[]) {
    if (lock.current) return;
    if (files.length+imagesRef.current.length>5) { setError("اختر حتى 5 صور في المرة الواحدة."); return; }
    lock.current=true; setBusy(true); setError("");
    const prepared: PreparedCrmImage[]=[];
    try {
      for (const [index,file] of files.entries()) { setStatus(`تجهيز الصورة ${index+1} من ${files.length}…`); prepared.push(await prepareCrmImage(file)); }
      if (!mounted.current) { prepared.forEach(image => URL.revokeObjectURL(image.url)); return; }
      setImages(current => [...current,...prepared]);
    } catch(e) { prepared.forEach(image => URL.revokeObjectURL(image.url)); setError(errorText(e)); }
    finally { lock.current=false; if (mounted.current) { setBusy(false);setStatus(""); } }
  }
  function paste(event: ClipboardEvent) {
    const files=Array.from(event.clipboardData.files); if (!files.length) return;
    event.preventDefault(); void choose(files);
  }
  async function upload() {
    if (lock.current || !imagesRef.current.length) return;
    lock.current=true;setBusy(true);setError("");
    let saved=0;
    try {
      const batch=[...imagesRef.current];
      for (const [index,image] of batch.entries()) {
        setStatus(`رفع الصورة ${index+1} من ${batch.length}…`);
        const reserved=await command<{id:string; object_path:string; state:string}>(contactId,"reserve",{hash:await imageHash(image.blob),mime:image.blob.type,caption});
        if (reserved.state==="archived") throw new Error("الصورة موجودة في الأرشيف. استعدها من قسم الصور المؤرشفة بدل تكرارها.");
        if (reserved.state==="pending") {
          const {error: uploadError}=await getSupabaseBrowserClient().storage.from(CRM_IMAGE_BUCKET).upload(reserved.object_path,image.blob,{contentType:image.blob.type,upsert:false,cacheControl:"300"});
          // A previous upload may have arrived before its final response was lost.
          // Storage versions may report duplicate objects as 400 or 409. The
          // server verifies the immutable object's metadata before finalizing.
          try { await command(contactId,"finish",{id:reserved.id}); }
          catch (finishError) { throw uploadError || finishError; }
        }
        saved++; URL.revokeObjectURL(image.url); setImages(current => current.filter(value => value.id!==image.id));
      }
      onSaved(); onClose();
    } catch(e) { setError(`${saved ? `تم حفظ ${saved} صورة. `:""}${errorText(e)} الصور المتبقية محفوظة هنا لإعادة المحاولة.`); if(saved) onSaved(); }
    finally { lock.current=false; if(mounted.current) { setBusy(false);setStatus(""); } }
  }
  const redacting=images.find(image => image.id===redactId);
  return <CenteredDialog title="إضافة صور المحادثة" onClose={() => { if(!lock.current) onClose(); }}>
    <div className="crm-photo-uploader" onPaste={paste}>
      <p><LockKeyhole size={16} aria-hidden="true"/> الصور خاصة بملف العميل. راجع وضوح الكلام وأخفِ أي بيانات حساسة قبل الرفع.</p>
      {redacting ? <RedactImage image={redacting} onCancel={() => setRedactId(null)} onApply={next => { if(!mounted.current) {URL.revokeObjectURL(next.url);return;} URL.revokeObjectURL(redacting.url);setImages(current => current.map(image => image.id===redacting.id ? next:image));setRedactId(null); }}/> : <>
        <label className="crm-photo-picker"><ImagePlus aria-hidden="true" size={26}/><strong>اختيار صور من الجهاز</strong><span>PNG، JPG، WebP · حتى 5 صور · تُضغط قبل الرفع</span><input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={busy} onChange={event => { const files=Array.from(event.target.files??[]);event.target.value="";void choose(files); }}/></label>
        <label className="crm-photo-paste"><span>أو الصق الصورة هنا من المحادثة</span><input aria-label="لصق صورة المحادثة" placeholder="اضغط هنا ثم Ctrl+V أو ⌘V" readOnly disabled={busy}/></label>
        <div className="crm-photo-drafts">{images.map((image,index) => <div key={image.id}><img src={image.url} alt={`معاينة الصورة ${index+1} قبل الرفع`}/><small>{imageSize(image.blob.size)}</small><div><Button variant="secondary" type="button" disabled={busy} onClick={() => setRedactId(image.id)}>إخفاء بيانات</Button><Button variant="ghost" type="button" disabled={busy} aria-label={`إزالة الصورة ${index+1} من الاختيار`} onClick={() => {URL.revokeObjectURL(image.url);setImages(current => current.filter(value=>value.id!==image.id));}}><X size={18}/></Button></div></div>)}</div>
        <label className="crm-photo-caption"><span>ملاحظة على الصور (اختياري)</span><input maxLength={300} value={caption} disabled={busy} onChange={event=>setCaption(event.target.value)} placeholder="مثال: اتفاق العميل على الاشتراك"/></label>
        <div className="crm-photo-actions"><Button type="button" disabled={busy||!images.length} onClick={()=>void upload()}>{busy?<LoaderCircle className="spin" size={16}/>:<Upload size={16}/>} رفع {images.length || ""} صور</Button><Button variant="ghost" type="button" disabled={busy} onClick={onClose}>إلغاء</Button></div>
      </>}
      <p role="status" aria-live="polite">{status}</p>{error?<p className="crm-photo-error" role="alert">{error}</p>:null}
    </div>
  </CenteredDialog>;
}

export function CrmConversationImages({ contactId, userId, canManage }: {contactId:string;userId:string;canManage:boolean}) {
  const [data,setData]=useState<CrmImagePage|null>(null),[page,setPage]=useState(0),[archived,setArchived]=useState(false),[upload,setUpload]=useState(false),[selected,setSelected]=useState<{image:CrmImage;url:string}|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(true),[working,setWorking]=useState(false),[revision,setRevision]=useState(0);
  const refresh=useCallback(()=>{setLoading(true);setError("");setData(null);setRevision(n=>n+1);},[]);
  useEffect(()=>{
    let active=true;
    void command<CrmImagePage>(contactId,"list",{page,archived}).then(value=>{if(active)setData(value);}).catch(e=>{if(active)setError(errorText(e));}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[contactId,page,archived,revision]);
  async function archive() {
    if(!selected||working)return;setWorking(true);setError("");
    try {await command(contactId,selected.image.state==="archived"?"restore":"archive",{id:selected.image.id});setSelected(null);refresh();}
    catch(e){setError(errorText(e));}finally{setWorking(false);}
  }
  return <section className="panel crm-customer-section crm-conversation-images" aria-label="صور المحادثة">
    <div className="section-heading compact"><div><h2>صور المحادثة</h2><p><LockKeyhole size={14} aria-hidden="true"/> خاصة بمسؤول العميل والإدارة</p></div><Button type="button" onClick={()=>setUpload(true)}><ImagePlus size={17} aria-hidden="true"/> إضافة صور</Button></div>
    <div className="crm-photo-toolbar"><button type="button" className="text-button" onClick={()=>{setArchived(!archived);setPage(0);setLoading(true);setError("");setData(null);}}>{archived?"العودة إلى الصور":"الصور المؤرشفة"}</button>{data?<span>{data.total} صورة</span>:null}</div>
    {error?<div className="crm-photo-error" role="alert">{error} <button type="button" className="text-button" onClick={refresh}>إعادة المحاولة</button></div>:null}
    {loading?<p role="status">جارٍ تحميل الصور…</p>:data?.images.length?<div className="crm-photo-grid">{data.images.map(image=><PhotoTile key={image.id} image={image} onOpen={url=>setSelected({image,url})}/>)}</div>:!error?<p className="empty-proof">{archived?"لا توجد صور مؤرشفة.":"لا توجد صور بعد. أضف لقطة للاتفاق أو التفاصيل المهمة في المحادثة."}</p>:null}
    {data && (page>0 || data.total>12)?<nav className="crm-photo-pages" aria-label="صفحات صور العميل"><Button variant="secondary" type="button" disabled={!page||loading} onClick={()=>{setPage(n=>n-1);setLoading(true);setData(null);}}>السابق</Button><span>صفحة {page+1}</span><Button variant="secondary" type="button" disabled={(page+1)*12>=data.total||loading} onClick={()=>{setPage(n=>n+1);setLoading(true);setData(null);}}>التالي</Button></nav>:null}
    {data?<details className="crm-photo-usage"><summary>مساحة الصور</summary><p>{imageSize(data.used_bytes)} من سقف {imageSize(data.limit_bytes)} — لكل صور العملاء، وتشمل المحاولات قيد الرفع والأرشيف.</p><meter min={0} max={data.limit_bytes} value={data.used_bytes} aria-label="مساحة صور العملاء"/><p>الأرشفة تخفي الصورة ولا تحذفها أو توفر مساحة. لا توجد زيادة تلقائية في السقف.</p>{data.used_bytes>=data.limit_bytes*.8?<p role="alert">اقتربنا من سقف الصور. تواصل مع الإدارة قبل امتلائه.</p>:null}</details>:null}
    {data?.pending?<p className="crm-photo-pending">يوجد {data.pending} رفع غير مكتمل. أعد اختيار نفس الصورة لاستكمال المحاولة بدون تكرار.</p>:null}
    {upload?<ImageUploader contactId={contactId} onClose={()=>setUpload(false)} onSaved={refresh}/>:null}
    {selected?<CenteredDialog title={selected.image.caption||"صورة المحادثة"} onClose={()=>{if(!working)setSelected(null);}}><div className="crm-photo-viewer"><p>{selected.image.author_name} · {new Intl.DateTimeFormat("ar-EG",{dateStyle:"medium",timeStyle:"short"}).format(new Date(selected.image.created_at))}</p><img src={selected.url} alt={selected.image.caption||"صورة المحادثة بالحجم الكامل"}/>{canManage||selected.image.created_by===userId?<Button type="button" variant="secondary" disabled={working} onClick={()=>void archive()}>{selected.image.state==="archived"?<RotateCcw size={16}/>:<Archive size={16}/>} {selected.image.state==="archived"?"استعادة الصورة":"أرشفة الصورة بدون حذف"}</Button>:null}{error?<p role="alert">{error}</p>:null}</div></CenteredDialog>:null}
  </section>;
}
