import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const source = await readFile(new URL("../lib/content-calendar.ts",import.meta.url),"utf8");
const code = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const c = await import("data:text/javascript;base64,"+Buffer.from(code).toString("base64"));
const content = {id:"c",title:"ريل",format:"reel",created_by:"owner",status:"production",platforms:["Instagram","facebook"],publish_at:"2026-09-17T15:00:00Z"};
const plan = {id:"p",name:"خطة المؤشر",offer:"المؤشر",status:"active"};
const linked = {id:"i",plan_id:"p",content_item_id:"c",platforms:content.platforms,publish_at:content.publish_at,status:"in_production"};
test("Cairo wall time handles DST and browser-independent date rollover",()=>{
  assert.equal(c.calendarInstant("2026-09-17T18:00"),"2026-09-17T15:00:00.000Z");
  assert.equal(c.calendarInstant("2026-01-17T18:00"),"2026-01-17T16:00:00.000Z");
  assert.equal(c.calendarInstant("2026-04-24T00:30"),null);
  assert.equal(c.calendarInstant("2026-02-30T18:00"),null);
  assert.equal(c.calendarDay("2026-09-17T22:30:00Z"),"2026-09-18");
  assert.equal(c.calendarWall(c.calendarInstant("2026-09-17T18:15")),"2026-09-17T18:15");
});
test("Saturday week and 42-cell month include boundaries",()=>{
  assert.equal(c.calendarWeek("2026-09-17"),"2026-09-12");
  assert.equal(c.calendarMonthDays("2026-09-17").length,42);
  assert.equal(c.addCalendarDays("2026-12-31",1),"2027-01-01");
});
test("drop uses 15-minute grid without moving outside the day",()=>{
  assert.equal(c.calendarWall(c.calendarDropTime("2026-09-17",608)),"2026-09-17T10:15");
  assert.equal(c.calendarWall(c.calendarDropTime("2026-09-17",1900)),"2026-09-17T23:45");
});
test("one request, per-platform independent schedule, no duplicate linked plan row",()=>{
  const slots=[{content_item_id:"c",platform:"instagram",scheduled_at:null,revision:2}];
  const entries=c.calendarEntries([content],[linked],[plan],slots);
  assert.equal(entries.length,2);
  assert.equal(entries.find(e=>e.platform==="instagram").scheduledAt,null);
  assert.equal(entries.find(e=>e.platform==="facebook").scheduledAt,content.publish_at);
  assert.ok(entries.every(e=>e.source==="content"&&e.product==="المؤشر"));
});
test("cancelled or archived requests are absent; published cards are immovable",()=>{
  assert.equal(c.calendarEntries([{...content,status:"cancelled"}],[],[],[]).length,0);
  assert.equal(c.calendarEntries([content],[linked],[{...plan,status:"archived"}],[]).length,0);
  assert.ok(c.calendarEntries([{...content,status:"published"}],[],[],[]).every(e=>!e.editable));
});
test("overlap lanes do not collide for staggered appointments",()=>{
  const entries=[0,60,140].map((minute,index)=>({key:String(index),scheduledAt:c.calendarDropTime("2026-09-17",600+minute)}));
  const lanes=c.calendarLanes(entries);
  assert.equal(lanes.get("0").count,2);
  assert.notEqual(lanes.get("0").lane,lanes.get("1").lane);
  assert.notEqual(lanes.get("1").lane,lanes.get("2").lane);
});
test("calendar exposes mobile/keyboard alternative, undo and Cairo time",async()=>{
  const ui=await readFile(new URL("../components/planning/ContentCalendar.tsx",import.meta.url),"utf8");
  for(const contract of ["draggable={editable}","onPointerMove={touchMove}","تغيير الموعد","تراجع عن النقل","calendar-mobile-agenda","توقيت القاهرة","aria-valuenow","datetime-local"])assert.ok(ui.includes(contract),contract);
});
test("calendar SQL protects scopes, optimistic locking and never reschedules tasks",async()=>{
  const sql=await readFile(new URL("../supabase/migrations/20260916234611_content_calendar_slots.sql",import.meta.url),"utf8");
  assert.match(sql,/enable row level security/);
  assert.match(sql,/expected_revision <> coalesce\(slot.revision,0\)/);
  assert.match(sql,/expected_time is distinct from/);
  assert.match(sql,/can_read_content_actor/);
  assert.match(sql,/transfer_calendar_plan_slots/);
  assert.doesNotMatch(sql,/update public\.tasks|insert into public\.tasks/i);
});
