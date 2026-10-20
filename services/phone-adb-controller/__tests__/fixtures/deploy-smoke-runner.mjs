// required smoke用真实HTTP预检；SSH/scp仍由外层临时桩记录，绝不接触设备。
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {resolve,join,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {commanderMap,bindingComponents} from '../../deployment-targets.mjs';
import {digest} from '../../runtime-definition.mjs';
import {normalizedDescriptions} from './normalized-description-bindings.mjs';
const deploy=resolve(process.argv[2]),root=execFileSync('git',['-C',resolve(deploy,'..'),'rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();
const sha=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
const repo='perfectuser21/zenithjoy-workspace',path='services/phone-adb-controller/douyin-phone-adb';
const activity='33333333-3333-4333-8333-333333333333',av='44444444-4444-4444-8444-444444444444';
const ids={'xian-m4':'55555555-5555-4555-8555-555555555555','mmv':'77777777-7777-4777-8777-777777777777'};
const component={kind:'code',repo,path,revision:sha,digest:'sha256:'+digest(readFileSync(join(root,path)))};
const row=(id,payload,extra)=>({id,...extra,source_repo:repo,source_path:'fixture-only.json',source_commit:sha,payload,payload_sha256:digest({source:{repo,path:'fixture-only.json',commit:sha},payload})});
const workflowKeys=['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring','douyin_lead_outreach'];
const definitions={workflows:[101,102,103,104].map((n,i)=>{const id=`b1000000-0000-4000-8000-${String(n).padStart(12,'0')}`;return row(id,{workflow_id:id,key:workflowKeys[i],activities:[{activity_id:activity,activity_version_id:av}]},{workflow_id:id});}),activities:[row(av,{activity_id:activity,steps:[],implementation_bindings:[{...component,scope:'activity',status:'verified'},...normalizedDescriptions]},{activity_id:activity})]};
const extra=['workflow_report.internal','workflow_commander.internal','douyin_video_publish.android'].map((key,i)=>{const id=`00000000-0000-4000-8000-${String(i+900).padStart(12,'0')}`;return row(id,{workflow_id:id,key,activities:[{activity_id:activity,activity_version_id:av}]},{workflow_id:id});});
const releases=Object.fromEntries(Object.entries(ids).map(([target,id])=>{const selected={...definitions,workflows:[...definitions.workflows,...(target==='mmv'?extra:[])]};const payload={...selected,components:bindingComponents(selected,sha),verification:{status:'verified'}};const release={id,target,environment:'production',payload};release.manifest_sha256=digest({environment:release.environment,target,payload});return [id,release];}));
// 仅此本地HTTP测试服务模拟候选业务回执；生产代码仍执行完整原始准入。
// 公司readiness测试必须先通过上一层闸，不能因新增闸缺fixture而死在无关位置。
const responses=new Map(Object.values(releases).map(release=>['/api/brain/releases/'+release.id,{release}]));
const businessRunIds=[],runtimeHash=digest({fixture:'paired-deploy-runtime',sha});
for(const production of Object.values(releases)){
 const release={...production,id:production.id.replace(/^./,'8'),environment:`staging:${sha}`};
 release.manifest_sha256=digest({environment:release.environment,target:release.target,payload:release.payload});
 const observation='fixture-observation-'+release.target;
 responses.set('/api/brain/releases/'+release.id,{release});
 responses.set('/api/brain/releases/'+release.id+'/gate',{release_id:release.id,deployed:true,actual_matches:true,current_observation_id:observation});
 for(const workflow of release.payload.workflows){
  const key=workflow.payload.key;
  if(key==='workflow_commander.internal')continue;
  const target=key==='douyin_comment_scoring'||key==='workflow_report.internal'||key==='douyin_video_publish.android'?'mmv':'xian-m4';
  if(target!==release.target)continue;
  const runId='fixture-business-'+key,binding={id:'fixture-binding-'+key,run_id:runId,release_id:release.id,workflow_definition_version_id:workflow.id,workflow_id:workflow.workflow_id,snapshot_sha256:workflow.payload_sha256,observation_id:observation,runtime_snapshot_sha256:runtimeHash};
  const taskId='fixture-task-'+key;
  businessRunIds.push(runId);
  responses.set('/api/brain/runs/'+runId+'/definition',{binding});
  responses.set('/api/brain/runs/'+runId+'/reconciliation',{run_id:runId,run_binding_id:binding.id,release_id:release.id,business_outcome:process.env.PAIR_BUSINESS_ADMISSION_MODE==='failed'?'fail':'pass',evidence_status:'verified',gaps:[],missing:[],unexpected:[],expected_count:1,span_count:1,links:{task_id:taskId},task_run:{status:'success'}});
  responses.set('/api/brain/runs/'+runId+'?include=spans',{spans:[{run_binding_id:binding.id,evidence:{runtime_snapshot_sha256:runtimeHash}}]});
  responses.set('/api/brain/tasks/'+taskId,{id:taskId,status:'completed',result:{workflow_control:{phase:'final',envelope:{definition:{release_id:release.id,runtime_snapshot_sha256:runtimeHash}},verification:{task_id:taskId,run_id:runId,definition_sha256:workflow.payload_sha256,verdict:'PASS',assertions:[{name:'cleanup',pass:true}],evidence:['fixture://independent-readback/'+runId]}}}});
 }
}
const server=createServer((req,res)=>{
 const response=responses.get(req.url);
 if(req.method!=='GET'||req.headers.authorization!=='Bearer fixture-deploy-only'||!response){res.writeHead(404);res.end('{}');return;}
 res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(response));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const folder=mkdtempSync(join(tmpdir(),'deploy-smoke-plan-'));const plan={source_repo:repo,source_commit:sha,release_ids:ids,releases:Object.fromEntries(Object.entries(ids).map(([host,id])=>[host,releases[id]])),commander_releases:commanderMap(releases[ids.mmv])};
const planFile=join(folder,'plan.json'),mapFile=join(folder,'map.json');writeFileSync(planFile,JSON.stringify(plan));writeFileSync(mapFile,JSON.stringify(plan.commander_releases));
try{const child=spawn('bash',[relative(root,deploy)],{cwd:root,stdio:['ignore','inherit','inherit'],env:{...process.env,WF_DEPLOY_PLAN_FILE:planFile,WF_COMMANDER_RELEASES_FILE:mapFile,WF_RELEASE_IDS:JSON.stringify(ids),WF_BUSINESS_RUN_IDS:JSON.stringify(businessRunIds),WF_DEPLOY_ENVIRONMENT:'production',WF_DEPLOY_COLLECTOR:'fixture',WF_DEPLOY_ATTEMPT_KEY:'smoke',BRAIN_URL:`http://127.0.0.1:${server.address().port}`,BRAIN_INTERNAL_TOKEN:'fixture-deploy-only'}});
 process.exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>resolve(code||0));});
}finally{server.close();rmSync(folder,{recursive:true,force:true});}
