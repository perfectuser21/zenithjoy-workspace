import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,lstatSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import * as owner from '../activity-commander.mjs';

const scope={run_id:'unknown-owner__a2',binding_id:'binding-two',source_commit:'a'.repeat(40),task_id:null};
const sha=x=>createHash('sha256').update(x).digest('hex');
async function fixture(t){
 const home=mkdtempSync(join(tmpdir(),'owner-reconcile-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const turn=await owner.reserveWorkflowCommanderTurn(scope,{home});await turn.close();
 const session=owner.workflowCommanderSession(scope),file=join(home,'.openclaw/leadgen-owner-turns',session.split(':').at(-1)+'.pending.json');
 const raw=readFileSync(file),record=JSON.parse(raw),s=lstatSync(file);
 return {home,file,raw,record,request:{scope,session,expected:{dev:s.dev,ino:s.ino,sha256:sha(raw),transport_nonce:record.transport_nonce}}};
}
function readers(f,mode='quiet'){
 const gateway={pid:200,started_at_ms:Date.now(),command_sha256:'b'.repeat(64)};
 return {readHost:async()=>({gateway:{...gateway},scope_processes:[],observed_at:Date.now()}),readOfficial:async(method,params)=>{
  assert.equal(params.key??params.sessionKey??params.spawnedBy,f.request.session);
  if(method==='sessions.describe')return {session:{key:f.request.session,sessionId:'original-session',snapshotAt:Date.now(),hasActiveRun:mode==='active',activeRunIds:mode==='active'?['current']:[]}};
  if(method==='sessions.get')return {messages:[{role:'assistant',timestamp:Date.now()-1000}]};
  if(method==='chat.history')return {sessionKey:f.request.session,sessionId:'original-session',pendingInputs:{total:0,queuedCount:0,items:[]}};
  if(method==='sessions.list')return {ts:Date.now(),sessions:[],hasMore:false};
  if(method==='tools.invoke')return {ok:true,toolName:'subagents',source:'core',output:{details:{status:'ok',action:'list',callerIsSubagent:false,callerSessionKey:f.request.session,requesterSessionKey:f.request.session,active:[]}}};
  throw Error('unexpected official method '+method);
 }};
}
test('未知pending只能由完整fresh官方inactive与换代本机读回CAS归档，不伪旧turn成功',async t=>{
 const f=await fixture(t);assert.equal(typeof owner.reconcileWorkflowCommanderTurn,'function','正式维护入口尚不存在');
 const result=await owner.reconcileWorkflowCommanderTurn(f.request,{home:f.home,...readers(f)});
 assert.equal(result.status,'reconciled_inactive');assert.equal(result.business_result,'unknown');
 assert.equal(existsSync(f.file),false);assert.deepEqual(readFileSync(result.original_path),f.raw);
 const proof=JSON.parse(readFileSync(result.receipt_path));assert.equal(proof.original.status,'reserved');assert.equal(proof.original_sha256,sha(f.raw));
 assert.equal(Object.hasOwn(proof,'execution_stopped'),false);
 const next=await owner.reserveWorkflowCommanderTurn(scope,{home:f.home});await next.close();
});
test('官方active、缺pending字段和scope漂移均保原pending拒绝归档',async t=>{
 assert.equal(typeof owner.reconcileWorkflowCommanderTurn,'function','正式维护入口尚不存在');
 for(const mode of ['active','missing_queue','wrong_nonce']){
  const f=await fixture(t),io=readers(f,mode),read=io.readOfficial;
  if(mode==='missing_queue')io.readOfficial=async(m,p)=>m==='chat.history'?{sessionKey:f.request.session,sessionId:'original-session'}:read(m,p);
  if(mode==='wrong_nonce')f.request.expected.transport_nonce='wrong';
  await assert.rejects(owner.reconcileWorkflowCommanderTurn(f.request,{home:f.home,...io}),/COMMANDER_OWNER_RECONCILE_/);
  assert.deepEqual(readFileSync(f.file),f.raw);
 }
});

test('官方读取期间scope文件内容或inode被换、Gateway再换代、同scope进程仍活都不得归档',async t=>{
 const {writeFileSync,renameSync}=await import('node:fs');
 for(const mode of ['content','inode','gateway','live','stale','missing_core']){
  const f=await fixture(t),io=readers(f),read=io.readOfficial,host=io.readHost;let hostCount=0;
  io.readOfficial=async(m,p)=>{
   const r=await read(m,p);
   if(m==='sessions.get'){
    if(mode==='content')writeFileSync(f.file,f.raw+' ');
    if(mode==='inode'){renameSync(f.file,f.file+'.old');writeFileSync(f.file,f.raw,{mode:0o600});}
   }
   if(mode==='stale'&&m==='sessions.describe')r.session.snapshotAt=1;
   if(mode==='missing_core'&&m==='tools.invoke')delete r.output.details.active;
   return r;
  };
  io.readHost=async()=>{const r=await host();hostCount++;if(mode==='gateway'&&hostCount===2)r.gateway.pid++;if(mode==='live')r.scope_processes=[{pid:99}];return r;};
  await assert.rejects(owner.reconcileWorkflowCommanderTurn(f.request,{home:f.home,...io}),/COMMANDER_OWNER_RECONCILE_/,mode);
  assert.equal(existsSync(f.file),true);
 }
});

test('维护持owner内核锁期间真实reservation不能进入；完成后未知pending仍保留',async t=>{
 const f=await fixture(t),io=readers(f),read=io.readOfficial;let collision;
 io.readOfficial=async(m,p)=>{if(!collision){collision=owner.reserveWorkflowCommanderTurn(scope,{home:f.home});await assert.rejects(collision,/COMMANDER_OWNER_TURN_UNRESOLVED/);}return read(m,p);};
 const result=await owner.reconcileWorkflowCommanderTurn(f.request,{home:f.home,...io});
 assert.equal(result.status,'reconciled_inactive');assert.ok(collision);
});

test('reservation父进程正常退出自动释放内核锁，不留下不可回收mutex',async t=>{
 const {execFileSync}=await import('node:child_process');
 const home=mkdtempSync(join(tmpdir(),'owner-kernel-parent-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const module=new URL('../activity-commander.mjs',import.meta.url).href;
 execFileSync(process.execPath,['--input-type=module','-e',`import {reserveWorkflowCommanderTurn} from ${JSON.stringify(module)};await reserveWorkflowCommanderTurn(${JSON.stringify(scope)},{home:process.argv[1]});process.exit(0);`,home],{timeout:5000});
 const session=owner.workflowCommanderSession(scope),file=join(home,'.openclaw/leadgen-owner-turns',session.split(':').at(-1)+'.pending.json');
 const raw=readFileSync(file),r=JSON.parse(raw),s=lstatSync(file),f={home,file,raw,record:r,request:{scope,session,expected:{dev:s.dev,ino:s.ino,sha256:sha(raw),transport_nonce:r.transport_nonce}}};
 const result=await owner.reconcileWorkflowCommanderTurn(f.request,{home,...readers(f)});assert.equal(result.status,'reconciled_inactive');
});

test('末次读回新队列或新子agent不能被首轮空与owner无active覆盖',async t=>{
 for(const mode of ['queue','child','core']){
  const f=await fixture(t),io=readers(f),read=io.readOfficial,counts={};
  io.readOfficial=async(m,p)=>{counts[m]=(counts[m]||0)+1;const r=await read(m,p);if(counts[m]===2){if(mode==='queue'&&m==='chat.history')r.pendingInputs={total:1,queuedCount:1,items:[{state:'queued'}]};if(mode==='child'&&m==='sessions.list')r.sessions=[{key:'new-child'}];if(mode==='core'&&m==='tools.invoke')r.output.details.active=[{runId:'new-run'}];}return r;};
  await assert.rejects(owner.reconcileWorkflowCommanderTurn(f.request,{home:f.home,...io}),/COMMANDER_OWNER_RECONCILE_/);
  assert.deepEqual(readFileSync(f.file),f.raw);
 }
});

test('helper丢失后父仍保同一内核锁，显式关闭后新持有者才可获得',async t=>{
 const {acquireOwnerLock}=await import('../commander-owner-lock.mjs');const f=await fixture(t),first=await acquireOwnerLock(f.file);
 process.kill(first.pid,'SIGTERM');await new Promise(r=>setTimeout(r,60));
 assert.throws(()=>first.assertHeld(),/COMMANDER_OWNER_TURN_UNRESOLVED/);
 await assert.rejects(acquireOwnerLock(f.file),/COMMANDER_OWNER_TURN_UNRESOLVED/);await first();
 const next=await acquireOwnerLock(f.file);assert.doesNotThrow(()=>next.assertHeld());await next();
 assert.deepEqual(readFileSync(f.file),f.raw);
});

test('正式本机maintenance CLI真实读取请求并归档；仅外部官方与ps边界替身',async t=>{
 const {writeFileSync}=await import('node:fs'),{execFileSync}=await import('node:child_process');
 const f=await fixture(t),old={...f.record,started_at:'2020-01-01T00:00:00.000Z'};writeFileSync(f.file,JSON.stringify(old),{mode:0o600});
 const s=lstatSync(f.file);f.request.expected={...f.request.expected,ino:s.ino,sha256:sha(readFileSync(f.file))};
 const request=join(f.home,'request.json'),preload=join(f.home,'external-boundaries.mjs');writeFileSync(request,JSON.stringify(f.request));
 const fake=`import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
 const spawn=cp.spawn,exec=cp.execFileSync,key=${JSON.stringify(f.request.session)};
 cp.execFileSync=(command,args,options)=>{if(command!=='/bin/ps'||JSON.stringify(args)!==JSON.stringify(['-axo','pid=,ppid=,uid=,lstart=,command=']))throw Error('unexpected host call');return '200 1 '+process.getuid()+' Wed Oct 21 23:15:02 2026 /opt/homebrew/opt/node/bin/node /opt/homebrew/lib/node_modules/openclaw/dist/index.js gateway --port 18789\\n';};
 cp.spawn=(command,args,options)=>{if(command==='/usr/bin/python3')return spawn(command,args,options);if(command!=='openclaw'||args[0]!=='gateway'||args[1]!=='call')throw Error('unexpected external command');const m=args[2],p=JSON.parse(args[4]);if((p.key??p.sessionKey??p.spawnedBy)!==key)throw Error('wrong owner');let r;
 if(m==='sessions.describe')r={session:{key,sessionId:'original-session',snapshotAt:Date.now(),hasActiveRun:false,activeRunIds:[]}};
 else if(m==='sessions.get')r={messages:[{role:'assistant',timestamp:Date.now()}]};
 else if(m==='chat.history')r={sessionKey:key,sessionId:'original-session',pendingInputs:{total:0,queuedCount:0,items:[]}};
 else if(m==='sessions.list')r={ts:Date.now(),sessions:[],hasMore:false};
 else if(m==='tools.invoke')r={ok:true,toolName:'subagents',source:'core',output:{details:{status:'ok',action:'list',callerIsSubagent:false,callerSessionKey:key,requesterSessionKey:key,active:[]}}};else throw Error('unexpected method');
 return spawn(process.execPath,['-e','process.stdout.write('+JSON.stringify(JSON.stringify(r))+')'],options);};syncBuiltinESMExports();`;
 writeFileSync(preload,fake);
 const cli=new URL('../commander-owner-reconcile.mjs',import.meta.url);
 const result=JSON.parse(execFileSync(process.execPath,['--import',preload,cli.pathname,request],{encoding:'utf8',timeout:10000,env:{...process.env,HOME:f.home}}));
 assert.equal(result.status,'reconciled_inactive');assert.equal(existsSync(f.file),false);assert.equal(JSON.parse(readFileSync(result.original_path)).status,'reserved');
});

test('maintenance读回期间真实helper意外退出，提交被拒且pending原件不动',async t=>{
 const {execFileSync}=await import('node:child_process');const f=await fixture(t),io=readers(f),read=io.readOfficial;let killed=false;
 io.readOfficial=async(m,p)=>{
  if(!killed){
   const rows=execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).split('\n').filter(x=>x.includes(f.file+'.guard')&&x.includes('fcntl.flock'));
   const row=rows.map(x=>x.match(/^\s*(\d+)\s+(\d+)\s/)).find(x=>x&&Number(x[2])===process.pid);assert.ok(row,'fixture must identify only its own live lock helper');
   process.kill(Number(row[1]),'SIGTERM');killed=true;await new Promise(r=>setTimeout(r,60));
  }
  return read(m,p);
 };
 await assert.rejects(owner.reconcileWorkflowCommanderTurn(f.request,{home:f.home,...io}),/COMMANDER_OWNER_RECONCILE_/);
 assert.deepEqual(readFileSync(f.file),f.raw);assert.equal(killed,true);
});

function killOwnLockWithoutPolling(file){
 // Only the helper owned by this isolated test process and exact private file.
 const {pid}=process;const rows=execFileSync('/bin/ps',['-axo','pid=,ppid=,command='],{encoding:'utf8'}).split('\n');
 const row=rows.filter(x=>x.includes(file+'.guard')&&x.includes('fcntl.flock')).map(x=>x.match(/^\s*(\d+)\s+(\d+)\s/)).find(x=>x&&Number(x[2])===pid);
 assert.ok(row,'exact owned fixture helper must exist');process.kill(Number(row[1]),'SIGKILL');
 const until=performance.now()+150;while(performance.now()<until){} // intentionally do not poll Node close events
}
test('末次host读回杀死真实helper且不poll退出事件时禁止归档pending',async t=>{
 const f=await fixture(t),io=readers(f),host=io.readHost;let calls=0;
 io.readHost=async()=>{const r=await host();if(++calls===2)killOwnLockWithoutPolling(f.file);return r;};
 await assert.rejects(owner.reconcileWorkflowCommanderTurn(f.request,{home:f.home,...io}),/COMMANDER_OWNER_RECONCILE_/);
 assert.deepEqual(readFileSync(f.file),f.raw);assert.equal(lstatSync(f.file).ino,f.request.expected.ino);
});
test('returned同样不能在helper已死但Node缓存未更新时清除原reservation',async t=>{
 const home=mkdtempSync(join(tmpdir(),'owner-return-race-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const turn=await owner.reserveWorkflowCommanderTurn(scope,{home});
 const file=join(home,'.openclaw/leadgen-owner-turns',owner.workflowCommanderSession(scope).split(':').at(-1)+'.pending.json'),raw=readFileSync(file);
 killOwnLockWithoutPolling(file);
 await assert.rejects(Promise.resolve().then(()=>turn.returned('official returned response')),/COMMANDER_OWNER_TURN_UNRESOLVED/);
 assert.deepEqual(readFileSync(file),raw);await turn.close();
});

test('helper已提交而ACK丢失时只读归档证明，不自动重发或恢复旧pending',async t=>{
 const cp=(await import('node:child_process')).default,{syncBuiltinESMExports}=await import('node:module'),{readdirSync}=await import('node:fs');
 const f=await fixture(t),spawn=cp.spawn;let committedAcks=0;
 cp.spawn=(command,args,options)=>{
  const child=spawn(command,args,options);
  if(command==='/usr/bin/python3'&&args.at(-1)===f.file+'.guard'){
   const on=child.stdout.on.bind(child.stdout);child.stdout.on=(event,listener)=>{
    if(event!=='data')return on(event,listener);let buffer='';
    return on(event,chunk=>{buffer+=chunk.toString();while(buffer.includes('\n')){const end=buffer.indexOf('\n'),line=buffer.slice(0,end);buffer=buffer.slice(end+1);const frame=JSON.parse(line);if(frame.result?.original_path){committedAcks++;child.kill('SIGKILL');}else listener(Buffer.from(line+'\n'));}});
   };
  }
  return child;
 };
 syncBuiltinESMExports();
 try{await assert.rejects(owner.reconcileWorkflowCommanderTurn(f.request,{home:f.home,...readers(f)}),/COMMANDER_OWNER_RECONCILE_/);}
 finally{cp.spawn=spawn;syncBuiltinESMExports();}
 assert.equal(committedAcks,1);assert.equal(existsSync(f.file),false);
 const directory=join(f.home,'.openclaw/leadgen-owner-turns'),archives=()=>readdirSync(directory).filter(x=>x.endsWith('.reconciled_inactive'));
 assert.equal(archives().length,1);const archive=join(directory,archives()[0]);
 assert.deepEqual(readFileSync(join(archive,'original.pending.json')),f.raw);
 const proof=JSON.parse(readFileSync(join(archive,'receipt.json')));assert.equal(proof.status,'reconciled_inactive');assert.equal(proof.business_result,'unknown');assert.equal(proof.original.status,'reserved');
 await assert.rejects(owner.reconcileWorkflowCommanderTurn(f.request,{home:f.home,...readers(f)}),/COMMANDER_OWNER_RECONCILE_/);
 assert.equal(archives().length,1,'no second commit and no rollback after missing ACK');
});
