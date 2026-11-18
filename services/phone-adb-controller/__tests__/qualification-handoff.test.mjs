import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';
import {evidenceFor,finalize} from './fixtures/qualification-handoff/readback-handoff.mjs';
const fixture=new URL('./fixtures/qualification-handoff/',import.meta.url),raw=JSON.parse(readFileSync(new URL('p6-checker-result.json',fixture))),hash=b=>createHash('sha256').update(b).digest('hex');
function f(){const dir=mkdtempSync(join(tmpdir(),'qualification-handoff-')),proof=join(dir,'host-proof.json');writeFileSync(proof,readFileSync(new URL('p6-host-proof.json',fixture)));const {request,observed}=structuredClone(raw);request.context.verification.proof_manifest_path=proof;const scope=evidenceFor(request.context.verification,'102',observed.identity);return {dir,proof,request,result:observed,scope,cleanup:()=>rmSync(dir,{recursive:true,force:true})};}
test('real P6 six passed facts become a source-verifiable qualification receipt in the actual adapter finalization',()=>{const x=f();try{assert.equal(x.result.checks.length,6);assert.ok(x.result.checks.every(c=>c.status==='passed'));const out=finalize(x.request,x.result,x.scope.qualification_receipt_source);assert.equal(out.output.qualification_receipt?.status,'passed');}finally{x.cleanup();}});
test('original P6 output really lacked the required handoff receipt',()=>{assert.equal(raw.observed.output.qualification_receipt,undefined);assert.deepEqual(raw.observed.output.video_ids,['7707600173446204723']);});
const invalid={
 'start phase':x=>x.request.phase='start',
 'other workflow':x=>x.request.workflow='101',
 'other activity':x=>x.request.activity='collection',
 'missing request identity':x=>{delete x.request.task_id;delete x.result.identity.task_id;},
 'invalid attempt':x=>{x.request.attempt=0;x.result.identity.attempt=0;},
 'missing nonce':x=>{delete x.request.nonce;delete x.result.nonce;},
 'wrong nonce':x=>x.result.nonce='foreign',
 'wrong result identity':x=>x.result.identity.run_id='foreign',
 'request check subset':x=>x.request.checks.pop(),
 'missing check':x=>x.result.checks.pop(),
 'duplicate check':x=>x.result.checks[1]=structuredClone(x.result.checks[0]),
 'failed check':x=>x.result.checks[0].status='failed',
 'unknown check':x=>x.result.checks[0].status='unknown',
 'missing check evidence':x=>x.result.checks[0].evidence=[],
 'wrong target scope':x=>x.request.context.verification['102'].video_ids=['7707600173446204000'],
 'duplicate output VID':x=>x.result.output.video_ids.push(x.result.output.video_ids[0]),
 'unresolved VID':x=>x.result.output.unresolved_video_ids.push(x.result.output.video_ids[0]),
 'empty collection':x=>x.result.output.no_collectable_videos=true,
 'duplicate PG row':x=>{const c=x.result.checks.find(c=>c.id==='persisted_qualification');c.evidence[0].observation.found.push(structuredClone(c.evidence[0].observation.found[0]));},
 'all rejected':x=>x.result.checks.find(c=>c.id==='persisted_qualification').evidence[0].observation.found[0].status='rejected',
 'manifest swapped after checks':x=>writeFileSync(x.proof,'{}'),
 'unbound manifest source':x=>delete x.scope.qualification_receipt_source,
};
for(const[name,change]of Object.entries(invalid))test('qualification receipt refuses '+name,()=>{const x=f();try{change(x);const before=structuredClone(x.request.context);const out=finalize(x.request,x.result,x.scope.qualification_receipt_source);assert.equal(out.output.qualification_receipt,undefined);assert.deepEqual(x.request.context,before);}finally{x.cleanup();}});
test('mixed matched/rejected DB facts propagate only the actually matched subset',()=>{const x=f();try{const other='7707600173446204000';x.request.context.verification['102'].video_ids.push(other);x.result.output.video_ids.push(other);for(const c of x.result.checks.filter(c=>['persisted_qualification','all_target_videos_resolved'].includes(c.id))){c.evidence[0].observation.requested.push(other);c.evidence[0].observation.found.push({video_id:other,status:'rejected',process_status:'fixture'});}const out=finalize(x.request,x.result,x.scope.qualification_receipt_source);assert.deepEqual(out.output.qualification_receipt.matched_video_ids,['7707600173446204723']);assert.equal(out.output.qualification_receipt.originals.length,1);}finally{x.cleanup();}});
test('receipt carries six verified facts and indexed original SHA without rewriting frozen coverage',()=>{const x=f();try{const original=structuredClone(x.request.context);const out=finalize(x.request,x.result,x.scope.qualification_receipt_source),r=out.output.qualification_receipt;assert.equal(r.schema,'qualification-acceptance/v1');assert.deepEqual(r.identity,x.result.identity);assert.equal(Object.hasOwn(r,'nonce'),false);assert.equal(out.nonce,x.request.nonce);assert.equal(r.checks.length,6);assert.ok(r.originals[0].assets.length>0);assert.ok(r.originals[0].assets.every(a=>/^[a-f0-9]{64}$/.test(a.sha256)));assert.deepEqual(x.request.context,original);}finally{x.cleanup();}});
test('formal helper strips stale passing receipts from rejected final facts',async()=>{const {attachQualificationReceipt}=await import('../qualification-handoff.mjs');const x=f();try{x.result.output.qualification_receipt={status:'passed'};x.result.outcome='blocked';const out=attachQualificationReceipt(x.request,x.result,{proofManifest:x.scope.qualification_receipt_source});assert.equal(out.output.qualification_receipt,undefined);assert.equal(out.outcome,'blocked');}finally{x.cleanup();}});
test('candidate adapter and permanent actual extraction match exact recorded hashes',()=>{const meta=JSON.parse(readFileSync(new URL('provenance.json',fixture)));assert.equal(hash(readFileSync(new URL('readback-handoff.mjs',fixture))),meta.fixture_sha256);if(!process.env.QUALIFICATION_HANDOFF_ADAPTER)return;const source=readFileSync(process.env.QUALIFICATION_HANDOFF_ADAPTER,'utf8');assert.equal(hash(source),meta.candidate_adapter_sha256);const ef=source.slice(source.indexOf('function evidenceFor('),source.indexOf('export async function main('));const tail=source.slice(source.indexOf('  result.checks=[...checks.values()];'),source.indexOf('\n}\nif(process.argv[1]')).replaceAll('qualificationReceiptSource','proofManifest');const expected="import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';\nimport {attachQualificationReceipt} from '../../../qualification-handoff.mjs';\nconst hash=b=>crypto.createHash('sha256').update(b).digest('hex');\nexport "+ef+"\nexport function finalize(request,result,proofManifest){const checks=new Map(result.checks.map(c=>[c.id,c]));\n"+tail+"\n}\n";assert.equal(expected,readFileSync(new URL('readback-handoff.mjs',fixture),'utf8'));assert.ok(source.includes("if(activity==='qualification')qualificationReceiptSource=scope.qualification_receipt_source;"));});

test('formal helper rejects nonpassing final outcomes even with otherwise complete facts',async()=>{const {attachQualificationReceipt}=await import('../qualification-handoff.mjs');for(const outcome of ['blocked','empty','unknown']){const x=f();try{x.result.outcome=outcome;assert.equal(attachQualificationReceipt(x.request,x.result,{proofManifest:x.scope.qualification_receipt_source}).output.qualification_receipt,undefined);}finally{x.cleanup();}}});
for(const [name,change]of Object.entries({
 'empty factual observation':x=>x.result.checks[0].evidence[0].observation={},
 'untrusted PG source':x=>x.result.checks.find(c=>c.id==='persisted_qualification').evidence[0].source='agent:proposal',
 'wrong captured source hash':x=>x.scope.qualification_receipt_source.sha256='f'.repeat(64),
 'foreign host proof identity':x=>{const m=JSON.parse(readFileSync(x.proof));m.identity.run_id='foreign';writeFileSync(x.proof,JSON.stringify(m));x.scope.qualification_receipt_source.sha256=hash(readFileSync(x.proof));},
 'missing matched originals':x=>{const m=JSON.parse(readFileSync(x.proof));m.qualification_evidence={};writeFileSync(x.proof,JSON.stringify(m));x.scope.qualification_receipt_source.sha256=hash(readFileSync(x.proof));},
 'invalid original SHA':x=>{const m=JSON.parse(readFileSync(x.proof)),spec=m.qualification_evidence[x.result.output.video_ids[0]];spec.wav.sha256='invalid';writeFileSync(x.proof,JSON.stringify(m));x.scope.qualification_receipt_source.sha256=hash(readFileSync(x.proof));},
}))test('source-bound handoff rejects '+name,()=>{const x=f();try{change(x);assert.equal(finalize(x.request,x.result,x.scope.qualification_receipt_source).output.qualification_receipt,undefined);}finally{x.cleanup();}});
