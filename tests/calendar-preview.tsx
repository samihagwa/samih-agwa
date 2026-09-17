import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "../app/globals.css";
import { ContentCalendarWorkspace } from "../components/planning/ContentCalendarWorkspace";
import { fixtureMode } from "./calendar-preview-backend";
import { useState } from "react";
import { DateInput } from "../components/ui/DateInput";
function DateInputCheck(){const [result,setResult]=useState("");return <details><summary>اختبار حقل التاريخ المشترك</summary><form onSubmit={event=>{event.preventDefault();setResult(String(new FormData(event.currentTarget).get("when")));}}><label>موعد تجريبي<DateInput name="when" aria-label="موعد تجريبي" type="datetime-local" required defaultValue="2026-09-17T14:30" min="2026-09-17T12:00" max="2026-09-30T23:59"/></label><button type="submit">قراءة الموعد</button><button type="reset">إعادة الحقل</button><output>{result}</output></form></details>;}
function Preview() {
  return <main style={{maxWidth:1500,margin:"auto",padding:20}}><p style={{fontSize:12}}>اختبار معزول بلا اتصال بالموقع — <button onClick={()=>fixtureMode("failure")}>فشل الشبكة التالي</button> <button onClick={()=>fixtureMode("conflict")}>تعارض التعديل التالي</button> <button onClick={()=>{localStorage.setItem("calendar-fixture-viewer","yes");location.reload();}}>مشاهد</button> <button onClick={()=>{localStorage.removeItem("calendar-fixture-viewer");location.reload();}}>مالك</button></p><ContentCalendarWorkspace/><DateInputCheck/></main>;
}
createRoot(document.getElementById("root")!).render(<Preview/>);
