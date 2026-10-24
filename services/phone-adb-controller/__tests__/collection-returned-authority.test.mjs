import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {collectionFixture,vids} from './helpers/collection-recovery-fixture.mjs';
const originalSpec=JSON.parse(readFileSync(new URL('./fixtures/collection-returned-35f/verification-spec.json',import.meta.url)));

test('真实Code已提交→35f原验收失败只能只读Skill和本人受管cleanup，原FAIL不变',{skip:process.platform!=='darwin'},async t=>{
 const f=await collectionFixture(t);const load=name=>import(pathToFileURL(join(f.runtime,name)));
 // 仅补隔离controller的本人释放回执；所有真实handler/exec/leaf/broker保持原路径。
 const ctl=join(f.runtime,'douyin-phone-adb');writeFileSync(ctl,readFileSync(ctl,'utf8').replace("case 'preflight':","case 'lock-release':console.log('lock=released owner=scope-owner');break;case 'preflight':"),{mode:0o755});
 const {digest}=await load('runtime-definition.mjs');f.frozen.files['runtime/douyin-phone-adb']=createHash('sha256').update(readFileSync(ctl)).digest('hex');delete f.frozen.snapshot_sha256;f.frozen.snapshot_sha256=digest(f.frozen);writeFileSync(join(f.d,'run-definition.json'),JSON.stringify(f.frozen));const br=join(f.d,'run-bindings/a1.request.json'),b=JSON.parse(readFileSync(br));b.runtime_snapshot_sha256=f.frozen.snapshot_sha256;writeFileSync(br,JSON.stringify(b));
 const {createHandlers}=await load('leadgen-handlers.mjs'),{invokeNativeActivity,runWorkflow}=await load('leadgen-workflow.mjs'),{createActivityRecovery}=await load('activity-skill-recovery.mjs'),{callActivityTool}=await load('activity-skill-tool.mjs'),{judgeSteps}=await load('step-judge.mjs');
 let launches=0,cleanupCalls=0,verifyCalls=0;const queue=async q=>{const r=await f.queue(q);return q.op==='claim_videos'?r.slice(0,1):r;};
 const rpc=async body=>{if(body.kind==='activity_skill_authority')return {authorized:true};if(body.kind==='activity_skill'){launches++;assert.equal(body.request.mode,'readback_only');await callActivityTool(body.request.broker_request_path,'inspect');await assert.rejects(callActivityTool(body.request.broker_request_path,'resume'),/SKILL_RESUME_NOT_ALLOWED/);await callActivityTool(body.request.broker_request_path,'phone',{command:'status',args:[]});return {result:{status:'ok',execution_stopped:true}};}return {result:await queue(body.request)};};
 const h=createHandlers({root:f.runtime,env:f.env,sourceCommit:'a'.repeat(40),taskId:'scope-task',rpc});h.state.currentActivity='preflight';await h.preflight();h.state.currentActivity='qualification';assert.equal((await h.qualification()).matched,1);h.state.currentActivity='collection';h.state.budgetDeadline=Date.now()+60000;
 const context={run_id:'scope-run__a1',task_id:'scope-task',source_commit:'a'.repeat(40)},binding={id:'scope-binding',run_id:context.run_id,task_id:context.task_id};
 const recover=createActivityRecovery({runDir:f.d,frozen:f.frozen,binding,env:f.env,handlers:h,rpc});
 const out=await runWorkflow({activities:[{key:'collection',retry_safe:false},{key:'cleanup'}],context,handlers:{collection:()=>invokeNativeActivity(()=>h.collection(),h.state),cleanup:async()=>{cleanupCalls++;h.state.currentActivity='cleanup';return invokeNativeActivity(()=>h.cleanup(),h.state);}},recover,commander:async()=>({action:'continue'}),record:async()=>{},verify:async(a,e)=>{if(a.key==='cleanup')return {verified:true};verifyCalls++;assert.equal(e.result.videos_processed,1);const v=judgeSteps({spec:originalSpec,stage:'collection',ctx:{metrics:e.result,tag:f.env.WFR_TAG,evidenceDir:join(f.d,'phone/evidence',f.env.P),runDir:f.d,tsvFile:join(f.d,'comments.tsv')}});assert.equal(v.steps.length,2);assert.ok(v.steps.every(s=>s.pass===false),'真实35f两Step缺panel/screen必须仍拒');return {verified:false,step_dod:[v]};},terminationUnverified:()=>h.state.nativeStopUnproven===true,quarantine:async()=>({verified:true})});
 assert.equal(f.stored.has(vids[0]),true,'先证明真实Code已提交首VID');assert.equal(verifyCalls,1);assert.equal(out.status,'failed','只读/cleanup不能将业务FAIL洗绿');assert.equal(launches,1,'原路径目前在Skill59前拒绝');assert.equal(cleanupCalls,1,'只读收尾后须走原cleanup');assert.equal(f.dbCalls.filter(q=>q.op==='claim_videos').length,1);assert.equal(f.phoneCalls().filter(q=>q.cmd==='open-video'&&q.args[0]===vids[0]&&q.args[1].includes('-collection-')).length,1);
});
