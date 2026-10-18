import test from 'node:test';
import assert from 'node:assert/strict';
import * as recovery from '../activity-skill-recovery.mjs';
const request={run_id:'fixture__a1',activity_key:'qualification',source_commit:'a'.repeat(40),runtime_snapshot_sha256:'b'.repeat(64)};
const receipt=(overrides={})=>({status:'ok',execution_stopped:true,terminal:{terminalReply:{text:JSON.stringify({result:'blocked',run_id:request.run_id,activity:'qualification',source_commit:request.source_commit,runtime_snapshot_sha256:request.runtime_snapshot_sha256,earliest_error:{stage:'record_stop',reason:'RECORD_AUDIO_RESTORE_UNVERIFIED state=unknown'},blocked_reason:'原生音轨仍未知，未执行resume',...overrides})}}});
test('official child business block preserves the concrete reason without becoming success',()=>{
 assert.equal(typeof recovery.skillBlockedDiagnostic,'function');
 const r=recovery.skillBlockedDiagnostic(receipt(),request,{});
 assert.equal(r.status,'blocked');assert.match(r.reason,/原生音轨仍未知/);assert.match(r.reason,/RECORD_AUDIO_RESTORE_UNVERIFIED/);
});
test('foreign run, source, method snapshot and model success prose cannot become business evidence',()=>{
 assert.equal(typeof recovery.skillBlockedDiagnostic,'function');
 for(const bad of [{run_id:'other'}, {source_commit:'c'.repeat(40)}, {runtime_snapshot_sha256:'d'.repeat(64)}, {result:'completed'}])assert.equal(recovery.skillBlockedDiagnostic(receipt(bad),request,{}),null);
 assert.equal(recovery.skillBlockedDiagnostic({terminal:{terminalReply:{text:'all done'}}},request,{}),null);
});
