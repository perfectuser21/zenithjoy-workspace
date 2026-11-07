import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,writeFileSync,readFileSync,readdirSync,rmSync,realpathSync,mkdirSync,cpSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {NATIVE_102_DARWIN_SHARDS,native102DarwinInvocations} from '../native-102-ci-selection.mjs';
const root=resolve(import.meta.dirname,'../../..');
async function runOwner(t,{shard,signal,tapMode}={}){
 assert.equal(process.platform,'darwin','required102 lifecycle uses the actual Darwin kernel');
 for(const name of ['PREFLIGHT_TEST_PG_BIN','PREFLIGHT_TEST_PYTHON_BIN','PREFLIGHT_TEST_PIL_ROOT','PREFLIGHT_TEST_FFMPEG_BIN','PREFLIGHT_TEST_FFPROBE_BIN'])assert.ok(process.env[name],name+' must be explicit');
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'native102-owner-lifecycle-'))),preload=join(directory,'child-boundary.mjs'),artifacts=join(directory,'artifacts'),sourceRoot=join(directory,'source');
 // Exact original CI driver closure, privately owned per lifecycle run. This
 // is not a synthetic business Source or a replacement for the job checkout.
 for(const name of ['package.json','scripts/ci/native-102-darwin-tests.mjs','scripts/ci/native-102-ci-selection.mjs','services/phone-adb-controller/__tests__/helpers/native-phone-test-python.mjs','services/phone-adb-controller/__tests__/helpers/native-phone-test-media.mjs']){const path=join(sourceRoot,name);mkdirSync(resolve(path,'..'),{recursive:true,mode:0o700});cpSync(join(root,name),path);assert.equal(readFileSync(path).equals(readFileSync(join(root,name))),true);}
 symlinkSync(realpathSync(join(root,'node_modules')),join(sourceRoot,'node_modules'));
 // Only the test-suite subprocess boundary is synthetic. The actual driver,
 // binary/nofork/Pillow checks, initdb, PG PID, signals and finally all execute.
 const batches=native102DarwinInvocations(shard),programs=batches.map((batch,index)=>{
  if(signal)return 'setInterval(()=>{},1000);';
  if(tapMode){if(batch.expectedTests===null)return '';const n=tapMode==='short'?3:4,skip=tapMode==='skip'?1:0,summary=tapMode==='missing'?'':`# tests ${n}\n# pass ${n-skip}\n# fail 0\n# cancelled 0\n# skipped ${skip}\n# todo 0\n`;return 'process.stdout.write('+JSON.stringify(summary)+');';}
  return index===batches.length-1?'process.exitCode=37;':'';
 });
 writeFileSync(preload,`import cp from 'node:child_process';import{syncBuiltinESMExports}from'node:module';import{readFileSync}from'node:fs';const original=cp.spawn,programs=${JSON.stringify(programs)};let index=0;cp.spawn=function(command,args,options){if(command===process.execPath&&args?.[0]==='--test'){const program=programs[index++];if(typeof program!=='string')throw Error('UNEXPECTED_TEST_BATCH');const child=original(command,['-e',program],options);child.once('spawn',()=>{const fixture=JSON.parse(readFileSync(options.env.ZJ_NATIVE_103_PG_FIXTURE));console.log(JSON.stringify({event:'native102-lifecycle-dispatch',args,child_pid:child.pid,source_root:options.cwd,fixture_path:options.env.ZJ_NATIVE_103_PG_FIXTURE,pg_data:fixture.data,pg_port:fixture.port}));});child.once('close',(code,signal)=>console.log(JSON.stringify({event:'native102-lifecycle-child-close',child_pid:child.pid,code,signal})));return child;}return original(command,args,options);};syncBuiltinESMExports();`);
 const child=spawn(process.execPath,['--import',preload,'scripts/ci/native-102-darwin-tests.mjs'],{cwd:sourceRoot,env:{...process.env,NODE_OPTIONS:'',NATIVE_102_CI_SHARD:shard,PREFLIGHT_TEST_PHONE_ARTIFACTS:artifacts},stdio:['ignore','pipe','pipe']});
 let output='',error='',sent=false;const closed=new Promise((yes,no)=>{child.once('error',no);child.once('close',(code,signal)=>yes({code,signal}));});
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');const stopped=await Promise.race([closed,new Promise(r=>setTimeout(r,20000))]);if(!stopped)throw Error('NATIVE102_LIFECYCLE_OWNER_STOP_UNKNOWN');}rmSync(directory,{recursive:true,force:true});});
 child.stdout.on('data',bytes=>{output+=bytes.toString();if(signal&&!sent&&output.includes('"event":"native102-lifecycle-dispatch"')){sent=true;child.kill(signal);}});child.stderr.on('data',bytes=>{error+=bytes.toString();});
 const result=await closed,records=output.split('\n').flatMap(line=>{try{return[JSON.parse(line)];}catch{return[];}}),ready=records.find(r=>r.event==='native102-private-pg-ready'),stop=records.find(r=>r.event==='native102-private-pg-close');
 assert.equal(result.signal,null,'owner must enter finally, not terminate through the default signal action');if(tapMode==='valid')assert.equal(result.code,0);else assert.notEqual(result.code,0,'cancellation/child failure/incomplete TAP is never passing business evidence');
 assert.ok(ready,output+'\n'+error);assert.ok(stop,output+'\n'+error);assert.equal(ready.shard,shard);assert.equal(stop.shard,shard);assert.equal(stop.owned_pid,ready.owned_pid);assert.equal(stop.stopped,true);assert.ok(stop.result);assert.equal(existsSync(stop.directory),false,'remove only after actual owned PG close');
 assert.deepEqual(stop.result,{code:0,signal:null},'the private PG really returned through its own shutdown');
 const dispatches=records.filter(r=>r.event==='native102-lifecycle-dispatch'),childCloses=records.filter(r=>r.event==='native102-lifecycle-child-close'),attempted=signal?batches.slice(0,1):batches;
 assert.deepEqual(dispatches.map(r=>r.args),attempted.map(b=>b.args),'actual original flags and complete-file selection must match every attempted batch');assert.equal(childCloses.length,dispatches.length);
 for(let index=0;index<dispatches.length;index++){const dispatch=dispatches[index],childClose=childCloses[index];assert.equal(dispatch.source_root,sourceRoot);assert.equal(dispatch.pg_port,ready.port);assert.equal(childClose.child_pid,dispatch.child_pid);const code=signal?null:!tapMode&&index===batches.length-1?37:0;assert.deepEqual({code:childClose.code,signal:childClose.signal},{code,signal:signal?'SIGTERM':null});}
 if(signal)assert.equal(sent,true);if(tapMode==='valid')assert.equal(records.filter(r=>r.event==='native102-ci-complete-file').length,1);else if(tapMode)assert.match(error,/NATIVE_102_CI_FULL_FILE_COUNT/);
 const failures=existsSync(artifacts)?readdirSync(artifacts).filter(n=>n.startsWith('owner-failure-')):[];assert.equal(failures.length,tapMode==='valid'?0:1);let artifact;
 if(failures.length){artifact=JSON.parse(readFileSync(join(artifacts,failures[0],'native102-ci-failure.json')));assert.equal(artifact.event,'native102-ci-failed');assert.equal(artifact.owned_pg_pid,ready.owned_pid);assert.equal(artifact.cancellation_requested,Boolean(signal));}
 const proof={shard,cancel_signal:signal??null,tap_mode:tapMode??null,synthetic_business_boundary:true,owner_exit:result,ready,closed:stop,dispatch:dispatches[0],dispatches,child_closed:childCloses,failure_artifact:artifact};console.log(JSON.stringify({event:'native102-lifecycle-proof',...proof}));return proof;
}
for(const shard of ['1','2','3']){
 for(const signal of ['SIGTERM','SIGINT'])test('native102 owner '+shard+' '+signal+' closes its actual private PG and child in finally',{timeout:30000},async t=>runOwner(t,{signal,shard}));
 test('native102 owner '+shard+' actual child failure preserves artifact and proves PG stop',{timeout:30000},async t=>runOwner(t,{shard}));
}
test('native102 component owners2 and3 concurrently own different PG and exact private driver Source',{timeout:30000},async t=>{
 const [a,b]=await Promise.all(['2','3'].map(shard=>runOwner(t,{shard})));
 for(const key of ['owned_pid','port'])assert.notEqual(a.ready[key],b.ready[key]);assert.notEqual(a.closed.directory,b.closed.directory);for(const key of ['source_root','fixture_path','pg_data'])assert.notEqual(a.dispatch[key],b.dispatch[key]);
});
for(const shard of ['0','4','01','3.0',undefined])test('native102 refuses '+(shard??'missing')+' shard instead of selecting no tests or a default owner',()=>{
 assert.equal(process.platform,'darwin');const env={...process.env,NODE_OPTIONS:'',NATIVE_102_CI_SHARD:shard};
 const r=spawnSync(process.execPath,['scripts/ci/native-102-darwin-tests.mjs'],{cwd:root,env,encoding:'utf8',timeout:5000});assert.equal(r.error,undefined);assert.notEqual(r.status,0);assert.match(r.stderr,/NATIVE_102_CI_SHARD_REQUIRED/);assert.doesNotMatch(r.stdout,/native102-private-pg-ready|native102-ci-selection/);
});

const privateOwner=Object.entries(NATIVE_102_DARWIN_SHARDS).find(([_shard,suites])=>suites.includes('native-phone-wire-ticket-private-brand.test.mjs'))[0];
for(const tapMode of ['valid','short','skip','missing'])test('single complete private-brand child TAP '+tapMode+' retains real PG finally',{timeout:30000},async t=>runOwner(t,{shard:privateOwner,tapMode}));
