import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {digest,readFrozen} from '../runtime-definition.mjs';
import {writeAcceptedDiscoveryResult} from './helpers/discovery-handoff-fixture.mjs';
import {createHandlers} from '../leadgen-workflow.mjs';
const source='cicd24c9_101_20261023_2013',vid='7699316353698753663',other='7699406826379298531';
const oldSha='24c9e6b97b81ae144985474d9e33665bf65a6a8e',newSha='b'.repeat(40),company='ef8e14b0-4018-4e54-bc7a-866e51a0ce0b',tenant='a4ca8914-f5a7-4928-b1e3-6b69f9c0ab61';
const config={company_id:company,tenant_id:tenant,version:14,policy_id:'jinoshengyuan-existing-acquisition-rules-v1'};
function snapshot(dir,body){mkdirSync(dir,{recursive:true});const x={...body,snapshot_sha256:digest(body)};writeFileSync(join(dir,'run-definition.json'),JSON.stringify(x));return x;}
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'producer-intake-')),up=join(dir,'douyin_video_discovery-'+source),current=join(dir,'douyin_video_processing-new102');
 const identity={profile:'legacy',serial:'ANGYVB4402004137'};
 const producer=snapshot(up,{files:{},deployment:{source_commit:oldSha},run_identity:{...identity,capability:'douyin_video_discovery',tag:source,run_id:'douyin_video_discovery-'+source}});
 const videos=[vid,other].map(videoId=>({videoId,author:'原作者',title:'原视频'}));const raw=JSON.stringify({run:source,profile:'legacy',videos,captures:videos});writeFileSync(join(up,'discovery-progress.json'),raw);writeAcceptedDiscoveryResult(up,{source,profile:'legacy',sha:oldSha});
 const descriptor={schema_version:1,workflow_key:'douyin_video_discovery',run_tag:source,source_commit:oldSha,snapshot_sha256:producer.snapshot_sha256,progress_sha256:digest(raw),...identity,line:'jinuo',company_id:company,tenant_id:tenant,company_config_version:14,policy_id:config.policy_id,video_ids:[vid]};
 const env={HOME:dir,WFR_RUN_DIR:current,WFR_TAG:'new102',P:'legacy',SERIAL:identity.serial,LEADGEN_LINE:'jinuo',LEADGEN_SOURCE_RUN:source,OWN_ACCOUNTS_CONF:join(dir,'own.json')};writeFileSync(env.OWN_ACCOUNTS_CONF,JSON.stringify({nicknames:[],ids:[]}));
 const body={files:{},deployment:{source_commit:newSha},run_identity:{...identity,capability:'douyin_video_processing',tag:'new102',run_id:'douyin_video_processing-new102'},producer_descriptor:descriptor};snapshot(current,body);
 const producerCompany={verified:true,...config,run_id:source};
 const calls=[],rows=videos.map(v=>({video_id:v.videoId,line_key:'jinuo',judgment_status:'matched',process_status:'待采评论',judgment_config:{...config,run_id:'original102'}}));
 const make=()=>createHandlers({root:dir,env,rpc:async({request:q})=>{calls.push(q);return {result:q.op==='company_config'?config:q.op==='inspect_videos'?rows:q.op==='verify_producer_company'?producerCompany:[]};}});
 return {dir,up,current,descriptor,body,env,calls,make,producerCompany};
}
test('真实旧readFrozen+现有intake：显式冻结producer允许新consumer但只交批准VID，原progress完整不改',async()=>{
 const f=fixture();try{assert.equal(readFrozen(f.up).deployment.source_commit,oldSha);const before=readFileSync(join(f.up,'discovery-progress.json'));const h=f.make();await h.dedup();assert.deepEqual(h.state.intakeVideoIds,[vid]);assert.deepEqual(readFileSync(join(f.up,'discovery-progress.json')),before);const proof=JSON.parse(readFileSync(join(f.current,'new102-intake-readback.json')));assert.equal(proof.source_commit,oldSha);assert.equal(proof.consumer_source_commit,newSha);assert.deepEqual(proof.video_ids,[vid,other]);assert.deepEqual(proof.eligible_video_ids,[vid]);}finally{rmSync(f.dir,{recursive:true,force:true});}
});
test('无显式冻结descriptor仍拒跨source，不回退全库',async()=>{const f=fixture();try{delete f.body.producer_descriptor;snapshot(f.current,f.body);await assert.rejects(f.make().dedup(),/上游|PRODUCER/);assert.equal(f.calls.filter(q=>q.op==='claim_videos').length,0);}finally{rmSync(f.dir,{recursive:true,force:true});}});
for(const [key,value]of Object.entries({source_commit:'c'.repeat(40),snapshot_sha256:'d'.repeat(64),progress_sha256:'e'.repeat(64),run_tag:'other101',profile:'other',serial:'other',company_id:'11111111-2222-4333-8444-555555555555',tenant_id:'22222222-3333-4444-8555-666666666666',company_config_version:15,video_ids:[other]}))test('producer错'+key+'拒绝，不触claim',async()=>{const f=fixture();try{f.descriptor[key]=value;snapshot(f.current,f.body);await assert.rejects(f.make().dedup(),/上游|PRODUCER/);assert.equal(f.calls.filter(q=>q.op==='claim_videos').length,0);}finally{rmSync(f.dir,{recursive:true,force:true});}});

test('原producer公司PG冻结核验失败不能靠descriptor自报通过',async()=>{const f=fixture();try{f.producerCompany.verified=false;await assert.rejects(f.make().dedup(),/上游|PRODUCER/);assert.equal(f.calls.filter(q=>q.op==='claim_videos').length,0);}finally{rmSync(f.dir,{recursive:true,force:true});}});
test('同公司原producer政策漂移仍拒绝',async()=>{const f=fixture();try{f.descriptor.policy_id='another-valid-policy';snapshot(f.current,f.body);await assert.rejects(f.make().dedup(),/上游|PRODUCER/);}finally{rmSync(f.dir,{recursive:true,force:true});}});
test('私有descriptor固定实际文件：拒权限、symlink、扩展授权字段，真实queue仅SELECT核producer公司',async()=>{
 const {readProducerDescriptor}=await import('../producer-descriptor.mjs'),{chmodSync,symlinkSync}=await import('node:fs'),{createRequire}=await import('node:module');const {queueRequest}=createRequire(import.meta.url)('../leadgen-queue.js');
 const f=fixture(),path=join(f.dir,'descriptor.json');try{
  writeFileSync(path,JSON.stringify(f.descriptor),{mode:0o600});assert.deepEqual(readProducerDescriptor(path),f.descriptor);
  chmodSync(path,0o644);assert.throws(()=>readProducerDescriptor(path),/PRODUCER/);chmodSync(path,0o600);symlinkSync(path,path+'.link');assert.throws(()=>readProducerDescriptor(path+'.link'));
  writeFileSync(path,JSON.stringify({...f.descriptor,allow_all:true}));assert.throws(()=>readProducerDescriptor(path),/PRODUCER/);
  const row={...config,run_id:source,snapshot:{...config}};let calls=0;const pool={query:async(sql,args)=>{calls++;assert.match(sql,/^SELECT /);assert.deepEqual(args,[company,source]);return {rows:[row]};}};
  assert.equal((await queueRequest(pool,{op:'verify_producer_company',run:'new102',line:'jinuo',descriptor:f.descriptor})).verified,true);
  for(const bad of [{run:''},{line:'yuesheng'}])await assert.rejects(queueRequest(pool,{op:'verify_producer_company',run:'new102',line:'jinuo',descriptor:f.descriptor,...bad}),/PRODUCER_REQUEST_SCOPE/);assert.equal(calls,1);row.snapshot.version=15;assert.equal((await queueRequest(pool,{op:'verify_producer_company',run:'new102',line:'jinuo',descriptor:f.descriptor})).verified,false);assert.equal(calls,2);
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});
