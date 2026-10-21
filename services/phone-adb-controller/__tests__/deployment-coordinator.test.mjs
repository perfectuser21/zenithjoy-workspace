import test from 'node:test';
import assert from 'node:assert/strict';
import {coordinateDeployment} from '../deployment-coordinator.mjs';

function fixture(fail={}) {
  const calls=[], states={}, decisions=[];
  let decision=null;
  const action=(name,fn)=>async host=>{calls.push(`${name}:${host||''}`);if(Object.hasOwn(fail,name)&&fail[name]===host)throw Error(`${name} lost`);return fn?.(host);};
  return {calls,states,decisions,options:{
    readDecision:async()=>decision,
    writeDecision:async value=>{decision=value;decisions.push(value);},
    prepare:action('prepare',host=>states[host]='prepared'),
    inspect:action('inspect',host=>states[host]||null),
    reacquire:action('reacquire',()=>{}),
    install:action('install',()=>{}),
    verifyInstalled:action('verifyInstalled',()=>{}),
    commit:action('commit',host=>states[host]='committed'),
    restore:action('restore',host=>states[host]='restored'),
    verifyRestored:action('verifyRestored',()=>{}),
    release:action('release',host=>states[host]='released')
  }};
}

test('both host verification precedes durable commit and either barrier release',async()=>{
  const f=fixture();await coordinateDeployment(f.options);
  assert.deepEqual(f.decisions,['install','commit']);
  assert.ok(f.calls.indexOf('verifyInstalled:mmv')<f.calls.indexOf('commit:xian-m4'));
  assert.ok(f.calls.indexOf('commit:mmv')<f.calls.indexOf('release:xian-m4'));
  assert.deepEqual(f.states,{'xian-m4':'released',mmv:'released'});
});

test('second host prepare failure restores first host only and preserves original failure',async()=>{
  const f=fixture({prepare:'mmv'});
  await assert.rejects(coordinateDeployment(f.options),/prepare lost/);
  assert.ok(!f.calls.includes('install:'));
  assert.ok(f.calls.includes('restore:xian-m4'));
  assert.ok(!f.calls.includes('restore:mmv'));
});

test('deployment failure restores both hosts before either barrier is released',async()=>{
  const f=fixture({install:undefined});
  await assert.rejects(coordinateDeployment(f.options),/install lost/);
  assert.ok(f.calls.indexOf('verifyRestored:mmv')<f.calls.indexOf('release:xian-m4'));
  assert.deepEqual(f.decisions,['install','restore']);
});

test('failed old observation keeps both barriers closed',async()=>{
  const f=fixture({install:undefined,verifyRestored:'mmv'});
  await assert.rejects(coordinateDeployment(f.options),/verifyRestored lost/);
  assert.ok(!f.calls.some(x=>x.startsWith('release:')));
});

test('commit ACK loss never triggers blind rollback after durable commit decision',async()=>{
  const f=fixture({commit:'mmv'});
  await assert.rejects(coordinateDeployment(f.options),/commit lost/);
  assert.deepEqual(f.decisions,['install','commit']);
  assert.ok(!f.calls.some(x=>x.startsWith('restore:')));
  assert.ok(!f.calls.some(x=>x.startsWith('release:')));
});

test('recover committed direction verifies both hosts and never reinstalls',async()=>{
  const f=fixture();await f.options.writeDecision('commit');
  f.states['xian-m4']='committed';f.states.mmv='prepared';
  await coordinateDeployment({...f.options,recover:true});
  assert.ok(!f.calls.some(x=>x.startsWith('prepare:')||x.startsWith('install:')||x.startsWith('restore:')));
  assert.deepEqual(f.states,{'xian-m4':'released',mmv:'released'});
});

test('recovery with an unreachable host does not mutate or release the other host',async()=>{
  const f=fixture({inspect:'mmv'});await f.options.writeDecision('install');
  f.states['xian-m4']='prepared';f.states.mmv='prepared';
  await assert.rejects(coordinateDeployment({...f.options,recover:true}),/inspect lost/);
  assert.ok(!f.calls.some(x=>/^(restore|release|commit):/.test(x)));
});

test('explicit rollback changes direction only after all journals can be read',async()=>{
  const f=fixture();await f.options.writeDecision('commit');
  f.states['xian-m4']='released';f.states.mmv='released';
  await coordinateDeployment({...f.options,rollback:true});
  assert.deepEqual(f.decisions,['commit','restore']);
  assert.ok(f.calls.includes('restore:mmv'));
  assert.ok(!f.calls.some(x=>x.startsWith('install:')));
});


test('recovery first reacquires both released host barriers before verification or restoration',async()=>{
 const f=fixture();await f.options.writeDecision('commit');
 f.states['xian-m4']='released';f.states.mmv='committed';
 await coordinateDeployment({...f.options,recover:true});
 assert.ok(f.calls.indexOf('reacquire:xian-m4')>=0);
 assert.ok(f.calls.indexOf('reacquire:mmv')<f.calls.indexOf('verifyInstalled:xian-m4'));
 assert.ok(f.calls.indexOf('inspect:mmv')<f.calls.indexOf('reacquire:xian-m4'));
});


test('recover before first install may have no durable decision or host journals',async()=>{
 const f=fixture();
 assert.deepEqual(await coordinateDeployment({...f.options,recover:true}),{direction:'restored'});
 assert.deepEqual(f.decisions,['restore']);
 assert.ok(!f.calls.some(x=>/^(install|release|restore):/.test(x)));
});
