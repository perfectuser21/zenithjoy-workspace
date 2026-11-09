import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const dir=new URL('./fixtures/device-epoch-fence-sdk31/',import.meta.url),read=n=>readFileSync(new URL(n,dir),'utf8'),load=()=>import('../device-epoch-fence-sdk31.mjs');
const original=Object.fromEntries(['sdk','boot_id','processes','input','activity'].map(q=>[q,read(q+'.txt')]));
test('真实SDK31原始fixture哈希与格式；单独诊断仍不签整体排空',async()=>{
 const p=JSON.parse(read('provenance.json'));for(const [q,v]of Object.entries(p.files)){assert.equal(createHash('sha256').update(original[q]).digest('hex'),v.fixture_sha256);assert.equal(v.wire_complete,true);assert.equal(v.exit_code,0);}
 const {parseSdk31Diagnostics}=await load(),r=parseSdk31Diagnostics(original);assert.equal(r.processes.rows.length,8);assert.equal(r.input.connections,15);assert.equal(r.input.queue_idle,true);assert.equal(r.activities.records,8);assert.equal(r.activities.records_idle,true);assert.equal(r.activities.pending_launch,'not_attested');assert.equal(r.remote_quiescence,'unknown');assert.equal(r.original_execution_stopped,false);assert.ok(r.processes.unresolved_shells.some(p=>p.pid===195));
});
test('wait/outbound/pending/touch/key/dispatcher字段非空或缺失均不视为空闲',async()=>{
 const {parseSdk31Diagnostics}=await load();for(const [from,to]of [['WaitQueue: <empty>','WaitQueue: length=1'],['OutboundQueue: <empty>','OutboundQueue: length=1'],['PendingEvent: <none>','PendingEvent: KeyEvent'],['InboundQueue: <empty>','InboundQueue: length=1'],['KeyDowns: 0 keys currently down','KeyDowns: 1 keys currently down'],['Last Raw Touch: pointerCount=0','Last Raw Touch: pointerCount=1'],['DispatchFrozen: false','DispatchFrozen: true'],['  Connections:','  MissingConnections:']]){const r=parseSdk31Diagnostics({...original,input:original.input.replace(from,to)});assert.equal(r.input.queue_idle,false,from);assert.equal(r.remote_quiescence,'unknown');}
});
test('截断process库存/Activity idle缺失/原producer存在，全部保守UNKNOWN',async()=>{
 const {parseSdk31Diagnostics}=await load();for(const change of [{processes:original.processes+'garbage\n'},{processes:original.processes+'    0 99999 745 uiautomator uiautomator dump --compressed /sdcard/old.xml\n'},{activity:original.activity.replace('idle=true','idle=false')},{activity:original.activity.replace('mVisibilityTransactionDepth=0','mVisibilityTransactionDepth=1')}]){const r=parseSdk31Diagnostics({...original,...change});assert.equal(r.remote_quiescence,'unknown');assert.ok(r.reasons.length);}
 assert.throws(()=>parseSdk31Diagnostics({...original,sdk:'32\n'}),/SDK31_REQUIRED/);
});
test('console来源排除依固定原controllerhash+真实fd/session，不以sh名或ticks推时间',async()=>{
 const {consoleShellIsOutsideOldDomain}=await load(),f={controllerSourceSha256:'b22cfc7d7a9d2e863be89c9e6af354e985083a8acdd56029f3da191c009d7fa6',process:{pid:195,uid:2000,ppid:1,name:'sh',args:'sh'},stat:'195 (sh) S 1 195 195 1025 195 4210944 477 349 2 1 0 0 0 0 20 0 1 0 247\n',status:'Name:\tsh\nTgid:\t195\nPid:\t195\nPPid:\t1\nUid:\t2000\t2000\t2000\t2000\nThreads:\t1\n',cmdline:'/system/bin/sh\0',fds:'total 0\nlrwx------ 1 shell shell 64 2026-11-09 05:32 0 -> /dev/console\nlrwx------ 1 shell shell 64 2026-11-09 05:32 1 -> /dev/console\nlrwx------ 1 shell shell 64 2026-11-09 05:32 10 -> /dev/tty\nlrwx------ 1 shell shell 64 2026-11-09 05:32 2 -> /dev/console\n',wchan:'wait_woken'};
 const out=consoleShellIsOutsideOldDomain(f);assert.equal(out.start_ticks,'247');assert.equal(out.session,195);assert.equal(out.started_before_run,undefined);for(const change of [x=>x.controllerSourceSha256='0'.repeat(64),x=>x.cmdline+='-c\0',x=>x.fds=x.fds.replace('/dev/console','pipe:[123]'),x=>x.stat=x.stat.replace('S 1 195 195','S 745 195 195'),x=>x.process.uid=0]){const x=structuredClone(f);change(x);assert.throws(()=>consoleShellIsOutsideOldDomain(x),/SDK31_CONSOLE_ORIGIN/);}
});

test('console排除末段绑定同boot和start_ticks，PID复用不得沿用旧排除',async()=>{const {verifyConsoleProcessIdentity}=await load(),excluded={pid:195,start_ticks:'247'},stat='195 (sh) S 1 195 195 1025 195 4210944 477 349 2 1 0 0 0 0 20 0 1 0 247\n';assert.doesNotThrow(()=>verifyConsoleProcessIdentity({excluded,stat,bootId:'same',expectedBootId:'same'}));for(const change of [{stat:stat.replace('247','248')},{bootId:'new-boot'}])assert.throws(()=>verifyConsoleProcessIdentity({excluded,stat,bootId:'same',expectedBootId:'same',...change}),/FENCE_CONSOLE_IDENTITY_CHANGED/);});
