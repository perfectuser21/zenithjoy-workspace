import {readFileSync,realpathSync} from 'node:fs';
import {join,dirname,basename} from 'node:path';
import {readFrozen} from './runtime-definition.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const fail=()=>{throw Error('PUBLIC_DOMAIN_UPSTREAM_UNVERIFIED');};
export function validatePublicUpstreamReceipt(value,ref){
 const r=value?.receipt,c=value?.central_run;
 if(value?.authenticated!==true||r?.run_id!==ref.run_id||r.task_id!==ref.task_id||r.profile_sha256!==ref.profile_sha256||r.status!=='completed'||r.execution_unknown===true
  ||c?.status!=='success'||c.recording_status!=='confirmed'||r.validation?.workflow?.verdict!=='pass'||r.validation?.cleanup?.verdict!=='pass'||r.validation?.activities?.collect_videos?.verdict!=='pass')fail();
 return r;
}
export async function readPublicDomainUpstream({env,current}){
 const ref=current.public_domain?.upstream;
 if(!ref||![ref.run_id,ref.task_id].every(v=>UUID.test(v||''))||!/^[a-f0-9]{64}$/.test(ref.profile_sha256||'')||ref.run_id===current.public_domain.run_id||ref.task_id===current.public_domain.task_id)fail();
 const path=realpathSync(ref.run_directory||'');
 if(path!==ref.run_directory||basename(path)!==ref.run_id||dirname(path)!==dirname(realpathSync(env.WFR_RUN_DIR)))fail();
 const upstream=readFrozen(path),p=upstream.public_domain;
 if(!p||p.run_id!==ref.run_id||p.task_id!==ref.task_id||p.profile_sha256!==ref.profile_sha256||upstream.run_identity?.tag!==env.LEADGEN_SOURCE_RUN||upstream.run_identity?.capability!=='douyin_video_discovery')fail();
 const final=JSON.parse(readFileSync(join(path,'public-result-workflow.json'),'utf8'));
 if(final.run_id!==ref.run_id||final.task_id!==ref.task_id||final.status!=='validated'||final.execution_stopped!==true||final.profile_sha256!==ref.profile_sha256)fail();
 if(!env.BRAIN_URL||!env.BRAIN_INTERNAL_TOKEN)fail();
 const url=new URL(`/api/brain/common-runner/${ref.run_id}/inspect`,env.BRAIN_URL);
 const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+env.BRAIN_INTERNAL_TOKEN},body:JSON.stringify({task_id:ref.task_id}),redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok)fail();validatePublicUpstreamReceipt(await response.json(),ref);
 return {upstreamDir:path,upstream,final};
}
