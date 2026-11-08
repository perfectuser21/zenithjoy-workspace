import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPreflightPhoneDriver} from '../preflight-phone-driver.mjs';

test('account reader cannot publish or tap after its public Activity cancellation during a slow dump',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'public-code-cancel-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const signal=new AbortController(),calls=[];
 const driver=createPreflightPhoneDriver({evidenceRoot:directory,owner:'test_run',profile:'test',serial:'SERIAL',model:'MODEL',expectedAccount:'expected',deadlineMs:Date.now()+300000,signal:signal.signal,assertResources:async()=>{},
  local:{run:async()=>JSON.stringify({kind:'none',me:{x:10,y:10}})},
  adb:async(...args)=>{calls.push(args);if(args.includes('displays'))return 'mCurrentFocus=Window{abc u0 com.ss.android.ugc.aweme/.MainActivity}';if(args.includes('dump')){signal.abort();return '';}if(args[0]==='pull')writeFileSync(args[2],'<hierarchy/>');return '';}});
 await assert.rejects(()=>driver.run('account-current','test_run-account'),/PREFLIGHT_PHONE_CLOSED/);
 assert.equal(calls.some(args=>args.includes('tap')||args[0]==='pull'),false,'no new native leaf may follow cancelled dump');
 assert.equal(existsSync(join(directory,'test_run-account-profile.xml')),false);
});

test('public Code preflight has a separate canonical native factory and refuses unbranded admission before IO',async()=>{
 const {createPublicCodePreflight}=await import('../public-code-preflight.mjs');
 assert.throws(()=>createPublicCodePreflight({}),/PUBLIC_CODE_PREFLIGHT_/);
});

import {publicCodeNativeFixture} from './fixtures/public-code-preflight-native.mjs';
for(const workflow of ['douyin_video_discovery','douyin_video_processing'])test(workflow+' uses genuine reviewed shell-v2/ROM/nofork account preflight and exact owner cleanup', {skip:process.platform!=='darwin'},async t=>{
 const now=Date.now;let elapsed=0,advanced=false;
 t.mock.method(Date,'now',()=>now()+elapsed);
 const f=await publicCodeNativeFixture(t,{workflow,onDump:()=>{if(!advanced&&workflow==='douyin_video_discovery'){elapsed=125000;advanced=true;}}}),{createPublicCodePreflight}=await f.load('public-code-preflight.mjs');
 const runtime=createPublicCodePreflight(f),result=await runtime.preflight();
 assert.equal(result.douyin_id,'expected');assert.equal(f.state.executionUnknown,undefined);
 if(workflow==='douyin_video_discovery')assert.equal(advanced,true,'a complete reviewed dump after 125s remains inside the original 300s Activity, with no legacy 120s shell cap');
 assert.equal(readFileSync(join(f.locks,f.env.SERIAL+'.lock/owner'),'utf8').trim(),f.env.WFR_TAG);
 f.state.budgetDeadline=Date.now()+120000;
 const cleanup=await runtime.cleanup();assert.equal(cleanup.no_lock,true);assert.equal(cleanup.cleanup_readback_verified,1);
 assert.equal(existsSync(join(f.locks,f.env.SERIAL+'.lock')),false);
 assert.ok(f.calls.some(c=>c.includes('uiautomator')));assert.ok(f.calls.every(c=>c.startsWith('exec /system/bin/')));
});

test('public Code account dump cancelled while active leaves original quarantine and never issues a following tap',{skip:process.platform!=='darwin'},async t=>{
 const f=await publicCodeNativeFixture(t,{slowDump:true}),{createPublicCodePreflight}=await f.load('public-code-preflight.mjs'),runtime=createPublicCodePreflight(f),controller=new AbortController();
 const result=runtime.preflight({signal:controller.signal});result.catch(()=>{});await Promise.race([f.dumpStarted,result.then(()=>{throw Error('DUMP_NOT_STARTED');})]);controller.abort();
 await assert.rejects(result,e=>e.executionStopped===false);assert.equal(f.state.executionUnknown,true);assert.equal(f.calls.some(c=>c.includes("'tap'")),false);
 assert.equal((await runtime.quarantine()).verified,true);assert.equal(existsSync(join(f.locks,f.env.SERIAL+'.lock/preflight_quarantined')),true);
 await assert.rejects(()=>runtime.cleanup(),/PUBLIC_CODE_PREFLIGHT_PREVIOUS_UNKNOWN/);
});

test('new strict cleanup cannot convert previous generic observed-only work or cloned cleanup JSON into stop authority',{skip:process.platform!=='darwin'},async t=>{
 const f=await publicCodeNativeFixture(t),{createPublicCodePreflight}=await f.load('public-code-preflight.mjs'),runtime=createPublicCodePreflight(f);
 f.state.nativeStopUnproven=true;f.state.discoveryCleanupEvidence={cleanup_phone_scope:{protocol:'discovery-cleanup-only-v1',purpose:'cleanup_only'}};
 await assert.rejects(()=>runtime.cleanup(),e=>e.message==='PUBLIC_CODE_PREFLIGHT_PREVIOUS_UNKNOWN'&&e.executionStopped===false);
 assert.deepEqual(f.calls,[]);
});

test('changed profile registry bytes refuse before any phone command under the frozen native scope',{skip:process.platform!=='darwin'},async t=>{
 const f=await publicCodeNativeFixture(t),{createPublicCodePreflight}=await f.load('public-code-preflight.mjs'),runtime=createPublicCodePreflight(f);
 writeFileSync(f.registry,readFileSync(f.registry,'utf8').replace('Fixture','Changed'));
 await assert.rejects(()=>runtime.preflight(),/PUBLIC_CODE_PREFLIGHT_SOURCE/);assert.deepEqual(f.calls,[]);
});

test('shared 102 native cleanup preserves original video lease release after qualification refusal',{skip:process.platform!=='darwin'},async t=>{
 const f=await publicCodeNativeFixture(t,{workflow:'douyin_video_processing'}),{createHandlers}=await f.load('leadgen-handlers.mjs'),calls=[];
 Object.assign(f.env,{WFR_HOSTKEY:'mmv',LEADGEN_MMV_DEVICE_RUNTIME:'1',LEADGEN_LIMIT:'1'});
 Object.assign(f.lease,{acquire:async()=>{},ensure:async()=>{}});
 const device_binding={company_id:'company-fixture',tenant_id:'tenant-fixture',version:26,run_id:f.env.WFR_TAG,profile:f.env.P,device_serial:f.env.SERIAL,douyin_id:'expected',verification_status:'verified',enabled:true};
 const handlers=createHandlers({root:f.root,env:f.env,sourceCommit:f.state.source_commit,taskId:f.state.task_id,centralLease:f.lease,
  execute:async()=>{throw Error('LEGACY_NATIVE_FALLBACK_FORBIDDEN');},rpc:async q=>{
   const op=q.request?.op;calls.push(op);
   if(op==='company_config')return {result:{...device_binding,device_binding}};
   if(op==='claim_videos')return {result:[{video_id:'7693970762462579121'}]};
   if(op==='renew_video')throw Error('FIXTURE_QUALIFICATION_REFUSED');
   if(op==='release_video')return {result:{released:true}};
   throw Error('UNEXPECTED_RPC:'+op);
  }});
 handlers.state.budgetDeadline=Date.now()+300000;await handlers.preflight();
 await assert.rejects(()=>handlers.preflight(),/PUBLIC_CODE_PREFLIGHT_ALREADY_STARTED/);
 handlers.state.intakeVideoIds=['7693970762462579121'];
 await assert.rejects(()=>handlers.qualification(),/FIXTURE_QUALIFICATION_REFUSED/);
 handlers.state.budgetDeadline=Date.now()+120000;const cleanup=await handlers.cleanup();
 assert.equal(cleanup.no_lock,true);assert.equal(calls.filter(op=>op==='release_video').length,1,'new phone cleanup must preserve original queue lease return');
});
