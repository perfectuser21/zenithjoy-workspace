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
