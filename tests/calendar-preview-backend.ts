// Standalone browser fixture. No network, auth token, or real data.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { calendarDay, calendarInstant } from "../lib/content-calendar";
const org="00000000-0000-4000-8000-000000000001";
const owner="00000000-0000-4000-8000-000000000002";
const today=calendarDay(new Date());
let mode="";
export function fixtureMode(value:string){mode=value;}
const stored=()=>{try{return JSON.parse(localStorage.getItem("calendar-fixture-slots")??"[]");}catch{return [];}};
const state: Record<string,any[]>={
 memberships:[{organization_id:org,user_id:owner,role:localStorage.getItem("calendar-fixture-viewer")?"viewer":"owner",status:"active",allowed_sections:["planning"]}],
 content_items:[
  {id:"00000000-0000-4000-8000-000000000003",organization_id:org,title:"شرح المؤشر في دقيقة",format:"reel",platforms:["instagram","facebook"],created_by:owner,status:"production",publish_at:calendarInstant(today+"T14:00")},
  {id:"00000000-0000-4000-8000-000000000004",organization_id:org,title:"أخطاء إدارة رأس المال",format:"post",platforms:["telegram"],created_by:owner,status:"scheduled",publish_at:calendarInstant(today+"T18:30")},
  {id:"00000000-0000-4000-8000-000000000005",organization_id:org,title:"إعلان الكورس الجديد",format:"story",platforms:["instagram"],created_by:owner,status:"planned",publish_at:calendarInstant(today+"T21:00")},
 ], content_plan_items:[],content_plans:[],content_calendar_slots:stored(),
 profiles:[{id:owner,full_name:"مسؤول النشر التجريبي"}],
 tasks:[{id:"task",content_item_id:"00000000-0000-4000-8000-000000000003",content_step:"editing",is_work_item:true,status:"done",owner_id:owner,due_at:"2026-09-16T10:00:00Z"},{id:"task2",content_item_id:"00000000-0000-4000-8000-000000000003",content_step:"publishing",is_work_item:true,status:"ready",owner_id:owner}],
 content_step_deliveries:[{id:"delivery",task_id:"task",content_item_id:"00000000-0000-4000-8000-000000000003",step:"editing",result_url:"https://example.com/video",version:1,submitted_at:new Date().toISOString()}]
};
export function isSupabaseConfigured(){return true;}
export function getSupabaseBrowserClient(){
 return {
  auth:{onAuthStateChange:(callback:any)=>{const timer=setTimeout(()=>callback("SIGNED_IN",{user:{id:owner}}),0);return{data:{subscription:{unsubscribe:()=>clearTimeout(timer)}}};}},
  from:(table:string)=>{
   let rows=[...(state[table]??[])];let single=false;let patch:any=null;
   const equal=(key:string,value:any)=>{rows=rows.filter(r=>r[key]===value);return query;};
   const query:any={select:()=>query,update:(value:any)=>{patch=value;return query;},eq:equal,is:equal,neq:(key:string,value:any)=>{rows=rows.filter(r=>r[key]!==value);return query;},order:()=>query,limit:(n:number)=>{rows=rows.slice(0,n);return query;},range:(a:number,b:number)=>{rows=rows.slice(a,b+1);return query;},maybeSingle:()=>{single=true;return query;},then:(resolve:any)=>{if(patch)rows.forEach(row=>Object.assign(row,patch,{version:(row.version??0)+1}));return Promise.resolve({data:single?rows[0]??null:rows,error:null}).then(resolve);}};return query;
  },
  channel:()=>{const channel={on:()=>channel,subscribe:()=>channel};return channel;},removeChannel:async()=>{},
  rpc:async(name:string,args:any)=>{
   await new Promise(resolve=>setTimeout(resolve,350));
   if(mode){const failure=mode;mode="";return{data:null,error:{message:failure==="conflict"?"Calendar revision changed; refresh and retry":"offline"}};}
   if(name==="create_calendar_draft"){
    state.content_plan_items.push({id:args.request_id,organization_id:org,owner_id:owner,created_by:owner,title:args.item_title,objective:args.item_brief,version:1,content_item_id:null,kind:args.item_kind,status:"planned",platforms:args.item_platforms,publish_at:args.item_time});
    return{data:args.request_id,error:null};
   }
   if(name==="move_content_calendar_group") {
    const snapshot=structuredClone(state.content_calendar_slots); const rows=[];
    for(const change of args.changes){const result:any=await getSupabaseBrowserClient().rpc("move_content_calendar_slot",{...args,target_platform:change.platform,target_time:change.target_time,expected_revision:change.revision,expected_time:change.expected_time});if(result.error){state.content_calendar_slots=snapshot;localStorage.setItem("calendar-fixture-slots",JSON.stringify(snapshot));return result;}rows.push(result.data);}
    return {data:rows,error:null};
   }
   const parent=state[args.source_kind==="content"?"content_items":"content_plan_items"].find(r=>r.id===args.source_id);
   const key=args.source_kind==="content"?"content_item_id":"plan_item_id";
   let slot=state.content_calendar_slots.find(r=>r[key]===args.source_id&&r.platform===args.target_platform);
   if((slot?.revision??0)!==args.expected_revision||(slot?slot.scheduled_at:parent.publish_at)!==args.expected_time)return{error:{message:"Calendar revision changed; refresh and retry"}};
   for(const platform of parent.platforms){if(!state.content_calendar_slots.some(r=>r[key]===parent.id&&r.platform===platform))state.content_calendar_slots.push({id:crypto.randomUUID(),organization_id:org,content_item_id:null,plan_item_id:null,[key]:parent.id,platform,scheduled_at:parent.publish_at,revision:0});}
   slot=state.content_calendar_slots.find(r=>r[key]===args.source_id&&r.platform===args.target_platform);
   slot.scheduled_at=args.target_time;slot.revision++;slot.updated_at=new Date().toISOString();
   localStorage.setItem("calendar-fixture-slots",JSON.stringify(state.content_calendar_slots));
   return{data:{...slot},error:null};
  }
 };
}
