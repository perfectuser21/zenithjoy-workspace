import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync,writeFileSync,readFileSync,readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { seedFrozen } from './fixtures/frozen-runtime.mjs';
const CLI=resolve('services/phone-adb-controller/runtime-receipts.mjs');
function invoke(env,...args){return new Promise((done,reject)=>{const child=spawn(process.execPath,[CLI,...args],{env:{...process.env,...env}});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('exit',code=>done({code,out,err}));});}
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
