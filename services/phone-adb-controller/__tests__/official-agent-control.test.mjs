import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request as requestHttp} from 'node:http';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {parse} from 'yaml';
import {RPC_FILES} from '../leadgen-client.mjs';
import {skillRunKey} from '../leadgen-skill-agent.mjs';
import {canonical} from '../runtime-definition.mjs';

const control=await import('../official-agent-control.mjs').catch(error=>{
 if(error.code==='ERR_MODULE_NOT_FOUND'&&error.url===new URL('../official-agent-control.mjs',import.meta.url).href)return {};
 throw error;
});
const root=fileURLToPath(new URL('../',import.meta.url));
const sha=x=>createHash('sha256').update(x).digest('hex');
const jsonHash=x=>sha(canonical(x));

async function using(fn,{delay=false}={}){
 assert.equal(typeof control.createOfficialAgentControl,'function','正式authority需要不fork外层Node/SSH的Code-owned入口');
 const directory=mkdtempSync(join(tmpdir(),'official-control-')),home=join(directory,'home'),journalDirectory=join(directory,'journal');
 mkdirSync(journalDirectory,{mode:0o700});
 const methodName='douyin-leadgen-activity-101-collect-videos',text=readFileSync(join(root,'skills',methodName,'SKILL.md'),'utf8');
 const version=parse(text.match(/^---\n([\s\S]*?)\n---/)[1]).metadata.version;
 const support=readFileSync(join(root,'skills/leadgen-activity-execution.md'),'utf8');
 const contract={budget:{max_duration_s:30}},contractSha=jsonHash(contract),commit='a'.repeat(40);
 const q={protocol:'leadgen-activity-v1',run_id:'douyin_video_discovery-official_fixture__a1',task_id:'11111111-1111-4111-8111-111111111111',binding_id:'22222222-2222-4222-8222-222222222222',workflow_key:'douyin_video_discovery',run_tag:'official_fixture',profile:'cloud-phone-test',serial:'47.100.213.173:10001',line:'yuesheng',source_commit:commit,workflow_definition_version_id:'wv1',release_id:'r1',observation_id:'o1',runtime_snapshot_sha256:'b'.repeat(64),activity_key:'collect_videos',broker_host:'mmv',broker_request_path:'/private/tmp/fixture/request.json',broker_tool_path:'/private/tmp/fixture/tool.mjs',nonce:'c'.repeat(48),deadline_ms:Date.now()+20000,mode:'execute',source_run:null,limit:2,comment_limit:null,run_max_seconds:1800,discovery_filters:{sort:'comprehensive',time_layer:'one_week',location:'unlimited'},discovery_input:null,method:{reference_id:'ref1',activity_version_id:'av1',name:methodName,version,sha256:sha(text),text,support:{text:support,sha256:sha(support)},contract:{activity_version_id:'av1',definition_key:'douyin_video_discovery.collect_videos',payload:contract,sha256:contractSha}}};
 const binding={id:q.binding_id,run_id:q.run_id,workflow_id:'w1',workflow_definition_version_id:'wv1',release_id:'r1',observation_id:'o1',runtime_snapshot_sha256:q.runtime_snapshot_sha256,external_origin:'zenithjoy:mmv',actor:'runtime:phone-adb-controller:agent-v1',task_id:q.task_id};
 const wf={source_commit:commit,payload:{key:q.workflow_key,activities:[{slot_key:q.activity_key,reference_id:'ref1',activity_id:'a1',activity_version_id:'av1'}]}};
 const av={contract_sha256:contractSha,payload:{definition_key:q.method.contract.definition_key,contract,implementation_bindings:[{kind:'skill',status:'verified',repo:'perfectuser21/zenithjoy-workspace',revision:commit,name:methodName,version,content_sha256:q.method.sha256}]}};
 const task={id:q.task_id,status:'in_progress',claimed_by:'headed-fixture',payload:{workflow_key:q.workflow_key,run_tag:q.run_tag,profile:q.profile,device_serial:q.serial,company_line:q.line,source_commit:commit}};
 const routes=new Map([['/api/brain/runs/'+q.run_id+'/definition',{binding}],['/api/brain/workflows/w1/versions/wv1',{version:wf}],['/api/brain/tasks/'+q.task_id,task],['/api/brain/activities/a1/versions/av1',{version:av}]]);
 for(const folder of ['.openclaw/commander','openclaw-root/workspaces-root/clawd-work-commander'])for(const file of ['AGENTS.md','skills/workflow-commander/SKILL.md']){
  const target=join(home,folder,file);mkdirSync(resolve(target,'..'),{recursive:true});writeFileSync(target,readFileSync(join(root,'commander',file)));
 }
 const runDir=join(home,'.openclaw/leadgen-activity-runs',skillRunKey(q));mkdirSync(runDir,{recursive:true,mode:0o700});
 const agent={run_id:q.run_id,task_id:q.task_id,parent_session_key:'agent:work-commander:fixture',nonce:q.nonce,expires_at:q.deadline_ms/1000};
 const childRun='33333333-3333-4333-8333-333333333333',childKey='agent:skill-factory:subagent:fixture';
 const records={'activity-request.json':q,'agent-request.json':agent,'spawn-claimed.json':{...agent,source_commit:commit},'agent-binding.json':{...agent,child_run_id:childRun,child_session_key:childKey},'spawn-receipt.json':{runId:childRun,childSessionKey:childKey,resolvedProvider:'openai',resolvedModel:'gpt-6.1-sol'}};
 for(const [name,value]of Object.entries(records))writeFileSync(join(runDir,name),JSON.stringify(value),{mode:0o600});
 const source={commit,files:[...RPC_FILES,'official-agent-control.mjs'].map(path=>({path,sha256:sha(readFileSync(join(root,path)))}))};
 let dispatches=0;const sockets=new Set();let arrived;const firstRequest=new Promise(r=>{arrived=r;});
 const server=createServer((req,res)=>{
  dispatches++;assert.equal(req.headers['x-internal-token'],'fixture-private-token');arrived();
  if(delay)return;
  const value=routes.get(req.url);res.writeHead(value?200:404,{'Content-Type':'application/json','Connection':'close'});res.end(JSON.stringify(value??{}));
 });
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const options={source,runtimeRoot:root,request:q,home,journalDirectory,deadlineMs:q.deadline_ms,credential:()=> 'fixture-private-token',httpRequest:(opts,callback)=>{
  assert.equal(opts.hostname,'127.0.0.1');assert.equal(String(opts.port),'5221');assert.equal(opts.method,'GET');
  return requestHttp({...opts,port:server.address().port},callback);
 }};
 let instance;
 try{instance=control.createOfficialAgentControl(options);await fn({instance,q,source,options,routes,firstRequest,count:()=>dispatches,journalDirectory,runDir});}
 finally{if(instance)await instance.close();for(const socket of sockets)socket.destroy();await new Promise(r=>server.close(r));rmSync(directory,{recursive:true,force:true});}
}

test('原真实Skill/中央绑定/私有official原件经本机只读HTTP授权，无outer Node或SSH',async()=>using(async({instance,q,count})=>{
 const value=await instance.request({kind:'activity_skill_authority',request:q});
 assert.deepEqual(value,{ok:true,authorized:true});assert.equal(count(),4);
 assert.equal(instance.snapshot().execution_stopped,false,'idle不等于sealed');
 await instance.close();assert.equal(instance.snapshot().execution_stopped,true);
}));
test('换Task、nonce、profile、source或broker host在任何IO之前拒绝',async()=>using(async({instance,q,count})=>{
 for(const change of [{task_id:'44444444-4444-4444-8444-444444444444'},{nonce:'d'.repeat(48)},{profile:'other'},{source_commit:'e'.repeat(40)},{broker_host:'xian-m4'}])await assert.rejects(()=>instance.request({kind:'activity_skill_authority',request:{...q,...change}}),/OFFICIAL_CONTROL_SCOPE/);
 assert.equal(count(),0);
}));
test('尚未闭域的launch/stop/commander及其它业务不回退旧RPC，零HTTP',async()=>using(async({instance,q,count})=>{
 for(const kind of ['activity_skill','activity_skill_stop','commander','queue','outreach'])await assert.rejects(()=>instance.request({kind,request:q}),/OFFICIAL_CONTROL_UNSUPPORTED/);
 assert.equal(count(),0);
}));
test('中央Task错身份仍沿原校验拒绝，不借本地transport获得权限',async()=>using(async({instance,q,routes})=>{
 routes.get('/api/brain/tasks/'+q.task_id).payload.device_serial='47.100.213.173:10002';
 await assert.rejects(()=>instance.request({kind:'activity_skill_authority',request:q}),/RPC_SKILL_PRIMARY_TASK_SCOPE_INVALID/);
}));
test('seal取消在途读；真实request/socket关闭前保留pending，晚回调不发第二GET',async()=>using(async({instance,q,firstRequest,count})=>{
 const work=instance.request({kind:'activity_skill_authority',request:q});const rejected=assert.rejects(work,/OFFICIAL_CONTROL_CLOSED/);
 await firstRequest;assert.equal(instance.snapshot().pending,1);
 const closed=instance.close();await rejected;await closed;
 assert.equal(count(),1);assert.equal(instance.snapshot().pending,0);assert.equal(instance.snapshot().execution_stopped,true);
 await assert.rejects(()=>instance.request({kind:'activity_skill_authority',request:q}),/OFFICIAL_CONTROL_CLOSED/);
},{delay:true}));
