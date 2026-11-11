// Actual managed Python wrapper + fenced Darwin C leaf; no phone or daemon request.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {spawn,spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {startCollectionLeafProducer} from '../collection-leaf-producer.mjs';
const route=new URL('../adb-existing-route.py',import.meta.url).pathname,wrapper=new URL('../adb-managed-client.py',import.meta.url).pathname;
const observe=`import types,sys\np=sys.argv[1];m=types.ModuleType('route');m.__file__=p;exec(compile(open(p,'rb').read(),p,'exec'),m.__dict__);text,retried=m.verified_client_version(sys.argv[2]);print(text,end='');print('retried='+str(retried),file=sys.stderr)`;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function fixture(t,{afterDelayMs=2300,budgetMs=10000,rejectAfter=false}={}){
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'proxy-version-')));t.after(()=>rmSync(directory,{recursive:true,force:true}));const binary=join(directory,'client'),calls=join(directory,'calls');
 writeFileSync(binary+'.c',`#include <stdio.h>\n#include <string.h>\n#include <stdlib.h>\n#include <unistd.h>\nint main(int n,char**v){int seen=0;char line[1024];FILE*old=fopen(${JSON.stringify(calls)},"r");if(old){while(fgets(line,sizeof(line),old))seen++;fclose(old);}FILE*f=fopen(${JSON.stringify(calls)},"a");if(!f)return 9;for(int i=1;i<n;i++)fprintf(f,"%s ",v[i]);fputs("\\n",f);fclose(f);if(getenv("VERSION_JITTER")&&seen<2)sleep(3);if(n==2&&!strcmp(v[1],"version")){puts("Android Debug Bridge version 1.0.41");return 0;}return 11;}\n`);
 const cc=spawnSync('cc',[binary+'.c','-o',binary],{encoding:'utf8'});assert.equal(cc.status,0,cc.stderr);
 const base={host_id:'xian-m4',transport:'usb',endpoint:'tcp:127.0.0.1:12345',forbidden_ports:[],adb_bin:binary,adb_sha256:createHash('sha256').update(readFileSync(binary)).digest('hex')},policyPath=join(directory,'client-policy.json');writeFileSync(policyPath,JSON.stringify({...base,schema_version:1}),{mode:0o600});
 let checks=0;const deadlineMs=Date.now()+budgetMs,p=await startCollectionLeafProducer({directory,policy:{...base,schema_version:2,instance_id:'fixture-private',adb_realpath:binary},serial:'NO-DEVICE',deadlineMs,env:{HOME:directory,PATH:process.env.PATH},assertAdmission:async()=>{checks++;if(checks%2===0){await sleep(afterDelayMs);if(rejectAfter)throw Error('EPOCH_FIXTURE_AUTHORITY_REJECTED');}}});t.after(()=>p.close());
 const run=(extra={})=>new Promise(resolve=>{const child=spawn('python3',['-c',observe,route,wrapper],{env:{...process.env,...p.env,WFR_COLLECTION_POLICY_FILE:policyPath,ZJ_ADB_HOST_CONFIG:policyPath,...extra}});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('close',(code,signal)=>resolve({code,signal,stdout,stderr}));});
 return {p,run,calls,binary,deadlineMs,checks:()=>checks};
}
test('version proxy preserves successful returned leaf while fresh post-admission exceeds the local 2s probe budget',{skip:process.platform!=='darwin'},async t=>{
 const f=await fixture(t);assert.equal(f.p.env.WFR_COLLECTION_LEAF_DEADLINE_MS,String(f.deadlineMs));const result=await f.run(),end=await f.p.seal();
 assert.equal(result.code,0,result.stderr+'\n'+JSON.stringify(end));assert.match(result.stdout,/Android Debug Bridge version 1\.0\.41/);assert.match(result.stderr,/retried=False/);
 assert.equal(f.checks(),2,'both fresh authority checks remain mandatory');assert.equal(end.leaves.length,1);assert.equal(end.leaves[0].code,0);assert.equal(end.leaves[0].request_returned,true);assert.equal(end.requests_returned,true);assert.equal(end.complete,true);assert.equal(readFileSync(f.calls,'utf8'),'version \n');
});
test('version proxy refuses expired or missing parent deadline before starting a native leaf',{skip:process.platform!=='darwin'},async t=>{
 const f=await fixture(t,{afterDelayMs:0});
 for(const raw of ['',String(Date.now()-1),'unbounded']){const result=await f.run({WFR_COLLECTION_LEAF_DEADLINE_MS:raw});assert.notEqual(result.code,0);assert.match(result.stderr,/ADB_ROUTE_CLIENT_PROXY_DEADLINE/);}
 const end=await f.p.seal();assert.equal(end.leaves.length,0);assert.equal(f.checks(),0);
});
test('real proxy deadline expiry still isolates a returned leaf when the client disconnects before post-admission completes',{skip:process.platform!=='darwin'},async t=>{
 const f=await fixture(t,{afterDelayMs:2300,budgetMs:1500}),result=await f.run();assert.notEqual(result.code,0);const end=await f.p.seal();
 assert.equal(end.leaves.length,1);assert.equal(end.leaves[0].code,0);assert.equal(end.leaves[0].request_returned,true);assert.equal(end.complete,false);assert.equal(end.requests_returned,false,'a disconnected or late authority result is not accepted as a successful transport');
});

test('a real post-version fresh guard rejection stays unknown and does not retry native work',{skip:process.platform!=='darwin'},async t=>{
 const f=await fixture(t,{afterDelayMs:100,rejectAfter:true}),result=await f.run(),end=await f.p.seal();
 assert.notEqual(result.code,0);assert.equal(f.checks(),2);assert.equal(end.leaves.length,1);assert.equal(end.leaves[0].code,0);assert.equal(end.leaves[0].request_returned,true);assert.equal(end.requests_returned,false);assert.equal(end.complete,false);assert.equal(readFileSync(f.calls,'utf8'),'version \n');
});
test('ordinary local binary version retains the original two-second startup reads and three-attempt limit',{skip:process.platform!=='darwin',timeout:15000},async t=>{
 const f=await fixture(t,{afterDelayMs:0});
 const env={...process.env,VERSION_JITTER:'1'};for(const key of ['WFR_COLLECTION_LEAF_SOCKET','WFR_COLLECTION_LEAF_NONCE','WFR_COLLECTION_LEAF_DEADLINE_MS'])delete env[key];
 const result=await new Promise(resolve=>{const child=spawn('python3',['-c',observe,route,f.binary],{env});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('close',code=>resolve({code,stdout,stderr}));});
 assert.equal(result.code,0,result.stderr);assert.match(result.stderr,/retried=True/);assert.equal(readFileSync(f.calls,'utf8'),'version \nversion \nversion \n');assert.equal(f.checks(),0);assert.equal((await f.p.seal()).leaves.length,0,'local validation does not invoke parent IPC');
});
