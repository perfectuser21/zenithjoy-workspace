import test from 'node:test';
import assert from 'node:assert/strict';
import {runWorkflow} from '../leadgen-runner-adapter.mjs';

const context={run_id:'pure-skill-run',workflow_key:'douyin_video_discovery',execution_mode:'agent'};
const activities=[{key:'collect_videos'},{key:'cleanup'}];
const base=options=>({activities,context,handlers:{collect_videos:()=>{throw Error('ORIGINAL_CODE_MUST_NOT_EXECUTE');},cleanup:()=>{throw Error('ORIGINAL_CLEANUP_MUST_NOT_EXECUTE');}},commander:async()=>({action:'none'}),verify:async()=>({verified:true}),...options});

test('Agent-first从首Activity派Skill并按固定顺序收尾，不调用Code handler或恢复入口',async()=>{
 const calls=[];let recovered=0;
 const result=await runWorkflow(base({executeAgent:async(activity,options)=>{calls.push(activity.key);assert.equal(options.context.execution_mode,'agent');return {status:'completed',execution_stopped:true,result:{saved:1}};},recover:async()=>{recovered++;throw Error('CODE_RECOVERY_MUST_NOT_EXECUTE');}}));
 assert.equal(result.status,'completed');assert.deepEqual(calls,['collect_videos','cleanup']);assert.equal(recovered,0);
 assert.equal(result.results[0].code_failures,0);assert.equal(result.results[0].rescued,false);
});

test('Agent-first缺正式执行器不能静默回退Code',async()=>{
 let code=0;
 const result=await runWorkflow(base({handlers:{collect_videos:async()=>{code++;return {};},cleanup:async()=>{code++;return {};}}}));
 assert.notEqual(result.status,'completed');assert.equal(code,0);
 assert.match(JSON.stringify(result),/AGENT_PRIMARY_EXECUTOR_UNAVAILABLE/);
});

test('Agent-first缺独立验收不能派Agent或接受自报成功',async()=>{
 let calls=0;
 const result=await runWorkflow(base({verify:undefined,executeAgent:async()=>{calls++;return {status:'completed',execution_stopped:true,result:{saved:1}};}}));
 assert.notEqual(result.status,'completed');assert.equal(calls,0);
 assert.match(JSON.stringify(result),/AGENT_INDEPENDENT_VERIFY_UNAVAILABLE/);
});

test('Agent-first未证明终止时隔离并禁止后续Skill清场',async()=>{
 const calls=[];let quarantine=0;
 const result=await runWorkflow(base({executeAgent:async activity=>{calls.push(activity.key);return {status:'failed',execution_stopped:false,reason:'official_child_terminal_missing'};},quarantine:async()=>{quarantine++;return {verified:true};}}));
 assert.equal(result.status,'needs_review');assert.deepEqual(calls,['collect_videos']);assert.equal(quarantine,1);
 assert.equal(result.results[0].execution_stopped,false);
});

test('旧Code未知执行仍保留failed收口和隔离，不被Agent needs_review新语义改写',async()=>{
 let cleanup=0,quarantine=0;
 const result=await runWorkflow(base({context:{...context,execution_mode:'code'},handlers:{collect_videos:async()=>{throw Object.assign(Error('EXECUTION_DEADLINE'),{executionStopped:false});},cleanup:async()=>{cleanup++;return {};}},quarantine:async()=>{quarantine++;return {verified:true};}}));
 assert.equal(result.status,'failed');assert.equal(cleanup,0);assert.equal(quarantine,1);assert.equal(result.results[0].execution_stopped,false);
});

test('Agent-first不能扩展至104发送路径',async()=>{
 let launched=0;
 const result=await runWorkflow(base({context:{...context,workflow_key:'douyin_lead_outreach'},executeAgent:async()=>{launched++;return {status:'completed',execution_stopped:true,result:{sent:1}};}}));
 assert.notEqual(result.status,'completed');assert.equal(launched,0);
 assert.match(JSON.stringify(result),/AGENT_PRIMARY_WORKFLOW_UNSUPPORTED/);
});

test('Agent-first的Commander纠偏送达Agent下一轮，原始业务结果仍由独立验收决定',async()=>{
 const records=[];let corrected=false;
 const result=await runWorkflow(base({commander:async request=>request.evidence?.question?{action:'steer',text:'补齐同视频原生身份再提交'}:{action:'none'},record:async row=>records.push(row),executeAgent:async(activity,options)=>{
  if(activity.key==='collect_videos'){
   const reply=await options.onEvent({type:'question',question:'原件身份缺失如何继续？'});
   corrected=reply.action==='steer'&&/同视频/.test(reply.text);
  }
  return {status:'completed',execution_stopped:true,result:{saved:1}};
 }}));
 assert.equal(result.status,'completed');assert.equal(corrected,true);
 assert.ok(records.some(row=>row.phase==='commander_exchange'&&row.activity==='collect_videos'));
});
