import {readFileSync,existsSync,realpathSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {readFrozen,canonical,assertExecutionMode} from './runtime-definition.mjs';
import {loadPreflightPg} from './preflight-pg-dependencies.mjs';
import {validatePublicDomainIdentity,publicDomainTaskProjectionMatches} from './public-domain-authority.mjs';
const fail=()=>{throw Error('PUBLIC_DOMAIN_PG_SCOPE');};
export function publicDomainPgRequired(runtimeRoot){const file=join(dirname(runtimeRoot),'run-definition.json');return existsSync(file)&&Boolean(JSON.parse(readFileSync(file,'utf8')).public_domain);}
export async function verifyPublicDomainTask({runtimeRoot,env=process.env}){
 const p=readFrozen(dirname(runtimeRoot)).public_domain;return readPublicDomainClaim({identity:p,env});
}
export async function readPublicDomainClaim({identity:p,env=process.env}){
 const b=p?.run_binding;
 if(!p||!env.BRAIN_URL||!env.BRAIN_INTERNAL_TOKEN)fail();
 const url=new URL(`/api/brain/tasks/${encodeURIComponent(p.task_id)}`,env.BRAIN_URL);
 const readFailure=(phase,cause)=>Object.assign(Error('PUBLIC_DOMAIN_PG_SCOPE'),{code:'PUBLIC_DOMAIN_TASK_GET_'+phase,...(cause?{cause}:{})});
 let response,task;
 try{response=await fetch(url,{headers:{Authorization:'Bearer '+env.BRAIN_INTERNAL_TOKEN},signal:AbortSignal.timeout(10000),redirect:'error'});}
 catch(error){throw readFailure('TRANSPORT',error);}
 if(!response.ok)throw readFailure('HTTP');
 try{task=await response.json();}catch(error){throw readFailure('BODY',error);}
 const projection={identity:p,binding:{id:b.run_binding_id,run_id:p.run_id,task_id:p.task_id,workflow_id:b.workflow_id,workflow_definition_version_id:b.workflow_definition_version_id,attempt_key:b.attempt_key,activities:b.activities}};
 if(!publicDomainTaskProjectionMatches(task,projection))fail();
 return {run_id:p.run_id,task_id:p.task_id,binding_id:b.run_binding_id,claim_verified:true,claim:{claimed_by:task.claimed_by,claimed_at:task.claimed_at}};
}
export async function verifyPublicDomainCompany({runtimeRoot,pool,env=process.env}){
 const p=readFrozen(dirname(runtimeRoot)).public_domain,c=p?.company;
 if(!c)fail();
 const rows=(await pool.query(`SELECT company_id,tenant_id,version,snapshot->>'config_status' AS status,snapshot->'runtime_config'->>'policy_id' AS policy_id
 FROM zenithjoy.company_config_runs WHERE company_id=$1 AND tenant_id=$2 AND run_id=$3`,[c.company_id,c.tenant_id,env.WFR_TAG])).rows;
 const actual=rows.length?rows:(await pool.query(`SELECT company_id,tenant_id,config_version AS version,config_status AS status,runtime_config->>'policy_id' AS policy_id
 FROM zenithjoy.tenant_company_profiles WHERE company_id=$1 AND tenant_id=$2`,[c.company_id,c.tenant_id])).rows;
 if(actual.length!==1||actual[0].company_id!==c.company_id||actual[0].tenant_id!==c.tenant_id||Number(actual[0].version)!==c.version||actual[0].status!=='enabled'||actual[0].policy_id!==c.policy_id)fail();
 return {company_id:c.company_id,tenant_id:c.tenant_id,version:c.version,policy_id:c.policy_id,verified:true};
}
export function loadPublicDomainPg({runtimeRoot,input,env=process.env}){
 if(['NODE_PATH','NODE_OPTIONS','NODE_PG_FORCE_NATIVE'].some(k=>env[k]))fail();
 const dir=env.WFR_RUN_DIR;
 if(!dir||realpathSync(dir)!==dir||realpathSync(runtimeRoot)!==join(dir,'runtime')||env.WF_HOME!==runtimeRoot||!['code','agent'].includes(env.LEADGEN_EXECUTION_MODE))fail();
 const frozen=readFrozen(dir),p=frozen.public_domain,b=p?.run_binding;
 validatePublicDomainIdentity({...p,mode:'formal'});
 if(assertExecutionMode(frozen,env)!==env.LEADGEN_EXECUTION_MODE||p.task_id!==env.WF_BRAIN_TASK_ID||p.run_id!==env.WFR_RUN_ID||env.WFR_ATTEMPT!=='a1'
  ||!Number.isSafeInteger(p.cleanup_deadline_ms)||Date.now()>=p.cleanup_deadline_ms||frozen.run_identity?.run_id!==p.run_id
  ||input?.source?.commit!==frozen.deployment?.source_commit||b.workflow_definition_version_id!==frozen.workflow_version?.id
  ||b.workflow_id!==frozen.workflow_version?.payload?.workflow_id||!['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring'].includes(env.WF_BRAIN_WORKFLOW)
  ||frozen.workflow_version.payload.key!==env.WF_BRAIN_WORKFLOW)fail();
 if(input.source.execution&&canonical(input.source.execution)!==canonical({run:env.WFR_TAG,run_id:p.run_id,profile:env.P,line:env.LEADGEN_LINE}))fail();
 const requestRun=input?.request?.run??input?.run,requestLine=input?.request?.line??input?.line;
 if(requestRun!==undefined&&requestRun!==env.WFR_TAG||requestLine!==undefined&&requestLine!==env.LEADGEN_LINE)fail();
 const {Pool}=loadPreflightPg({runtimeRoot,frozen:{...frozen,preflight_pg:frozen.public_pg}});
 return env.DATABASE_URL?new Pool({connectionString:env.DATABASE_URL}):new Pool({host:env.PGHOST,port:Number(env.PGPORT||5432),user:env.PGUSER,password:env.PGPASSWORD,database:env.PGDATABASE||'zenithjoy'});
}
