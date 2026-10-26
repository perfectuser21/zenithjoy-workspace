// Exercise the actual discovery loop; only external phone/queue operations are isolated.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createDiscoveryHandlers} from '../leadgen-discovery.mjs';
import * as runtime from '../runtime-definition.mjs';
import {withDiscoveryMetricsFixture} from './helpers/discovery-metrics-fixture.mjs';

function input(dir,max=2){
 const keyword='人工智能训练师怎么考',file=join(dir,'keywords.txt');writeFileSync(file,keyword+'\n');
 return {env:{WF_BRAIN_WORKFLOW:'douyin_video_discovery',WFR_TAG:'attemptquota',P:'legacy',SERIAL:'SERIAL',LEADGEN_LINE:'jinuo',LEADGEN_SOURCE_KIND:'keyword',LEADGEN_SOURCES_FILE:file,LEADGEN_MAX_SCREENS:'1',LEADGEN_DISCOVERY_MAX_ATTEMPTS:String(max)},fixed:{schema_version:2,workflow_key:'douyin_video_discovery',run_tag:'attemptquota',profile:'legacy',serial:'SERIAL',line:'jinuo',max_attempts:max,max_screens:1,source_kind:'keyword',sources:[keyword],source_sha256:createHash('sha256').update(keyword+'\n').digest('hex')}};
}
async function temp(body){const dir=mkdtempSync(join(tmpdir(),'discovery-attempt-'));try{return await body(dir);}finally{rmSync(dir,{recursive:true,force:true});}}
function rig(dir,{missing=false,failure=false,unknown=false,limit=6,legacy=false}={}){
 const {env,fixed}=input(dir),calls=[],writes=[];
 if(legacy){fixed.schema_version=1;fixed.max_candidates=fixed.max_attempts;delete fixed.max_attempts;env.LEADGEN_DISCOVERY_MAX_CANDIDATES=env.LEADGEN_DISCOVERY_MAX_ATTEMPTS;delete env.LEADGEN_DISCOVERY_MAX_ATTEMPTS;}
 const h=withDiscoveryMetricsFixture(createDiscoveryHandlers)({root:dir,profile:'legacy',run:'attemptquota',sources:fixed.sources,limit,location:'unlimited',discoveryInput:fixed,env:{WFR_RUN_DIR:dir,...env},execute:async()=>({code:0}),queue:async(_,{video})=>{writes.push(video.videoId);return {status:'pending',inserted:true};},phone:async(command,...args)=>{
  calls.push({command,args});
  if(command==='search-time-layer')return 'sort=latest\ntime_layer=six_months\nduration=unlimited\nscope=unlimited\nlocation=unlimited\n';
  if(command==='search-video-cards')return Array.from({length:4},(_,i)=>`${300+i}\t540\t00:20\t目标${i}\t${missing&&i===0?'':'作者'+i}`).join('\n')+'\nvideo_tab=1\nloading=0\nend_of_results=0\nevidence=/tmp/attempt-grid.xml';
  if(command==='search-kw-matches')return 'kw_matches=1';
  if(command==='tap-evidence'&&failure){const e=Error('candidate tap failed');if(unknown)e.executionStopped=false;throw e;}
  if(command==='current-video-link')return 'video_id=7700140623701611674\nshort_url=https://v.douyin.com/valid/\ncontent_type=video\nreturn_mode=results\n';return '';
 }});return {h,calls,writes,env,fixed};
}
test('explicit attempt input freezes schema2 without conflating displayed candidate cap',()=>temp(dir=>{
 const {env,fixed}=input(dir);assert.deepEqual(runtime.discoveryInput(env),fixed);
 assert.deepEqual(runtime.assertDiscoveryInput({discovery_input:fixed},env),fixed);
}));
test('first page four cards permits only first two slots, retains true seen count and duplicate cost',()=>temp(async dir=>{
 const {h,calls,writes}=rig(dir);const out=await h.collect_videos();
 assert.equal(out.counts.cards,4);assert.equal(out.counts.attempted,2);assert.equal(writes.length,2);assert.equal(out.counts.persisted,1);
 assert.equal(calls.filter(x=>x.command==='tap-evidence').length,2);assert.equal(out.stop_reason,'attempt_limit_reached');
 assert.equal(calls.some(x=>x.command==='search-grid-scroll'),false);assert.equal(out.all_results_scanned,false);assert.notEqual(out.status,'partial');
 const p=JSON.parse(readFileSync(join(dir,'discovery-progress.json')));assert.equal(p.request.max_attempts,2);assert.equal(Object.hasOwn(p.request,'max_candidates'),false);assert.equal(p.counts.cards,4);
}));
test('missing identity consumes a slot without replacing it with the third card',()=>temp(async dir=>{
 const {h,calls,writes}=rig(dir,{missing:true});const out=await h.collect_videos();
 assert.equal(out.counts.attempted,2);assert.equal(out.counts.missing_identity,1);assert.equal(writes.length,1);assert.equal(calls.filter(x=>x.command==='tap-evidence').length,1);assert.equal(out.status,'partial');
}));
test('failed attempted candidate consumes quota and cannot fill from later slots',()=>temp(async dir=>{
 const {h,calls,writes}=rig(dir,{failure:true});const out=await h.collect_videos();
 assert.equal(out.counts.attempted,1);assert.equal(out.counts.failed,1);assert.equal(calls.filter(x=>x.command==='tap-evidence').length,1);assert.deepEqual(writes,[]);assert.equal(out.status,'partial');
}));
test('unknown candidate execution retains safe stop instead of consuming remaining quota',()=>temp(async dir=>{
 const {h,calls}=rig(dir,{failure:true,unknown:true});const out=await h.collect_videos();assert.equal(out.status,'partial');assert.equal(out.stop_reason,'capture_failed');assert.equal(out.counts.attempted,1);assert.equal(calls.filter(x=>x.command==='tap-evidence').length,1);
}));
test('success limit is independent and may stop before attempt quota is exhausted',()=>temp(async dir=>{
 const {h,calls}=rig(dir,{limit:1});const out=await h.collect_videos();assert.equal(out.counts.attempted,1);assert.equal(out.stop_reason,'limit_reached');assert.equal(calls.filter(x=>x.command==='tap-evidence').length,1);
}));
test('completed single run cannot reset attempts by invoking discovery again',()=>temp(async dir=>{
 const {h,calls}=rig(dir);await h.collect_videos();const n=calls.length;await assert.rejects(h.collect_videos(),/DISCOVERY_INPUT_ALREADY_USED/);assert.equal(calls.length,n);
}));
test('old schema1 still rejects oversized first page with zero taps',()=>temp(async dir=>{
 const {h,calls,writes}=rig(dir,{legacy:true});const out=await h.collect_videos();assert.equal(out.counts.cards,4);assert.equal(out.counts.attempted,0);assert.equal(out.stop_reason,'candidate_limit_exceeded');assert.deepEqual(writes,[]);assert.equal(calls.some(x=>x.command==='tap-evidence'),false);
}));
test('simultaneous old and new limits fail rather than choosing a quota implicitly',()=>temp(dir=>{
 const {env}=input(dir);assert.throws(()=>runtime.discoveryInput({...env,LEADGEN_DISCOVERY_MAX_CANDIDATES:'2'}),/DISCOVERY_INPUT_INVALID/);
}));
test('schema and quota fields cannot be relabeled to silently change strict behavior',()=>temp(dir=>{
 const {fixed}=input(dir);for(const patch of [{schema_version:1},{max_candidates:2},{max_attempts:0},{max_attempts:1001},{max_screens:2}])assert.throws(()=>runtime.validateDiscoveryInput({...fixed,...patch}),/DISCOVERY_INPUT_INVALID/);
}));
test('frozen input rejects addition, deletion, mode switching or quota changes',()=>temp(dir=>{
 const {env,fixed}=input(dir);for(const patch of [{},{discovery_input:{...fixed,max_attempts:3}},{discovery_input:{...fixed,schema_version:1}}])assert.throws(()=>runtime.assertDiscoveryInput(patch,env),/DISCOVERY_INPUT/);
 const deleted={...env};delete deleted.LEADGEN_DISCOVERY_MAX_ATTEMPTS;assert.throws(()=>runtime.assertDiscoveryInput({discovery_input:fixed},deleted),/DISCOVERY_INPUT/);
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
 const {env,fixed}=input(dir);env.WFR_RUN_DIR=join(dir,'run');return {env,fixed,routes,options:{runDir:env.WFR_RUN_DIR,deploymentRoot:root,planPath:join(root,'workflow.plan'),stepSpecPath:join(root,'steps.json'),workflowKey:'douyin_video_discovery',rawContractSha256:runtime.digest(contract),discoveryInput:fixed,runIdentity:{capability:'douyin_video_discovery',tag:'attemptquota',profile:'legacy',serial:'SERIAL',run_id:'run'},get:async path=>structuredClone(routes[path])}};
}

test('schema2 actual freeze and action reject changed source before phone',()=>temp(async dir=>{
 const f=freezeRig(dir);await runtime.freezeDefinition(f.options);assert.deepEqual(runtime.readFrozen(f.env.WFR_RUN_DIR).discovery_input,f.fixed);let phones=0;
 const action=createDiscoveryAction({root:dir,env:f.env,state:{},sourceCommit:'a'.repeat(40),taskId:'t',phone:async()=>{phones++;},bounded:async()=>({code:0}),queue:async()=>[],rpc:async()=>({result:['其他词']}),profile:'legacy',run:'attemptquota',isLocked:()=>false,isClosed:()=>false,setClosed:()=>{},setScope:()=>{}});
 await assert.rejects(action.getDiscovery(),/DISCOVERY_INPUT_SOURCE_MISMATCH/);assert.equal(phones,0);
}));
test('schema2 existing progress rejects before any RPC or phone',()=>temp(async dir=>{
 const f=freezeRig(dir);await runtime.freezeDefinition(f.options);writeFileSync(join(f.env.WFR_RUN_DIR,'discovery-progress.json'),'{}');let calls=0;
 const action=createDiscoveryAction({root:dir,env:f.env,state:{},sourceCommit:'a'.repeat(40),taskId:'t',phone:async()=>{calls++;},bounded:async()=>({code:0}),queue:async()=>[],rpc:async()=>{calls++;return {result:f.fixed.sources};},profile:'legacy',run:'attemptquota',isLocked:()=>false,isClosed:()=>false,setClosed:()=>{},setScope:()=>{}});
 await assert.rejects(action.collect(),/DISCOVERY_INPUT_ALREADY_USED/);assert.equal(calls,0);
}));

test('schema2 official prepare CLI freezes explicit attempts and rejects resume changes',{timeout:15000},()=>temp(async dir=>{
 const {createServer}=await import('node:http'),{spawn}=await import('node:child_process'),{hostname}=await import('node:os'),{deploymentTarget}=await import('../runtime-host.mjs');
 const f=freezeRig(dir),target=deploymentTarget(hostname());
 const release={id:'raw-cli-release',environment:'scratch',target,payload:{schema_version:1,workflows:[f.routes['/api/brain/workflows/w/versions/wv'].version],activities:[f.routes['/api/brain/activities/a/versions/av'].version]}};
 release.manifest_sha256=runtime.digest({environment:release.environment,target,payload:release.payload});
 const manifest=join(f.options.deploymentRoot,'deployment-manifest.json');writeFileSync(manifest,JSON.stringify({...JSON.parse(readFileSync(manifest)),release_id:release.id,observation_id:'raw-cli-obs',environment:'scratch',target}));
 const server=createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.url==='/api/brain/machines')res.end(JSON.stringify([{id:'ed3555dc-4777-446c-bdf0-d928d6a08ef1',status:'active',metadata:{tailscale_ip:'100.1.1.1',public_ip:'38.1.1.1'}}]));else if(req.url==='/api/brain/releases/raw-cli-release')res.end(JSON.stringify({release}));else{res.statusCode=404;res.end('{}');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const env={...process.env,...f.env,BRAIN_URL:'http://127.0.0.1:'+server.address().port,BRAIN_INTERNAL_TOKEN:'fixture-only',WF_DEPLOYMENT_ROOT:f.options.deploymentRoot,WF_CONTRACT_RAW_SHA256:f.options.rawContractSha256,WF_PLAN_PATH:f.options.planPath,WF_STEP_SPEC:'steps.json',WF_ARG_CAP:'douyin_video_discovery',WFR_RUN_ID:'run',WFR_HOME:dir};
  const run=()=>new Promise((resolve,reject)=>{const c=spawn(process.execPath,[new URL('../runtime-receipts.mjs',import.meta.url).pathname,'prepare'],{env,timeout:5000});let stderr='';c.stderr.on('data',b=>stderr+=b);c.on('error',reject);c.on('close',code=>resolve({code,stderr}));});
  const first=await run();assert.equal(first.code,0,first.stderr);assert.deepEqual(runtime.readFrozen(f.env.WFR_RUN_DIR).discovery_input,f.fixed);
  env.LEADGEN_DISCOVERY_MAX_ATTEMPTS='3';const changed=await run();assert.notEqual(changed.code,0);assert.match(changed.stderr,/DISCOVERY_INPUT_RESUME_MISMATCH/);
 }finally{await new Promise(r=>server.close(r));}
}));
