import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import {createHash} from 'node:crypto';
import { mkdtempSync,writeFileSync,readFileSync,readdirSync,chmodSync,mkdirSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { seedFrozen } from './fixtures/frozen-runtime.mjs';
const CLI=resolve('services/phone-adb-controller/runtime-receipts.mjs');
function invoke(env,...args){return new Promise((done,reject)=>{const child=spawn(process.execPath,[CLI,...args],{env:{...process.env,HOME:env.WFR_RUN_DIR,...env}});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('exit',code=>done({code,out,err}));});}
test('真实HTTP: receipt断线留pending，重启flush字节不变，ack后sent，真重试新occurrence且409 blocked',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'runtime-http-'));seedFrozen(dir,null,{runId:'http-run'});let mode='drop';const bodies=[];
 const server=createServer((req,res)=>{let body='';req.on('data',b=>body+=b);req.on('end',()=>{bodies.push(body);assert.equal(req.headers.authorization,'Bearer fixture-token');if(mode==='drop')return req.socket.destroy();res.writeHead(mode==='conflict'?409:200,{'Content-Type':'application/json'});res.end('{"inserted":1}');});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const env={WFR_RUN_DIR:dir,WFR_RUN_ID:'http-run',WFR_ATTEMPT:'a1',BRAIN_URL:`http://127.0.0.1:${server.address().port}`,BRAIN_INTERNAL_TOKEN:'fixture-token'};
 const art=join(dir,'artifact.json');writeFileSync(art,JSON.stringify({observed_at:new Date().toISOString(),metrics:{rescan_count:2,rescan_rate:0.5}}));
 assert.equal((await invoke(env,'mark-start','collection','1')).code,0);
 assert.equal((await invoke(env,'span','collection','completed','1',art,'word')).code,0);
 const files=()=>readdirSync(join(dir,'outbox')).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(readFileSync(join(dir,'outbox',n),'utf8')));
 assert.equal(files()[0].state,'pending');const first=files()[0];
 writeFileSync(art,JSON.stringify({observed_at:'changed',metrics:{}}));mode='ok';await invoke(env,'flush');
 assert.equal(files()[0].state,'sent');assert.equal(bodies[0],bodies[1]);
 const span=JSON.parse(bodies[1])[0];assert.equal(span.evidence.workflow_definition_version_id,'workflow-version');assert.equal(span.evidence.reference_id,'reference-3');assert.equal(span.attempts,3);
 await invoke(env,'mark-start','collection','1');mode='conflict';await invoke(env,'span','collection','failed','1',art,'word');
 assert.equal(files().find(f=>f.event_id!==first.event_id).state,'blocked');
 assert.equal(new Set(files().map(f=>f.occurrence_key)).size,2);
 assert.ok(files().every(f=>!JSON.stringify(f).includes('fixture-token')));
});
test('旧v1 outbox无需release或binding仍原body重传，禁止升级改写历史事件',async t=>{
 const {enqueue}=await import('../runtime-outbox.mjs');const dir=mkdtempSync(join(tmpdir(),'runtime-v1-replay-'));let received;
 const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;received=JSON.parse(body);res.end('{"skipped":1}');});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const body=[{run_id:'legacy-run',occurrence_key:'legacy-occurrence',activity_id:'legacy-activity',outcome:'pass',evidence:{original:true}}];
 enqueue(dir,{key:'legacy-occurrence',endpoint:`http://127.0.0.1:${server.address().port}/api/brain/spans`,body});
 const result=await invoke({WFR_RUN_DIR:dir,BRAIN_URL:'',BRAIN_INTERNAL_TOKEN:'fixture-token'},'flush');assert.equal(result.code,0,result.err);assert.deepEqual(received,body);assert.equal(received[0].identity_protocol,undefined);
});

test('真实HTTP步骤证据引用冻结owner，跨活动清场读回仍属于原preflight',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'runtime-step-span-'));
 seedFrozen(dir,null,{runId:'step-run',steps:{preflight:[{step_id:'step-identity',locator:{step_key:'account'}}]}});
 let received;const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;received=JSON.parse(raw);res.end('{"inserted":2}');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const env={WFR_RUN_DIR:dir,WFR_RUN_ID:'step-run',WFR_ATTEMPT:'a1',BRAIN_URL:`http://127.0.0.1:${server.address().port}`,BRAIN_INTERNAL_TOKEN:'fixture-token'};
 const file=join(dir,'artifact.json');writeFileSync(file,JSON.stringify({observed_at:new Date().toISOString(),verification:{step_dod:[{steps:[{key:'flow.preflight.account',activity:'preflight',pass:true}]}]}}));
 const result=await invoke(env,'span','cleanup','completed','1',file);assert.equal(result.code,0,result.err);
 assert.equal(received.length,2);assert.equal(received[0].step_id,null);
 assert.equal(received[1].step_id,'step-identity');assert.equal(received[1].reference_id,'reference-0');
 assert.equal(received[1].activity_definition_version_id,'av-0');assert.equal(received[1].evidence.observed_at_stage,'cleanup');
 writeFileSync(file,JSON.stringify({verification:{step_dod:[{steps:[{key:'flow.preflight.missing',activity:'preflight',pass:true}]}]}}));
 assert.equal((await invoke(env,'span','cleanup','completed','2',file)).code,1);
});

// 真实曾出现152KB证据在固定8秒上传预算内丢回执；控制curl边界而不等一分钟。
test('大证据可使用60秒上传预算，整体剩余预算更小时必须收紧，耗尽后保持pending',async()=>{
 const {enqueue}=await import('../runtime-outbox.mjs');
 for(const [remaining,source] of [[120000,'workflow'],[2000,'workflow'],[0,'workflow'],[2000,'explicit']]){
  const dir=mkdtempSync(join(tmpdir(),'runtime-upload-budget-')),bin=join(dir,'bin'),trace=join(dir,'curl-timeout.json');mkdirSync(bin);
  const curl=join(bin,'curl');writeFileSync(curl,'#!/usr/bin/env node\nconst fs=require("node:fs");const a=process.argv.slice(2),body=fs.readFileSync(0,"utf8");fs.writeFileSync(process.env.CURL_TRACE,JSON.stringify({maxTime:Number(a[a.indexOf("-m")+1]),stdin_sha256:require("node:crypto").createHash("sha256").update(body).digest("hex"),stdin_bytes:Buffer.byteLength(body),binary_stdin:a[a.indexOf("--data-binary")+1]==="@-"}));process.stdout.write("\\n200");');chmodSync(curl,0o700);
  const body=[{run_id:'large-real-evidence',occurrence_key:'original-key',evidence:{artifact:'x'.repeat(152352)}}];
  enqueue(dir,{key:'original-key',endpoint:'http://fixture.invalid/api/brain/spans',body});
  const result=await invoke({WFR_RUN_DIR:dir,BRAIN_INTERNAL_TOKEN:'fixture-token',PATH:bin+':'+process.env.PATH,CURL_TRACE:trace,...(source==='explicit'?{WFR_EVIDENCE_DEADLINE_MS:String(Date.now()+remaining)}:{WF_RUN_START_TS:String(Date.now()/1000-100),WF_RUN_MAX_SECONDS:String(100+remaining/1000)})},'flush');
  assert.equal(result.code,0,result.err);
  const event=JSON.parse(readFileSync(join(dir,'outbox',readdirSync(join(dir,'outbox'))[0])));assert.deepEqual(event.body,body);
  if(remaining===0){assert.equal(existsSync(trace),false);assert.equal(event.state,'pending');assert.match(result.out,/WFR_EVIDENCE_STATUS=pending/);}
  else{const timing=JSON.parse(readFileSync(trace));assert.equal(timing.binary_stdin,true);assert.equal(timing.stdin_sha256,createHash('sha256').update(JSON.stringify(body)).digest('hex'));assert.ok(timing.stdin_bytes>152352);assert.ok(timing.maxTime<=60);if(remaining===120000)assert.ok(timing.maxTime>8,'大证据不能仍限制8秒');else assert.ok(timing.maxTime<=2,'上传不得超出整轮余量');assert.equal(event.state,'sent');}
 }
});
