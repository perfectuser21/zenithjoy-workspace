import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {stageCandidate} from '../deployment-candidate.mjs';
import {digest} from '../runtime-definition.mjs';
const c=JSON.parse(readFileSync(process.argv[2])),observations=new Map();
for(const r of Object.values(c.plan.releases))r.manifest_sha256=digest({environment:r.environment,target:r.target,payload:r.payload});
const request=async(url,body)=>{
 const path=new URL(url).pathname,id=path.split('/')[4],r=Object.values(c.plan.releases).find(r=>r.id===id);
 if(body){
  if(c.mode==='ack-fail')throw Error('fixture ACK unavailable');
  const o={id:'obs-'+r.target,release_id:r.id,payload:body};observations.set(id,o);
  appendFileSync(join(c.top,'brain.jsonl'),JSON.stringify({path,body})+'\n');return {observation:o};
 }
 if(path.endsWith('/gate'))return {deployed:true,actual_matches:true,current_observation_id:observations.get(id)?.id};
 if(path.includes('/observations/'))return {observation:observations.get(id)};
 return {release:r};
};
try{const result=await stageCandidate({root:c.source,sha:c.sha,plan:c.plan,attemptKey:'fixture-attempt',request,brainUrl:'http://fixture.invalid'});console.log(JSON.stringify({ok:true,result}));}
catch(e){console.log(JSON.stringify({ok:false,error:e.message,stderr:e.stderr?.toString()}));}
