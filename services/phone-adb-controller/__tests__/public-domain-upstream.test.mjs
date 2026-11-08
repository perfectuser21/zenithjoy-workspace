import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validatePublicUpstreamReceipt} from '../public-domain-upstream.mjs';
const ref={run_id:randomUUID(),task_id:randomUUID(),profile_sha256:'a'.repeat(64)};
const receipt=()=>({authenticated:true,receipt:{...ref,status:'completed',execution_unknown:false,validation:{workflow:{verdict:'pass'},cleanup:{verdict:'pass'},activities:{collect_videos:{verdict:'pass'}}}},central_run:{status:'success',recording_status:'confirmed'}});
test('public 102 source requires actual canonical worker receipt and central recording ACK',()=>{assert.equal(validatePublicUpstreamReceipt(receipt(),ref).run_id,ref.run_id);});
for(const [name,mutate]of [
 ['unauthenticated',r=>r.authenticated=false],['other task',r=>r.receipt.task_id=randomUUID()],['other run',r=>r.receipt.run_id=randomUUID()],['other profile bytes',r=>r.receipt.profile_sha256='b'.repeat(64)],['worker unknown',r=>r.receipt.execution_unknown=true],['worker not done',r=>r.receipt.status='running'],['central pending',r=>r.central_run.recording_status='pending'],['business fail',r=>r.receipt.validation.activities.collect_videos.verdict='fail'],['cleanup absent',r=>delete r.receipt.validation.cleanup],['workflow unknown',r=>r.receipt.validation.workflow.verdict='unknown']
])test('public 102 source rejects '+name,()=>{const r=receipt();mutate(r);assert.throws(()=>validatePublicUpstreamReceipt(r,ref),/PUBLIC_DOMAIN_UPSTREAM_UNVERIFIED/);});
