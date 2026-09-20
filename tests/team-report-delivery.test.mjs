import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const source=await readFile(new URL('../supabase/functions/telegram-publisher/index.ts',import.meta.url),'utf8');
const worker=source.slice(source.indexOf('function workflowNotificationText('),source.indexOf('Deno.serve('));
const js=ts.transpileModule(worker,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
async function deliver({allowed=true,permissionError=null,kind='team_report',status=200,networkError=false,gate=true}={}){
  const calls=[],http=[];
  const row={notification_id:7,claim_token:'claim',notification_kind:kind,notification_title:'تقرير اختبار',notification_body:'اختبار فقط',notification_url:'/?report=fixture',telegram_chat_id:123};
  const client={rpc:async(name,args)=>{
    calls.push([name,args]);
    if(name==='claim_telegram_notification_batch')return {data:[row],error:null};
    if(name==='mark_telegram_notification_network_started')return {data:gate,error:null};
    if(name==='authorize_team_report_delivery')return {data:allowed,error:permissionError};
    return {data:true,error:null};
  }};
  const result=await runInNewContext(js+'; sendWorkflowNotifications(client)',{client,siteUrl:'https://example.test',telegram:async(method,body)=>{
    http.push([method,body]); if(networkError)throw new Error('network uncertain');
    return {response:{ok:status===200,status},result:status===200?{ok:true,result:{message_id:5}}:{ok:false,parameters:{retry_after:17}}};
  }});
  return {result,calls,http};
}
test('actual worker denies revoked report before HTTP, after claim marker required for terminal completion',async()=>{
  const {result,calls,http}=await deliver({allowed:false});
  assert.equal(http.length,0);assert.equal(result.failed,1);
  assert.deepEqual(calls.map(c=>c[0]),['claim_telegram_notification_batch','mark_telegram_notification_network_started','authorize_team_report_delivery','complete_telegram_notification_delivery']);
  assert.equal(calls.at(-1)[1].target_terminal_status,'failed');
});
test('actual worker fails closed on authorization outage or rejected claim',async()=>{
  assert.equal((await deliver({permissionError:{message:'unavailable'}})).http.length,0);
  const denied=await deliver({gate:false});assert.equal(denied.http.length,0);assert.equal(denied.calls.length,2);
});
test('authorized report sends one summary and link; unrelated notifications retain original path',async()=>{
  const report=await deliver();assert.equal(report.result.sent,1);assert.equal(report.http.length,1);
  assert.equal(report.http[0][1].reply_markup.inline_keyboard[0][0].text,'فتح التقرير الكامل');
  const normal=await deliver({kind:'task_assigned'});assert.equal(normal.result.sent,1);
  assert.equal(normal.calls.some(c=>c[0]==='authorize_team_report_delivery'),false);
});
test('rate limit and uncertain network preserve existing no-blind-retry behavior',async()=>{
  const rate=await deliver({status:429});assert.equal(rate.result.deferred,1);
  assert.equal(rate.calls.at(-1)[0],'defer_telegram_notification_delivery');assert.equal(rate.calls.at(-1)[1].target_retry_after_seconds,17);
  const uncertain=await deliver({networkError:true});assert.equal(uncertain.result.unknown,1);
  assert.equal(uncertain.calls.at(-1)[1].target_terminal_status,'unknown');
});
