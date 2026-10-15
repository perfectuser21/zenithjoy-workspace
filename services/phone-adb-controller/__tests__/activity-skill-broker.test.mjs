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
 const b=await startActivityBroker({directory:d,request:{...request,...overrides},inspect:async()=>({company_id:'fixture-company'}),resume:async()=>{resumed++;return {scored:1};},phone:async()=>{throw Error('fixture scoring cannot use phone');}});
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
