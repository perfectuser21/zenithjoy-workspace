import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import {runResumeSequence} from '../device-epoch-fence-resume-sequence.mjs';
import * as processApi from '../device-epoch-fence-resume-process.mjs';
import {digest} from '../device-epoch-fence-reference.mjs';
import {mkdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';

async function nativeTerminal(t,unknown) {
  const fixture=fileURLToPath(new URL('./fixtures/epoch-stop-continuation-native/old-wait.py',import.meta.url));
  const child=spawn('python3',['-I',fixture,...(unknown?['--keep-parent-live']:[])],{stdio:['pipe','pipe','pipe']});let stderr='';child.stderr.on('data',b=>stderr+=b);
  const exited=new Promise(resolve=>child.once('close',(code)=>resolve(code)));
  t.after(async()=>{child.stdin.end('close\n');const timer=setTimeout(()=>child.kill('SIGKILL'),5000);try{assert.equal(await exited,0,stderr);}finally{clearTimeout(timer);}});
  const lines=createInterface({input:child.stdout});
  const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('NATIVE_SETUP_TIMEOUT\n'+stderr)),15000);lines.once('line',line=>{clearTimeout(timer);resolve(JSON.parse(line));});child.once('close',code=>{clearTimeout(timer);reject(Error('NATIVE_SETUP_EXIT '+code+'\n'+stderr));});});
  assert.equal(result.private_terminal_unknown,true);
  assert.equal(result.old_stop_signals,1);
  assert.equal(result.ops_parent_reclaims,unknown?0:1);
  assert.equal(result.field_actions,0);
  return result;
}

for (const fault of ['none','terminal-unknown','connect-unknown']) test(`真实old-handler停证未知后独立回收，continuation ${fault}不重发stop`,{timeout:25000},async t=>{
  const native=await nativeTerminal(t,fault==='terminal-unknown'),events=[],serial='192.0.2.31:10001';let connected=false,brand;
  const d=native.document;
  const executionDirectory=join(native.root,'continuation');mkdirSync(executionDirectory);
  const body={mode:'observed_stop_continuation',task_id:'9f2df876-88ec-4f7b-8aae-133d059aa812',scope:{serial},prior:{checkpoint_sha256:'a'.repeat(64)},source_authority:{commit:d.source_commit},
    execution_directory:executionDirectory,
    new_instance:{instance_id:d.instance_id,policy:{endpoint:d.endpoint},policy_path:d.policy_path,policy_sha256:d.policy_sha256},
    owned_supervisor:{actual:native.expected,supervisor_source:d.supervisor_source},
    stop_continuation:{checkpoint_sha256:'a'.repeat(64),failed_resume_plan_sha256:'c'.repeat(64),ops_receipt_sha256:'d'.repeat(64)}};
  const plan={...body,plan_sha256:digest(body)};
  const readHelper=document=>{
    const readback=fileURLToPath(new URL('./fixtures/epoch-stop-continuation-native/readback.py',import.meta.url));
    const r=spawnSync('python3',['-I',readback,native.root,native.home],{input:JSON.stringify(document),encoding:'utf8',timeout:10000});
    if(r.status!==0)throw Error('RESUME_PRIVATE_TERMINAL_UNKNOWN');return JSON.parse(r.stdout);
  };
  const guard={prepare:async()=>{},assertAlive:async()=>{},commit:async()=>{events.push('archive');return {};}};
  const forbidden=async()=>{throw Error('OLD_STOP_PATH_MUST_NOT_RUN');};
  const io={assertApproved:async()=>{},withDeviceGuard:async fn=>fn(guard),assertOriginalCheckpoint:async()=>{},oldInventory:async()=>[],
    inspectPrivateExact:forbidden,stopPrivateOnce:forbidden,verifyPrivateTerminal:forbidden,
    inspectObservedStopped:async()=>{events.push('fresh-terminal');assert.equal(typeof processApi.readObservedStopContinuation,'function');const result=await processApi.readObservedStopContinuation(plan,readHelper);brand=result.cap;return brand;},
    persistObservedStop:async(cap,g)=>{assert.equal(cap,brand);assert.equal(g,guard);const facts=processApi.verifyObservedStopContinuation(cap,plan);assert.equal(facts.selected_identities_absent,true);assert.equal(facts.listener_absent,true);assert.equal(facts.instance_locks_released,true);
      assert.throws(()=>processApi.verifyObservedStopContinuation({...cap},plan),/OBSERVED_STOP_CAPABILITY/);
      assert.throws(()=>processApi.verifyObservedStopContinuation(cap,{...plan,task_id:'foreign'}),/OBSERVED_STOP_CAPABILITY/);
      await processApi.persistObservedStopContinuation(cap,{plan,guard:g,assertAuthority:io.assertApproved,readHelper});
      const stored=JSON.parse(readFileSync(join(executionDirectory,'stop-terminal.json')));assert.equal(stored.stop_signal_sent,false);assert.equal(stored.original_resume_status,'unknown');assert.equal(stored.original_execution_stopped,false);events.push('persist-stop');},
    startPrivateOnce:async()=>events.push('start'),newInventory:async()=>connected?[{serial,state:'device'}]:[],
    connectNewOnce:async()=>{events.push('connect');connected=true;return {wire_complete:fault!=='connect-unknown',action_confirmed:true};},
    observeNoninterference:async()=>({kind:'old-route-fenced-observed-noninterference/v1',original_execution_stopped:false,android_internal:'not_attested'}),
    releaseCentralOnce:async()=>{events.push('release');return {status:'released',receipt:{}};},assertAfterRelease:async()=>{},
    createRecord:async()=>({sha256:'b'.repeat(64)}),verifyFinal:async()=>({old_route_absent:true,central_free:true,archive_verified:true})};
  if(fault==='none'){
    const result=await runResumeSequence({plan,io});assert.equal(result.status,'fenced');assert.equal(result.original_execution_stopped,false);
    assert.deepEqual(events.slice(0,4),['fresh-terminal','persist-stop','start','connect']);
  }else{
    await assert.rejects(runResumeSequence({plan,io}),fault==='terminal-unknown'?/PRIVATE_TERMINAL_UNKNOWN/:/CONNECT_ACK_UNKNOWN/);
    assert.equal(events.includes('release'),false);assert.equal(events.includes('archive'),false);
  }
  assert.equal(events.filter(e=>e==='start').length,fault==='terminal-unknown'?0:1);
  assert.equal(events.filter(e=>e==='connect').length,fault==='terminal-unknown'?0:1);
});

test('fixture前置断言失败仍精确清理本人child及listener，无孤儿进程',{timeout:20000},()=>{
  const fixture=fileURLToPath(new URL('./fixtures/epoch-stop-continuation-native/old-wait.py',import.meta.url));
  const r=spawnSync('python3',['-I',fixture,'--fail-before-term'],{encoding:'utf8',timeout:15000});
  assert.equal(r.status,1);assert.match(r.stderr,/INJECTED_BEFORE_TERM/);
  const line=r.stderr.split('\n').find(s=>s.startsWith('NATIVE_CLEANUP '));assert.ok(line,r.stderr);
  assert.deepEqual(JSON.parse(line.slice('NATIVE_CLEANUP '.length)),{listener_absent:true,child_terminal:true});
});
