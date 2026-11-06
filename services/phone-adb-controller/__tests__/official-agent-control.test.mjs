import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync,chmodSync,statSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {createHash} from 'node:crypto';
import {canonical} from '../runtime-definition.mjs';
import {using} from './fixtures/official-control-fixture.mjs';

test('deadline取消同步异常不逃出定时器，收尾保留unknown',async()=>using(async({q,options,createControl,firstRequest,journalDirectory})=>{
 const directory=join(journalDirectory,'deadline-throw');fs.mkdirSync(directory,{mode:0o700});let actualDestroy,throws=0;
 const started=Date.now(),control=createControl({...options,journalDirectory:directory,deadlineMs:started+250,cleanupDeadlineMs:started+700,httpRequest:(...args)=>{
  const req=options.httpRequest(...args);actualDestroy=req.destroy.bind(req);req.destroy=(...x)=>{if(throws++===0)throw Error('FIXTURE_DEADLINE_CANCEL_THROW');return actualDestroy(...x);};return req;
 }});
 const work=control.request({kind:'activity_skill_authority',request:q});work.catch(()=>{});
 try{await firstRequest;await assert.rejects(work,/OFFICIAL_CONTROL_DEADLINE/);await new Promise(resolve=>setImmediate(resolve));
  const closed=await control.close();assert.ok(throws>0);assert.equal(closed.execution_unknown,true);assert.equal(closed.execution_stopped,false);
 }finally{actualDestroy?.();await work.catch(()=>{});await control.close();}
},{delay:true}));

test('同步取消抛错仍关闭其余执行域，重复close在原预算内归还unknown',async()=>using(async({q,options,createControl,firstRequest,journalDirectory})=>{
 const directory=join(journalDirectory,'cancel-throw');fs.mkdirSync(directory,{mode:0o700});let actualDestroy,throws=0,timer;
 const started=Date.now(),control=createControl({...options,journalDirectory:directory,deadlineMs:started+400,cleanupDeadlineMs:started+600,httpRequest:(...args)=>{
  const req=options.httpRequest(...args);actualDestroy=req.destroy.bind(req);req.destroy=(...x)=>{if(throws++===0)throw Error('FIXTURE_CANCEL_THROW');return actualDestroy(...x);};return req;
 }});
 const work=control.request({kind:'activity_skill_authority',request:q});work.catch(()=>{});await firstRequest;
 try{
  const first=await control.close().then(value=>({kind:'returned',value}),error=>({kind:'rejected',code:error.message}));
  const second=await Promise.race([control.close().then(value=>({kind:'returned',value})),new Promise(resolve=>{timer=setTimeout(()=>resolve({kind:'unbounded'}),900);})]);
  assert.notEqual(second.kind,'unbounded','取消异常不能留下永不完成的closing Promise');
  assert.equal(first.kind,'returned');assert.equal(second.value.execution_unknown,true);assert.equal(second.value.execution_stopped,false);
  assert.equal(second.value.sealed,true);assert.ok(readdirSync(directory).some(name=>/^official-caller-final-.*\.json$/.test(name)));
 }finally{clearTimeout(timer);actualDestroy?.();await work.catch(()=>{});}
},{delay:true}));

test('原真实Skill/中央绑定/私有official原件经本机只读HTTP授权，无outer Node或SSH',async()=>using(async({instance,q,count})=>{
 const value=await instance.request({kind:'activity_skill_authority',request:q});
 assert.deepEqual(value,{ok:true,authorized:true});assert.equal(count(),4);
 assert.equal(instance.snapshot().execution_stopped,false,'idle不等于sealed');
 await instance.close();assert.equal(instance.snapshot().execution_stopped,true);
}));
test('换Task、nonce、profile、source或broker host在任何IO之前拒绝',async()=>using(async({instance,q,count})=>{
 for(const change of [{task_id:'44444444-4444-4444-8444-444444444444'},{nonce:'d'.repeat(48)},{profile:'other'},{source_commit:'e'.repeat(40)},{broker_host:'xian-m4'}])await assert.rejects(()=>instance.request({kind:'activity_skill_authority',request:{...q,...change}}),/OFFICIAL_CONTROL_SCOPE/);
 assert.equal(count(),0);
}));
test('尚未闭域的launch/stop/commander及其它业务不回退旧RPC，零HTTP',async()=>using(async({instance,q,count})=>{
 for(const kind of ['activity_skill','activity_skill_stop','commander','queue','outreach'])await assert.rejects(()=>instance.request({kind,request:q}),/OFFICIAL_CONTROL_UNSUPPORTED/);
 assert.equal(count(),0);
}));
test('中央Task错身份仍沿原校验拒绝，不借本地transport获得权限',async()=>using(async({instance,q,routes})=>{
 routes.get('/api/brain/tasks/'+q.task_id).payload.device_serial='47.100.213.173:10002';
 await assert.rejects(()=>instance.request({kind:'activity_skill_authority',request:q}),/RPC_SKILL_PRIMARY_TASK_SCOPE_INVALID/);
}));
test('seal取消在途读；真实request/socket关闭前保留pending，晚回调不发第二GET',async()=>using(async({instance,q,firstRequest,count})=>{
 const work=instance.request({kind:'activity_skill_authority',request:q});const rejected=assert.rejects(work,/OFFICIAL_CONTROL_CLOSED/);
 await Promise.race([firstRequest,work.then(()=>{throw Error('authority returned before fixture request');})]);assert.equal(instance.snapshot().pending,1);
 const closed=instance.close();await rejected;await closed;
 assert.equal(count(),1);assert.equal(instance.snapshot().pending,0);assert.equal(instance.snapshot().execution_stopped,true);
 await assert.rejects(()=>instance.request({kind:'activity_skill_authority',request:q}),/OFFICIAL_CONTROL_CLOSED/);
},{delay:true}));

test('缺失request close回执不得卡死收尾或伪停止；真实socket虽关仍保unknown',async()=>using(async({instance,q,firstRequest})=>{
 const work=instance.request({kind:'activity_skill_authority',request:q});const rejected=assert.rejects(work,/OFFICIAL_CONTROL_CLOSED/);
 await Promise.race([firstRequest,work]);
 const result=await Promise.race([instance.close(),new Promise(r=>setTimeout(()=>r('unbounded'),1000))]);
 assert.notEqual(result,'unbounded','close必须在receipt预算内返回unknown，不能无限等close事件');
 assert.equal(result.execution_stopped,false);assert.equal(result.execution_unknown,true);assert.equal(result.pending,1);
 await rejected;
},{delay:true,suppressClose:true}));

test('绝对deadline取消真实挂起HTTP，之后无新GET且本机关闭可证',async()=>using(async({instance,q,firstRequest,count})=>{
 const work=instance.request({kind:'activity_skill_authority',request:q});const rejected=assert.rejects(work,/OFFICIAL_CONTROL_DEADLINE/);
 await Promise.race([firstRequest,work]);await rejected;await instance.close();
 assert.equal(count(),1);assert.equal(instance.snapshot().execution_stopped,true);
},{delay:true,shortDeadline:true}));
test('日志ACL被改时在HTTP前拒绝并保unknown，close不洗掉记录失败',async()=>using(async({instance,q,count,journalDirectory})=>{
 const file=readdirSync(journalDirectory).find(x=>x.endsWith('.jsonl'));chmodSync(join(journalDirectory,file),0o644);
 await assert.rejects(()=>instance.request({kind:'activity_skill_authority',request:q}),/OFFICIAL_CONTROL_JOURNAL/);assert.equal(count(),0);
 await instance.close();assert.equal(instance.snapshot().execution_stopped,false);assert.equal(instance.snapshot().execution_unknown,true);
}));
test('依赖原件被改仍由原source verifier拒绝；不为了本机调用绕过摘要',async()=>using(async({instance,q,count,runtimeRoot})=>{
 const file=join(runtimeRoot,'leadgen-rpc.mjs');writeFileSync(file,readFileSync(file,'utf8')+'\n');
 await assert.rejects(()=>instance.request({kind:'activity_skill_authority',request:q}),/OFFICIAL_CONTROL_SOURCE/);assert.equal(count(),0);
}));
test('错误模型的私有spawn原件不可获得authority，凭据不进入记录',async()=>using(async({instance,q,runDir,journalDirectory})=>{
 const file=join(runDir,'spawn-receipt.json'),receipt=JSON.parse(readFileSync(file));receipt.resolvedModel='different';writeFileSync(file,JSON.stringify(receipt));
 assert.deepEqual(await instance.request({kind:'activity_skill_authority',request:q}),{ok:true,authorized:false});
 for(const name of readdirSync(journalDirectory))assert.equal(readFileSync(join(journalDirectory,name),'utf8').includes('fixture-private-token'),false);
}));

const finalFiles=directory=>readdirSync(directory).filter(name=>/^official-caller-final-.*\.json$/.test(name));
const sha=value=>createHash('sha256').update(value).digest('hex');
test('Caller close publishes one durable safe final snapshot tied to its exact request and closed ledger',async()=>using(async({instance,q,journalDirectory})=>{
 await instance.request({kind:'activity_skill_authority',request:q});assert.deepEqual(finalFiles(journalDirectory),[]);
 const closed=await instance.close(),names=finalFiles(journalDirectory);assert.equal(names.length,1,'Caller requires an independent durable final record');
 const path=join(journalDirectory,names[0]),bytes=readFileSync(path),value=JSON.parse(bytes);
 assert.equal(statSync(path).mode&0o777,0o600);assert.equal(value.protocol,'official-caller-final/v1');
 assert.equal(value.request_sha256,sha(canonical(q)));assert.equal(value.task_id,q.task_id);assert.equal(value.run_id,q.run_id);assert.equal(value.nonce,q.nonce);assert.equal(value.source_commit,q.source_commit);
 assert.deepEqual(value.snapshot,closed);assert.equal(value.journal_closed,true);assert.equal(value.snapshot.caller_execution_stopped,true);assert.equal(value.snapshot.execution_stopped,true);assert.equal(value.snapshot.execution_unknown,false);
 assert.deepEqual(value.raw_turns,[]);assert.equal(value.ledger.sha256,sha(readFileSync(join(journalDirectory,value.ledger.file))));assert.equal(value.ledger.bytes,statSync(join(journalDirectory,value.ledger.file)).size);
 assert.ok(!bytes.includes(Buffer.from('fixture-private-token')));assert.equal(instance.verifySealedExecution(value.snapshot,{request:q}),false,'disk JSON is never a private stop brand');
 await Promise.all([instance.close(),instance.close()]);assert.deepEqual(finalFiles(journalDirectory),names);assert.deepEqual(readFileSync(path),bytes);
}));

test('final unknown preserves pending and missing request-close despite subsequent replay; no second final',async()=>using(async({instance,q,firstRequest,journalDirectory,replay})=>{
 const work=instance.request({kind:'activity_skill_authority',request:q}),rejected=assert.rejects(work,/CLOSED/);await firstRequest;
 const closed=await instance.close();await rejected;const file=join(journalDirectory,finalFiles(journalDirectory)[0]),bytes=readFileSync(file),final=JSON.parse(bytes);
 assert.equal(final.snapshot.pending,1);assert.equal(final.snapshot.execution_stopped,false);assert.equal(final.snapshot.execution_unknown,true);assert.deepEqual(final.snapshot,closed);
 for(const callback of replay)callback();await instance.close();assert.deepEqual(readFileSync(file),bytes);assert.equal(instance.snapshot().execution_stopped,false);
},{delay:true,suppressClose:true}));
for(const fault of ['open','write','fsync'])test(`final ${fault} failure taints close forever and cannot leave a valid positive final name`,async()=>using(async({instance,q,journalDirectory})=>{
 const original={openSync:fs.openSync,writeSync:fs.writeSync,fsyncSync:fs.fsyncSync};let finalFd,attempts=0;
 fs.openSync=(path,...args)=>{if(String(path).includes('official-caller-final-')){attempts++;if(fault==='open')throw Error('fixture-sensitive-error');const fd=original.openSync(path,...args);finalFd=fd;return fd;}return original.openSync(path,...args);};
 fs.writeSync=(fd,...args)=>{if(fd===finalFd&&fault==='write')throw Error('fixture-sensitive-error');return original.writeSync(fd,...args);};
 fs.fsyncSync=fd=>{if(fd===finalFd&&fault==='fsync')throw Error('fixture-sensitive-error');return original.fsyncSync(fd);};syncBuiltinESMExports();let closed;
 try{closed=await instance.close();}finally{Object.assign(fs,original);syncBuiltinESMExports();}
 assert.equal(closed.execution_stopped,false);assert.equal(closed.execution_unknown,true);assert.equal(instance.verifySealedExecution(closed,{request:q}),false);assert.deepEqual(finalFiles(journalDirectory),[]);
 const names=readdirSync(journalDirectory);await Promise.all([instance.close(),instance.close()]);assert.deepEqual(readdirSync(journalDirectory),names);assert.equal(attempts,1);assert.equal(instance.snapshot().execution_stopped,false);
}));
for(const change of ['ledger-replaced','ledger-edited-in-place','source-drift','directory-mode'])test(`final ${change} cannot attest the original Caller`,async()=>using(async({instance,journalDirectory,runtimeRoot})=>{
 if(change==='ledger-replaced'){const path=join(journalDirectory,readdirSync(journalDirectory).find(n=>n.endsWith('.jsonl')));renameSync(path,path+'.original');writeFileSync(path,'forged ledger\n',{mode:0o600});}
 else if(change==='ledger-edited-in-place')writeFileSync(join(journalDirectory,readdirSync(journalDirectory).find(n=>n.endsWith('.jsonl'))),'forged same-inode ledger\n');
 else if(change==='source-drift')writeFileSync(join(runtimeRoot,'leadgen-rpc.mjs'),'source drift');else chmodSync(journalDirectory,0o755);
 const closed=await instance.close();assert.equal(closed.execution_stopped,false);assert.equal(closed.execution_unknown,true);
 for(const file of finalFiles(journalDirectory)){const value=JSON.parse(readFileSync(join(journalDirectory,file)));assert.equal(value.evidence_complete,false);assert.equal(value.snapshot.execution_stopped,false);}
}));
test('recreated Caller final remains independent unknown and disk final never restores prior authority',async()=>using(async({instance,q,options,createControl,journalDirectory})=>{
 await instance.close();const first=finalFiles(journalDirectory);assert.equal(first.length,1);const bytes=readFileSync(join(journalDirectory,first[0]));
 const next=createControl(options);const closed=await next.close();assert.equal(closed.previous_caller_stop_unproven,true);assert.equal(closed.execution_unknown,true);assert.equal(closed.execution_stopped,false);
 assert.equal(finalFiles(journalDirectory).length,2);assert.deepEqual(readFileSync(join(journalDirectory,first[0])),bytes);assert.equal(next.verifySealedExecution(JSON.parse(bytes).snapshot,{request:q}),false);
}));

for(const fault of ['rename-fails','foreign-winner'])test(`failed final ${fault} stays unknown without overwriting an external path`,async()=>using(async({instance,journalDirectory})=>{
 const original={openSync:fs.openSync,writeSync:fs.writeSync,renameSync:fs.renameSync};let finalFd,path,renames=0;
 fs.openSync=(name,...args)=>{const fd=original.openSync(name,...args);if(String(name).includes('official-caller-final-')){path=String(name);finalFd=fd;}return fd;};
 fs.writeSync=(fd,...args)=>{const n=original.writeSync(fd,...args);if(fd===finalFd){if(fault==='foreign-winner'){original.renameSync(path,path+'.owned');const winner=original.openSync(path,'wx',0o600);try{original.writeSync(winner,Buffer.from('FOREIGN_WINNER'));}finally{fs.closeSync(winner);}}throw Error('fixture-sensitive-output');}return n;};
 fs.renameSync=(...args)=>{renames++;if(fault==='rename-fails')throw Error('fixture-rename-denied');return original.renameSync(...args);};syncBuiltinESMExports();let closed;
 try{closed=await instance.close();}finally{Object.assign(fs,original);syncBuiltinESMExports();}
 assert.equal(closed.execution_stopped,false);assert.equal(closed.execution_unknown,true);assert.equal(closed.final_record_failed,true);
 if(fault==='foreign-winner'){assert.equal(renames,0);assert.equal(readFileSync(path,'utf8'),'FOREIGN_WINNER');}else assert.equal(renames,1);
 const names=readdirSync(journalDirectory);await instance.close();assert.deepEqual(readdirSync(journalDirectory),names);
}));

test('close reentry during descriptor cleanup shares the same pipeline and final record',async()=>using(async({instance,journalDirectory})=>{
 const original=fs.closeSync;let second,entered=false;fs.closeSync=fd=>{if(!entered){entered=true;second=instance.close();}return original(fd);};syncBuiltinESMExports();let first;
 try{first=await instance.close();await second;}finally{fs.closeSync=original;syncBuiltinESMExports();}
 assert.equal(first.execution_stopped,true);assert.equal(finalFiles(journalDirectory).length,1);assert.equal(instance.snapshot().execution_unknown,false);
}));
