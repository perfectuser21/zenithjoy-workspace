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
 const art=join(dir,'artifact.json');writeFileSync(art,JSON.stringify({observed_at:new Date().toISOString(),metrics:{rescan_count:2,rescan_rate:0.5,avatar_recovery_count:2}}));
 assert.equal((await invoke(env,'mark-start','collection','1')).code,0);
 assert.equal((await invoke(env,'span','collection','completed','1',art,'word')).code,0);
 const files=()=>readdirSync(join(dir,'outbox')).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(readFileSync(join(dir,'outbox',n),'utf8')));
 assert.equal(files()[0].state,'pending');const first=files()[0];
 writeFileSync(art,JSON.stringify({observed_at:'changed',metrics:{}}));mode='ok';await invoke(env,'flush');
 assert.equal(files()[0].state,'sent');assert.equal(bodies[0],bodies[1]);
 const span=JSON.parse(bodies[1])[0];assert.equal(span.evidence.workflow_definition_version_id,'workflow-version');assert.equal(span.evidence.reference_id,'reference-3');assert.equal(span.attempts,5);assert.equal(span.evidence.avatar_recovery_count,2);assert.equal(span.evidence.identity_rescan_count,2);
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

const mmvId='ed3555dc-4777-446c-bdf0-d928d6a08ef1';
const mmvInventory=()=>[{id:mmvId,status:'active',metadata:{tailscale_ip:'100.71.151.105',public_ip:'38.23.47.81'}}];
test('正式MMV路由默认TS，显式public只选择同一登记机器并保HostKeyAlias',async()=>{
 const {selectMmvTransport}=await import('../runtime-receipts.mjs');
 assert.equal(typeof selectMmvTransport,'function');
 const rows=mmvInventory(),before=JSON.stringify(rows);
 const expected={machine_id:mmvId,ssh_hostname:'100.71.151.105',ssh_hostkey_alias:'38.23.47.81'};
 assert.deepEqual(selectMmvTransport(rows),expected);
 assert.deepEqual(selectMmvTransport({machines:rows},'tailscale'),expected);
 assert.deepEqual(selectMmvTransport(rows,'public'),{...expected,ssh_hostname:'38.23.47.81'});
 assert.equal(JSON.stringify(rows),before,'不得修改中央登记对象或已冻结路由');
});
test('MMV路由非法模式/非唯一或非active登记/缺地址均拒绝，不回退猜IP',async()=>{
 const {selectMmvTransport}=await import('../runtime-receipts.mjs');
 assert.equal(typeof selectMmvTransport,'function');
 for(const mode of ['','auto','PUBLIC','38.23.47.81','public '])assert.throws(()=>selectMmvTransport(mmvInventory(),mode));
 for(const rows of [[],[{...mmvInventory()[0],id:'another-host'}],mmvInventory().map(m=>({...m,status:'offline'})),[...mmvInventory(),...mmvInventory()]]){
  for(const mode of ['tailscale','public'])assert.throws(()=>selectMmvTransport(rows,mode));
 }
 for(const field of ['tailscale_ip','public_ip'])for(const value of [undefined,'','999.23.47.81','38.23.47.81;echo bad','host.invalid']){
  const rows=mmvInventory();rows[0].metadata[field]=value;
  for(const mode of ['tailscale','public'])assert.throws(()=>selectMmvTransport(rows,mode));
 }
});
test('真实prepare CLI消费路由env，非法模式在冻结/绑定前拒绝',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'runtime-mmv-route-')),bin=join(dir,'bin');mkdirSync(bin);
 const curl=join(bin,'curl');
 writeFileSync(curl,`#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(JSON.stringify(mmvInventory())+'\n200')});\n`);chmodSync(curl,0o700);
 const result=await invoke({WFR_RUN_DIR:dir,WF_BRAIN_WORKFLOW:'douyin_video_processing',WF_MMV_SSH_ROUTE:'auto',BRAIN_URL:'http://fixture.invalid',PATH:bin+':'+process.env.PATH},'prepare');
 assert.equal(result.code,1);assert.match(result.err,/WF_MMV_SSH_ROUTE仅允许tailscale或public/);
 assert.equal(existsSync(join(dir,'run-definition.json')),false);
 assert.equal(existsSync(join(dir,'run-bindings')),false);
});
