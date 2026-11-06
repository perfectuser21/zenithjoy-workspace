import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import YAML from 'yaml';
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const sha=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:canonical(value)).digest('hex');

// All three slots use distributed, hashed Skill bytes. The task lease below is
// issued through actual HTTP heartbeat/readback, never Worker JSON.
export async function freezePublicPhoneDefinition(t,f,{env,manifest,extraFrozen={},activityBudgetS=180}){
 const load=name=>import(pathToFileURL(join(f.runtimeRoot,name))),definitions=await load('runtime-definition.mjs'),lease=await load('native-task-lease.mjs');
 assert.equal(manifest.source_commit,f.source.commit);assert.equal(manifest.target,'mmv');
 const input=definitions.agentInput(env),discovery=definitions.discoveryInput(env),task=f.routes.get('/api/brain/tasks/'+input.task_id);
 task.claimed_at=new Date().toISOString();Object.assign(task.payload,{workflow_key:input.workflow_key,run_tag:input.run_tag,profile:input.profile,device_serial:input.serial,company_line:input.line,source_commit:manifest.source_commit,scope:{source_run:null,limit:input.limit,send:0,run_max_seconds:input.run_max_seconds,execution_transport:input.execution_transport,max_turns:input.max_turns}});
 const binding=f.routes.get('/api/brain/runs/'+f.q.run_id+'/definition').binding,wf=f.routes.get('/api/brain/workflows/w1/versions/wv1').version;
 wf.id='wv1';wf.source_commit=manifest.source_commit;wf.payload.workflow_id='w1';wf.payload.activities=[];
 wf.payload.contract=YAML.parse(readFileSync(new URL('../../../../product-map/contracts/douyin_video_discovery.yaml',import.meta.url),'utf8'));
 const activities=[];
 for(const[key,index]of [['preflight',1],['collect_videos',2],['cleanup',3]]){
  const method=key==='collect_videos'?'douyin-leadgen-activity-101-collect-videos':'douyin-leadgen-activity-102-'+key,text=readFileSync(join(f.runtimeRoot,'skills',method,'SKILL.md'),'utf8'),contract={budget:{max_duration_s:typeof activityBudgetS==='number'?activityBudgetS:activityBudgetS[key]}},version={id:'av'+index,source_commit:manifest.source_commit,contract_sha256:sha(contract),payload:{activity_id:'a'+index,definition_key:(key==='collect_videos'?'douyin_video_discovery.':'douyin_video_processing.')+key,contract,implementation_bindings:[{kind:'skill',status:'verified',repo:manifest.source_repo,revision:manifest.source_commit,name:method,version:text.match(/^  version: (\S+)$/m)[1],content_sha256:sha(text),path:'services/phone-adb-controller/skills/'+method+'/SKILL.md'}]}};
  const reference={slot_key:key,sequence_no:index,reference_id:'ref'+index,activity_id:'a'+index,activity_version_id:version.id};wf.payload.activities.push(reference);activities.push({reference,version});f.routes.set(`/api/brain/activities/a${index}/versions/av${index}`,{version});
 }
 const body={schema_version:2,execution_mode:'agent',execution_transport:'raw-model-v1',max_turns:input.max_turns,agent_input:input,discovery_input:discovery,native_claim:{claimed_by:task.claimed_by,claimed_at:task.claimed_at},deployment:{...manifest,observation_id:'o1'},release:{id:'r1',target:'mmv'},workflow_version:wf,activities,files:Object.fromEntries(manifest.files.map(row=>['runtime/'+row.deployed_path,row.content_sha256])),...extraFrozen};
 const sockets=new Set(),leaseRequests=[],server=createServer(async(request,response)=>{
  leaseRequests.push({method:request.method,path:request.url});response.setHeader('Connection','close');
  assert.equal(request.headers.authorization,'Bearer fixture-phone-lease');
  if(request.method==='GET'){assert.equal(request.url,'/api/brain/tasks/'+task.id);response.end(JSON.stringify({task}));return;}
  assert.equal(request.method,'POST');assert.equal(request.url,'/api/brain/tasks/'+task.id+'/heartbeat');let raw='';for await(const bytes of request)raw+=bytes;const posted=JSON.parse(raw);assert.equal(posted.claimer,task.claimed_by);
  response.end(JSON.stringify({ok:true,lease_until:new Date(Date.now()+posted.lease_seconds*1000).toISOString(),lease_seconds:posted.lease_seconds,heartbeat_count:1}));
 });server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));});
 const end=(input.run_start_ts+input.run_max_seconds)*1000,leaseBinding={task_id:task.id,source_commit:manifest.source_commit,run_tag:input.run_tag,claim:body.native_claim,snapshot_sha256:sha(body),scope_sha256:sha(input),worker_deadline_ms:end,receipt_deadline_ms:end};
 const cap=await lease.issueNativeTaskLease({directory:join(f.journalDirectory,'actual-phone-lease'),origin:'http://127.0.0.1:'+server.address().port,credential:()=> 'fixture-phone-lease',binding:leaseBinding,readClaim:reply=>definitions.nativeClaimFromTask({task:reply.task,input,sourceCommit:manifest.source_commit})});body.native_task_lease=lease.consumeNativeTaskLease(cap,leaseBinding);
 const frozen={...body,snapshot_sha256:sha(body)};binding.runtime_snapshot_sha256=frozen.snapshot_sha256;
 const runDir=env.WFR_RUN_DIR;writeFileSync(join(runDir,'run-definition.json'),JSON.stringify(frozen),{mode:0o600});
 const record={run_id:binding.run_id,runtime_snapshot_sha256:frozen.snapshot_sha256,body:{actor:definitions.executionActor(frozen)}};mkdirSync(join(runDir,'run-bindings'),{mode:0o700});writeFileSync(join(runDir,'run-bindings/a1.request.json'),JSON.stringify(record),{mode:0o600});writeFileSync(join(runDir,'run-bindings/a1.ack.json'),JSON.stringify({binding}),{mode:0o600});
 assert.equal((await load('runtime-binding.mjs')).readBinding(runDir,'a1',frozen).id,binding.id);
 return {frozen,binding,task,activities:activities.map(item=>({...item.version.payload.contract,key:item.reference.slot_key})),leaseRequests};
}
