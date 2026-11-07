// Root-authorized private-brand observation layer. Node's official module mock
// wraps the actual source-pinned issuer/claim functions; no substitute Runtime,
// lease, preflight scope, Source bytes or capability issuer is constructed.
import test from 'node:test';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';import {join} from 'node:path';
import {usingNativeRuntimeAdmissionBoundary} from './fixtures/native-phone-runtime-admission-boundary.mjs';
for(const attack of ['clone','cross-command','reuse','expired'])test('genuine local protocol ticket private-brand '+attack,async t=>{
 let armed=false,seen=0,actual,rejections=0,claimInputs;
 const beforeWorkflowImport=async f=>{
  const url=pathToFileURL(join(f.runtimeRoot,'native-phone-protocol-ticket.mjs')).href;
  // A distinct import URL retains the original implementation unchanged while
  // the canonical URL seen by real Runtime/observers gets only the wrapper.
  actual=await import(url+'?private-brand-original');
  t.mock.module(url,{namedExports:{...actual,
   async issueNativePhoneProtocolTicket(...args){const cap=await actual.issueNativePhoneProtocolTicket(...args);return cap;},
   claimNativePhoneProtocolTicket(cap,expected){
    if(!armed)return actual.claimNativePhoneProtocolTicket(cap,expected);
    armed=false;seen++;claimInputs=expected;
    const rejected=fn=>{assert.throws(fn,e=>e.code==='NATIVE_PHONE_PROTOCOL_TICKET'||/DEADLINE|SCOPE|TIMEOUT|CLOSED/.test(e.code||e.message));rejections++;};
    if(attack==='clone')rejected(()=>actual.claimNativePhoneProtocolTicket(structuredClone(cap),expected));
    if(attack==='cross-command')rejected(()=>actual.claimNativePhoneProtocolTicket(cap,{...expected,request:{...expected.request,operation:'pause'}}));
    if(attack==='reuse'){const check=actual.claimNativePhoneProtocolTicket(cap,expected);rejected(()=>actual.claimNativePhoneProtocolTicket(cap,expected));return check;}
    if(attack==='expired'){
     const now=Date.now,deadline=Math.max(expected.scope.worker_deadline_ms,expected.scope.cleanup_deadline_ms)+1;
     Date.now=()=>deadline;
     let expiredError;try{rejected(()=>{try{return actual.claimNativePhoneProtocolTicket(cap,expected);}catch(error){expiredError=error;throw error;}});}finally{Date.now=now;}
     throw expiredError;
    }
    return actual.claimNativePhoneProtocolTicket(cap,expected);
   }
  }});
 };
 const result=await usingNativeRuntimeAdmissionBoundary(t,async f=>{
  const start=f.adb.requests.length;armed=true;
  if(attack==='expired')await assert.rejects(()=>f.preflightRuntime.current().phone('foreground'));
  else assert.match(await f.preflightRuntime.current().phone('foreground'),/com\.ss\.android\.ugc\.aweme/);
  assert.equal(seen,1);assert.equal(rejections,1);assert.equal(claimInputs.request.kind,'shell');assert.equal(claimInputs.request.operation,'foreground');
  if(attack==='expired')assert.deepEqual(f.adb.requests.slice(start),[],'expired genuine cap must fail before any new protocol bytes');
  f.observations.push({attack,genuine_caps_seen:seen,original_claim_rejections:rejections});
 },{beforeWorkflowImport});
 if(attack==='expired'){assert.ok(result.lockHeld);assert.equal(result.cleanup,undefined);}else{assert.equal(result.preflight.status,'completed');assert.equal(result.cleanup.status,'completed');assert.equal(result.lockHeld,null);}
});
