import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./publish.mjs',import.meta.url),'utf8').split('\n').filter(line=>!line.startsWith('import ')).join('\n');
const publish=new (Object.getPrototypeOf(async function(){}).constructor)('getToken','notionReq','__INPUT__','console',source);
const rich=value=>({rich_text:[{plain_text:value,text:{content:value}}]});
async function run(incoming,previous,props={}){
 let written;const req=async(path,method='GET',body)=>{if(method==='PATCH'){written=body.properties;return {}};return {properties:{'账号巡查快照':rich(JSON.stringify(previous)),...props}}};
 await publish(()=> 'fixture',(_,path,method,body)=>req(path,method,body),incoming,{log(){}});
 return {written,snapshot:JSON.parse(written['账号巡查快照'].rich_text.map(t=>t.text.content).join(''))};
}
const prior={checked_at:'2026-10-01T14:00:00Z',schedule_status:'paused',results:{抖音:{state:'已登录',last_verified:{nickname:'本人甲',account_id:'sample_a',verified_at:'2026-10-01T14:00:00Z'}}},rendered_props:{'抖音账号':'旧机器值'}};

test('台账保留历史本人身份且尊重人工覆盖，不把离线误记为未登录',async()=>{
 const result=await run({checked_at:'2026-10-10T14:00:00Z',task_id:'fixture',phones:{小白:{serial:'sample',results:{抖音:{state:'离线未查',reason:'offline'}}}}},prior,{'抖音账号':rich('人工确认本人乙')});
 assert.equal(result.written['抖音账号'],undefined);
 assert.equal(result.snapshot.results.抖音.state,'离线未查');
 assert.equal(result.snapshot.results.抖音.last_verified.account_id,'sample_a');
 assert.equal(result.snapshot.conflicts.length,1);
});

test('实际中央调度状态更新快照，不沿用已过时的paused标签',async()=>{
 const result=await run({checked_at:'2026-10-10T14:00:00Z',task_id:'fixture',schedule_status:'active',recurring_task_id:'new-schedule',phones:{小白:{serial:'sample',results:{}}}},prior);
 assert.equal(result.snapshot.schedule_status,'active');
 assert.equal(result.snapshot.recurring_task_id,'new-schedule');
});

test('只登记调度状态不伪造账号核验时间、不覆盖账号和本人信息',async()=>{
 const result=await run({metadata_only:true,schedule_status:'active',recurring_task_id:'new-schedule',schedule:'每天22:00（Asia/Shanghai）',phones:{小白:{}}},prior);
 assert.equal(result.written['账号核验时间'],undefined);
 assert.equal(result.written['抖音账号'],undefined);
 assert.equal(result.snapshot.checked_at,prior.checked_at);
 assert.deepEqual(result.snapshot.results,prior.results);
 assert.equal(result.snapshot.schedule_status,'active');
});
