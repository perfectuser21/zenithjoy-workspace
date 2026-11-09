import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runResumeSequence} from '../device-epoch-fence-resume-sequence.mjs';

function nativeTerminal() {
  const fixture=fileURLToPath(new URL('./fixtures/epoch-stop-continuation-native/old-wait.py',import.meta.url));
  const r=spawnSync('python3',['-I',fixture],{encoding:'utf8',timeout:20000});
  assert.equal(r.status,0,r.stderr||r.stdout);
  const result=JSON.parse(r.stdout.trim());
  assert.equal(result.private_terminal_unknown,true);
  assert.equal(result.old_stop_signals,1);
  assert.equal(result.ops_parent_reclaims,1);
  assert.equal(result.field_actions,0);
  return result.proof;
}

for (const fault of ['none','terminal-unknown','connect-unknown']) test(`真实old-handler停证未知后独立回收，continuation ${fault}不重发stop`,{timeout:25000},async()=>{
  const proof=nativeTerminal(),events=[],serial='192.0.2.31:10001';let connected=false;
  const guard={prepare:async()=>{},assertAlive:async()=>{},commit:async()=>{events.push('archive');return {};}};
  const forbidden=async()=>{throw Error('OLD_STOP_PATH_MUST_NOT_RUN');};
  const io={assertApproved:async()=>{},withDeviceGuard:async fn=>fn(guard),assertOriginalCheckpoint:async()=>{},oldInventory:async()=>[],
    inspectPrivateExact:forbidden,stopPrivateOnce:forbidden,verifyPrivateTerminal:forbidden,
    inspectObservedStopped:async()=>{events.push('fresh-terminal');if(fault==='terminal-unknown')throw Error('RESUME_PRIVATE_TERMINAL_UNKNOWN');return proof;},
    persistObservedStop:async(brand,g)=>{assert.equal(brand,proof);assert.equal(g,guard);events.push('persist-stop');},
    startPrivateOnce:async()=>events.push('start'),newInventory:async()=>connected?[{serial,state:'device'}]:[],
    connectNewOnce:async()=>{events.push('connect');connected=true;return {wire_complete:fault!=='connect-unknown',action_confirmed:true};},
    observeNoninterference:async()=>({kind:'old-route-fenced-observed-noninterference/v1',original_execution_stopped:false,android_internal:'not_attested'}),
    releaseCentralOnce:async()=>{events.push('release');return {status:'released',receipt:{}};},assertAfterRelease:async()=>{},
    createRecord:async()=>({sha256:'b'.repeat(64)}),verifyFinal:async()=>({old_route_absent:true,central_free:true,archive_verified:true})};
  const plan={mode:'observed_stop_continuation',scope:{serial},prior:{checkpoint_sha256:'a'.repeat(64)}};
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
