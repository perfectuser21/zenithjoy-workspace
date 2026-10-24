import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createConnection} from 'node:net';
import {createHash} from 'node:crypto';
import {startCollectionLeafProducer} from '../collection-leaf-producer.mjs';

async function fixture(t){
 const d=mkdtempSync(join(tmpdir(),'collection-returned-leaf-'));t.after(()=>rmSync(d,{recursive:true,force:true}));
 const c=join(d,'client.c'),bin=join(d,'client');
 writeFileSync(c,'#include <string.h>\n#include <stdio.h>\n#include <unistd.h>\n#include <signal.h>\nint main(int n,char**a){const char*q=a[n-1];if(!strcmp(q,"one")){puts("known-business-failure");return 1;}if(!strcmp(q,"slow")){sleep(5);return 0;}if(!strcmp(q,"signal")){raise(SIGTERM);return 0;}if(!strcmp(q,"fork")){int p=fork();return p<0?77:0;}puts("returned");return 0;}\n');
 const r=spawnSync('cc',[c,'-o',bin],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 const p=await startCollectionLeafProducer({directory:d,policy:{adb_bin:bin,adb_sha256:createHash('sha256').update(readFileSync(bin)).digest('hex'),endpoint:'tcp:127.0.0.1:12345'},serial:'NO-DEVICE',deadlineMs:Date.now()+3000,env:process.env});t.after(()=>p.close());
 const call=word=>new Promise((yes,no)=>{const s=createConnection(p.env.WFR_COLLECTION_LEAF_SOCKET);let raw='';s.on('error',no);s.on('connect',()=>s.end(JSON.stringify({nonce:p.env.WFR_COLLECTION_LEAF_NONCE,argv:['-H','127.0.0.1','-P','12345','-s','NO-DEVICE','shell',word]})));s.on('data',b=>raw+=b);s.on('end',()=>yes(raw?JSON.parse(raw):{transport_closed:true}));});
 return {p,call};
}
test('真实nofork code1已返回但旧业务complete仍false',{skip:process.platform!=='darwin'},async t=>{
 const f=await fixture(t),reply=await f.call('one');assert.equal(reply.code,1);assert.equal(Buffer.from(reply.stdout,'base64').toString().trim(),'known-business-failure');
 const s=await f.p.seal();assert.equal(s.leaves.length,1);assert.equal(s.leaves[0].code,1);assert.equal(s.leaves[0].signal,null);assert.equal(s.leaves[0].tainted,false);assert.ok(s.leaves[0].started_at&&s.leaves[0].ended_at);
 assert.equal(s.complete,false,'不能将非零业务失败洗成complete');assert.equal(s.requests_returned,true,'已封闭nofork真实close必须独立判归还');
});
test('真实code0的requests_returned不是caller布尔',{skip:process.platform!=='darwin'},async t=>{const f=await fixture(t);assert.equal((await f.call('ok')).code,0);const s=await f.p.seal();assert.equal(s.complete,true);assert.equal(s.requests_returned,true);});
for(const mode of ['slow','signal','fork'])test('真实'+mode+'不能签requests_returned',{skip:process.platform!=='darwin'},async t=>{const f=await fixture(t);const reply=await f.call(mode);assert.notEqual(reply.code,0);if(mode==='fork')assert.equal(reply.code,77,'实际内核拒fork而非fixture未运行');const s=await f.p.seal();if(mode==='slow')assert.ok(s.leaves.some(x=>x.tainted||x.signal),'实际超时/信号必须已发生');assert.equal(s.complete,false);assert.notEqual(s.requests_returned,true);});
