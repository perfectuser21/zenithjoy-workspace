import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {usingNative102Queue} from './fixtures/native-102-queue-fixture.mjs';
import {addProcessingUiSource,processingUiFixture} from './fixtures/native-processing-ui-fixture.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const api=await import('../native-phone-processing.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
test('processing composition exposes Code primitives for the original shared agent tools',()=>assert.equal(typeof api.createNativePhoneProcessing,'function'));
test('actual 101 admission -> closed private intake -> original PG claim passes through processing primitives',async t=>{
 await usingNative102Queue(t,async f=>{
  const pins=f.source.files.filter(r=>r.path==='native-phone-processing.mjs');assert.equal(pins.length,1,'processing must consume its unique formal RPC Source');assert.equal(pins[0].sha256,sha(readFileSync(join(f.root,'native-phone-processing.mjs'))));
  const {createLeadgenAgentTools}=await f.load('leadgen-agent-tools.mjs'),module=await f.load('native-phone-processing.mjs'),processing=module.createNativePhoneProcessing({root:f.root,source:f.source,env:f.env,createPool:f.createPool});
  const scope=f.activate('dedup');await processing.prepareActivity(scope,{directory:f.makeDirectory('composition-dedup'),assertAuthority:f.authority(),resources:async()=>true,refreshOwned:async()=>{throw Error('TEST_HOOK_NOT_USED');},readbackAuthority:async()=>{throw Error('TEST_HOOK_NOT_USED');}});
  const d=processing.primitives(scope),dt=createLeadgenAgentTools({scope,runDir:f.current,primitives:{...d,assertResources:async()=>true}}),result=await dt.business('verify_upstream');assert.equal(result.received,2);assert.equal(result.eligible,1);
  assert.equal((await d.settle()).eligible,1);assert.equal((await processing.closeActivity(scope)).execution_stopped,true);
  let lockRenewed=false,refreshes=0;const qscope=f.activate('qualification');await processing.prepareActivity(qscope,{directory:f.makeDirectory('composition-qualification'),assertAuthority:f.authority(),resources:async()=>true,readbackAuthority:async()=>{throw Error('TEST_HOOK_NOT_USED');},refreshOwned:async()=>{refreshes++;return {renewed:lockRenewed};}});
  const q=processing.primitives(qscope),qt=createLeadgenAgentTools({scope:qscope,runDir:f.current,primitives:{...q,assertResources:async()=>true}}),rows=await qt.business('claim_videos');const committed=f.commits();assert.deepEqual(await qt.business('claim_videos'),JSON.parse(JSON.stringify(rows)));assert.equal(f.commits(),committed);
  assert.deepEqual(rows.map(v=>v.video_id),[f.vid]);assert.deepEqual((await q.inspect()).leased_videos.map(v=>v.video_id),[f.vid]);
  assert.equal((await q.queue('inspect_videos',{video_ids:[f.vid]}))[0].process_status,'处理中:'+qscope.run);
  const renews=f.calls.filter(sql=>sql.includes('lease_heartbeat')).length;await assert.rejects(q.heartbeat(),/PHONE_LEASE/);assert.equal(refreshes,1);assert.equal(f.calls.filter(sql=>sql.includes('lease_heartbeat')).length,renews);lockRenewed=true;assert.equal((await q.heartbeat()).renewed,true);assert.equal(refreshes,2);
  await assert.rejects(q.queue('claim_videos',{}),/CLAIM_ALREADY_ISSUED/);
  const before=f.allocated();await assert.rejects(q.phone('record-start','forged-record'),/RECORDING_UNAVAILABLE|VIDEO|PHONE_HOOKS/);assert.equal(f.allocated(),before);
  await assert.rejects(q.queue('inspect_videos',{video_ids:[f.other]}),/TARGET/);
  assert.equal((await processing.closeActivity(qscope)).execution_stopped,true);assert.equal(processing.snapshot().execution_unknown,false);
 });
});
test('actual cleanup COMMIT ACK loss preserves unknown and never sends another release',async t=>{
 await usingNative102Queue(t,async f=>{
  const pins=f.source.files.filter(r=>r.path==='native-phone-processing.mjs');assert.equal(pins.length,1,'processing must consume its unique formal RPC Source');assert.equal(pins[0].sha256,sha(readFileSync(join(f.root,'native-phone-processing.mjs'))));
  const module=await f.load('native-phone-processing.mjs'),p=module.createNativePhoneProcessing({root:f.root,source:f.source,env:f.env,createPool:f.createPool});
  const ds=f.activate('dedup');await p.prepareActivity(ds,{directory:f.makeDirectory('ack-intake'),assertAuthority:f.authority(),resources:async()=>true,refreshOwned:async()=>{throw Error('TEST_HOOK_NOT_USED');},readbackAuthority:async()=>{throw Error('TEST_HOOK_NOT_USED');}});await p.primitives(ds).verifyUpstream();await p.closeActivity(ds);
  const qs=f.activate('qualification');await p.prepareActivity(qs,{directory:f.makeDirectory('ack-claim'),assertAuthority:f.authority(),resources:async()=>true,refreshOwned:async()=>{throw Error('TEST_HOOK_NOT_USED');},readbackAuthority:async()=>{throw Error('TEST_HOOK_NOT_USED');}});await p.primitives(qs).queue('claim_videos');await p.closeActivity(qs);
  const cs=f.activate('cleanup');await p.prepareCleanup(cs,{directory:f.makeDirectory('ack-cleanup'),assertAuthority:f.authority(),resources:async()=>true,refreshOwned:async()=>{throw Error('TEST_HOOK_NOT_USED');},readbackAuthority:async()=>{throw Error('TEST_HOOK_NOT_USED');}});f.loseCommit();const stopped=await p.closeActivity(cs);assert.equal(stopped.execution_stopped,false);assert.equal(stopped.external_effect,'unknown');assert.equal(p.snapshot().execution_unknown,true);
  assert.equal((await f.read()).find(v=>v.video_id===f.vid).process_status,'待判定');const writes=f.calls.filter(s=>s.startsWith('UPDATE zenithjoy.leadgen_videos SET process_status=')).length;assert.deepEqual(await p.closeActivity(cs),stopped);assert.equal(f.calls.filter(s=>s.startsWith('UPDATE zenithjoy.leadgen_videos SET process_status=')).length,writes);
 });
});
test('processing uses the original detail macro and binds actual Code link bytes to the claimed VID',async t=>{
 await usingNative102Queue(t,async f=>{
  addProcessingUiSource(f);const module=await f.load('native-phone-processing.mjs'),processing=module.createNativePhoneProcessing({root:f.root,source:f.source,env:f.env,createPool:f.createPool});
  const ds=f.activate('dedup');await processing.prepareActivity(ds,{directory:f.makeDirectory('ui-intake'),assertAuthority:f.authority(),resources:async()=>true,refreshOwned:async()=>{throw Error('TEST_HOOK_NOT_USED');},readbackAuthority:async()=>{throw Error('TEST_HOOK_NOT_USED');}});await processing.primitives(ds).verifyUpstream();await processing.closeActivity(ds);
  const qs=f.activate('qualification'),ui=processingUiFixture(f,t,qs);await processing.prepareActivity(qs,{directory:f.makeDirectory('ui-qualification'),assertAuthority:f.authority(),resources:async()=>true,refreshOwned:async()=>{throw Error('TEST_HOOK_NOT_USED');},readbackAuthority:async()=>{throw Error('TEST_HOOK_NOT_USED');},...ui});const q=processing.primitives(qs);await q.queue('claim_videos');
  await assert.rejects(q.validatePhone('open-video',[f.other],qs),/VIDEO/);const args=await q.validatePhone('open-video',[f.vid],qs);assert.match(await q.phone('open-video',...args),/video_opened=1/);assert.equal(ui.calls.some(([op])=>op==='pause'),true);
  const linkArgs=await q.validatePhone('current-video-link',[],qs);assert.match(await q.phone('current-video-link',...linkArgs),new RegExp('video_id='+f.vid));assert.equal((await q.inspect()).verified_detail_video_id,f.vid);
  const readBefore=ui.calls.length;assert.match(await q.phone('foreground'),/com\.ss\.android\.ugc\.aweme/);assert.equal(typeof await q.phone('window'),'string');const tree=await q.phone('ui-evidence',q.evidenceId('ui-evidence'));assert.match(tree.xml,/<hierarchy>/);assert.match(await q.phone('snapshot-evidence',q.evidenceId('snapshot-evidence')),/\.png/);const readCalls=ui.calls.slice(readBefore);assert.equal(readCalls.filter(([op])=>op==='capture-xml').every(([,args])=>args[1]?.policy==='opportunistic-search-tab'),true);assert.equal(readCalls.some(([op,args])=>op==='pause'||op==='keyevent'&&['85','127','126'].includes(args[0])),false);const n=ui.calls.length;await assert.rejects(q.phone('ui-evidence','foreign-id'),/READ_SCOPE/);await assert.rejects(q.phone('snapshot-evidence',qs.run+'-not-issued'),/READ_SCOPE/);assert.equal(ui.calls.length,n);const savedCommand=ui.io.command;delete ui.io.command;await assert.rejects(q.phone('window'),/PHONE_HOOKS/);ui.io.command=savedCommand;assert.throws(()=>processing.primitives({...qs,serial:'foreign-scope'}),/SCOPE/);assert.equal(ui.calls.length,n);
  const refs=(await q.inspect()).native_video_identity_evidence;assert.equal(refs.length,1);writeFileSync(refs[0].path,'tampered');await assert.rejects(q.inspect(),/IDENTITY/);
  assert.equal((await processing.closeActivity(qs)).execution_stopped,false);
 });
});
test('Code module with no started body reports zero owned resources without minting handoff or phone permission',async t=>{
 await usingNative102Queue(t,async f=>{
  const pins=f.source.files.filter(r=>r.path==='native-phone-processing.mjs');assert.equal(pins.length,1,'processing must consume its unique formal RPC Source');assert.equal(pins[0].sha256,sha(readFileSync(join(f.root,'native-phone-processing.mjs'))));
  const module=await f.load('native-phone-processing.mjs'),processing=module.createNativePhoneProcessing({root:f.root,source:f.source,env:f.env,createPool:f.createPool}),scope=f.activate('qualification'),before=f.allocated();
  const stopped=await processing.closeActivity(scope);assert.equal(stopped.execution_stopped,true);assert.equal(stopped.not_started,true);assert.equal(stopped.physical_actions,0);assert.equal(f.allocated(),before);
  assert.throws(()=>processing.primitives(scope),/SCOPE/);await assert.rejects(processing.closeActivity({...scope,source_commit:'f'.repeat(40)}),/SCOPE/);
  await assert.rejects(processing.prepareActivity(scope,{directory:f.makeDirectory('known-no-intake'),assertAuthority:f.authority(),resources:async()=>true,refreshOwned:async()=>{throw Error('TEST_HOOK_NOT_USED');},readbackAuthority:async()=>{throw Error('TEST_HOOK_NOT_USED');}}),/INTAKE_REQUIRED/);
  assert.equal((await processing.closeActivity(scope)).execution_stopped,true);assert.equal(f.allocated(),before);
 });
});
test('new cleanup AV releases only its private actual owned claims and independently reads them back',async t=>{
 await usingNative102Queue(t,async f=>{
  const pins=f.source.files.filter(r=>r.path==='native-phone-processing.mjs');assert.equal(pins.length,1,'processing must consume its unique formal RPC Source');assert.equal(pins[0].sha256,sha(readFileSync(join(f.root,'native-phone-processing.mjs'))));
  const module=await f.load('native-phone-processing.mjs'),processing=module.createNativePhoneProcessing({root:f.root,source:f.source,env:f.env,createPool:f.createPool});
  const ds=f.activate('dedup');await processing.prepareActivity(ds,{directory:f.makeDirectory('cleanup-intake'),assertAuthority:f.authority(),resources:async()=>true,refreshOwned:async()=>{throw Error('TEST_HOOK_NOT_USED');},readbackAuthority:async()=>{throw Error('TEST_HOOK_NOT_USED');}});await processing.primitives(ds).verifyUpstream();await processing.closeActivity(ds);
  const qs=f.activate('qualification');await processing.prepareActivity(qs,{directory:f.makeDirectory('cleanup-claim'),assertAuthority:f.authority(),resources:async()=>true,refreshOwned:async()=>{throw Error('TEST_HOOK_NOT_USED');},readbackAuthority:async()=>{throw Error('TEST_HOOK_NOT_USED');}});await processing.primitives(qs).queue('claim_videos');await processing.closeActivity(qs);
  const cs=f.activate('cleanup');await processing.prepareCleanup(cs,{directory:f.makeDirectory('cleanup-new-AV'),assertAuthority:f.authority(),resources:async()=>true,refreshOwned:async()=>{throw Error('TEST_HOOK_NOT_USED');},readbackAuthority:async()=>{throw Error('TEST_HOOK_NOT_USED');}});
  const stopped=await processing.closeActivity(cs);assert.equal(stopped.execution_stopped,true);assert.deepEqual(stopped.video_leases_released,[f.vid]);assert.equal(stopped.video_lease_readback_verified,true);
  const rows=await f.read();assert.equal(rows.find(v=>v.video_id===f.vid).process_status,'待判定');assert.equal(rows.find(v=>v.video_id===f.other).harvest_batch,qs.source_run);assert.equal(rows.find(v=>v.video_id===f.other).process_status,'待判定');
  const commits=f.commits();assert.deepEqual(await processing.closeActivity(cs),stopped);assert.equal(f.commits(),commits);
 });
});
test('closed dedup gets an independent original-B readonly PG Judge and fixed hard probes',async t=>{
 await usingNative102Queue(t,async f=>{
  const pins=f.source.files.filter(r=>r.path==='native-phone-processing.mjs');assert.equal(pins.length,1,'processing must consume its unique formal RPC Source');assert.equal(pins[0].sha256,sha(readFileSync(join(f.root,'native-phone-processing.mjs'))));
  const module=await f.load('native-phone-processing.mjs'),auth=await f.load('native-activity-authority.mjs'),scope=f.activate('dedup'),request=structuredClone(f.q),task=f.routes.get('/api/brain/tasks/'+scope.task_id);
  const processing=module.createNativePhoneProcessing({root:f.root,source:f.source,env:f.env,createPool:f.createPool});let readerClosed=false;
  const readbackAuthority=async()=>{const directory=f.makeDirectory('readback-B'),a=auth.createNativeActivityAuthority({runtimeRoot:f.root,source:f.source,request,frozen:{native_claim:{claimed_by:task.claimed_by,claimed_at:task.claimed_at},snapshot_sha256:scope.snapshot_sha256,deployment:{source_commit:f.source.commit}},directory,createControl:({directory:d})=>f.createControl({...f.options,source:f.source,request,journalDirectory:d})});return {assertAuthority:async()=>auth.readNativeAuthorityProjection(await a.readClaim(),{source:f.source,request}),close:async()=>{const p=await a.close();readerClosed=true;return p;},verifyStopped:p=>a.verifyStopped(p)};};
  await processing.prepareActivity(scope,{directory:f.makeDirectory('composition-readback'),assertAuthority:f.authority(),resources:async()=>true,refreshOwned:async()=>{throw Error('TEST_HOOK_NOT_USED');},readbackAuthority});
  const d=processing.primitives(scope);await d.verifyUpstream();await d.settle();await processing.closeActivity(scope);
  const before=f.commits(),checked=await processing.readbackChecks('dedup',{metrics:{own_filter_verified:0},deadlineMs:Math.min(scope.receipt_deadline_ms-1,Date.now()+5000)});
  assert.equal(checked.result.code_native_readback.execution_stopped,true);assert.equal(checked.result.code_native_readback.authority_execution_stopped,true);assert.equal(readerClosed,true);assert.equal(f.commits(),before);
  assert.equal(checked.result.probes.length,3);assert.equal(checked.result.probes.every(p=>p.pass===true),true);assert.equal(checked.result.metrics.own_filter_verified,1);
  assert.equal(f.calls.some(sql=>sql==='BEGIN READ ONLY'),true);assert.equal(processing.snapshot().execution_unknown,false);
 });
});
test('authority loss still closes every owned 102 domain and retains unknown instead of blocking close itself',async t=>{
 await usingNative102Queue(t,async f=>{
  const pins=f.source.files.filter(r=>r.path==='native-phone-processing.mjs');assert.equal(pins.length,1,'processing must consume its unique formal RPC Source');assert.equal(pins[0].sha256,sha(readFileSync(join(f.root,'native-phone-processing.mjs'))));
  const module=await f.load('native-phone-processing.mjs'),processing=module.createNativePhoneProcessing({root:f.root,source:f.source,env:f.env,createPool:f.createPool});
  let allowed=true;const scope=f.activate('dedup');await processing.prepareActivity(scope,{directory:f.makeDirectory('composition-revoked'),assertAuthority:f.authority(),resources:async()=>allowed,refreshOwned:async()=>{throw Error('TEST_HOOK_NOT_USED');},readbackAuthority:async()=>{throw Error('TEST_HOOK_NOT_USED');}});
  const p=processing.primitives(scope);await p.verifyUpstream();allowed=false;await assert.rejects(p.inspect(),/RESOURCES/);
  const stopped=await processing.closeActivity(scope);assert.equal(stopped.execution_stopped,false);assert.equal(processing.snapshot().activities[0].closed,true);assert.equal(processing.snapshot().execution_unknown,true);
 });
});
