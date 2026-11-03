import test from 'node:test';
import assert from 'node:assert/strict';
import {runWorkflow} from '../leadgen-workflow.mjs';

const activities=[{key:'work'},{key:'next'},{key:'cleanup'}];
const base=({handlers={},...opts}={})=>({activities,context:{run_id:'adapter-run',workflow_key:'adapter'},handlers:{work:async()=>({saved:1}),next:async()=>({}),cleanup:async()=>({}),...handlers},record:async()=>{},verify:async()=>({verified:true}),...opts});
test('Commander不可达只记不可用，业务及清场按代码检查完成',async()=>{
 const records=[],executed=[];
 const result=await runWorkflow(base({handlers:Object.fromEntries(activities.map(a=>[a.key,async()=>{executed.push(a.key);return {};} ])),commander:async()=>{throw Error('COMMANDER_UNAVAILABLE');},record:async r=>records.push(r)}));
 assert.equal(result.status,'completed');assert.deepEqual(executed,['work','next','cleanup']);
 assert.ok(records.some(r=>r.commander_status==='unavailable'));
});
test('旧Commander的finish或status不能修改活动状态或顺序',async()=>{
 const executed=[];
 const result=await runWorkflow(base({handlers:Object.fromEntries(activities.map(a=>[a.key,async()=>{executed.push(a.key);return {};} ])),commander:async()=>({action:'finish',reason:'claim complete',status:'failed'})}));
 assert.equal(result.status,'completed');assert.deepEqual(executed,['work','next','cleanup']);
});
test('失败检查仅恢复一次，指导传给接手且再次检查失败needs_review',async()=>{
 let recovered=0,checked=0,next=0;const records=[];
 const result=await runWorkflow(base({handlers:{next:async()=>{next++;return {};}},commander:async r=>r.phase==='recovery'?{action:'steer',text:'修复保存读回，符合DoD',reason:'保存不完整→读回→DoD'}:{action:'none'},record:async r=>records.push(r),verify:async a=>{if(a.key==='work')checked++;return {verified:a.key!=='work'};},recover:async q=>{recovered++;assert.match(JSON.stringify(q.guidance),/读回/);return {status:'completed',execution_stopped:true,result:{saved:2}};}}));
 assert.equal(recovered,1);assert.equal(checked,2);assert.equal(next,0);assert.equal(result.status,'needs_review');
 assert.equal(result.results[0].validator_verdict,'fail');assert.equal(result.results[0].rescued,false);
 assert.ok(records.some(r=>r.phase==='commander_exchange'));
});
test('Commander abort触发待复核并清场，不能执行下一活动',async()=>{
 const executed=[];
 const result=await runWorkflow(base({handlers:Object.fromEntries(activities.map(a=>[a.key,async()=>{executed.push(a.key);return {};} ])),activities:[{key:'work',executor_kind:'agent'},{key:'next'},{key:'cleanup'}],commander:async r=>r.activity==='work'&&r.evidence?.phase==='end'?{action:'abort',reason:'请主理人复核'}:{action:'none'}}));
 assert.equal(result.status,'needs_review');assert.deepEqual(executed,['work','cleanup']);
});
test('原执行终止未知时不重试不清场，持久隔离资源',async()=>{
 let next=0,cleanup=0,recovered=0,isolated=0;
 const result=await runWorkflow(base({handlers:{work:async()=>{const e=Error('EXECUTION_DEADLINE');e.executionStopped=false;throw e;},next:async()=>{next++;},cleanup:async()=>{cleanup++;}},commander:async()=>({action:'none'}),recover:async()=>{recovered++;},quarantine:async()=>{isolated++;return {verified:true};}}));
 assert.equal(next,0);assert.equal(cleanup,0);assert.equal(recovered,0);assert.equal(isolated,1);assert.equal(result.resource_quarantine.verified,true);
});
test('checkpoint失败或未知在工作流读回和步骤裁判均只记录',async()=>{
 const {judgeSteps,workflowReadbackPassed}=await import('../step-judge.mjs');
 for(const observed of [2,undefined]){
  const spec={steps:[{key:'observation',at:'work',mode:'checkpoint',readback:{type:'metric',ref:'metrics.observed',expect:{op:'==',value:1}}},{key:'saved',at:'work',mode:'hard',readback:{type:'metric',ref:'metrics.saved',expect:{op:'==',value:1}}}]};
  const result=judgeSteps({spec,stage:'work',ctx:{metrics:{observed,saved:1}}});
  assert.deepEqual(result.hard_failed,[]);
  assert.equal(workflowReadbackPassed({probes:[{pass:true}],steps:result.steps,expected:spec.steps}),true);
  result.steps[1].pass=null;assert.equal(workflowReadbackPassed({probes:[{pass:true}],steps:result.steps,expected:spec.steps}),false);
 }
});
for(const workflow_key of ['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring','douyin_lead_outreach'])test(`${workflow_key}不以Commander在线作为通过条件`,async()=>{
 let sends=0;
 const result=await runWorkflow(base({context:{run_id:'same-run',workflow_key},commander:async()=>{throw Error('offline');},handlers:{work:async()=>{sends++;return {persisted:1};}}}));
 assert.equal(result.status,'completed');assert.equal(sends,1);
});
test('Commander Skill必须来自本run冻结字节，缺失和摘要漂移不可伪装加载',async()=>{
 const {readCommanderSkill}=await import('../leadgen-workflow.mjs'),{mkdtempSync,mkdirSync,writeFileSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{createHash}=await import('node:crypto');
 const d=mkdtempSync(join(tmpdir(),'commander-frozen-')),path='runtime/skills/runner-commander/SKILL.md',content='---\nname: runner-commander\nmetadata:\n  version: 1.0.0\n---\n只观察';
 try{mkdirSync(join(d,'runtime/skills/runner-commander'),{recursive:true});writeFileSync(join(d,path),content);const frozen={files:{[path]:createHash('sha256').update(content).digest('hex')}};assert.equal(readCommanderSkill(frozen,d).version,'1.0.0');assert.equal(readCommanderSkill(frozen,d).content,content);writeFileSync(join(d,path),content+'漂移');assert.throws(()=>readCommanderSkill(frozen,d),/BYTES_MISMATCH/);assert.throws(()=>readCommanderSkill({files:{}},d),/BYTES_MISMATCH/);}finally{rmSync(d,{recursive:true,force:true});}
});
test('冻结workflow on_status控制推进；缺完整生产路由只清场待复核',async()=>{
 const executed=[],routes={done:'pause',retry:'retry',failed:'stop',empty:'next',partial:'stop',needs_review:'pause'};
 const result=await runWorkflow(base({context:{run_id:'file-routes',workflow_routes:routes,require_routing:true},handlers:Object.fromEntries(activities.map(a=>[a.key,async()=>{executed.push(a.key);return {};}]))}));
 assert.deepEqual(executed,['work','cleanup']);assert.equal(result.status,'needs_review');
 executed.length=0;const missing=await runWorkflow(base({context:{run_id:'missing-routes',require_routing:true},handlers:Object.fromEntries(activities.map(a=>[a.key,async()=>{executed.push(a.key);return {};}]))}));
 assert.deepEqual(executed,['cleanup']);assert.equal(missing.status,'needs_review');
});
test('文件声明的retry受上限和副作用未知保护，不能重复执行未知写动作',async()=>{
 for(const unknown of [false,true]){let calls=0;const result=await runWorkflow(base({activities:[{key:'work',retry_safe:true},{key:'cleanup'}],handlers:{work:async()=>{calls++;return {status:'retry',...(unknown?{external_effect:'unknown'}:{})};}}}));assert.equal(calls,unknown?1:2);assert.equal(result.status,'needs_review');}
});
test('每活动Commander可用性独立留痕，后续掉线不能抹掉原在线事实',async()=>{
 const result=await runWorkflow(base({commander:async request=>{if(request.activity==='next')throw Error('observer offline at next');return {action:'none'};}}));assert.equal(result.status,'completed');assert.equal(result.results[0].commander_status,'available');assert.equal(result.results[1].commander_status,'unavailable');
});
test('Commander收到当前冻结Activity的完成标准和边界，不能只看到状态',async()=>{
 const seen=[],contract={key:'work',name:'保存原件',promise:'保存同一run原件并独立读回',preconditions:['来源身份已冻结'],postconditions:[{probe:'same_run_readback',asserts:'同run独立读回'}],side_effects:[{kind:'internal_write',target:'固定run原件'}],idempotency:{key:'run_id'},failure:{fatal:['来源不符']}};
 await runWorkflow(base({activities:[contract,{key:'cleanup'}],commander:async request=>{seen.push(request);return {action:'none'};}}));
 const event=seen.find(r=>r.activity==='work');assert.equal(event.brief.purpose,contract.promise);assert.deepEqual(event.brief.done_criteria,contract.postconditions);assert.deepEqual(event.activity_contract,contract);assert.ok(event.rules.some(rule=>JSON.stringify(rule).includes('来源身份已冻结')));
});
test('每次Commander交换保留wake/event/recovery/sleep原phase，不被事件分类覆盖',async()=>{
 const records=[];await runWorkflow(base({commander:async()=>({action:'none'}),record:async e=>records.push(e)}));
 const exchanges=records.filter(e=>e.phase==='commander_exchange');assert.ok(exchanges.some(e=>e.commander_phase==='wake'));assert.ok(exchanges.some(e=>e.commander_phase==='event'));assert.ok(exchanges.some(e=>e.commander_phase==='sleep'));
});
