// Parent-owned in-process facade; the public subprocess RPC remains closed to Skills.
import {realpathSync,readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical,readFrozen,frozenExecutionMode} from './runtime-definition.mjs';
import {publicDomainAuthority} from './public-domain-authority.mjs';
import {verifySkillRequest,runSkillAgent,skillAuthority,stopSkillAgent} from './leadgen-skill-agent.mjs';
const root=dirname(fileURLToPath(import.meta.url));
function methodHost(text){
 const front=text?.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1]||'';
 const metadata=front.match(/^metadata:\n((?:[ \t]+[^\n]*(?:\n|$))*)/m)?.[1]||'';
 const hosts=[...metadata.matchAll(/^  primary_hosts:([^\n]*)$/gm)];
 if((front.match(/^metadata:$/gm)||[]).length!==1||hosts.length!==1)return false;
 const inline=hosts[0][1].trim();let values=[];
 if(/^\[[a-z0-9., -]+\]$/.test(inline))values=inline.slice(1,-1).split(',').map(v=>v.trim());
 else if(inline===''){const block=metadata.slice(hosts[0].index+hosts[0][0].length).match(/^\n((?:    - [a-z0-9][a-z0-9.-]* *(?:\n|$))+)/)?.[1];if(block)values=block.trimEnd().split('\n').map(line=>line.slice(6).trim());}
 return new Set(values).size===values.length&&values.includes('official-child-v1');
}
function hostSupport(q,fixed){
 const name='skills/leadgen-official-child-host.md',value=q.method?.host_support;
 return value&&Object.keys(value).sort().join(',')==='sha256,text'&&typeof value.text==='string'
  &&fixed.files['runtime/'+name]===value.sha256&&readFileSync(join(root,name),'utf8')===value.text;
}
const kinds=new Set(['activity_skill','activity_skill_authority','activity_skill_stop']);
const fail=()=>{throw Object.assign(Error('PUBLIC_OFFICIAL_CHILD_SCOPE'),{executionStopped:false});};
export function createPublicOfficialChildRpc({runDir,frozen,baseRpc,get,agentOptions={}}={}){
 if(typeof runDir!=='string'||typeof baseRpc!=='function'||realpathSync(join(runDir,'runtime'))!==realpathSync(root))fail();
 const dir=realpathSync(runDir),fixed=structuredClone(frozen),requests=new Map();
 function local(q){
  const actual=readFrozen(dir),a=publicDomainAuthority(dir);
  if(!['official-child-host.mjs','leadgen-skill-agent.mjs','runtime-definition.mjs','public-domain-authority.mjs','skill-public-authority.mjs'].every(name=>typeof actual.files?.['runtime/'+name]==='string'))fail();
  if(!a||fixed.primary_host!=='official-child-v1'||frozenExecutionMode(fixed)!=='agent'||Object.hasOwn(fixed,'execution_transport')||Object.hasOwn(fixed,'max_turns')
   ||canonical(actual)!==canonical(fixed)||actual.snapshot_sha256!==a.snapshot_authority?.local_snapshot_sha256)fail();
  if(q){
   if(q.primary_host!=='official-child-v1'||!hostSupport(q,fixed)||q.mode!=='execute'||q.execution_transport!==undefined||q.max_turns!==undefined||q.transport_generation!==undefined||!methodHost(q.method?.text)||q.broker_host!=='mmv'
    ||q.run_id!==a.identity.run_id||q.task_id!==a.identity.task_id||q.source_commit!==fixed.deployment.source_commit
    ||q.broker_tool_path!==join(dir,'runtime','activity-skill-tool.mjs')||q.broker_request_path!==join(dir,'skill-primary',q.activity_key,'broker-request.json'))fail();
   const saved=requests.get(q.activity_key);if(saved&&saved!==canonical(q))fail();
  }
 }
 local();
 const authorize=async q=>{local(q);await verifySkillRequest(q,{...(get?{get}:{}),publicRunDirectory:dir});local(q);return true;};
 return async(body,options)=>{
  if(!kinds.has(body?.kind))return baseRpc(body,options);
  if(Object.keys(body).sort().join(',')!=='kind,request')fail();
  const q=structuredClone(body.request);local(q);
  requests.set(q.activity_key,canonical(q));
  if(body.kind==='activity_skill_authority'){
   await authorize(q);return {ok:true,authorized:skillAuthority(q,agentOptions)};
  }
  let result;
  if(body.kind==='activity_skill'){
   result=await runSkillAgent(q,{...agentOptions,beforeLaunch:()=>authorize(q)});
  }else{
   await authorize(q);result=await stopSkillAgent(q,agentOptions);
  }
  try{await authorize(q);}catch{throw Object.assign(Error('PUBLIC_OFFICIAL_CHILD_AUTHORITY_REVOKED'),{executionStopped:false});}
  return {ok:true,result};
 };
}
