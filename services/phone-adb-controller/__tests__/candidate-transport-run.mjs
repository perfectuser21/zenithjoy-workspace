import {readFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {stageCandidate} from '../deployment-candidate.mjs';
import {digest} from '../runtime-definition.mjs';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
const c=JSON.parse(readFileSync(process.argv[2])),observations=new Map();
const receiveProgress=c.mode.startsWith('install-progress-');
const originalExec=childProcess.execFileSync,originalAsyncExec=childProcess.execFile,originalTimeout=global.setTimeout;
if(receiveProgress){
 global.setTimeout=(callback,ms,...args)=>originalTimeout(callback,ms===90000?1000:ms,...args);
 childProcess.execFile=(file,args,options,callback)=>originalAsyncExec(file,args,{...options,timeout:options.timeout===720000?3500:options.timeout},callback);
}
childProcess.execFileSync=(file,args,options)=>{
 if(file==='ssh')appendFileSync(join(c.top,'ssh-options.jsonl'),JSON.stringify({host:args.at(-2),install:args.at(-1).includes("' install "),timeout:options?.timeout,input_bytes:options?.input?.length})+'\n');
 if(receiveProgress&&file==='ssh'&&args.at(-2)==='xian-m4'&&args.at(-1).includes("' install "))options={...options,timeout:1300};
 return originalExec(file,args,options);
};
syncBuiltinESMExports();
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
try{const result=await stageCandidate({root:c.source,sha:c.sha,plan:c.plan,attemptKey:'fixture-attempt',request,brainUrl:'http://fixture.invalid',progressiveXianInstall:receiveProgress});console.log(JSON.stringify({ok:true,result}));}
catch(e){console.log(JSON.stringify({ok:false,error:e.message,stderr:e.stderr?.toString()}));}
