import {createRoot} from 'react-dom/client';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '../app/globals.css';
import {TeamReportSettings} from '../components/team/TeamReportSettings';
import {TeamReportInbox} from '../components/team/TeamReportInbox';
function Preview(){return <main style={{maxWidth:1100,margin:'auto',padding:16}}><header style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12}}><h1>تقارير الفريق — اختبار معزول</h1><TeamReportInbox organizationId="fixture"/></header><p>الأسماء والأرقام بيانات اختبار فقط. لا اتصال بقاعدة الموقع ولا إرسال تيليجرام.</p><TeamReportSettings organizationId="fixture" people={[{id:'owner',name:'مالك — بيانات اختبار',role:'owner'},{id:'member',name:'عضو — بيانات اختبار',role:'member'}]}/></main>}
createRoot(document.getElementById('root')!).render(<Preview/>);
