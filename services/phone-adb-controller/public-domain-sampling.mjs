import {readFileSync,realpathSync} from 'node:fs';
import {join,dirname,basename} from 'node:path';
import {readFrozen} from './runtime-definition.mjs';
import {hash} from './public-domain-snapshot.mjs';
import {verifyPublicDomainTask} from './public-domain-pg.mjs';
const branded=new WeakMap();
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const fail=()=>{throw Error('PUBLIC_DOMAIN_SAMPLING_UNVERIFIED');};
export function validatePublicSamplingEvidence({current,upstream,final,central,sourceRun,lineKey}){
 const ref=current.public_domain?.upstream,p=upstream?.public_domain,r=central?.receipt,v=r?.validation,sample=upstream?.sampling_input;
 if(!current.public_domain?.company||!p?.company)fail();
 if(!ref||![ref.run_id,ref.task_id,p?.run_binding?.run_binding_id].every(x=>UUID.test(x||''))||p.run_id!==ref.run_id||p.task_id!==ref.task_id||p.profile_sha256!==ref.profile_sha256
  ||upstream.run_identity?.capability!=='douyin_video_processing'||upstream.run_identity.tag!==sourceRun||upstream.deployment?.source_commit!==current.deployment?.source_commit
  ||hash(current.public_domain.company)!==hash(p.company)||final?.status!=='validated'||final.execution_stopped!==true||final.run_id!==ref.run_id||final.task_id!==ref.task_id
  ||final.profile_sha256!==ref.profile_sha256||final.source_commit!==upstream.deployment.source_commit||central?.authenticated!==true||r?.run_id!==ref.run_id||r.task_id!==ref.task_id||r.profile_sha256!==ref.profile_sha256
  ||r.status!=='completed'||r.execution_unknown===true||central.central_run?.status!=='success'||central.central_run.recording_status!=='confirmed'
  ||v?.workflow?.verdict!=='pass'||v.cleanup?.verdict!=='pass'||v.activities?.qualification?.verdict!=='pass'||v.activities?.collection?.verdict!=='pass')fail();
 if(!sample||sample.workflow_key!=='douyin_video_processing'||sample.run_tag!==sourceRun||sample.profile!==upstream.run_identity.profile||sample.serial!==upstream.run_identity.serial
  ||sample.line!==lineKey||!sample.source_run||!Number.isSafeInteger(sample.comment_limit)||sample.comment_limit<1||sample.comment_limit>50||hash(sample)!==hash(final.sampling_input))fail();
 const a=final.sampling_admission_v1,q=final.qualification_identity_v1;
 if(!a||!q||!v.activities.collection.sampling_admission_v1||!v.activities.qualification.qualification_identity_v1||hash(a)!==hash(v.activities.collection.sampling_admission_v1)||hash(q)!==hash(v.activities.qualification.qualification_identity_v1))fail();
 for(const x of [a,q])if(x.run_id!==ref.run_id||x.run_binding_id!==p.run_binding.run_binding_id||x.source_commit!==upstream.deployment.source_commit||x.source_run!==sample.source_run||x.line!==lineKey)fail();
 if(a.comment_limit!==sample.comment_limit||!Array.isArray(a.videos)||!a.videos.length||!Array.isArray(q.videos)||q.videos.length!==a.videos.length)fail();
 const ids=[];
 for(const x of a.videos){
  if(!Array.isArray(x.comment_ids)||x.comment_ids.some(id=>!UUID.test(id))||x.comment_ids.length!==x.coverage||x.coverage>sample.comment_limit||x.stop_reason==='quota_reached'&&x.coverage!==sample.comment_limit||!/^[a-f0-9]{64}$/.test(x.pg_rows_sha256||''))fail();
  const matches=q.videos.filter(y=>y.video_id===x.video_id);if(matches.length!==1||!x.qualification||['mode','prior_judgment_run','identity_verified','identity_sha256'].some(k=>matches[0][k]!==x.qualification[k])||x.qualification.identity_verified!==true)fail();ids.push(...x.comment_ids);
 }
 if(new Set(ids).size!==ids.length)fail();
 return {protocol:'canonical-public-sampling/v1',run_id:ref.run_id,binding_id:p.run_binding.run_binding_id,source_run:sample.source_run,source_commit:upstream.deployment.source_commit,
  sampling_input:structuredClone(sample),sampling_admission_v1:structuredClone(a),qualification_identity_v1:structuredClone(q),qualification_verified:true};
}
export function isPublicSamplingProof(proof,scope){const b=proof&&branded.get(proof);return Boolean(b&&hash(proof)===b.digest&&Date.now()<b.deadline_ms&&(!scope||['lineKey','run','sourceRun','sourceCommit'].every(k=>scope[k]===b[k])));}
export async function readPublicDomainSamplingProof({runtimeRoot,env=process.env,sourceRun,lineKey}){
 const dir=dirname(runtimeRoot),current=readFrozen(dir),ref=current.public_domain?.upstream;
 if(current.workflow_version?.payload?.key!=='douyin_comment_scoring'||env.LEADGEN_SOURCE_RUN!==sourceRun||!ref)fail();
 await verifyPublicDomainTask({runtimeRoot,env});
 const upstreamDir=realpathSync(ref.run_directory||'');
 if(upstreamDir!==ref.run_directory||basename(upstreamDir)!==ref.run_id||dirname(upstreamDir)!==dirname(realpathSync(dir)))fail();
 const upstream=readFrozen(upstreamDir),final=JSON.parse(readFileSync(join(upstreamDir,'public-result-workflow.json'),'utf8'));
 const response=await fetch(new URL(`/api/brain/common-runner/${encodeURIComponent(ref.run_id)}/inspect`,env.BRAIN_URL),{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+env.BRAIN_INTERNAL_TOKEN},body:JSON.stringify({task_id:ref.task_id}),redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok)fail();
 const proof=Object.freeze(validatePublicSamplingEvidence({current,upstream,final,central:await response.json(),sourceRun,lineKey}));
 branded.set(proof,{digest:hash(proof),deadline_ms:current.public_domain.deadline_ms,lineKey,run:env.WFR_TAG,sourceRun,sourceCommit:current.deployment.source_commit});return proof;
}
