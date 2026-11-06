import assert from 'node:assert/strict';
import {createServer,request as requestHttp} from 'node:http';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,realpathSync,cpSync,readdirSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {parse} from 'yaml';
import {RPC_FILES} from '../../leadgen-client.mjs';
import {workflowCommanderSession} from '../../commander-owner-state.mjs';
import {skillRunKey} from '../../leadgen-skill-agent.mjs';
import {canonical} from '../../runtime-definition.mjs';
import {bindNative103TestPython} from '../helpers/native-103-test-python.mjs';

const control=await import('../../official-agent-control.mjs').catch(error=>{
 if(error.code==='ERR_MODULE_NOT_FOUND'&&error.url===new URL('../../official-agent-control.mjs',import.meta.url).href)return {};
 throw error;
});
const root=fileURLToPath(new URL('../../',import.meta.url));
const sha=x=>createHash('sha256').update(x).digest('hex');
const jsonHash=x=>sha(canonical(x));

export async function using(fn,{delay=false,suppressClose=false,shortDeadline=false,gatewayDependencies,gatewayCredential,rawTransport=false,scoring=false,phone=false,controlAcceptance=false,terminalPolicy}={}){
 assert.equal(typeof control.createOfficialAgentControl,'function','正式authority需要不fork外层Node/SSH的Code-owned入口');
 const copied=mkdtempSync(join(resolve(root,'../..'),'.official-control-fixture-')),runtimeRoot=join(copied,'runtime');
 cpSync(root,runtimeRoot,{recursive:true,filter:path=>!path.split('/').some(part=>['__tests__','node_modules','__pycache__'].includes(part))});
 if(scoring||phone){const binding=bindNative103TestPython(runtimeRoot);if(binding)writeFileSync(binding.path,JSON.stringify(binding.policy));}
 const localControl=await import(new URL('./runtime/official-agent-control.mjs',new URL('file://'+copied+'/')).href);
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'official-control-'))),home=join(directory,'home'),journalDirectory=join(directory,'journal');
 mkdirSync(journalDirectory,{mode:0o700});
 const methodName=scoring?'douyin-leadgen-activity-103-scoring':'douyin-leadgen-activity-101-collect-videos',text=readFileSync(join(root,'skills',methodName,'SKILL.md'),'utf8');
 const version=parse(text.match(/^---\n([\s\S]*?)\n---/)[1]).metadata.version;
 const support=readFileSync(join(root,'skills/leadgen-activity-execution.md'),'utf8');
 const contract={budget:{max_duration_s:30}},contractSha=jsonHash(contract),commit='a'.repeat(40);
 const q={protocol:'leadgen-activity-v1',run_id:'douyin_video_discovery-official_fixture__a1',task_id:'11111111-1111-4111-8111-111111111111',binding_id:'22222222-2222-4222-8222-222222222222',workflow_key:'douyin_video_discovery',run_tag:'official_fixture',profile:'cloud-phone-test',serial:'47.100.213.173:10001',line:'yuesheng',source_commit:commit,workflow_definition_version_id:'wv1',release_id:'r1',observation_id:'o1',runtime_snapshot_sha256:'b'.repeat(64),activity_key:'collect_videos',broker_host:'mmv',broker_request_path:'/private/tmp/fixture/request.json',broker_tool_path:'/private/tmp/fixture/tool.mjs',nonce:'c'.repeat(48),deadline_ms:Date.now()+20000,mode:'execute',source_run:null,limit:2,comment_limit:null,run_max_seconds:1800,discovery_filters:{sort:'comprehensive',time_layer:'one_week',location:'unlimited'},discovery_input:null,method:{reference_id:'ref1',activity_version_id:'av1',name:methodName,version,sha256:sha(text),text,support:{text:support,sha256:sha(support)},contract:{activity_version_id:'av1',definition_key:'douyin_video_discovery.collect_videos',payload:contract,sha256:contractSha}}};
 if(scoring){Object.assign(q,{workflow_key:'douyin_comment_scoring',profile:'none',serial:'none',activity_key:'scoring',discovery_filters:null});q.method.contract.definition_key='douyin_comment_scoring.scoring';}
 if(controlAcceptance){q.control_claim={claimed_by:'headed-fixture',claimed_at:'2026-11-05T05:00:00.000Z'};q.control_scope={protocol:'runner-control-acceptance/v1',activity_key:'scoring',allowed_intents:['inspect','finish']};}
 if(rawTransport){
  q.execution_transport='raw-model-v1';q.max_turns=4;
  assert.match(q.method.text,/execution_transports:\n\s+- raw-model-v1/,'raw fixture must use actual distributed new Skill bytes');
  const policy=JSON.parse(readFileSync(join(runtimeRoot,'official-gateway-runtime.json'))),pkg=join(directory,'gateway-fixture');mkdirSync(join(pkg,'dist'),{recursive:true});writeFileSync(join(pkg,'package.json'),JSON.stringify({version:policy.gateway_version}));
  if(terminalPolicy!==undefined){policy.schema_version=3;policy.terminal_policy=terminalPolicy;}policy.package_root=pkg;policy.agent_config_path=join(directory,'agent-config.json');writeFileSync(policy.agent_config_path,JSON.stringify({agents:{entries:Object.fromEntries(['skill-factory','work-commander'].map(a=>[a,{model:{primary:'openai/gpt-6.1-sol',fallbacks:[]}}]))}}),{mode:0o600});for(const f of policy.files){const bytes='synthetic future runtime policy fixture '+f.path;writeFileSync(join(pkg,f.path),bytes);f.sha256=sha(bytes);}writeFileSync(join(runtimeRoot,'official-gateway-runtime.json'),JSON.stringify(policy));

 }
 const binding={id:q.binding_id,run_id:q.run_id,workflow_id:'w1',workflow_definition_version_id:'wv1',release_id:'r1',observation_id:'o1',runtime_snapshot_sha256:q.runtime_snapshot_sha256,external_origin:'zenithjoy:mmv',actor:'runtime:phone-adb-controller:agent-v1',task_id:q.task_id};
 const wf={source_commit:commit,payload:{key:q.workflow_key,activities:[{slot_key:q.activity_key,reference_id:'ref1',activity_id:'a1',activity_version_id:'av1'}]}};
 const av={contract_sha256:contractSha,payload:{definition_key:q.method.contract.definition_key,contract,implementation_bindings:[{kind:'skill',status:'verified',repo:'perfectuser21/zenithjoy-workspace',revision:commit,name:methodName,version,content_sha256:q.method.sha256}]}};
 const task={id:q.task_id,status:'in_progress',claimed_by:'headed-fixture',payload:{workflow_key:q.workflow_key,run_tag:q.run_tag,profile:q.profile,device_serial:q.serial,company_line:q.line,source_commit:commit}};
 if(scoring)delete task.payload.device_serial;
 if(controlAcceptance){task.claimed_at=q.control_claim.claimed_at;}
 if(controlAcceptance)task.payload.scope={control_scope:structuredClone(q.control_scope),execution_transport:q.execution_transport,max_turns:q.max_turns,run_max_seconds:q.run_max_seconds,limit:q.limit};
 const routes=new Map([['/api/brain/runs/'+q.run_id+'/definition',{binding}],['/api/brain/workflows/w1/versions/wv1',{version:wf}],['/api/brain/tasks/'+q.task_id,task],['/api/brain/activities/a1/versions/av1',{version:av}]]);
 for(const folder of ['.openclaw/commander','openclaw-root/workspaces-root/clawd-work-commander'])for(const file of ['AGENTS.md','skills/workflow-commander/SKILL.md']){
  const target=join(home,folder,file);mkdirSync(resolve(target,'..'),{recursive:true});writeFileSync(target,readFileSync(join(root,'commander',file)));
 }
 const runDir=join(home,'.openclaw/leadgen-activity-runs',skillRunKey(q));mkdirSync(runDir,{recursive:true,mode:0o700});
 const agent={run_id:q.run_id,task_id:q.task_id,parent_session_key:workflowCommanderSession(q),nonce:q.nonce,expires_at:q.deadline_ms/1000};
 const childRun='33333333-3333-4333-8333-333333333333',childKey='agent:skill-factory:subagent:fixture';
 const records={'activity-request.json':q,'agent-request.json':agent,'spawn-claimed.json':{...agent,source_commit:commit},'agent-binding.json':{...agent,child_run_id:childRun,child_session_key:childKey},'spawn-receipt.json':{runId:childRun,childSessionKey:childKey,resolvedProvider:'openai',resolvedModel:'gpt-6.1-sol'}};
 for(const [name,value]of Object.entries(records))writeFileSync(join(runDir,name),JSON.stringify(value),{mode:0o600});
 writeFileSync(join(runtimeRoot,'deployment-manifest.json'),JSON.stringify({source_commit:commit}));
 const source={commit,files:[...new Set([...RPC_FILES,'official-agent-control.mjs','official-gateway-runtime.mjs','official-gateway-runtime.json','official-commander-sdk.mjs'])].map(path=>({path,sha256:sha(readFileSync(join(runtimeRoot,path)))}))};
 let dispatches=0;const sockets=new Set();let arrived;const firstRequest=new Promise(r=>{arrived=r;});
 const server=createServer((req,res)=>{
  dispatches++;assert.equal(req.headers['x-internal-token'],'fixture-private-token');arrived();
  if(delay)return;
  const value=routes.get(req.url);res.writeHead(value?200:404,{'Content-Type':'application/json','Connection':'close'});res.end(JSON.stringify(value??{}));
 });
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const options={source,runtimeRoot,request:q,home,journalDirectory,gatewayDependencies,gatewayCredential,deadlineMs:(suppressClose||shortDeadline)?Date.now()+500:q.deadline_ms,cleanupDeadlineMs:(suppressClose||shortDeadline)?Date.now()+800:q.deadline_ms,credential:()=> 'fixture-private-token',httpRequest:(opts,callback)=>{
  assert.equal(opts.hostname,'127.0.0.1');assert.equal(String(opts.port),'5221');assert.equal(opts.method,'GET');
  const req=requestHttp({...opts,port:server.address().port},callback);
  if(suppressClose){const emit=req.emit;req.emit=function(event,...args){if(event==='close'){replay.push(()=>emit.call(req,event,...args));return false;}return emit.call(req,event,...args);};}
  return req;
 }};
 const replay=[];
 let instance;
 try{instance=localControl.createOfficialAgentControl(options);await fn({instance,q,source,options,createControl:localControl.createOfficialAgentControl,createFactory:localControl.createOfficialAgentControlFactory,routes,firstRequest,count:()=>dispatches,journalDirectory,runDir,replay,runtimeRoot});}
 finally{for(const callback of replay)callback();if(instance)await instance.close();for(const socket of sockets)socket.destroy();await new Promise(r=>server.close(r));rmSync(directory,{recursive:true,force:true});rmSync(copied,{recursive:true,force:true});}
}

