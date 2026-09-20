import type { CrmImage } from '../lib/crm-images';
const records: Array<CrmImage & {hash:string}>=[];
const blobs=new Map<string,Blob>();
export function getSupabaseBrowserClient(){return {
  rpc:async (_name:string,args:{action:string;payload:Record<string,unknown>})=>{
    const p=args.payload;
    if(args.action==='list') {const filtered=records.filter(i=>i.state===(p.archived?'archived':'ready'));return {data:{images:filtered.slice(Number(p.page)*12,(Number(p.page)+1)*12),total:filtered.length,used_bytes:Array.from(blobs.values()).reduce((s,b)=>s+b.size,0),limit_bytes:734003200,pending:0},error:null};}
    if(args.action==='reserve') {let row=records.find(i=>i.hash===p.hash);if(!row){row={id:crypto.randomUUID(),object_path:crypto.randomUUID(),created_by:'fixture',created_at:new Date().toISOString(),caption:String(p.caption),bytes:0,author_name:'عضو — بيانات اختبار',state:'ready',hash:String(p.hash)};records.unshift(row);}return {data:{...row,state:blobs.has(row.object_path)?row.state:'pending'},error:null};}
    const row=records.find(i=>i.id===p.id);if(!row)return {data:null,error:new Error('الصورة غير موجودة')};
    if(args.action==='archive')row.state='archived';if(args.action==='restore')row.state='ready';
    return {data:{id:row.id},error:null};
  },
  storage:{from:()=>({
    upload:async(path:string,blob:Blob)=>{blobs.set(path,blob);return {error:null};},
    download:async(path:string)=>({data:blobs.get(path),error:null}),
  })},
};}
