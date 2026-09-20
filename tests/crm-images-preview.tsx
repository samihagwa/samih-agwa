import {createRoot} from 'react-dom/client';
import {CrmConversationImages} from '../components/crm/CrmConversationImages';
import '../app/globals.css';
async function copyTestImage(){
 const canvas=document.createElement('canvas');canvas.width=700;canvas.height=950;const c=canvas.getContext('2d')!;
 c.fillStyle='#f3f6f5';c.fillRect(0,0,700,950);c.fillStyle='#263b47';c.font='28px Arial';c.textAlign='right';c.fillText('محادثة اختبار — لا تخص أي عميل حقيقي',650,70);
 c.fillStyle='#d9eeeb';c.fillRect(50,150,600,170);c.fillStyle='#263b47';c.fillText('اتفقنا على الاشتراك — بيانات اختبار فقط',620,235);
 c.fillStyle='#ffffff';c.fillRect(50,390,600,170);c.fillStyle='#263b47';c.fillText('شكرًا للتوضيح. أرسل لي التفاصيل',620,480);
 const blob=await new Promise<Blob>(resolve=>canvas.toBlob(value=>resolve(value!),'image/png'));
 await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);
}
function Preview(){return <main dir="rtl" style={{maxWidth:1060,margin:'32px auto',padding:16}}><h1>صور محادثات العملاء — اختبار معزول</h1><p>بيانات تجريبية فقط. لا اتصال بقاعدة الموقع ولا رفع خارجي. لا تُحفظ الصور بعد تحديث هذه المعاينة.</p><button className="button button-secondary" onClick={()=>void copyTestImage()}>نسخ صورة اختبار</button><CrmConversationImages contactId="fixture" userId="fixture" canManage/></main>;}
createRoot(document.getElementById('root')!).render(<Preview/>);
