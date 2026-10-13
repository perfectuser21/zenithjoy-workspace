import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {digest} from '../runtime-definition.mjs';
const repo='perfectuser21/zenithjoy-workspace',sha='a'.repeat(40),bytes=Buffer.from('real deployed bytes\n');
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function row(n,payload,identity){const source={repo,path:'contract.json',commit:sha};return{id:uuid(n),[identity]:payload[identity],source_repo:repo,source_path:source.path,source_commit:sha,payload,payload_sha256:digest({source,payload})};}
function evidence(scope,keys){
 const activities=keys.map((key,i)=>{const id=uuid(500+i+(scope==='zenithjoy'?0:100));return row(700+i+(scope==='zenithjoy'?0:100),{activity_id:id,implementation_bindings:[{kind:'code',scope:'activity',status:'verified',repo,revision:sha,path:'services/phone-adb-controller/'+(key.includes('internal')?'commander/wf-report.py':'douyin-phone-adb'),digest:'sha256:'+digest(bytes)}],steps:[]},'activity_id');});
 const workflows=keys.map((key,i)=>row(900+i+(scope==='zenithjoy'?0:100),{workflow_id:scope==='zenithjoy'&&i<4?`b1000000-0000-4000-8000-${String(101+i).padStart(12,'0')}`:uuid(100+i),key,contract:{key,...(key==='workflow_commander.internal'?{}:{execution_profile:'codex_agent'})},activities:[{activity_id:activities[i].activity_id,activity_version_id:activities[i].id}]},'workflow_id'));
 const snapshot={schema_version:1,scope,repo,revision:sha,status:'verified',gaps:[],definitions:{workflows,activities}};snapshot.snapshot_sha256=digest(snapshot);
 const report={protocol:'pilot_release_verification_v1',purpose:'release_verification',scope,source:{repo,head_revision:sha},snapshot_sha256:snapshot.snapshot_sha256,verification_status:'verified',gaps:[],assertion_source:'current_registration',definition_versions:{workflows,activities},expected_usages:workflows.map(w=>({workflow_id:w.workflow_id})),required_assertions:[{assertion_ref:scope+'.sh',source_bindings:[]}]};
 report.assertion_plan_sha256=digest(Object.fromEntries(['scope','source','definition_versions','expected_usages','required_assertions','assertion_source'].map(k=>[k,report[k]])));
 const receipt={purpose:'release_verification',actor:'pilot_release_verification',verdict:'PASS',scope:'declared_pilot_regressions',business_runtime_status:'not_evaluated',snapshot_sha256:snapshot.snapshot_sha256,assertion_plan_sha256:report.assertion_plan_sha256,source:report.source,report_sha256:digest(Buffer.from(JSON.stringify(report))),assertions:[{assertion_ref:scope+'.sh',source_repo:repo,source_revision:sha,test_sha256:'b'.repeat(64),source_bindings:[],exit_code:0}]};return{snapshot,report,receipt};
}
export function fixture(){return{...evidence('zenithjoy',['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring','douyin_lead_outreach','douyin_video_publish.android']),commander:evidence('commander-generic',['workflow_report.internal','workflow_commander.internal'])};}
test('双scope唯一MMV七流程/xian四流程，完整receipt不能偷减且同key不同版本拒绝',async()=>{
 const {targetDefinitions}=await import('../deployment-targets.mjs');const bundle=fixture();
 const result=targetDefinitions(bundle,sha,()=>bytes);assert.equal(result.mmv.definitions.workflows.length,7);assert.equal(result['xian-m4'].definitions.workflows.length,4);
 for(const mutate of [b=>delete b.commander,b=>b.commander.receipt.assertions=[],b=>b.commander.report.scope='zenithjoy',b=>b.receipt.assertions[0].exit_code=1]){const copy=structuredClone(bundle);mutate(copy);assert.throws(()=>targetDefinitions(copy,sha,()=>bytes));}
});
test('旧本机manifest保留本机files视图，与Commander共享同一MMV release/ACK',async()=>{
 const {localManifestView}=await import('../deployment-targets.mjs');const local={source_repo:repo,source_commit:sha,files:[{path:'services/phone-adb-controller/a.sh',deployed_path:'a.sh',content_sha256:digest(bytes)}]};
 const ack={...local,files:[...local.files,{path:'remote/phone',deployed_path:'xian-m4:~/phone',content_sha256:digest(bytes)}],release_id:uuid(10),observation_id:uuid(11),environment:'production',target:'mmv'};
 const view=localManifestView(local,ack);assert.deepEqual(view.files,local.files);assert.equal(view.release_id,ack.release_id);assert.equal(view.observation_id,ack.observation_id);
 assert.throws(()=>localManifestView({...local,source_commit:'b'.repeat(40)},ack));
});
test('真实commander-only无正式map在任何ssh副作用前拒绝',()=>{
 const dir=mkdtempSync(join(tmpdir(),'commander-deploy-map-')),marker=join(dir,'called');for(const name of ['ssh','scp'])writeFileSync(join(dir,name),`#!/bin/sh\nprintf called > '${marker}'\nexit 99\n`,{mode:0o755});
 const result=spawnSync('bash',[new URL('../deploy.sh',import.meta.url).pathname,'--commander-only'],{env:{...process.env,PATH:dir+':'+process.env.PATH,WF_COMMANDER_RELEASES_FILE:'',WF_DEPLOY_PLAN_FILE:''},encoding:'utf8'});
 assert.notEqual(result.status,0);assert.equal(existsSync(marker),false,'缺map已经触及远端');
});

test('真实HTTP xian→唯一MMV观测，旧两root只收到同ACK本机视图',async t=>{
 const {createServer}=await import('node:http');const {brainRequest}=await import('../deployment-preflight.mjs');const {observeUnified}=await import('../deployment-unified-observe.mjs');
 const folder=mkdtempSync(join(tmpdir(),'unified-http-'));const local={schema_version:1,source_repo:repo,source_commit:sha,files:[{path:'services/phone-adb-controller/a.sh',deployed_path:'a.sh',content_sha256:digest(bytes)}]};
 const extra={kind:'code',repo,revision:sha,path:'services/phone-adb-controller/commander/wf-report.py',digest:'sha256:'+digest(bytes)};
 const releases={};for(const [target,id]of [['xian-m4',uuid(10)],['mmv',uuid(11)]]){const r={id,target,environment:'production',payload:{components:[{kind:'repo',repo,revision:sha},{kind:'code',repo,revision:sha,path:local.files[0].path,digest:'sha256:'+digest(bytes)},...(target==='mmv'?[extra]:[])]}};r.manifest_sha256=digest({environment:r.environment,target,payload:r.payload});releases[id]=r;}
 const observations=new Map(),posts=[],published=[];
 const server=createServer(async(req,res)=>{assert.equal(req.headers.authorization,'Bearer fixture-token');const parts=req.url.split('/'),id=parts[4];let value;
  if(req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);posts.push(body);value={observation:{id:'obs-'+id,release_id:id,payload:body}};observations.set(id,value.observation);}
  else if(req.url.endsWith('/gate'))value={deployed:true,actual_matches:true,current_observation_id:observations.get(id).id};
  else if(req.url.includes('/observations/'))value={observation:observations.get(id)};else value={release:releases[id]};res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`,plan={source_repo:repo,source_commit:sha,releases:{mmv:releases[uuid(11)]},release_ids:{'xian-m4':uuid(10),mmv:uuid(11)}};
 const result=await observeUnified({plan,xianManifest:local,mmvManifest:local,options:{environment:'production',collector:'fixture',attemptKey:'same-deploy',brainUrl:base,stateDir:folder,request:brainRequest(base,'fixture-token')},collectXian:async m=>({...m,observed_hostname:'mac-mini-m4-xian'}),collectMmv:async(m,ack)=>{assert.equal(published[0].manifest.observation_id,ack.observation_id);return{...m,observed_hostname:'aad17-2'};},publish:async(host,path,manifest)=>published.push({host,path,manifest})});
 assert.deepEqual(posts.map(p=>p.target),['xian-m4','mmv']);assert.equal(published.length,3);assert.equal(published[1].manifest.observation_id,published[2].manifest.observation_id);assert.deepEqual(result.mmv.files,local.files);assert.equal(posts[1].components.length,3);
});

test('部署锁与真实安装采集Python回归',()=>{
 const result=spawnSync('python3',[new URL('./deployment-installed.test.py',import.meta.url).pathname],{encoding:'utf8'});assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
});
