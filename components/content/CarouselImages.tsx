"use client";
import { useState } from "react";
import { ArrowUp,ArrowDown,Plus,Trash2 } from "lucide-react";
import { carouselImages } from "../../lib/carousel-images";
import { Button } from "../ui/Button";

export function CarouselImageFields({initial,disabled}:{initial:unknown;disabled:boolean}) {
  const [rows,setRows]=useState(()=>{const images=carouselImages(initial);return(images.length?images:["",""]).map((url,index)=>({id:index,url}));});
  function move(index:number,offset:number){setRows(current=>{const next=[...current];[next[index],next[index+offset]]=[next[index+offset],next[index]];return next;});}
  return <fieldset className="carousel-image-fields"><legend>صور الكاروسيل بالترتيب</legend>
    <p>أضف رابط كل صورة منفصلًا، ثم رتّبها بالأسهم. أول صورة هي الغلاف. الروابط المباشرة تعرض معاينة؛ روابط Drive تفتح الملف.</p>
    {rows.map((row,index)=><div className="carousel-image-row" key={row.id}><strong>{index+1}</strong><label><span>رابط الصورة {index+1}</span><input name="carousel_image" value={row.url} onChange={e=>setRows(current=>current.map(item=>item.id===row.id?{...item,url:e.target.value}:item))} type="url" dir="ltr" required maxLength={2000} disabled={disabled} placeholder="https://…"/></label><div>
      <button type="button" className="icon-button" disabled={disabled||index===0} aria-label={`تقديم الصورة ${index+1}`} onClick={()=>move(index,-1)}><ArrowUp size={16}/></button>
      <button type="button" className="icon-button" disabled={disabled||index===rows.length-1} aria-label={`تأخير الصورة ${index+1}`} onClick={()=>move(index,1)}><ArrowDown size={16}/></button>
      <button type="button" className="icon-button" disabled={disabled||rows.length<=2} aria-label={`إزالة الصورة ${index+1}`} onClick={()=>setRows(current=>current.filter(item=>item.id!==row.id))}><Trash2 size={16}/></button>
    </div></div>)}
    <Button type="button" variant="secondary" disabled={disabled||rows.length>=30} onClick={()=>setRows(current=>[...current,{id:Math.max(...current.map(row=>row.id))+1,url:""}])}><Plus size={16}/> إضافة صورة</Button>
  </fieldset>;
}
export function CarouselImageGallery({images}:{images:unknown}) {
  const urls=carouselImages(images);
  if(!urls.length)return null;
  return <section className="carousel-gallery" aria-label="صور الكاروسيل المسلّمة"><h3>صور الكاروسيل ({urls.length})</h3><ol>{urls.map((url,index)=><li key={url}><a href={url} target="_blank" rel="noopener noreferrer">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={url} alt={`معاينة الصورة ${index+1}`} loading="lazy" referrerPolicy="no-referrer"/>
    <strong>الصورة {index+1}{index===0?" · الغلاف":""}</strong><span>فتح الصورة</span>
  </a></li>)}</ol></section>;
}
