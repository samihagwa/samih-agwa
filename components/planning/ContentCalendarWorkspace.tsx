"use client";

import { DateInput } from "../ui/DateInput";

import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { calendarEntries, calendarError, calendarDateInstant, calendarDay, type CalendarEntry, type CalendarSlot } from "../../lib/content-calendar";
import { contentProgress, latestDeliveries, safeWebLink } from "../../lib/content-presentation";
import { contentPlatformLabel } from "../../lib/content";
import { contentPlanItemKinds, contentPlanItemKindConfig, type ContentPlanItemKind } from "../../lib/planning";
import { contentSourceDeepLink } from "../../lib/deep-links";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "../../lib/supabase/client";
import type { Tables } from "../../lib/supabase/database.types";
import { useWorkspaceAuth } from "../../lib/supabase/use-workspace-auth";
import { Button } from "../ui/Button";
import { ContentCalendar, type CalendarDetails } from "./ContentCalendar";

type Workspace = { membership: Tables<"memberships">; contents: Tables<"content_items">[]; items: Tables<"content_plan_items">[]; plans: Tables<"content_plans">[]; slots: CalendarSlot[] };
async function pages<T>(read: (start: number, end: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const rows: T[] = [];
  for (let start = 0; ; start += 500) { const result = await read(start, start + 499); if (result.error) throw result.error; rows.push(...(result.data ?? [])); if ((result.data?.length ?? 0) < 500) return rows; }
}
const platformOptions = ["instagram", "facebook", "tiktok", "youtube", "telegram", "x", "email"];

export function ContentCalendarWorkspace() {
  const configured = isSupabaseConfigured();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(configured);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [details, setDetails] = useState<{key:string;data:CalendarDetails} | null>(null);
  const [undo, setUndo] = useState<{ entry: CalendarEntry; times: (string | null)[] } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createFormKey,setCreateFormKey] = useState(0);
  const [initialTime] = useState(() => calendarDay(new Date(Date.now()+86400000)));
  const generation = useRef(0);
  const busy = useRef(false);
  const createRequest = useRef("");
  const dialog = useRef<HTMLDialogElement>(null);
  const clearWorkspace = useCallback(() => { generation.current++; setWorkspace(null); setSelectedKey(null); setDetails(null); setUndo(null); setCreateOpen(false); }, []);
  const clearTransientState = useCallback(() => { setError(null); setNotice(null); }, []);
  const loadWorkspace = useCallback(async (active: Session) => {
    const current = ++generation.current;
    const db = getSupabaseBrowserClient();
    try {
      const member = await db.from("memberships").select("*").eq("user_id", active.user.id).eq("status", "active").limit(1).maybeSingle();
      if (member.error) throw member.error;
      if (!member.data) { if (current === generation.current) clearWorkspace(); return; }
      const org = member.data.organization_id;
      const [contents, items, plans, slots] = await Promise.all([
        pages<Tables<"content_items">>((a,b) => db.from("content_items").select("*").eq("organization_id",org).neq("status","cancelled").order("id").range(a,b)),
        pages<Tables<"content_plan_items">>((a,b) => db.from("content_plan_items").select("*").eq("organization_id",org).order("id").range(a,b)),
        pages<Tables<"content_plans">>((a,b) => db.from("content_plans").select("*").eq("organization_id",org).order("id").range(a,b)),
        pages<CalendarSlot>((a,b) => db.from("content_calendar_slots").select("*").eq("organization_id",org).order("id").range(a,b)),
      ]);
      if (current !== generation.current) return;
      setWorkspace({membership:member.data,contents,items,plans,slots});
    } catch { if (current === generation.current) setError("تعذّر تحميل التقويم كاملًا. اضغط تحديث للمحاولة مرة أخرى."); }
    finally { if (current === generation.current) setLoading(false); }
  }, [clearWorkspace]);
  const session = useWorkspaceAuth({ configured, loadWorkspace, clearWorkspace, setLoading, clearTransientState });
  const entries = useMemo(() => workspace ? calendarEntries(workspace.contents,workspace.items,workspace.plans,workspace.slots) : [], [workspace]);
  const selected = entries.find((entry) => entry.key === selectedKey);
  const canEdit = Boolean(workspace && ["owner","admin","manager"].includes(workspace.membership.role) && (workspace.membership.role === "owner" || workspace.membership.allowed_sections.includes("planning")));
  const refresh = useCallback(() => { setError(null); if(session) void loadWorkspace(session); }, [session,loadWorkspace]);

  const orgId = workspace?.membership.organization_id;
  useEffect(() => {
    if (!orgId || !session) return;
    const db = getSupabaseBrowserClient(); let timer: ReturnType<typeof setTimeout>;
    const channel = db.channel(`content-calendar-${orgId}`);
    for (const table of ["content_calendar_slots","content_items","content_plan_items","content_plans","tasks","content_step_deliveries"]) {
      channel.on("postgres_changes",{event:"*",schema:"public",table,filter:`organization_id=eq.${orgId}`},() => { clearTimeout(timer); timer=setTimeout(() => { void loadWorkspace(session); },400); });
    }
    channel.subscribe();
    const focus = () => { void loadWorkspace(session); };
    window.addEventListener("focus",focus);
    return () => { clearTimeout(timer); void db.removeChannel(channel); window.removeEventListener("focus",focus); };
  }, [orgId, session, loadWorkspace]);

  useEffect(() => {
    let cancelled = false;
    if (!selected) return;
    const db = getSupabaseBrowserClient();
    const base = { progress:0,done:0,total:0,current:"",owner:"غير محدد",fileUrl:null,requestUrl:selected.contentId?contentSourceDeepLink(selected.contentId,""):`/planning?plan_item=${selected.sourceId}&manage=1#plan-item-${selected.sourceId}` };
    void (async () => {
      try {
        const tasks = selected.contentId ? await pages<Tables<"tasks">>((a,b)=>db.from("tasks").select("*").eq("content_item_id",selected.contentId!).neq("status","cancelled").order("id").range(a,b)) : [];
        const deliveries = selected.contentId ? await pages<Tables<"content_step_deliveries">>((a,b)=>db.from("content_step_deliveries").select("*").eq("content_item_id",selected.contentId!).order("id").range(a,b)) : [];
        const publishing = tasks.find((task)=>task.content_step==="publishing");
        const profile = await db.from("profiles").select("full_name").eq("id",publishing?.owner_id ?? selected.ownerId).maybeSingle();
        if (profile.error) throw profile.error;
        const progress = contentProgress(tasks,selected.status as Tables<"content_items">["status"]);
        const latest = [...latestDeliveries(deliveries).values()].find((delivery)=>delivery.step==="editing" && tasks.some((task)=>task.id===delivery.task_id&&task.status==="done"));
        if (!cancelled) setDetails({key:selected.key,data:{...base,progress:progress.percent,done:progress.done,total:progress.total,current:progress.current,owner:profile.data?.full_name??"غير محدد",fileUrl:latest?.result_url?safeWebLink(latest.result_url):null}});
      } catch { if (!cancelled) setDetails({key:selected.key,data:{...base,error:"تعذّر تحميل تفاصيل التنفيذ. أعد التحديث."}}); }
    })();
    return () => { cancelled=true; };
  }, [selected, workspace]);
  useEffect(() => { if(createOpen) dialog.current?.showModal(); else dialog.current?.close(); },[createOpen]);

  async function move(entry: CalendarEntry, time: string | null, restoreTimes?: (string | null)[]) {
    if (busy.current || !canEdit || !session) return false;
    const members = entry.members ?? [entry];
    const targets = members.map((member,index)=>restoreTimes ? restoreTimes[index] : time ? calendarDateInstant(calendarDay(time),member.scheduledAt) : null);
    if (members.every((member,index)=>targets[index]===member.scheduledAt)) return true;
    busy.current=true;setWorking(true);setError(null);setNotice("جارٍ حفظ موعد المحتوى…");
    const actor = session.user.id;
    try {
      const result = await getSupabaseBrowserClient().rpc("move_content_calendar_group",{source_kind:entry.source,source_id:entry.sourceId,changes:members.map((member,index)=>({platform:member.platform,target_time:targets[index],revision:member.revision,expected_time:member.scheduledAt}))});
      if(result.error) throw result.error;
      const slots = result.data;
      // Keep the canonical response, including revision, for a conflict-safe undo.
      setWorkspace((current)=>current?.membership.user_id===actor?{...current,slots:[...current.slots.filter((row)=>!slots.some(slot=>slot.id===row.id)),...slots]}:current);
      const updated = members.map(member=>{const slot=slots.find(row=>row.platform===member.platform)!;return {...member,scheduledAt:slot.scheduled_at,revision:slot.revision};});
      setUndo(restoreTimes?null:{entry:{...updated[0],members:updated},times:members.map(member=>member.scheduledAt)});
      setNotice(restoreTimes?"تم التراجع عن النقل.":members.length>1?`تم نقل المحتوى مع ${members.length} منصات. مهام التنفيذ لم تتغير.`:`تم حفظ موعد ${contentPlatformLabel(entry.platform)} فقط. مهام التنفيذ لم تتغير.`);
      await loadWorkspace(session);
      return true;
    } catch (failure) { setError(calendarError(failure));setNotice(null);await loadWorkspace(session);return false; }
    finally { busy.current=false;setWorking(false); }
  }
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if(!workspace||!session||busy.current)return;
    const form=new FormData(event.currentTarget); const time=calendarDateInstant(String(form.get("time")));
    const platforms=form.getAll("platforms").map(String);
    if(!time||!platforms.length){setCreateError("حدد يوم النشر ومنصة واحدة على الأقل.");return;}
    busy.current=true;setWorking(true);setCreateError("");setError(null);setNotice(null);
    try {
      const result=await getSupabaseBrowserClient().rpc("create_calendar_draft",{target_org:workspace.membership.organization_id,request_id:createRequest.current,item_title:String(form.get("title")).trim(),item_kind:String(form.get("kind")) as ContentPlanItemKind,item_brief:String(form.get("brief")).trim(),item_platforms:platforms,item_time:time,target_plan:String(form.get("plan"))||null});
      if(result.error)throw result.error;
      setCreateOpen(false);setUndo(null);setSelectedKey(`plan:${result.data}:${platforms[0]}`);setNotice("تمت إضافة المحتوى للتقويم. لم تُنشأ مهام تنفيذ تلقائيًا.");await loadWorkspace(session);
    } catch { setCreateError("تعذّر الحفظ. تأكد أن الموعد داخل فترة الخطة وأن حسابك يملك صلاحية التخطيط. بياناتك ما زالت هنا."); }
    finally { busy.current=false;setWorking(false); }
  }
  async function editDraft(entry: CalendarEntry, title: string, brief: string) {
    const item=workspace?.items.find(row=>row.id===entry.sourceId);
    if(!canEdit||!session||busy.current||!item||item.content_item_id)return false;
    busy.current=true;setWorking(true);setError(null);
    try {
      const result=await getSupabaseBrowserClient().from("content_plan_items").update({title,objective:brief}).eq("id",item.id).eq("version",item.version).is("content_item_id",null).select("id").maybeSingle();
      if(result.error)throw result.error;
      if(!result.data)throw new Error("changed");
      setNotice("تم حفظ تفاصيل المحتوى.");await loadWorkspace(session);return true;
    }catch{setError("لم نحفظ التعديل. قد تكون التفاصيل اتغيّرت؛ حدّث التقويم وحاول مجددًا. النص الذي كتبته ما زال هنا.");return false;}
    finally{busy.current=false;setWorking(false);}
  }
  async function complete(entry: CalendarEntry, completed: boolean) {
    if (busy.current || !canEdit || !session || !entry.editable) return false;
    busy.current=true;setWorking(true);setError(null);setNotice("جارٍ حفظ علامة الإتمام…");
    try {
      const result=await getSupabaseBrowserClient().rpc("set_content_calendar_completion", {
        source_kind:entry.source,source_id:entry.sourceId,completed,
        changes:(entry.members??[entry]).map(member=>({platform:member.platform,revision:member.revision,expected_time:member.scheduledAt})),
      });
      if(result.error)throw result.error;
      const slots=result.data;
      setWorkspace(current=>current?.membership.user_id===session.user.id?{...current,slots:[...current.slots.filter(row=>!slots.some(slot=>slot.id===row.id)),...slots]}:current);
      setUndo(null);setNotice(completed?"تم حفظ علامة الإتمام. مهام التنفيذ وحالة النشر لم تتغير.":"تم إلغاء علامة الإتمام.");
      await loadWorkspace(session);return true;
    }catch{setError("تعذّر حفظ علامة الإتمام. حدّث التقويم وحاول مجددًا.");setNotice(null);await loadWorkspace(session);return false;}
    finally{busy.current=false;setWorking(false);}
  }
  if(!configured)return <p className="form-notice">إعداد الاتصال بمساحة العمل مطلوب.</p>;
  if(loading&&!workspace)return <p role="status">جارٍ تحميل تقويم المحتوى…</p>;
  if(!workspace)return <div><p role="alert">{error??"يلزم تسجيل الدخول بحساب فريق فعّال."}</p><Button href="/login">تسجيل الدخول</Button>{session?<Button onClick={refresh}>إعادة المحاولة</Button>:null}</div>;
  return <>
    <ContentCalendar onComplete={complete} onEditDraft={editDraft} entries={entries} canEdit={canEdit} working={working} error={error} notice={notice} details={selected ? details?.key===selected.key ? details.data : {loading:true,progress:0,done:0,total:0,current:"",owner:"",fileUrl:null,requestUrl:""} : null} selectedKey={selectedKey} undoAvailable={Boolean(undo)} onSelect={setSelectedKey} onMove={move} onUndo={()=>{if(undo)void move(undo.entry,null,undo.times);}} onRefresh={refresh} onCreate={()=>{createRequest.current=crypto.randomUUID();setCreateFormKey((value)=>value+1);setCreateError("");setCreateOpen(true);}}/>
    <dialog ref={dialog} className="calendar-create-dialog" onCancel={(event)=>{if(working)event.preventDefault();else setCreateOpen(false);}} onClose={()=>setCreateOpen(false)}><form key={createFormKey} onSubmit={create}><header><h2>إضافة محتوى للتقويم</h2><button className="icon-button" type="button" disabled={working} aria-label="إغلاق" onClick={()=>setCreateOpen(false)}><X size={18}/></button></header><p>الطلبات الموجودة تظهر هنا تلقائيًا. أضف هنا فكرة جديدة وموعدها فقط.</p><label>عنوان المحتوى<input name="title" minLength={3} maxLength={180} required/></label><div className="calendar-form-pair"><label>نوع المحتوى<select name="kind">{contentPlanItemKinds.map((kind)=><option key={kind} value={kind}>{contentPlanItemKindConfig[kind].label}</option>)}</select></label><label>يوم النشر<DateInput name="time" type="date" defaultValue={initialTime} required/></label></div><label>المطلوب / الفكرة<textarea name="brief" minLength={5} maxLength={2000} rows={3} required placeholder="وصف بسيط للمحتوى المقترح"/></label><fieldset><legend>المنصات</legend><div className="calendar-platform-checkboxes">{platformOptions.map((platform)=><label key={platform}><input type="checkbox" name="platforms" value={platform} defaultChecked={platform==="instagram"}/>{contentPlatformLabel(platform)}</label>)}</div></fieldset><details className="calendar-optional-plan"><summary>ربط بخطة موجودة — اختياري</summary><label>الخطة<select name="plan"><option value="">بدون خطة محددة</option>{workspace.plans.filter((plan)=>plan.status!=="archived").map((plan)=><option key={plan.id} value={plan.id}>{plan.offer||plan.name} ({plan.starts_on} — {plan.ends_on})</option>)}</select></label></details>{createError?<p className="form-notice error" role="alert">{createError}</p>:null}<div className="calendar-dialog-actions"><Button type="submit" disabled={working}>{working?"جارٍ الحفظ…":"إضافة للتقويم"}</Button><Button variant="ghost" type="button" disabled={working} onClick={()=>setCreateOpen(false)}>إلغاء</Button></div><a className="text-button" href="/content?create=reel">عندي المادة الخام وأريد إنشاء طلب تنفيذ</a></form></dialog>
  </>;
}
