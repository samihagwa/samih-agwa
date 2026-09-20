import { cairoReportDay, shiftReportDay } from "../lib/team-reports";
const day=shiftReportDay(cairoReportDay(),-1);
const report={start:day,end:day,generated_at:new Date().toISOString(),presence_since:day+'T08:00:00Z',partial:false,members:[
  {user_id:'owner',name:'مالك — بيانات اختبار',metrics:{deliveries:3,completed:2,content_created:1,scripts_edited:2},presence_days:1,first_seen:day+'T07:00:00Z',last_seen:day+'T15:00:00Z',last_activity:day+'T14:00:00Z',overdue_now:1,auto_published:2},
  {user_id:'member',name:'عضو — بيانات اختبار',metrics:{},presence_days:0,first_seen:null,last_seen:null,last_activity:null,overdue_now:0,auto_published:0},
]};
let config={daily_enabled:false,weekly_enabled:false,delivery_hour:8,weekly_day:6,revision:0,scheduler_available:true,included_users:['owner','member'],recipients:[{user_id:'owner',scope:'team',telegram:false}]};
export function getSupabaseBrowserClient() { return {rpc:async(_name:string,args:{command:string;payload?:unknown})=>{
  await new Promise(resolve=>setTimeout(resolve,150));
  if(args.command==='save') {config={...config,...args.payload as typeof config,revision:config.revision+1};return {data:config,error:null};}
  if(args.command==='settings')return {data:config,error:null};
  if(args.command==='list')return {data:[{id:'fixture',scope:'team',cadence:'daily',period_start:day,period_end:day,created_at:report.generated_at}],error:null};
  return {data:report,error:null};
}}; }
