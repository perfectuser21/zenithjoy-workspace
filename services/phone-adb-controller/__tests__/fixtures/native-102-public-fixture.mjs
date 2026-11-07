import {using} from './official-control-fixture.mjs';
import {freezeNative102PublicDefinition} from './native-102-public-definition-fixture.mjs';
import {writeFileSync,readFileSync} from 'node:fs';import {join} from 'node:path';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
const sha=v=>createHash('sha256').update(v).digest('hex');
export async function usingNative102Public(t,fn,{minimalFreeze=true,beforeWorkflowImport}={}){return using(async f=>{
 const oldRun=f.q.run_id,binding=f.routes.get('/api/brain/runs/'+oldRun+'/definition').binding;
 Object.assign(f.q,{workflow_key:'douyin_video_processing',serial:'192.0.2.31:10001',source_run:'public_source101',run_id:'douyin_video_processing-'+f.q.run_tag+'__a1'});binding.run_id=f.q.run_id;f.routes.set('/api/brain/runs/'+f.q.run_id+'/definition',{binding});
 const env={HOME:f.options.home,WFR_RUN_DIR:join(f.runtimeRoot,'..'),WFR_TAG:f.q.run_tag,WFR_RUN_ID:f.q.run_id.replace(/__a1$/,''),WFR_ATTEMPT:'a1',P:f.q.profile,SERIAL:f.q.serial,WFR_HOSTKEY:'mmv',LEADGEN_LINE:f.q.line,LEADGEN_LIMIT:String(f.q.limit),LEADGEN_SOURCE_RUN:f.q.source_run,LEADGEN_COMMENT_LIMIT:'5',WF_BRAIN_WORKFLOW:f.q.workflow_key,WF_BRAIN_TASK_ID:f.q.task_id,WF_RUN_START_TS:String(Math.floor(Date.now()/1000)),WF_RUN_MAX_SECONDS:'1800',LEADGEN_EXECUTION_MODE:'agent',LEADGEN_EXECUTION_TRANSPORT:'raw-model-v1',LEADGEN_MAX_TURNS:'64'};
 const manifest={source_repo:'perfectuser21/zenithjoy-workspace',source_commit:f.source.commit,target:'mmv',files:f.source.files.map(row=>({path:'services/phone-adb-controller/'+row.path,deployed_path:row.path,content_sha256:sha(readFileSync(join(f.runtimeRoot,row.path)))}))};
 writeFileSync(join(f.runtimeRoot,'deployment-manifest.json'),JSON.stringify(manifest));
 await beforeWorkflowImport?.(f);
 const definition=minimalFreeze?await freezeNative102PublicDefinition(t,f,{env,manifest,activityBudgetS:600}):null,workflow=await import(pathToFileURL(join(f.runtimeRoot,'leadgen-workflow.mjs')));
 let outer=0;const handlers=definition?workflow.createWorkflowHandlers({root:f.runtimeRoot,env,frozen:definition.frozen,binding:definition.binding,taskId:f.q.task_id,sourceCommit:f.source.commit,rpc:async()=>{outer++;throw Error('NO_OUTER_RPC');},execute:async()=>{outer++;throw Error('NO_OUTER_EXEC');}}):null;
 return fn({...f,env,definition,workflow,handlers,outerCalls:()=>outer});
 },{rawTransport:true});}
