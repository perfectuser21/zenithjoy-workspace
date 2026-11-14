import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {parse} from 'yaml';

const source=readFileSync(new URL('../../ci-l4-e2e-smoke.yml',import.meta.url),'utf8');
const workflow=parse(source),worker=workflow.jobs['smoke-e2e-worker'];
const step=name=>worker.steps.find(s=>s.name===name);
const complete=step('Assert topic reached completed state').run;
const epoch='2026-11-14T00:00:00.123456+00:00',id='11111111-1111-4111-8111-111111111111';
function state(status='completed') {
 return {tasks:{[id]:{id,status,released:true,claim_epoch:epoch,
   result:{lease_receipt:{claimer:'worker',claim_epoch:epoch,status:'completed',result_sha256:'a'.repeat(64)}}}},
  events:['register','claim','heartbeat','finish','finish-replay'].map(action=>({action,task_id:id}))};
}
function run(t,value,{pipeline='completed',topic='待发布',shell=complete}={}) {
 const root=mkdtempSync(join(tmpdir(),'content-e2e-gate-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 mkdirSync(join(root,'bin'));
 writeFileSync(join(root,'bin','psql'),`#!/bin/bash\ncase "$*" in *"SELECT status FROM zenithjoy.pipeline_runs"*) printf '%s\\n' "$PIPELINE_STATUS_FIXTURE";; *"SELECT status FROM zenithjoy.topics"*) printf '%s\\n' "$TOPIC_STATUS_FIXTURE";; *) exit 19;; esac\n`,{mode:0o755});
 const file=join(root,'state.json');writeFileSync(file,JSON.stringify(value));
 return spawnSync('bash',['-euo','pipefail','-c',shell],{cwd:root,encoding:'utf8',timeout:10000,
  env:{...process.env,PATH:join(root,'bin')+':'+process.env.PATH,BRAIN_STATE_FILE:file,TOPIC_ID:id,
       PIPELINE_STATUS_FIXTURE:pipeline,TOPIC_STATUS_FIXTURE:topic}});
}

test('existing required E2E uses isolated public task protocol, never production Brain or SQL running bypass',()=>{
 assert.ok(workflow.jobs['l4-e2e-passed'].needs.includes('smoke-e2e-worker'));
 assert.match(workflow.jobs['l4-e2e-passed'].steps[0].run,/needs\.smoke-e2e-worker\.result/);
 assert.equal(worker.env.BRAIN_URL,undefined);assert.equal(worker.env.CECELIA_BRAIN_URL,undefined);
 assert.equal(worker.env.E2E_FAKE_EXECUTORS,'true');
 assert.match(step('Start isolated Brain task protocol fixture').run,/start-content-brain-fixture\.sh start/);
 assert.match(step('Run topic-worker --apply with Brain registration').run,/set -euo pipefail/);
 assert.doesNotMatch(step('Run topic-worker --apply with Brain registration').run,/\|\| true/);
 assert.equal(worker.steps.some(s=>/INSERT.*running/.test(s.name||'')),false);
 assert.doesNotMatch(worker.steps.map(s=>s.run||'').join('\n'),/INSERT INTO zenithjoy\.pipeline_runs/);
});
test('actual E2E completion shell only accepts local completed plus exact Brain terminal receipt',t=>{
 const result=run(t,state());assert.equal(result.status,0,result.stderr+result.stdout);
});
test('actual E2E completion shell rejects local failed instead of treating any terminal as success',t=>{
 const result=run(t,state(),{pipeline:'failed'});assert.notEqual(result.status,0);
});
test('actual E2E completion shell rejects missing Brain finish, wrong epoch and duplicate execution',t=>{
 for(const mutate of [x=>x.tasks[id].status='queued',x=>x.tasks[id].result.lease_receipt.claim_epoch='old',
  x=>x.events.push({action:'claim',task_id:id}),x=>x.events.pop()]) {
  const value=state();mutate(value);const result=run(t,value);assert.notEqual(result.status,0,result.stdout);
 }
});

const pipelineSmoke=readFileSync(new URL('../smoke/pipeline-smoke.sh',import.meta.url),'utf8');
function runPipelineSmoke(t,{local='pending',brain='queued',taskId=id}={}) {
 const root=mkdtempSync(join(tmpdir(),'pipeline-register-contract-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const bin=join(root,'bin');mkdirSync(bin);
 writeFileSync(join(bin,'curl'),`#!/bin/bash
case "$*" in
 *"/health"*) printf '%s\\n' '{"ok":true,"fixture":true}';;
 *"/api/pipeline/dashboard-stats"*) printf '%s\\n' '{"total":0,"running":0}';;
 *"/api/topics"*) printf '%s\\n' '{"data":{"id":"${id}"}}';;
 *"/api/pipeline/trigger"*) printf '%s\\n' "$TRIGGER_RESPONSE";;
 *"/api/brain/tasks/"*) printf '%s\\n' "$TASK_RESPONSE";;
 *"/api/pipeline/"*) printf '%s\\n' '{"data":{"id":"${id}"}}';;
 *"/api/pipeline"*) printf '%s\\n' '{"data":[]}';;
 *) exit 71;;
esac
`,{mode:0o755});
 return spawnSync('bash',['-c',pipelineSmoke],{cwd:root,encoding:'utf8',timeout:10000,
  env:{...process.env,PATH:bin+':'+process.env.PATH,SMOKE_SCRATCH_API:'1',API_BASE:'http://127.0.0.1:5200',BRAIN_URL:'http://127.0.0.1:5239',
  TRIGGER_RESPONSE:JSON.stringify({success:true,data:{id,status:local,cecelia_task_id:id}}),
  TASK_RESPONSE:JSON.stringify({id:taskId,status:brain,claimed_by:null,payload:{business_owner:'zenithjoy'}})}});
}
test('actual baseline pipeline smoke requires pending local run and independently reads same queued Brain task',t=>{
 const result=runPipelineSmoke(t);assert.equal(result.status,0,result.stderr+result.stdout);
});
test('actual baseline pipeline smoke rejects pretending registered work is already running',t=>{
 const result=runPipelineSmoke(t,{local:'running'});assert.notEqual(result.status,0,result.stdout);
});
test('actual baseline pipeline smoke rejects mismatched Brain ID and unconfirmed Brain state',t=>{
 for(const options of [{taskId:'22222222-2222-4222-8222-222222222222'},{brain:'in_progress'}]) {
  const result=runPipelineSmoke(t,options);assert.notEqual(result.status,0,result.stdout);
 }
});

test('actual registration shell keeps topic approved until the Worker claims the task',t=>{
 const queued={tasks:{[id]:{id,status:'queued',claimed_by:null}},events:[{action:'register'}]};
 const shell=step('Assert registered work remains pending before Worker claim').run;
 const good=run(t,queued,{pipeline:'pending',topic:'已通过',shell});
 assert.equal(good.status,0,good.stderr+good.stdout);
 const premature=run(t,queued,{pipeline:'pending',topic:'研究中',shell});
 assert.notEqual(premature.status,0,'topic-worker must not advance the topic before a Worker claim');
});

test('L4 starts on main PR and merge queue with runner state initialized only at step scope',t=>{
 assert.ok(workflow.on.pull_request.branches.includes('main'));
 assert.ok(Object.hasOwn(workflow.on,'merge_group'));
 for(const [key,value] of Object.entries(worker.env))assert.doesNotMatch(String(value),/\$\{\{\s*runner\./,key);
 const gate=workflow.jobs['l4-e2e-passed'];
 assert.equal(gate.name,'L4 E2E Gate Passed');assert.equal(gate.if,'always()');
 assert.ok(gate.needs.includes('smoke-e2e-worker'));
 assert.match(gate.steps[0].run,/needs\.smoke-e2e-worker\.result/);
 const init=step('Initialize isolated worker state');assert.ok(init);
 assert.equal(init.env,undefined);assert.match(init.run,/XDG_STATE_HOME="\$RUNNER_TEMP\/content-worker-state"/);
 assert.ok(worker.steps.indexOf(init)<worker.steps.indexOf(step('Run topic-worker --apply with Brain registration')));
 const root=mkdtempSync(join(tmpdir(),'content-worker-state-init-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const envFile=join(root,'github-env'),stateDir=join(root,'content-worker-state');writeFileSync(envFile,'');
 const result=spawnSync('bash',['-euo','pipefail','-c',init.run],{encoding:'utf8',env:{...process.env,GITHUB_ENV:envFile,RUNNER_TEMP:root}});
 assert.equal(result.status,0,result.stderr);
 assert.equal(readFileSync(envFile,'utf8'),`XDG_STATE_HOME=${stateDir}\n`);
});
