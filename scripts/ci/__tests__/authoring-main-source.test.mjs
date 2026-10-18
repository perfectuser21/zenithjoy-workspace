import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import YAML from 'yaml';
const root=new URL('../../../',import.meta.url);
test('五个既有正式定义升patch且保留Patrol实际固定部署来源',()=>{
 for(const [path,version] of [
 ['commander/contracts/workflow-commander.json','2.0.33'],['commander/contracts/workflow-report.json','1.0.34'],
 ['patrol/contracts/single.json','0.1.25'],['patrol/contracts/batch.json','0.1.25'],['patrol/contracts/maintenance.json','0.1.24']]){
  const d=JSON.parse(readFileSync(new URL(`services/phone-adb-controller/${path}`,root)));
  assert.equal(d.version,version);assert.equal(d.source,undefined);
  if(path.startsWith('patrol'))for(const a of d.activities)assert.match(a.implementation.revision,/^[a-f0-9]{40}$/);
 }
});
test('三个Pilot必须等待main正式来源续版，PR也永久执行前置契约回归',()=>{
 const w=YAML.parse(readFileSync(new URL('.github/workflows/pilot-release-verification.yml',root),'utf8'));
 const j=w.jobs['authoring-main-source'];assert.ok(j,'缺来源登记前置');
 assert.equal(j.if,"github.ref == 'refs/heads/main'");
 assert.equal(j['continue-on-error'],undefined);
 assert.ok(j.steps.some(s=>s.run==='node scripts/ci/authoring-main-source.mjs'));
 assert.equal(j.services.postgres.env.POSTGRES_DB,'cecelia_scratch');
 for(const key of ['verify','verify-commander','verify-patrol-definitions'])assert.deepEqual(w.jobs[key].needs,['caller-contract','authoring-main-source']);
 const impact=YAML.parse(readFileSync(new URL('.github/workflows/implementation-impact.yml',root),'utf8'));
 assert.ok(impact.jobs['caller-contract'].steps.some(s=>s.run==='node --test scripts/ci/__tests__/authoring-main-source.test.mjs'));
});
test('编排器在登记任务之后真实验证、生产register前重核main、map必须传事务CAS',async()=>{
 const {renewDefinitions}=await import('../authoring-main-source-core.mjs');
 const calls=[];const digest='d'.repeat(64),sha='a'.repeat(40),definition={key:'workflow_report.internal',version:'1.0.34',capability_id:'cap',activities:[{key:'report'}],source:{revision:sha}};
 const scope={scope:'commander-generic',manifest:{id:'map',digest,manifest:{scope_key:'commander-generic',value_streams:[{brain_binding:{source_revision:'b'.repeat(40)}}],capabilities:[]}},documents:[{definition,owner:{id:'w',version:'1.0.33'}}]};
 const deps={checkMain:async()=>calls.push('main'),task:async(key)=>{calls.push('task:'+key);return{id:key,status:'in_progress'};},verify:async()=>{calls.push('verify');return {evidence_refs:['artifact:real'],definition_sha256:digest};},complete:async(t)=>calls.push('complete:'+t.id),register:async()=>calls.push('register'),activate:async(s,body)=>{calls.push('activate');assert.deepEqual(body,{expected_active:{id:'map',digest}});},hash:()=>digest};
 await renewDefinitions([scope],{revision:sha,...deps});
 assert.ok(calls.indexOf('task:validation:workflow_report.internal')<calls.indexOf('verify'));
 assert.ok(calls.indexOf('verify')<calls.indexOf('register'));
 assert.equal(calls[calls.indexOf('register')-1],'main');assert.equal(calls[calls.indexOf('activate')-1],'main');
});
test('真实验证失败或主线漂移时不能register/activate或伪写PASS',async()=>{
 const {renewDefinitions}=await import('../authoring-main-source-core.mjs');
 for(const phase of ['verify','main']){
  let writes=0,n=0;const scope={scope:'commander-generic',documents:[{definition:{key:'x',activities:[]},owner:{}}]};
  await assert.rejects(renewDefinitions([scope],{revision:'a'.repeat(40),hash:()=>'',checkMain:async()=>{if(phase==='main'&&++n>1)throw Error('MAIN_MOVED');},task:async()=>({}),verify:async()=>{if(phase==='verify')throw Error('actual failure');return{evidence_refs:['actual']};},complete:async()=>{},register:async()=>writes++,activate:async()=>writes++}));
  assert.equal(writes,0);
 }
});
