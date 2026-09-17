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
test("day-only moves preserve the date across DST and keep legacy clock metadata",()=>{
  assert.equal(c.calendarDay(c.calendarDateInstant("2026-09-18","2026-09-17T15:00:00Z")),"2026-09-18");
  assert.equal(c.calendarWall(c.calendarDateInstant("2026-09-18","2026-09-17T15:00:00Z")),"2026-09-18T18:00");
  assert.equal(c.calendarDateInstant("2026-02-30"),null);
  assert.equal(c.calendarDateInstant("2026-09-18T20:00"),null);
  assert.equal(c.calendarDay(c.calendarDateInstant("2026-04-24","2026-04-23T22:30:00Z")),"2026-04-24");
  assert.equal(c.calendarDateInstant("2026-09-17","2026-09-17T15:00:12Z"),"2026-09-17T15:00:12.000Z");
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
test("group cards by source and Cairo day, not title; retain independent platform records",()=>{
 const entries=c.calendarEntries([content,{...content,id:"other"}],[],[],[]);
 const groups=c.groupCalendarEntries(entries);
 assert.equal(groups.length,2);assert.equal(groups[0].members.length,2);
 assert.equal(entries.length,4);assert.equal(entries[0].members,undefined);
 const moved=entries.map(entry=>entry.key==="content:c:facebook"?{...entry,scheduledAt:"2026-09-18T15:00:00Z"}:entry);
 assert.equal(c.groupCalendarEntries(moved).length,3);
 assert.equal(c.groupCalendarEntries(entries.filter(entry=>entry.platform==="instagram"))[0].members.length,1);
});
test("calendar detail stays in place and completion is not inferred from ready status",async()=>{
 const ui=await readFile(new URL("../components/planning/ContentCalendar.tsx",import.meta.url),"utf8");
 assert.doesNotMatch(ui,/فتح بند الخطة|href=\{details.requestUrl\}|scrollIntoView/);
 assert.match(ui,/calendar-detail-dialog/);assert.match(ui,/تم النشر بنجاح/);
 assert.equal(c.calendarState({...content,status:"scheduled"}).label,"جاهز للنشر");
});
test("calendar exposes day-only drag, mobile alternative and undo without hourly gaps",async()=>{
  const ui=await readFile(new URL("../components/planning/ContentCalendar.tsx",import.meta.url),"utf8");
  for(const contract of ["draggable={editable}","onPointerMove={touchMove}","تغيير الموعد","تراجع عن النقل","calendar-mobile-agenda","calendar-week-board","aria-valuenow",'type="date"'])assert.ok(ui.includes(contract),contract);
  assert.doesNotMatch(ui,/datetime-local|calendar-time-grid|HOUR_HEIGHT|calendarTime\(/);
  for(const file of ["../components/planning/ContentCalendarWorkspace.tsx","../components/content/ContentPublishTimes.tsx"]){const code=await readFile(new URL(file,import.meta.url),"utf8");assert.doesNotMatch(code,/datetime-local|calendarTime\(/);}
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
