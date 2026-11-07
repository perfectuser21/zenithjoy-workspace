import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,writeFileSync,readFileSync,readdirSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {NATIVE_102_DARWIN_SHARDS} from '../native-102-ci-selection.mjs';
const root=resolve(import.meta.dirname,'../../..');
async function runOwner(t,{shard,signal}={}){
 assert.equal(process.platform,'darwin','required102 lifecycle uses the actual Darwin kernel');
 for(const name of ['PREFLIGHT_TEST_PG_BIN','PREFLIGHT_TEST_PYTHON_BIN','PREFLIGHT_TEST_PIL_ROOT','PREFLIGHT_TEST_FFMPEG_BIN','PREFLIGHT_TEST_FFPROBE_BIN'])assert.ok(process.env[name],name+' must be explicit');
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'native102-owner-lifecycle-'))),preload=join(directory,'child-boundary.mjs'),artifacts=join(directory,'artifacts');
 // Only the test-suite subprocess boundary is synthetic. The actual driver,
 // binary/nofork/Pillow checks, initdb, PG PID, signals and finally all execute.
 const program=signal?'setInterval(()=>{},1000);':'process.exitCode=37;';
 writeFileSync(preload,`import cp from 'node:child_process';import{syncBuiltinESMExports}from'node:module';const original=cp.spawn;cp.spawn=function(command,args,options){if(command===process.execPath&&args?.[0]==='--test'){console.log(JSON.stringify({event:'native102-lifecycle-dispatch',args}));return original(command,['-e',${JSON.stringify(program)}],options);}return original(command,args,options);};syncBuiltinESMExports();`);
 const child=spawn(process.execPath,['--import',preload,'scripts/ci/native-102-darwin-tests.mjs'],{cwd:root,env:{...process.env,NODE_OPTIONS:'',NATIVE_102_CI_SHARD:shard,PREFLIGHT_TEST_PHONE_ARTIFACTS:artifacts},stdio:['ignore','pipe','pipe']});
 let output='',error='',sent=false;const closed=new Promise((yes,no)=>{child.once('error',no);child.once('close',(code,signal)=>yes({code,signal}));});
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await Promise.race([closed,new Promise(r=>setTimeout(r,20000))]);}rmSync(directory,{recursive:true,force:true});});
 child.stdout.on('data',bytes=>{output+=bytes.toString();if(signal&&!sent&&output.includes('"event":"native102-private-pg-ready"')){sent=true;child.kill(signal);}});child.stderr.on('data',bytes=>{error+=bytes.toString();});
 const result=await closed,records=output.split('\n').flatMap(line=>{try{return[JSON.parse(line)];}catch{return[];}}),ready=records.find(r=>r.event==='native102-private-pg-ready'),stop=records.find(r=>r.event==='native102-private-pg-close');
 assert.equal(result.signal,null,'owner must enter finally, not terminate through the default signal action');assert.notEqual(result.code,0,'cancellation/child failure is never passing business evidence');
 assert.ok(ready,output+'\n'+error);assert.ok(stop,output+'\n'+error);assert.equal(ready.shard,shard);assert.equal(stop.shard,shard);assert.equal(stop.owned_pid,ready.owned_pid);assert.equal(stop.stopped,true);assert.ok(stop.result);assert.equal(existsSync(stop.directory),false,'remove only after actual owned PG close');
 console.log(JSON.stringify({event:'native102-lifecycle-proof',shard,cancel_signal:signal??null,owner_exit:result,ready,closed:stop}));
 if(signal)assert.equal(sent,true);
 else{
  const dispatch=records.find(r=>r.event==='native102-lifecycle-dispatch');assert.deepEqual(dispatch?.args,['--test','--test-concurrency=1',...NATIVE_102_DARWIN_SHARDS[shard].map(n=>'services/phone-adb-controller/__tests__/'+n)],'the real owner must attempt every selected suite exactly once');
  const failures=readdirSync(artifacts).filter(n=>n.startsWith('owner-failure-'));assert.equal(failures.length,1);const record=JSON.parse(readFileSync(join(artifacts,failures[0],'native102-ci-failure.json')));assert.equal(record.event,'native102-ci-failed');assert.equal(record.owned_pg_pid,ready.owned_pid);assert.equal(record.cancellation_requested,false);
 }
}
for(const [signal,shard]of [['SIGTERM','1'],['SIGINT','2']])test('native102 owner '+shard+' '+signal+' closes its actual private PG in finally',{timeout:30000},async t=>runOwner(t,{signal,shard}));
for(const shard of ['1','2'])test('native102 owner '+shard+' actual child failure preserves artifact and proves PG stop',{timeout:30000},async t=>runOwner(t,{shard}));
for(const shard of ['0',undefined])test('native102 refuses '+(shard??'missing')+' shard instead of selecting no tests or a default owner',()=>{
 assert.equal(process.platform,'darwin');const env={...process.env,NODE_OPTIONS:'',NATIVE_102_CI_SHARD:shard};
 const r=spawnSync(process.execPath,['scripts/ci/native-102-darwin-tests.mjs'],{cwd:root,env,encoding:'utf8',timeout:5000});assert.equal(r.error,undefined);assert.notEqual(r.status,0);assert.match(r.stderr,/NATIVE_102_CI_SHARD_REQUIRED/);assert.doesNotMatch(r.stdout,/native102-private-pg-ready|native102-ci-selection/);
});
