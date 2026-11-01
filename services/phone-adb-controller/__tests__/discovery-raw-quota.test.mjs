// 真发现循环/持久progress；只在手机、PG外部边界隔离，不连接设备。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createDiscoveryHandlers} from '../leadgen-discovery.mjs';
import * as runtime from '../runtime-definition.mjs';
import {withDiscoveryMetricsFixture} from './helpers/discovery-metrics-fixture.mjs';
import {addDiscoveryCliScopeTemplate} from './helpers/discovery-cli-scope-fixture.mjs';
const card=i=>`${300+i}\t540\t00:20\t目标${i}\t作者${i}`;
function input(dir,max=2){const file=join(dir,'keywords.txt');writeFileSync(file,'AI考证\n');return {env:{WF_BRAIN_WORKFLOW:'douyin_video_discovery',WFR_TAG:'rawquota',P:'legacy',SERIAL:'SERIAL',LEADGEN_LINE:'jinuo',LEADGEN_SOURCE_KIND:'keyword',LEADGEN_SOURCES_FILE:file,LEADGEN_MAX_SCREENS:'1',LEADGEN_DISCOVERY_MAX_CANDIDATES:String(max)},fixed:{schema_version:1,workflow_key:'douyin_video_discovery',run_tag:'rawquota',profile:'legacy',serial:'SERIAL',line:'jinuo',max_candidates:max,max_screens:1,source_kind:'keyword',sources:['AI考证'],source_sha256:createHash('sha256').update('AI考证\n').digest('hex')}};}
function rig(dir,{cards=2,max=2,missing=false,reveal=false,restricted=true}={}){
 const request=input(dir,max),calls=[],writes=[];let reads=0;
 const h=withDiscoveryMetricsFixture(createDiscoveryHandlers)({root:dir,profile:'legacy',run:'rawquota',sources:['AI考证'],limit:6,location:'unlimited',discoveryInput:restricted?request.fixed:undefined,env:{WFR_RUN_DIR:dir,...request.env},execute:async()=>({code:0}),queue:async(op,{video})=>{writes.push(video.videoId);return {status:'pending',inserted:true};},phone:async(command)=>{
  calls.push(command);
  if(command==='search-time-layer')return 'sort=latest\ntime_layer=six_months\nduration=unlimited\nscope=unlimited\nlocation=unlimited\n';
  if(command==='search-video-cards'){reads++;const list=reveal&&reads>1?[]:Array.from({length:cards},(_,i)=>missing?`${300+i}\t540\t00:20\t目标${i}\t`:card(i));return list.join('\n')+'\nvideo_tab=1\nloading=0\nend_of_results=1\nevidence=/tmp/raw-grid.xml';}
  if(command==='search-kw-matches')return 'kw_matches=1';
  if(command==='card-bottom-hint-from-xml')return 'clipped=1';
  if(command==='current-video-link')return 'video_id=7700140623701611674\nshort_url=https://v.douyin.com/valid/\ncontent_type=video\nreturn_mode=results\n';return '';
 }});return {h,calls,writes,request};
}
async function temp(body){const dir=mkdtempSync(join(tmpdir(),'discovery-raw-'));try{return await body(dir);}finally{rmSync(dir,{recursive:true,force:true});}}

test('重复VID也耗raw尝试额度，不能因唯一persisted不足而多点击',()=>temp(async dir=>{
 const {h,calls,writes}=rig(dir,{cards:3,max:3});const out=await h.collect_videos();assert.equal(out.counts.attempted,3);assert.equal(writes.length,3);assert.equal(out.counts.persisted,1);assert.equal(out.request?.max_candidates??JSON.parse(readFileSync(join(dir,'discovery-progress.json'))).request.max_candidates,3);assert.equal(calls.filter(x=>x==='tap-evidence').length,3);
}));
test('首屏超过raw上限如实记录seen并零候选点击零写入',()=>temp(async dir=>{
 const {h,calls,writes}=rig(dir,{cards:3,max:2});const out=await h.collect_videos();assert.equal(out.counts.cards,3);assert.equal(out.counts.attempted,0);assert.equal(out.stop_reason,'candidate_limit_exceeded');assert.equal(calls.includes('tap-evidence'),false);assert.deepEqual(writes,[]);
}));
test('受限模式不得为缺失候选reveal或restore追加视口',()=>temp(async dir=>{
 const {h,calls}=rig(dir,{cards:1,max:2,reveal:true});await h.collect_videos();assert.equal(calls.includes('search-grid-scroll'),false);assert.equal(calls.includes('tap-evidence'),false);
}));
test('受限同run已有progress拒二次采集，额度不能重置',()=>temp(async dir=>{
 const {h,calls}=rig(dir,{cards:1,max:2});await h.collect_videos();const before=calls.length;await assert.rejects(h.collect_videos(),/DISCOVERY_INPUT_ALREADY_USED/);assert.equal(calls.length,before);
}));
test('无受限输入旧reveal行为仍保持',()=>temp(async dir=>{
 const {h,calls}=rig(dir,{cards:1,reveal:true,restricted:false});await h.collect_videos();assert.equal(calls.includes('search-grid-scroll'),true);
}));

test('正式解析固定唯一来源文件字节、运行身份和raw上限',()=>temp(dir=>{
 const {env,fixed}=input(dir);assert.equal(typeof runtime.discoveryInput,'function');assert.deepEqual(runtime.discoveryInput(env),fixed);
}));
for(const bad of ['0','-1','2.5','NaN','1001'])test('非法raw数量派发前拒 '+bad,()=>temp(dir=>{
 const {env}=input(dir);env.LEADGEN_DISCOVERY_MAX_CANDIDATES=bad;assert.throws(()=>runtime.discoveryInput(env),/DISCOVERY_INPUT_INVALID/);
}));
test('冻结raw输入加删改及来源文件漂移拒，不借无字段旧默认',()=>temp(dir=>{
 const {env,fixed}=input(dir);assert.equal(typeof runtime.assertDiscoveryInput,'function');assert.deepEqual(runtime.assertDiscoveryInput({discovery_input:fixed},env),fixed);
 for(const snapshot of [{},{discovery_input:{...fixed,max_candidates:3}}])assert.throws(()=>runtime.assertDiscoveryInput(snapshot,env),/DISCOVERY_INPUT/);
 const changed={...env};delete changed.LEADGEN_DISCOVERY_MAX_CANDIDATES;assert.throws(()=>runtime.assertDiscoveryInput({discovery_input:fixed},changed),/DISCOVERY_INPUT/);
 writeFileSync(env.LEADGEN_SOURCES_FILE,'AI考证\n其他\n');assert.throws(()=>runtime.assertDiscoveryInput({discovery_input:fixed},env),/DISCOVERY_INPUT/);
}));
test('非101或多屏不能启用raw受限模式',()=>temp(dir=>{
 const {env}=input(dir);for(const patch of [{WF_BRAIN_WORKFLOW:'douyin_video_processing'},{LEADGEN_MAX_SCREENS:'2'}])assert.throws(()=>runtime.discoveryInput({...env,...patch}),/DISCOVERY_INPUT_INVALID/);
}));

import {mkdirSync} from 'node:fs';
import {createDiscoveryAction} from '../leadgen-discovery-action.mjs';
function freezeRig(dir){
 const root=join(dir,'deployment');mkdirSync(root);const sha='a'.repeat(40),source={repo:'test/repo',path:'contracts/raw.yaml',commit:sha};
 const entry=Buffer.from('frozen runtime\n'),plan=Buffer.from('WF_CAP=raw\n'),steps=Buffer.from('{"steps":[]}');
 for(const[name,bytes]of [['entry.sh',entry],['workflow.plan',plan],['steps.json',steps]])writeFileSync(join(root,name),bytes);
 const contract={id:'raw',contract_key:'douyin_video_discovery',capability:'keyword_acquisition',activities:[{id:'run',steps:[]}]};
 const ap={activity_id:'a',definition_key:'raw.run',contract:contract.activities[0],steps:[],implementation_bindings:[{kind:'code',status:'verified',repo:source.repo,path:'services/phone-adb-controller/entry.sh',revision:sha,content_sha256:runtime.digest(entry)}]};
 const wp={workflow_id:'w',key:'douyin_video_discovery',contract,activities:[{reference_id:'r',slot_key:'run',sequence_no:1,activity_id:'a',activity_version_id:'av'}]};
 const v=(id,payload)=>({id,source_repo:source.repo,source_path:source.path,source_commit:sha,contract_sha256:runtime.digest(payload.contract),payload_sha256:runtime.digest({source,payload}),payload});
 const routes={'/api/brain/workflows':[{id:'w',key:'douyin_video_discovery',current_definition_version_id:'wv'}],'/api/brain/workflows/w/versions/wv':{version:v('wv',wp)},'/api/brain/activities/a/versions/av':{version:v('av',ap)}};
 writeFileSync(join(root,'deployment-manifest.json'),JSON.stringify({source_repo:source.repo,source_commit:sha,files:[['entry.sh',entry],['workflow.plan',plan],['steps.json',steps]].map(([name,b])=>({path:'services/phone-adb-controller/'+name,deployed_path:name,content_sha256:runtime.digest(b)}))}));
 const {env,fixed}=input(dir);env.WFR_RUN_DIR=join(dir,'run');return {env,fixed,routes,options:{runDir:env.WFR_RUN_DIR,deploymentRoot:root,planPath:join(root,'workflow.plan'),stepSpecPath:join(root,'steps.json'),workflowKey:'douyin_video_discovery',rawContractSha256:runtime.digest(contract),discoveryInput:fixed,runIdentity:{capability:'douyin_video_discovery',tag:'rawquota',profile:'legacy',serial:'SERIAL',run_id:'run'},get:async path=>structuredClone(routes[path])}};
}
test('真实freezeDefinition→readFrozen固化raw输入，续跑加删改均拒',()=>temp(async dir=>{
 const f=freezeRig(dir);const first=await runtime.freezeDefinition(f.options);assert.deepEqual(first.discovery_input,f.fixed);assert.deepEqual(runtime.readFrozen(f.env.WFR_RUN_DIR).discovery_input,f.fixed);
 assert.equal((await runtime.freezeDefinition(f.options)).snapshot_sha256,first.snapshot_sha256);
 for(const q of [undefined,{...f.fixed,max_candidates:3}])await assert.rejects(runtime.freezeDefinition({...f.options,discoveryInput:q}),/DISCOVERY_INPUT/);
 const fresh=join(dir,'no-input');await runtime.freezeDefinition({...f.options,runDir:fresh,runIdentity:{...f.options.runIdentity,run_id:'no-input'},discoveryInput:undefined});
 await assert.rejects(runtime.freezeDefinition({...f.options,runDir:fresh,runIdentity:{...f.options.runIdentity,run_id:'no-input'}}),/DISCOVERY_INPUT/);
}));
for(const sources of [['AI考证','其他'],['别的']])test('实际getDiscovery拒RPC额外或漂移来源 '+sources,()=>temp(async dir=>{
 const f=freezeRig(dir);await runtime.freezeDefinition(f.options);let phones=0;
 const action=createDiscoveryAction({root:dir,env:f.env,state:{},sourceCommit:'a'.repeat(40),taskId:'t',phone:async()=>{phones++;},bounded:async()=>({code:0}),queue:async()=>[],rpc:async()=>({result:sources}),profile:'legacy',run:'rawquota',isLocked:()=>false,isClosed:()=>false,setClosed:()=>{},setScope:()=>{}});
 await assert.rejects(action.getDiscovery(),/DISCOVERY_INPUT_SOURCE_MISMATCH/);assert.equal(phones,0);
}));
test('受限已有progress在任何RPC或phone之前拒，不能重置配额',()=>temp(async dir=>{
 const f=freezeRig(dir);await runtime.freezeDefinition(f.options);writeFileSync(join(f.env.WFR_RUN_DIR,'discovery-progress.json'),'{}');let calls=0;
 const action=createDiscoveryAction({root:dir,env:f.env,state:{},sourceCommit:'a'.repeat(40),taskId:'t',phone:async()=>{calls++;},bounded:async()=>({code:0}),queue:async()=>[],rpc:async()=>{calls++;return {result:['AI考证']};},profile:'legacy',run:'rawquota',isLocked:()=>false,isClosed:()=>false,setClosed:()=>{},setScope:()=>{}});
 await assert.rejects(action.collect(),/DISCOVERY_INPUT_ALREADY_USED/);assert.equal(calls,0);
}));
test('缺身份卡片仍耗attempt并留下失败，不因0入库转成新额度',()=>temp(async dir=>{
 const {h,calls,writes}=rig(dir,{cards:2,max:2,missing:true});const result=await h.collect_videos();assert.equal(result.counts.attempted,2);assert.equal(result.counts.missing_identity,2);assert.equal(result.counts.failed,2);assert.equal(result.stop_reason,'candidate_limit_reached');assert.equal(result.status,'partial');assert.deepEqual(writes,[]);assert.equal(calls.includes('tap-evidence'),false);
}));

test('真实prepare CLI将raw输入写正式快照，漂移后CLI拒续跑',{timeout:15000},()=>temp(async dir=>{
 const {createServer}=await import('node:http'),{spawn}=await import('node:child_process'),{hostname}=await import('node:os'),{deploymentTarget}=await import('../runtime-host.mjs');
 const f=freezeRig(dir),target=deploymentTarget(hostname());
 const release={id:'raw-cli-release',environment:'scratch',target,payload:{schema_version:1,workflows:[f.routes['/api/brain/workflows/w/versions/wv'].version],activities:[f.routes['/api/brain/activities/a/versions/av'].version]}};
 release.manifest_sha256=runtime.digest({environment:release.environment,target,payload:release.payload});
 const manifest=join(f.options.deploymentRoot,'deployment-manifest.json');writeFileSync(manifest,JSON.stringify(addDiscoveryCliScopeTemplate(f.options.deploymentRoot,{...JSON.parse(readFileSync(manifest)),release_id:release.id,observation_id:'raw-cli-obs',environment:'scratch',target},{target,profile:'legacy',serial:'SERIAL'})));
 const server=createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.url==='/api/brain/machines')res.end(JSON.stringify([{id:'ed3555dc-4777-446c-bdf0-d928d6a08ef1',status:'active',metadata:{tailscale_ip:'100.1.1.1',public_ip:'38.1.1.1'}}]));else if(req.url==='/api/brain/releases/raw-cli-release')res.end(JSON.stringify({release}));else{res.statusCode=404;res.end('{}');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const env={...process.env,...f.env,BRAIN_URL:'http://127.0.0.1:'+server.address().port,BRAIN_INTERNAL_TOKEN:'fixture-only',WF_BRAIN_TASK_ID:'727032df-8545-462a-9e98-a2b9e20587af',WF_DEPLOYMENT_ROOT:f.options.deploymentRoot,WF_CONTRACT_RAW_SHA256:f.options.rawContractSha256,WF_PLAN_PATH:f.options.planPath,WF_STEP_SPEC:'steps.json',WF_ARG_CAP:'douyin_video_discovery',WFR_RUN_ID:'run',WFR_HOME:dir};
  const run=()=>new Promise((resolve,reject)=>{const c=spawn(process.execPath,[new URL('../runtime-receipts.mjs',import.meta.url).pathname,'prepare'],{env,timeout:5000});let stderr='';c.stderr.on('data',b=>stderr+=b);c.on('error',reject);c.on('close',code=>resolve({code,stderr}));});
  const first=await run();assert.equal(first.code,0,first.stderr);assert.deepEqual(runtime.readFrozen(f.env.WFR_RUN_DIR).discovery_input,f.fixed);
  env.LEADGEN_DISCOVERY_MAX_CANDIDATES='3';const changed=await run();assert.notEqual(changed.code,0);assert.match(changed.stderr,/DISCOVERY_INPUT_RESUME_MISMATCH/);
 }finally{await new Promise(r=>server.close(r));}
}));
