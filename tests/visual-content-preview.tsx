import {useState} from "react";
import {createRoot} from "react-dom/client";
import {VisualContentIntake} from "../components/content/VisualContentIntake";
import {CarouselImageFields,CarouselImageGallery} from "../components/content/CarouselImages";
import "../app/globals.css";
function Preview(){
 const [format,setFormat]=useState<"carousel"|"long_video">("carousel");
 const [payload,setPayload]=useState("");
 const [images,setImages]=useState<string[]>([]);
 return <main style={{maxWidth:950,margin:"24px auto",padding:16}}><p>اختبار معزول بدون إرسال أي مهام</p><button onClick={()=>setFormat(format==="carousel"?"long_video":"carousel")}>تبديل النوع</button>
 <VisualContentIntake key={format} format={format} people={[{id:"owner",name:"سميح عجوة"},{id:"ahmed",name:"Ahmed Shaban"}]} currentUserId="owner" defaultPublish="2026-09-25T12:00" working={false} onCancel={()=>{}} onCreate={async value=>{setPayload(JSON.stringify(value));return true;}}/>
 <output aria-label="نتيجة الطلب" style={{overflowWrap:"anywhere"}}>{payload}</output><form onSubmit={event=>{event.preventDefault();setImages(new FormData(event.currentTarget).getAll("carousel_image").map(String));}}><CarouselImageFields initial={[]} disabled={false}/><button type="submit">اختبار حفظ الصور</button></form>
 <CarouselImageGallery images={images}/></main>;
}
createRoot(document.getElementById("root")!).render(<Preview/>);
