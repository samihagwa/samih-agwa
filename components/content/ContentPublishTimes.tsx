"use client";
import { useEffect, useState } from "react";
import { calendarDateLabel, calendarDay, calendarTime, type CalendarSlot } from "../../lib/content-calendar";
import { contentPlatformLabel } from "../../lib/content";
import { getSupabaseBrowserClient } from "../../lib/supabase/client";
import type { Tables } from "../../lib/supabase/database.types";

// Used inside the shared request view, including the view opened from a task.
// Never present the legacy earliest timestamp as every platform's appointment.
export function ContentPublishTimes({ item }: { item: Tables<"content_items"> }) {
  const [slots, setSlots] = useState<CalendarSlot[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadedKey, setLoadedKey] = useState("");
  const key = `${item.id}:${item.publish_at}`;
  useEffect(() => {
    let cancelled=false;
    const db=getSupabaseBrowserClient();
    async function load() {
      const result=await db.from("content_calendar_slots").select("*").eq("content_item_id",item.id).eq("organization_id",item.organization_id);
      if(cancelled)return;
      setLoadedKey(key);setFailed(Boolean(result.error));
      if(!result.error)setSlots(result.data??[]);
    }
    void load();
    const channel=db.channel(`request-calendar-${item.id}`).on("postgres_changes",{event:"*",schema:"public",table:"content_calendar_slots",filter:`content_item_id=eq.${item.id}`},()=>{void load();}).subscribe();
    return ()=>{cancelled=true;void db.removeChannel(channel);};
  },[item.id,item.organization_id,key]);
  if(loadedKey!==key)return <p className="request-publish-times" role="status">جارٍ تحميل مواعيد النشر…</p>;
  if(failed)return <p className="request-publish-times" role="alert">تعذّر تحميل مواعيد المنصات. حدّث الصفحة للتأكد من الموعد.</p>;
  if(!slots)return <p className="request-publish-times" role="status">جارٍ تحميل مواعيد النشر…</p>;
  return <div className="request-publish-times" aria-label="مواعيد النشر حسب المنصة">{[...new Set(item.platforms.map((platform)=>platform.trim().toLowerCase()))].map((platform)=>{
    const slot=slots.find((row)=>row.platform===platform);const time=slot?slot.scheduled_at:item.publish_at;
    return <span key={platform}><strong>{contentPlatformLabel(platform)}</strong> · {time?`${calendarDateLabel(calendarDay(time))} — ${calendarTime(time)}`:"بدون موعد"}</span>;
  })}</div>;
}
