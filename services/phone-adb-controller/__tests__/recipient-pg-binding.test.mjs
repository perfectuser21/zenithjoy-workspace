import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseCollection,createHandlers} from '../leadgen-workflow.mjs';
import {companyFixture} from './company-config-fixture.mjs';
import {parse as parseYaml} from 'yaml';
const require=createRequire(import.meta.url);
const evidence=require('../queued-recipient-evidence.js');
const {queueRequest}=require('../leadgen-queue.js');
const pkg='com.ss.android.ugc.aweme',vid='7637880891511528896',run='source102',sourceRun='source101';
const prefix=`${run}-v${vid}-collection`;
const profileXml=`<hierarchy><node package="${pkg}" text="本人" content-desc="本人，复制名字和修改备注"/><node package="${pkg}" text="抖音号：person987"/><node package="${pkg}" text="企业负责人"/></hierarchy>`;
const returnedXml=`<hierarchy><node package="${pkg}" class="android.widget.TextView" resource-id="${pkg}:id/title" text="4条评论"/><node package="${pkg}" class="android.widget.EditText" resource-id="${pkg}:id/ety"/><node package="${pkg}" class="android.widget.FrameLayout" resource-id="${pkg}:id/fhn" text="" content-desc="本人,在哪里报名,09-27, · 山东,回复 按钮,"/></hierarchy>`;
function binding(){return {company_id:'11111111-1111-4111-8111-111111111111',tenant_id:'22222222-2222-4222-8222-222222222222',version:3,run_id:run,line_key:'yuesheng',source_run:sourceRun,profile:'cloud-phone-test',device_serial:'47.100.213.173:10001',douyin_id:'perfect21xx',verification_status:'verified',enabled:true};}
function native(b=binding()){
 const scope={comment_encoding:'canonical',line_key:b.line_key,run,source_run:sourceRun,video_id:vid,video_url:`https://www.douyin.com/video/${vid}`,profile:b.profile,douyin_id:'person987',nickname:'本人',comment_body_sha256:evidence.hash('在哪里报名'),profile_eid:prefix+'-person1-t1',video_identity_eid:prefix+'-after-card1'};
 return {version:1,receipt_id:'33333333-3333-4333-8333-333333333333',status:'verified',scope,company_binding:b,raw:{profile:profileXml,returned:returnedXml},sha256:{profile:evidence.hash(profileXml),returned:evidence.hash(returnedXml)},video_identity:{verified:true,content_type:'video',expected_video_id:vid,observed_video_id:vid,evidence_id:scope.video_identity_eid}};
}
const scope=e=>({...e.scope,comment_body:'在哪里报名'});
function frozenRow(b=binding()){
 const snapshot={company_id:b.company_id,tenant_id:b.tenant_id,version:b.version,config_status:'enabled',runtime_config:{routing:{line_key:b.line_key,profiles:[b.profile]},platform_accounts:[{company_id:b.company_id,tenant_id:b.tenant_id,platform:'douyin',profile:b.profile,device_serial:b.device_serial,douyin_id:b.douyin_id,verification_status:'verified',enabled:true}]}};
 return {company_id:b.company_id,tenant_id:b.tenant_id,version:b.version,run_id:b.run_id,source_run:b.source_run,task_inputs:{device_binding:{profile:b.profile,device_serial:b.device_serial}},snapshot};
}
test('已冻结PG云账号context允许真实native证据，caller自报绑定单独不能授权',()=>{
 const e=native();
 assert.equal(evidence.validateEvidence(e,scope(e),{companyBinding:binding()}).native_profile_verified,true);
 assert.throws(()=>evidence.validateEvidence(e,scope(e)),/RECIPIENT_/);
});
test('云capture读取本run私有绑定原件并保留严格XML/VID证明',()=>{
 const d=mkdtempSync(join(tmpdir(),'cloud-recipient-binding-')),runDir=join(d,'run'),phone=join(d,'phone'),root=join(phone,'evidence','cloud-phone-test');mkdirSync(runDir);mkdirSync(root,{recursive:true});
 const e=native(),profilePath=join(root,e.scope.profile_eid+'-profile.xml'),returnedPath=join(root,e.scope.profile_eid+'-returned.xml'),bindingFile=join(runDir,run+'-company-binding.json');
 writeFileSync(profilePath,profileXml);writeFileSync(returnedPath,returnedXml);writeFileSync(join(runDir,run+'-identity-'+vid+'.json'),JSON.stringify(e.video_identity));writeFileSync(bindingFile,JSON.stringify(binding()),{mode:0o600});
 const old=process.env.DOUYIN_PHONE_TMP_ROOT;process.env.DOUYIN_PHONE_TMP_ROOT=phone;
 try{const result=evidence.capture({runDir,line:'yuesheng',run,sourceRun,videoId:vid,videoUrl:e.scope.video_url,profile:'cloud-phone-test',douyinId:'person987',nickname:'本人',commentBody:'在哪里报名',started:Math.floor(Date.now()/1000)-1,profilePath,returnedPath,profileEid:e.scope.profile_eid,videoEid:e.scope.video_identity_eid,companyBindingFile:bindingFile,companyBindingSha:evidence.hash(readFileSync(bindingFile))});assert.deepEqual(JSON.parse(readFileSync(result.file)).company_binding,binding());}
 finally{if(old===undefined)delete process.env.DOUYIN_PHONE_TMP_ROOT;else process.env.DOUYIN_PHONE_TMP_ROOT=old;rmSync(d,{recursive:true,force:true});}
});
test('collect真实队列从原102 PG冻结选定设备派生授权，不接受仅声明profile',async()=>{
 const b=binding(),e=native(b),calls=[];
 const client={release(){},async query(sql,args){calls.push([sql,args]);if(sql.includes('company_config_runs'))return {rows:[frozenRow()]};if(sql.includes('FROM zenithjoy.leadgen_videos'))return {rows:[{video_id:vid,video_url:e.scope.video_url,judgment_status:'matched',url_bindings:1}]};if(sql.includes('INSERT INTO zenithjoy.leadgen_comments'))return {rows:[{id:'comment1'}]};return {rows:[]};}};
 const r=await queueRequest({connect:async()=>client},{op:'collect_partial',line:'yuesheng',run,source_run:sourceRun,video_id:vid,video_url:e.scope.video_url,comments:[{douyinId:'person987',nickname:'本人',commentBody:'在哪里报名',sourceVideoUrl:e.scope.video_url,recipientEvidence:e}]});
 assert.equal(r.inserted,1);assert.ok(calls.some(([sql])=>sql.includes('company_config_runs')));
});
test('MMV102预检把本run选定设备冻结进已有task_inputs，不能事后换同公司账号',async()=>{
 let options;
 const b=binding(),row=frozenRow();
 const r=await queueRequest({}, {op:'company_config',line:'yuesheng',run,source_run:sourceRun,step:'102',device_binding:{profile:b.profile,device_serial:b.device_serial}},{freezeCompanyConfig:async(_pool,o)=>{options=o;return row.snapshot;}});
 assert.deepEqual(options.taskInputs,{device_binding:{profile:b.profile,device_serial:b.device_serial}});
 assert.equal(r.device_binding.douyin_id,b.douyin_id);
});
for(const field of ['company_id','tenant_id','platform'])test('MMV102首次绑定拒绝账号声明异公司/平台 '+field,async()=>{
 const s=frozenRow().snapshot;s.runtime_config.platform_accounts[0][field]='other';
 await assert.rejects(()=>queueRequest({}, {op:'company_config',line:'yuesheng',run,source_run:sourceRun,step:'102',device_binding:{profile:binding().profile,device_serial:binding().device_serial}},{freezeCompanyConfig:async()=>s}),/COMPANY_ACCOUNT_DEVICE_NOT_VERIFIED/);
});
test('历史102来源授权仅读既有冻结行；不按当前账号配置补造旧run',async()=>{
 const {readCollectionAccountBinding}=require('../company-config-lib.js');
 const queries=[];const pool={query:async(sql,args)=>{queries.push([sql,args]);return {rows:[frozenRow()]};}};
 assert.deepEqual(await readCollectionAccountBinding(pool,{lineKey:'yuesheng',run,sourceRun}),binding());
 assert.ok(queries.every(([sql])=>/^SELECT\b/.test(sql.trim())));
 assert.ok(queries[0][1].includes(run));
});
for(const [name,change] of Object.entries({
 missing:()=>[],ambiguous:r=>[r,structuredClone(r)],unselected:r=>{r.task_inputs={};return [r];},different_selected:r=>{r.task_inputs.device_binding.profile='other';return [r];},
 wrong_run:r=>{r.run_id='other102';return [r];},wrong_source:r=>{r.source_run='other101';return [r];},wrong_company:r=>{r.company_id='other';return [r];},wrong_tenant:r=>{r.tenant_id='other';return [r];},wrong_version:r=>{r.version=4;return [r];},
 wrong_line:r=>{r.snapshot.runtime_config.routing.line_key='jinuo';return [r];},unrouted:r=>{r.snapshot.runtime_config.routing.profiles=[];return [r];},disabled:r=>{r.snapshot.runtime_config.platform_accounts[0].enabled=false;return [r];},unverified:r=>{r.snapshot.runtime_config.platform_accounts[0].verification_status='unverified';return [r];},
 duplicate:r=>{r.snapshot.runtime_config.platform_accounts.push(structuredClone(r.snapshot.runtime_config.platform_accounts[0]));return [r];},different_serial:r=>{r.snapshot.runtime_config.platform_accounts[0].device_serial='other';return [r];},
 account_company:r=>{r.snapshot.runtime_config.platform_accounts[0].company_id='other';return [r];},account_tenant:r=>{r.snapshot.runtime_config.platform_accounts[0].tenant_id='other';return [r];},account_platform:r=>{r.snapshot.runtime_config.platform_accounts[0].platform='wechat';return [r];},account_identity_missing:r=>{delete r.snapshot.runtime_config.platform_accounts[0].company_id;return [r];}
}))test('PG原102来源拒绝 '+name,async()=>{
 const {readCollectionAccountBinding}=require('../company-config-lib.js');
 const pool={query:async()=>({rows:change(frozenRow())})};
 await assert.rejects(()=>readCollectionAccountBinding(pool,{lineKey:'yuesheng',run,sourceRun}),/COMPANY_COLLECTION_BINDING_INVALID/);
});
test('parseCollection必须显式消费预检同run绑定，工件自带绑定不能自证',()=>{
 const d=mkdtempSync(join(tmpdir(),'recipient-cloud-parse-')),e=native(),file=join(d,`${e.scope.profile_eid}-recipient-${e.receipt_id}.json`);writeFileSync(file,JSON.stringify(e),{mode:0o600});
 const out=`RECIPIENT_PROOF\t${vid}\tperson987\t${e.scope.comment_body_sha256}\t${file}\t${evidence.hash(readFileSync(file))}\nLEAD\t本人\tperson987\tpersonal\t在哪里报名\t09-27\t山东\t企业AI\t关键词\t山东\thttps://www.douyin.com/user/person987\t${e.scope.video_url}\nCOLLECTION\t${vid}\tcollected\t1`;
 const recipientScope={runDir:d,lineKey:'yuesheng',run,sourceRun,profile:e.scope.profile,companyBinding:binding()};
 try{assert.equal(parseCollection({code:0,stdout:out},vid,{recipientScope})[0].recipientEvidence.status,'verified');assert.throws(()=>parseCollection({code:0,stdout:out},vid,{recipientScope:{...recipientScope,companyBinding:undefined}}),/RECIPIENT_/);}
 finally{rmSync(d,{recursive:true,force:true});}
});
test('103资格按原102来源授权读取native，当前公司评分规则独立保留',async()=>{
 const e=native(),b=binding(),snapshot=companyFixture();Object.assign(snapshot,{company_id:b.company_id,tenant_id:b.tenant_id,version:4});snapshot.runtime_config.comment_scoring.audiences=[{name:'企业客户',exclusion_signals:['同行']}];
 const comment={line_key:'yuesheng',harvest_batch:run,douyin_id:'person987',nickname:'本人',comment_body:'在哪里报名',source_video_url:e.scope.video_url,recipient_evidence:e};
 let called=0;const r=await require('../judge-recipient.js').qualifyRecipient(comment,snapshot,{companyBinding:b,apiKey:'fixture',httpPost:async()=>{called++;return {answers:{recipient:{choice:'passed',confidence:.99}}};}});
 assert.equal(r.status,'passed');assert.equal(r.company_version,4);assert.equal(called,1);
});
test('103实际enqueueBridge从原102 PG行传授权，不从评论的自报binding授权',async()=>{
 const b=binding(),e=native(),client={query:async sql=>sql.includes('company_config_runs')?{rows:[frozenRow()]}:sql.includes('FROM zenithjoy.leadgen_leads')?{rows:[{id:'lead1',line_key:'yuesheng',douyin_id:'person987'}]}:{rows:[]}};
 let seen;
 await require('../leadgen-outreach-bridge.js').enqueueBridge(client,{lineKey:'yuesheng',run:'score103',sourceRun:run,comment:{id:'comment1',line_key:'yuesheng',harvest_batch:run,douyin_id:'person987',recipient_evidence:e},lead:{id:'lead1'},config:{}},{qualifyRecipient:async(_c,_s,options)=>{seen=options?.companyBinding;return {status:'unknown'};}});
 assert.deepEqual(seen,b);
});
test('103真实bridge配送/读回可核云来源；104消费仍不因云来源自动获准',async()=>{
 const bridge=require('../leadgen-outreach-bridge.js'),b=binding(),e=native();
 const payload={version:1,line_key:'yuesheng',run:'score103',source_run:run,comment_run:run,comment_id:'comment1',lead_id:'lead1',lead_identity:{id:'lead1',line_key:'yuesheng',douyin_id:'person987'},target_douyin_id:'person987',nickname:'本人',comment_body:'在哪里报名',profile_url:'https://www.douyin.com/user/person987',source_video:'企业AI',source_video_url:e.scope.video_url,collected_at:'2026-10-16T08:00:00Z',intent_grade:'A',judgment_reason:'原评分',recipient_evidence:e,qualification:{status:'passed',company_id:b.company_id,tenant_id:b.tenant_id,company_version:4,policy_id:'policy4'}};
 const row={id:'33333333-3333-4333-8333-333333333333',line_key:'yuesheng',payload,payload_sha256:bridge.digest(payload),state:'pending',qualification_status:'passed'};
 const pool={async query(sql,args){
  if(sql.includes('company_config_runs'))return {rows:[frozenRow()]};
  if(sql.includes('SELECT * FROM zenithjoy.leadgen_bridge_outbox'))return {rows:[row]};
  if(sql.includes("SET state='attempted'")){Object.assign(row,{state:'attempted',fields:JSON.parse(args[2]),fields_sha256:args[3]});return {rows:[row],rowCount:1};}
  if(sql.includes("SET state='confirmed'")){Object.assign(row,{state:'confirmed',feishu_record_id:args[2]});return {rows:[row],rowCount:1};}
  return {rows:[],rowCount:1};
 }};
 const remote=[],freezeCompanyConfig=async()=>({company_id:b.company_id,tenant_id:b.tenant_id,version:4,policy_id:'policy4'});
 let posts=0;const result=await bridge.bridgeOutreach(pool,{line:'yuesheng',run:'score103',limit:1},{freezeCompanyConfig,lock:async(_line,fn)=>fn(),client:{all:async()=>remote,fields:async()=>[{field_name:'采集时间',type:1}],post:async fields=>{posts++;remote.push({record_id:'recABC123456',fields});}}});
 assert.equal(result.published,1);assert.equal(result.verified,true);assert.equal(posts,1);assert.equal((await bridge.readbackBridge(pool,{line:'yuesheng',ids:[row.id]})).verified,true);
 const ready=await bridge.eligibleOrders(require('../line-routes.js').routeOf('yuesheng'),remote,{run:'contact104'},{pool,freezeCompanyConfig});assert.deepEqual(ready,[]);
 assert.throws(()=>bridge.nativeIntent(row),/RECIPIENT_/,'104无显式新来源授权context不得放行');
 await assert.rejects(()=>require('../leadgen-outreach-orders.js').outreachRequest({op:'claim_outreach',line:'yuesheng',run:'contact104',profile:'cloud-phone-test',sender_douyin_id:'perfect21xx'},{sourceCommit:'a'.repeat(40)}),/触达profile或账号绑定缺失/);
 row.payload.qualification.company_id='other-company';row.payload_sha256=bridge.digest(row.payload);
 assert.throws(()=>bridge.nativeIntent(row,{companyBinding:b}),/BRIDGE_COMPANY_SOURCE_INVALID/);
});
for(const [name,change] of Object.entries({company_id:b=>b.company_id='other',tenant_id:b=>b.tenant_id='other',version:b=>b.version++,run_id:b=>b.run_id='another102',source_run:b=>b.source_run='another101',profile:b=>b.profile='other',device_serial:b=>b.device_serial='other',douyin_id:b=>b.douyin_id='other',enabled:b=>b.enabled='true',verification_status:b=>b.verification_status='draft'}))test('原生证据自报绑定不能替换PG context '+name,()=>{
 const e=native();change(e.company_binding);assert.throws(()=>evidence.validateEvidence(e,scope(e),{companyBinding:binding()}),/RECIPIENT_COMPANY_BINDING_INVALID/);
});
test('有合法PG绑定也不能绕过原生XML SHA/主体UID/实际VID',()=>{
 for(const change of [e=>e.sha256.profile='0'.repeat(64),e=>{e.raw.profile=e.raw.profile.replace('person987','wrong987');e.sha256.profile=evidence.hash(e.raw.profile);},e=>e.video_identity.observed_video_id='7637880891511528999']){
  const e=native();change(e);assert.throws(()=>evidence.validateEvidence(e,scope(e),{companyBinding:binding()}),/RECIPIENT_/);
 }
});
test('103 PG原102来源缺失保持unknown且不调用资格模型',async()=>{
 let called=0;const client={query:async sql=>sql.includes('FROM zenithjoy.leadgen_leads')?{rows:[{id:'lead1',line_key:'yuesheng',douyin_id:'person987'}]}:{rows:[]}};
 const r=await require('../leadgen-outreach-bridge.js').enqueueBridge(client,{lineKey:'yuesheng',run:'score103',sourceRun:run,comment:{id:'comment1',line_key:'yuesheng',harvest_batch:run,douyin_id:'person987',recipient_evidence:native()},lead:{id:'lead1'},config:{}},{qualifyRecipient:async()=>{called++;return {status:'passed'};}});
 assert.equal(r.qualification.status,'unknown');assert.equal(r.qualification.model_call_count,0);assert.equal(called,0);
});
test('MMV102真实preflight只在PG和当前原生账号均相等后写私有binding工件',async()=>{
 const d=mkdtempSync(join(tmpdir(),'recipient-real-preflight-')),b=binding(),calls=[];
 const env={HOME:d,WFR_RUN_DIR:d,WFR_HOSTKEY:'mmv',LEADGEN_MMV_DEVICE_RUNTIME:'1',WF_BRAIN_WORKFLOW:'douyin_video_processing',P:b.profile,SERIAL:b.device_serial,WFR_TAG:run,LEADGEN_LINE:b.line_key,LEADGEN_SOURCE_RUN:sourceRun,DOUYIN_PHONE_ADB:'/fixture/controller',DOUYIN_ADB_BIN:'/approved/adb'};
 const {line_key,source_run,...device_binding}=b;
 const h=createHandlers({root:d,env,rpc:async body=>({result:{company_id:b.company_id,tenant_id:b.tenant_id,version:b.version,run_id:run,device_binding}}),execute:async(command,args)=>{
  calls.push([command,args]);let stdout='';
  if(command==='/approved/adb')stdout=args.includes('get-state')?'device\n':args.includes('telephony.registry')?'mCallState=0\n':'';
  if(command==='/fixture/controller'){const op=args[2]==='--lock-owner'?args[4]:args[2];if(op==='preflight')stdout='serial='+b.device_serial+'\n';if(op==='lock-acquire')stdout='lock=acquired\n';if(op==='lock-refresh')stdout='lock=refreshed\n';if(op==='account-current')stdout='douyin_id='+b.douyin_id+'\n';}
  return {code:0,stdout,stderr:''};
 }});
 try{await h.preflight();const file=join(d,run+'-company-binding.json');assert.deepEqual(JSON.parse(readFileSync(file)),b);assert.ok(calls.some(([c,a])=>c==='/fixture/controller'&&a.includes('account-current')));await h.preflight();assert.deepEqual(JSON.parse(readFileSync(file)),b);}
 finally{rmSync(d,{recursive:true,force:true});}
});
test('PG来源授权helper进入三个实际消费Activity的固定Code集合，兼容新增方法有版本',()=>{
 const root=new URL('../../../',import.meta.url);
 for(const [flow,key,version] of [['douyin_video_processing','preflight','2.0.0'],['douyin_video_processing','collection','2.4.0'],['douyin_comment_scoring','mark_leads','3.1.0']]){
  const d=parseYaml(readFileSync(new URL('product-map/contracts/'+flow+'.yaml',root),'utf8')),a=d.activities.find(a=>a.key===key);
  assert.equal(a.version,version);assert.ok(a.implementation_bindings.some(b=>b.kind==='code'&&b.path==='services/phone-adb-controller/company-config-lib.js'));
 }
});
