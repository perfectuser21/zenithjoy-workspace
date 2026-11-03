import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startActivityBroker} from '../activity-skill-broker.mjs';
const exec=promisify(execFile);
const tool=new URL('../activity-skill-tool.mjs',import.meta.url).pathname;
const request={protocol:'leadgen-activity-v1',run_id:'fixture__a1',binding_id:'abc',activity_key:'scoring',nonce:'a'.repeat(48),deadline_ms:Date.now()+20000,mode:'repair',method:{name:'fixture-method',version:'0.2.0'}};
async function using(fn,overrides={}){const d=mkdtempSync(join(tmpdir(),'skill-broker-'));let resumed=0;
 const b=await startActivityBroker({directory:d,authorize:async()=>true,request:{...request,...overrides},inspect:async()=>({company_id:'fixture-company'}),resume:async()=>{resumed++;return {scored:1};},phone:async()=>{throw Error('fixture scoring cannot use phone');}});
 try{await fn(b,()=>resumed);}finally{await b.close();rmSync(d,{recursive:true,force:true});}}
const call=async(b,op)=>JSON.parse((await exec(process.execPath,[tool,b.requestPath,op],{timeout:3000})).stdout);
test('isolated real CLI fixture: inspect and one same-slot Code resume, no workflow entry',async()=>using(async(b,count)=>{
 assert.deepEqual((await call(b,'inspect')).result,{company_id:'fixture-company'});
 assert.equal((await call(b,'resume')).result.scored,1);assert.equal(count(),1);
 await assert.rejects(()=>call(b,'resume'));assert.equal(count(),1);
 assert.equal(readFileSync(b.requestPath,'utf8').includes('fixture-method'),true);
}));
test('send unknown and expired requests cannot invoke original send Code',async()=>{
 await using(async(b,count)=>{await assert.rejects(()=>call(b,'resume'));assert.equal(count(),0);},{activity_key:'send_dm',mode:'readback_only'});
 await using(async(b,count)=>{await assert.rejects(()=>call(b,'inspect'));assert.equal(count(),0);},{deadline_ms:Date.now()-1});
});

import {callActivityTool} from '../activity-skill-tool.mjs';
import {createConnection} from 'node:net';
const rawCall=(b,value)=>new Promise((yes,no)=>{const q=JSON.parse(readFileSync(b.requestPath,'utf8')),c=createConnection(q.socket);let text='';c.on('connect',()=>c.end(JSON.stringify({...q,...value})));c.on('data',x=>text+=x);c.on('error',no);c.on('end',()=>yes(JSON.parse(text)));});
test('broker rejects mismatched nonce/run/slot and undeclared operations',async()=>using(async(b,count)=>{
 for(const bad of [{nonce:'b'.repeat(48)},{run_id:'another'},{activity_key:'send_dm'},{op:'workflow'},{op:'phone',command:'private-message-send',args:[]}])assert.equal((await rawCall(b,{op:'resume',...bad})).ok,false);
 assert.equal(count(),0);
}));
test('broker default authorization is closed and mutable operations cannot overlap',async()=>{
 const d=mkdtempSync(join(tmpdir(),'skill-auth-'));let calls=0,release;
 let b=await startActivityBroker({directory:join(d,'closed'),request,inspect:async()=>({}),resume:async()=>{calls++;},phone:async()=>{}});
 try{await assert.rejects(()=>call(b,'resume'));assert.equal(calls,0);}finally{await b.close();}
 b=await startActivityBroker({directory:join(d,'open'),request:{...request,activity_key:'collection'},authorize:async()=>true,inspect:async()=>({}),resume:async()=>{calls++;await new Promise(r=>release=r);return {comments:1};},phone:async()=>{calls++;}});
 try{const active=call(b,'resume');while(!release)await new Promise(r=>setTimeout(r,5));await assert.rejects(()=>callActivityTool(b.requestPath,'phone',{command:'back-evidence',args:['fixture']}));release();await active;assert.equal(calls,1);}finally{await b.close();rmSync(d,{recursive:true,force:true});}
});

test('slow authorization cannot start a phone or Code operation after the original deadline',async()=>{
 const d=mkdtempSync(join(tmpdir(),'skill-deadline-'));let started=0;
 const b=await startActivityBroker({directory:d,request:{...request,deadline_ms:Date.now()+80},authorize:async()=>{await new Promise(r=>setTimeout(r,120));return true;},inspect:async()=>({}),resume:async()=>{started++;return {};},phone:async()=>{started++;}});
 try{await assert.rejects(()=>call(b,'resume'));await new Promise(r=>setTimeout(r,150));assert.equal(started,0);}finally{await b.close();rmSync(d,{recursive:true,force:true});}
});

test('qualification Skill can inspect fresh native audio only twice with parent-owned evidence identity',async()=>{
 const d=mkdtempSync(join(tmpdir(),'skill-native-'));let phones=0;
 const b=await startActivityBroker({directory:d,request:{...request,activity_key:'qualification',deadline_ms:Date.now()+20000},authorize:async()=>true,inspect:async()=>({video_id:'fixture-video'}),resume:async()=>({}),phone:async(command,...args)=>{assert.equal(command,'native-audio-evidence');assert.deepEqual(args,[]);phones++;return 'native_audio_state=started';}});
 try{
  assert.ok((await call(b,'inspect')).result.phone_capabilities.includes('native-audio-evidence'));
  await assert.rejects(()=>callActivityTool(b.requestPath,'phone',{command:'native-audio-evidence',args:['foreign-evidence']}));
  for(let i=0;i<2;i++)assert.match((await callActivityTool(b.requestPath,'phone',{command:'native-audio-evidence',args:[]})).result,/native_audio_state=started/);
  await assert.rejects(()=>callActivityTool(b.requestPath,'phone',{command:'native-audio-evidence',args:[]}));assert.equal(phones,2);
 }finally{await b.close();rmSync(d,{recursive:true,force:true});}
 for(const activity_key of ['collection','scoring','send_dm'])await using(async(b)=>{await assert.rejects(()=>callActivityTool(b.requestPath,'phone',{command:'native-audio-evidence',args:[]}));},{activity_key});
});


test('generation rotation cannot reset one resume, native reads or active operations',async()=>{
 const d=mkdtempSync(join(tmpdir(),'skill-generations-'));let resumes=0,reads=0,release;
 const q={...request,activity_key:'qualification',transport_generation:0,deadline_ms:Date.now()+20000};
 const b=await startActivityBroker({directory:d,request:q,authorize:async()=>true,inspect:async()=>({}),resume:async()=>{resumes++;await new Promise(r=>release=r);return {done:1};},phone:async()=>{reads++;throw Error('native capture failed');}});
 try{
  for(let i=0;i<2;i++)await assert.rejects(()=>callActivityTool(b.requestPath,'phone',{command:'native-audio-evidence',args:[]}));
  const pending=callActivityTool(b.requestPath,'resume');while(!release)await new Promise(r=>setTimeout(r,1));
  assert.throws(()=>b.advanceTurn(),/ADVANCE_REJECTED/);release();await pending;
  const next=b.advanceTurn();assert.equal(next.mode,'readback_only');assert.equal(next.nonce,q.nonce);assert.equal(next.deadline_ms,q.deadline_ms);
  await assert.rejects(()=>callActivityTool(b.requestPath,'inspect'));
  await assert.rejects(()=>callActivityTool(next.broker_request_path,'resume'));
  await assert.rejects(()=>callActivityTool(next.broker_request_path,'phone',{command:'back-evidence',args:[]}));
  assert.equal((await callActivityTool(next.broker_request_path,'inspect')).ok,true);assert.throws(()=>b.advanceTurn());assert.equal(resumes,1);assert.equal(reads,2);assert.equal(b.getResult().nativeReads,2);
 }finally{await b.close();rmSync(d,{recursive:true,force:true});}
});
test('broker转发真实工具进度与问题，纠偏留到下一次inspect且不扩大操作白名单',async()=>{
 const d=mkdtempSync(join(tmpdir(),'skill-progress-')),events=[];let inspectCalls=0;
 const b=await startActivityBroker({directory:d,request:{...request,deadline_ms:Date.now()+20000},authorize:async()=>true,inspect:async()=>({observed:++inspectCalls}),resume:async()=>({}),phone:async()=>{},onEvent:async e=>{events.push(e);return events.length===1?{action:'steer',text:'先核原合同读回'}:{action:'none'};}});
 try{const first=await callActivityTool(b.requestPath,'inspect',{question:'缺读回如何做？'});assert.equal(first.result.observed,1);const second=await callActivityTool(b.requestPath,'inspect');assert.deepEqual(second.result.commander_guidance,['先核原合同读回']);assert.equal(events[0].type,'question');assert.match(events[0].text,/读回/);await assert.rejects(()=>callActivityTool(b.requestPath,'send'));}finally{await b.close();rmSync(d,{recursive:true,force:true});}
});
test('Commander abort封闭broker写操作并请求精确child停止，未知停止不假报完成',async()=>{
 const d=mkdtempSync(join(tmpdir(),'skill-abort-'));let stopped=0,resumed=0;
 const b=await startActivityBroker({directory:d,request:{...request,deadline_ms:Date.now()+20000},authorize:async()=>true,inspect:async()=>({}),resume:async()=>{resumed++;return {};},phone:async()=>{},onEvent:async()=>({action:'abort',reason:'需复核'}),onAbort:async()=>{stopped++;return {execution_stopped:false};}});
 try{await callActivityTool(b.requestPath,'inspect');assert.equal(stopped,1);await assert.rejects(()=>callActivityTool(b.requestPath,'resume'));assert.equal(resumed,0);assert.equal(b.getResult().execution_unknown,true);}finally{await b.close();rmSync(d,{recursive:true,force:true});}
});
test('真实inspect事件CLI通过既有op转发Agent问题，无新业务操作',async()=>{
 const {spawn}=await import('node:child_process'),d=mkdtempSync(join(tmpdir(),'skill-question-cli-')),events=[];
 const b=await startActivityBroker({directory:d,request:{...request,deadline_ms:Date.now()+20000},authorize:async()=>true,inspect:async()=>({}),resume:async()=>({}),phone:async()=>{},onEvent:async e=>{events.push(e);return {action:'none'};}});
 try{await new Promise((yes,no)=>{const child=spawn(process.execPath,[tool,b.requestPath,'inspect','--event'],{stdio:['pipe','pipe','pipe']});let err='';child.stderr.on('data',x=>err+=x);child.on('error',no);child.on('close',code=>code===0?yes():no(Error(err)));child.stdin.end(JSON.stringify({question:'完成标准需要哪份独立证据？'}));});assert.equal(events[0].type,'question');assert.match(events[0].text,/独立证据/);}finally{await b.close();rmSync(d,{recursive:true,force:true});}
});
