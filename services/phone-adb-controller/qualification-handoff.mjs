// Host checker facts only. This receipt never changes frozen execution input.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const required=['native_video_identity','company_policy_identity','capture_or_valid_cache','asr_error_classification','persisted_qualification','all_target_videos_resolved'];
const identityKeys=['task_id','run_id','run_tag','workflow','activity','attempt'];
const need=x=>{if(!x)throw Error('QUALIFICATION_HANDOFF_UNVERIFIED');};
const exact=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&new Set(a).size===a.length&&a.every(x=>b.includes(x));
function originals(spec){
 const found=[];
 function visit(x){
  if(!x||typeof x!=='object')return;
  if(Object.hasOwn(x,'path')){need(typeof x.path==='string'&&path.isAbsolute(x.path)&&/^[a-f0-9]{64}$/.test(x.sha256||''));found.push({path:x.path,sha256:x.sha256});}
  for(const v of Object.values(x))visit(v);
 }
 visit(spec);need(found.length>0);
 const byPath=new Map();for(const item of found){need(!byPath.has(item.path)||byPath.get(item.path).sha256===item.sha256);byPath.set(item.path,item);}
 return [...byPath.values()].sort((a,b)=>a.path.localeCompare(b.path));
}
export function attachQualificationReceipt(request,result,{proofManifest}={}){
 const out=structuredClone(result);if(out.output)delete out.output.qualification_receipt;
 try{
  need(request.phase==='end'&&request.workflow==='102'&&request.activity==='qualification');
  need(identityKeys.slice(0,-1).every(k=>typeof request[k]==='string'&&request[k].length>0));
  need(Number.isSafeInteger(request.attempt)&&request.attempt>0&&typeof request.nonce==='string'&&request.nonce.length>0);
  need(identityKeys.every(k=>result.identity?.[k]===request[k])&&result.nonce===request.nonce);
  need(exact(request.checks,required)&&Array.isArray(result.checks)&&exact(result.checks.map(x=>x.id),required));
  need(result.outcome==='passed'&&result.checks.every(c=>c.status==='passed'&&Array.isArray(c.evidence)&&c.evidence.length>0&&c.evidence.every(e=>typeof e.source==='string'&&e.source&&e.observation&&typeof e.observation==='object'&&Object.keys(e.observation).length>0)));
  const target=request.context?.verification?.['102']?.video_ids;
  need(Array.isArray(target)&&target.length>0&&target.every(x=>typeof x==='string'&&/^\d{16,24}$/.test(x))&&exact(target,target));
  need(exact(result.output?.video_ids,target)&&result.output.read_only===true&&result.output.model_call_count===0&&result.output.no_collectable_videos===false&&Array.isArray(result.output.unresolved_video_ids)&&result.output.unresolved_video_ids.length===0);
  const db=result.checks.find(c=>c.id==='persisted_qualification').evidence;
  need(db.length===1&&db[0].source==='postgres:zenithjoy/leadgen_videos');
  const summary=db[0].observation;need(exact(summary.requested,target)&&Array.isArray(summary.found)&&exact(summary.found.map(x=>x.video_id),target)&&summary.found.every(x=>['matched','rejected'].includes(x.status)));
  const matched=summary.found.filter(x=>x.status==='matched').map(x=>x.video_id);need(matched.length>0);
  need(proofManifest&&path.isAbsolute(proofManifest.path)&&/^[a-f0-9]{64}$/.test(proofManifest.sha256||'')&&!fs.lstatSync(proofManifest.path).isSymbolicLink()&&fs.statSync(proofManifest.path).isFile());
  const raw=fs.readFileSync(proofManifest.path);need(sha(raw)===proofManifest.sha256);
  const manifest=JSON.parse(raw);need(manifest.schema==='activity-evidence/v1'&&['task_id','run_id','run_tag','workflow'].every(k=>manifest.identity?.[k]===request[k]));
  const index=matched.map(video_id=>{const spec=manifest.qualification_evidence?.[video_id];need(spec?.video_id===video_id&&typeof spec.expected_run==='string'&&spec.expected_run&&typeof spec.evidence_id==='string'&&spec.evidence_id);return {video_id,producer_run_tag:spec.expected_run,evidence_id:spec.evidence_id,assets:originals(spec)};});
  out.output.qualification_receipt={schema:'qualification-acceptance/v1',status:'passed',identity:structuredClone(result.identity),target_video_ids:[...target],matched_video_ids:matched,checks:structuredClone(result.checks),proof_manifest:{path:proofManifest.path,sha256:proofManifest.sha256},originals:index};
 }catch{/* Invalid, failed or missing facts never create a passing handoff. */}
 return out;
}
