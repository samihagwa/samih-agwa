import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "../app/globals.css";
import { ContentCalendarWorkspace } from "../components/planning/ContentCalendarWorkspace";
import { fixtureMode } from "./calendar-preview-backend";
function Preview() {
  return <main style={{maxWidth:1500,margin:"auto",padding:20}}><p style={{fontSize:12}}>اختبار معزول بلا اتصال بالموقع — <button onClick={()=>fixtureMode("failure")}>فشل الشبكة التالي</button> <button onClick={()=>fixtureMode("conflict")}>تعارض التعديل التالي</button> <button onClick={()=>{localStorage.setItem("calendar-fixture-viewer","yes");location.reload();}}>مشاهد</button> <button onClick={()=>{localStorage.removeItem("calendar-fixture-viewer");location.reload();}}>مالك</button></p><ContentCalendarWorkspace/></main>;
}
createRoot(document.getElementById("root")!).render(<Preview/>);
