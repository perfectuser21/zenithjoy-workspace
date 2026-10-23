import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {queueRequest}=require('../leadgen-queue.js');
import {freezeFixture,companyFixture} from './company-config-fixture.mjs';
const cid='11111111-1111-4111-8111-111111111111',lid='22222222-2222-4222-8222-222222222222';
const policySnapshot=companyFixture();policySnapshot.runtime_config.comment_scoring.audiences=[{id:'test-audience',fields:{'意向信号':'报名','人群描述':'测试人群','排除信号':'泛失业'}}];
policySnapshot.runtime_config.routing={line_key:'jinuo'};
const policyDeps={freezeCompanyConfig:async()=>policySnapshot,judgePolicy:async()=>({grade:'A',audit:{model:'fake',response_id:'r1',policy_evidence:{audience_id:'test-audience',matched_rule:'报名',exclusion_rule:null,reason:'咨询报名'}}})};
function markPool({failOutbox=false}={}) {
 const calls=[],comment={id:cid,line_key:'jinuo',dedup_key:'comment1',nickname:'待核个人',douyin_id:'person987',profile_url:'https://www.douyin.com/user/person987',comment_body:'在哪里报名',source_video:'人工智能训练师',source_video_url:'https://www.douyin.com/video/7637880891511528896',harvest_batch:'source102',relevance:'相关',intent_grade:'A',judgment_reason:'真实原分档',judgment_config:{run_id:'score103',company_id:policySnapshot.company_id,tenant_id:policySnapshot.tenant_id,version:policySnapshot.version,policy_id:policySnapshot.policy_id}};
 const client={async query(sql,args){calls.push({sql,args});
  if(/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql))return {rows:[]};
  if(/SELECT \* FROM zenithjoy.leadgen_comments/.test(sql))return {rows:[comment]};
  if(/company_config_runs/.test(sql))return {rows:[{snapshot:policySnapshot,company_id:policySnapshot.company_id,tenant_id:policySnapshot.tenant_id,version:policySnapshot.version,run_id:args[0]}]};
  if(/leadgen_videos/.test(sql))return {rows:[{video_url:comment.source_video_url,title:comment.source_video,line_key:'jinuo',judgment_status:'matched'}]};
  if(/SELECT id, dup_hit_count/.test(sql))return {rows:[]};
  if(/INSERT INTO zenithjoy.leadgen_leads/.test(sql))return {rows:[{id:lid}]};
  if(/SELECT id,line_key,douyin_id FROM zenithjoy.leadgen_leads/.test(sql))return {rows:[{id:lid,line_key:'jinuo',douyin_id:'person987'}]};
  if(/INSERT INTO zenithjoy.leadgen_bridge_outbox/.test(sql)){if(failOutbox)throw Error('outbox unavailable');return {rows:[{id:cid}]};}
  return {rows:[],rowCount:1};
 },release(){calls.push({sql:'RELEASE'});}};
 return {calls,async connect(){return client},query:client.query.bind(client)};
}
test('103真实mark入口须同事务保comment→lead桥接意图，旧personal/A无native证明仍unknown',async()=>{
 const pool=markPool();await queueRequest(pool,{op:'mark_leads',line:'jinuo',run:'score103',source_run:'source102',limit:1},policyDeps);
 const i=pool.calls.findIndex(c=>/INSERT INTO zenithjoy.leadgen_bridge_outbox/.test(c.sql));
 assert.ok(i>0,'PG已标已分拣却没有durable飞书outbox意图，异步104永远读不到');
 assert.ok(i<pool.calls.findIndex(c=>c.sql==='COMMIT'));
 const intent=pool.calls[i];assert.ok(intent.args.includes(cid));assert.ok(intent.args.includes(lid));
 assert.ok(intent.args.some(v=>typeof v==='string'&&v.includes('unknown')),'无真实主页证据不能以personal/A冒ready');
});
test('旧评分 run 进入新标人 run 时 outbox 同时保存两种身份',async()=>{
 const pool=markPool();const r=await queueRequest(pool,{op:'mark_leads',line:'jinuo',run:'mark103-new',source_run:'source102',limit:1},policyDeps);
 assert.equal(r.marked,1);
 const insert=pool.calls.find(c=>/INSERT INTO zenithjoy.leadgen_bridge_outbox/.test(c.sql));assert.ok(insert);
 const payload=JSON.parse(insert.args[5]);assert.equal(payload.run,'mark103-new');assert.equal(payload.scoring_run,'score103');
 assert.equal(payload.comment_run,'source102');assert.equal(insert.args[3],'mark103-new');
});
test('103标记/outbox插入失败必须原评论与lead事务整体回滚，不丢重放意图',async()=>{
 const pool=markPool({failOutbox:true});await assert.rejects(queueRequest(pool,{op:'mark_leads',line:'jinuo',run:'score103',source_run:'source102',limit:1},policyDeps),/outbox unavailable/);
 assert.ok(pool.calls.some(c=>c.sql==='ROLLBACK'));assert.ok(!pool.calls.some(c=>c.sql==='COMMIT'));
});

test('103桥接资格必须独立使用native主页+V3，不能只沿用personal/A等级',async()=>{
 const {enqueueBridge}=require('../leadgen-outreach-bridge.js');let called=0;const client={query:async()=>({rows:[]})};
 const row={id:cid,line_key:'jinuo',nickname:'机构样本',douyin_id:'fixtureOrg',comment_body:'在哪里报名',intent_grade:'A',account_type:'personal',recipient_evidence:{version:1,fixture_native:true}};
 const result=await enqueueBridge(client,{lineKey:'jinuo',run:'score103',sourceRun:'source102',comment:row,lead:{id:lid},config:{version:3}},
  {qualifyRecipient:async(comment,config)=>{called++;assert.equal(comment.intent_grade,'A');assert.equal(config.version,3);return {status:'excluded',reason:'原V3同行机构排除'};}});
 assert.equal(called,1,'不能忽略新的独立资格输入');assert.equal(result.qualification.status,'excluded');assert.equal(row.intent_grade,'A','不得改原评分');
});

import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('QA 沙箱经真实 RPC 完成旧 score → 新 mark → bridge → 独立 104 准备',()=>{
 const dir=mkdtempSync(join(tmpdir(),'leadgen-103-full-sandbox-')),fixture=join(dir,'fixture.json'),output=join(dir,'state');
 const route=require('../line-routes.js').routeOf('jinuo'),p=pendingBridge().payload;
 const snapshot=structuredClone(policySnapshot);snapshot.config_status='enabled';snapshot.runtime_config.policy_id=snapshot.policy_id;
 snapshot.runtime_config.contact_rules={status:'verified',ssot:'feishu',feishu_base:route.base,orders_table:route.lead,approved_scripts_table:route.script};
 snapshot.runtime_config.platform_accounts=[{verification_status:'verified',enabled:true,profile:'legacy',douyin_id:'sender987',device_serial:'sandbox'}];
 const row={id:cid,line_key:'jinuo',dedup_key:'sandbox-comment',nickname:p.nickname,douyin_id:p.target_douyin_id,
  profile_url:p.profile_url,comment_body:p.comment_body,source_video:p.source_video,source_video_url:p.source_video_url,
  harvest_batch:'source102',collected_at:p.collected_at,process_status:'待分拣',relevance:null,intent_grade:null,
  recipient_evidence:p.recipient_evidence,response:{primary_grade:'A',policy_grade:'A',recipient_choice:'passed',
   policy_evidence:{audience_id:'test-audience',matched_rule:'报名',exclusion_rule:null,reason:'报名咨询'}}};
 writeFileSync(fixture,JSON.stringify({snapshot,rows:[row],line:'jinuo',run:'score103',mark_run:'mark103-new',contact_run:'contact104',
  source_run:'source102',limit:1,profile:'legacy',sender_douyin_id:'sender987',video:{video_id:p.recipient_evidence.scope.video_id,
   video_url:p.source_video_url,title:p.source_video}}));
 const cli=new URL('./helpers/leadgen-103-sandbox.mjs',import.meta.url).pathname;
 for(const mode of ['score','score_readback','policy_review','mark_leads','mark_readback','bridge_outreach','bridge_readback','claim_outreach','prepare_outreach']){
  const result=spawnSync(process.execPath,[cli,mode,'--fixture',fixture,'--output',output],{encoding:'utf8'});
  assert.equal(result.status,0,`${mode}: ${result.stdout}${result.stderr}`);
  const body=JSON.parse(result.stdout);if(mode==='score')assert.equal(body.rows[0].judgment_config.run_id,'score103');
  if(mode==='mark_leads')assert.equal(body.outbox[0]?.payload.scoring_run,'score103');
  if(['score_readback','policy_review','mark_readback','bridge_readback'].includes(mode))assert.equal(body.result.verified,true,`${mode}: ${result.stdout}`);
  if(mode==='prepare_outreach')assert.equal(body.result.prepared,true);
 }
});
function pendingBridge(){
 const p={version:1,line_key:'jinuo',run:'score103',scoring_run:'score103',source_run:'source102',comment_id:cid,lead_id:lid,lead_identity:{id:lid,line_key:'jinuo',douyin_id:'person987'},target_douyin_id:'person987',nickname:'待核个人',comment_body:'在哪里报名',profile_url:'https://www.douyin.com/user/person987',source_video:'人工智能训练师',source_video_url:'https://www.douyin.com/video/7637880891511528896',collected_at:'2026-10-13T00:00:00Z',intent_grade:'A',judgment_reason:'原分档',qualification:{status:'passed',company_id:'company1',company_version:3,tenant_id:'tenant1',policy_id:'policy3'}};
 const pkg='com.ss.android.ugc.aweme',vid='7637880891511528896',prefix='source102-v'+vid+'-collection';
 const profile=`<hierarchy><node package="${pkg}" text="待核个人" content-desc="待核个人，复制名字和修改备注"/><node package="${pkg}" text="抖音号：person987"/><node package="${pkg}" text="普通职员，想学习AI考证"/></hierarchy>`;
 const returned=`<hierarchy><node package="${pkg}" class="android.widget.TextView" resource-id="${pkg}:id/title" text="4条评论"/><node package="${pkg}" class="android.widget.EditText" resource-id="${pkg}:id/ety"/><node package="${pkg}" text="待核个人"/><node package="${pkg}" class="android.widget.FrameLayout" resource-id="${pkg}:id/fhn" text="" content-desc="待核个人,在哪里报名,09-27, · 山东,回复 按钮,"/></hierarchy>`;
 const hash=v=>require('crypto').createHash('sha256').update(v).digest('hex');
 p.comment_run='source102';p.recipient_evidence={version:1,status:'verified',scope:{comment_encoding:'canonical',line_key:'jinuo',run:'source102',profile:'legacy',video_id:vid,video_url:p.source_video_url,douyin_id:p.target_douyin_id,nickname:p.nickname,comment_body_sha256:hash(p.comment_body),profile_eid:prefix+'-person1-t1',video_identity_eid:prefix+'-after-card1'},raw:{profile,returned},sha256:{profile:hash(profile),returned:hash(returned)},video_identity:{verified:true,content_type:'video',expected_video_id:vid,observed_video_id:vid,evidence_id:prefix+'-after-card1'}};
 return {id:cid,line_key:'jinuo',run_tag:p.run,payload:p,payload_sha256:require('../leadgen-outreach-bridge.js').digest(p),qualification_status:'passed',state:'pending',created_at:'2026-10-14T00:00:00Z'};
}
function bridgeStore(row){
 const calls=[];return {calls,async query(sql,args){calls.push({sql,args});
  if(/SELECT \* FROM zenithjoy.leadgen_bridge_outbox/.test(sql))return {rows:[row]};
  if(/SET state='attempted'/.test(sql)){row.state='attempted';row.fields=JSON.parse(args[2]);row.fields_sha256=args[3];return {rows:[row],rowCount:1};}
  if(/SET state='confirmed'/.test(sql)){row.state='confirmed';row.feishu_record_id=args[2];return {rows:[row],rowCount:1};}
  return {rows:[],rowCount:1};
 }};
}
test('103正常mark活动须消费durable bridge，不等待104 preflight',async()=>{
 const {createHandlers}=await import(process.env.BRIDGE_WORKFLOW_MODULE||'../leadgen-workflow.mjs');const d=mkdtempSync(join(tmpdir(),'async-mark-'));
 try{const calls=[];const h=createHandlers({root:d,env:{P:'legacy',SERIAL:'mock',WFR_TAG:'score103',LEADGEN_LINE:'jinuo',WFR_RUN_DIR:d,WF_HOME:d,HOME:d},rpc:async b=>{calls.push(b.request.op);return {result:b.request.op==='mark_leads'?{marked:1,ids:[cid],lead_ids:[lid]}:b.request.op==='mark_readback'?{verified:true,failures:0}:{published:1,unknown:0,verified:true,failures:0,ids:[]}};}});
 await h.mark_leads();assert.ok(calls.includes('bridge_outreach'),'103仍只写PG，104原飞书表没有生产者');
 }finally{rmSync(d,{recursive:true,force:true});}
});
test('桥接POST前durable attempted；响应未知仅GET匹配marker/UID/payload，重放不能POST第二次',async()=>{
 const row=pendingBridge(),pool=bridgeStore(row),events=[],remote=[];let posts=0,gets=0;
 const api={all:async()=>{events.push('get');gets++;if(gets===2)throw Error('first readback unavailable');return remote;},fields:async()=>[{field_name:'采集时间',type:1}],post:async fields=>{posts++;events.push('post');assert.equal(row.state,'attempted');remote.push({record_id:'recABC123456',fields});throw Error('HTTP response unknown');}};
 const opts={client:api,lock:async(_line,fn)=>fn(),freezeCompanyConfig:async()=>({company_id:'company1',version:3,tenant_id:'tenant1',policy_id:'policy3'}),reviewPolicy:async()=>({status:'pass'})};
 const first=await queueRequest(pool,{op:'bridge_outreach',line:'jinuo',run:'score103',limit:1},opts);
 assert.equal(posts,1);assert.equal(first.published,0);assert.equal(first.verified,false);assert.equal(row.state,'attempted');assert.ok(pool.calls.some(c=>/SET state='attempted'/.test(c.sql)));
 const second=await queueRequest(pool,{op:'bridge_outreach',line:'jinuo',run:'score103retry',limit:1},opts);
 assert.equal(posts,1,'未知结果不能盲POST重发');assert.equal(row.state,'confirmed');assert.equal(second.published,1);
});

test('104旧personal/A飞书待触达行缺独立native资格不能领取，protected原行保持',async()=>{
 const {outreachRequest}=require('../leadgen-outreach-orders.js');
 const row={record_id:'recOLD123456',fields:{'抖音昵称':'旧机构','抖音号':'legacyOrg','主页链接':'https://www.douyin.com/user/legacyOrg','AI判断理由':'[A级] 报名','状态':'待触达'}};let puts=0;
 const client={all:async()=>[row],put:async(_id,fields)=>{puts++;Object.assign(row.fields,fields);},get:async()=>row};
 const result=await outreachRequest({op:'claim_outreach',line:'jinuo',run:'contact104',limit:1,profile:'legacy',sender_douyin_id:'sender987'},
  {sourceCommit:'a'.repeat(40),client,lock:async(_line,fn)=>fn(),eligibleOrders:async()=>[],policy:async()=>({template:{id:'approved',version:'B',message:'你好'}})});
 assert.deepEqual(result,[]);assert.equal(puts,0);assert.equal(row.fields['状态'],'待触达');
});
test('104已有confirmed outbox的政策复核失败时不可成为可领订单',async()=>{
 const bridge=require('../leadgen-outreach-bridge.js'),route=require('../line-routes.js').routeOf('jinuo'),row=pendingBridge();
 row.state='confirmed';row.feishu_record_id='recABC123456';row.fields=bridge.buildOrderFields(row,route,[{field_name:'采集时间',type:1}]);row.fields_sha256=bridge.digest(row.fields);
 const remote=[{record_id:row.feishu_record_id,fields:structuredClone(row.fields)}];
 const pool={async query(){return {rows:[row]}}};
 const opts={pool,freezeCompanyConfig:async()=>({company_id:'company1',tenant_id:'tenant1',version:3,policy_id:'policy3'}),reviewPolicy:async()=>({status:'fail'})};
 assert.deepEqual(await bridge.eligibleOrders(route,remote,{run:'contact104'},opts),[]);
});
test('旧 score → 新 mark → 104 准备前复核使用各自冻结 run',async()=>{
 const bridge=require('../leadgen-outreach-bridge.js'),route=require('../line-routes.js').routeOf('jinuo'),row=pendingBridge();
 row.payload.run='mark103-new';row.payload.scoring_run='score103';row.run_tag='mark103-new';
 Object.assign(row.payload.qualification,{company_id:policySnapshot.company_id,tenant_id:policySnapshot.tenant_id,company_version:policySnapshot.version,policy_id:policySnapshot.policy_id});
 row.payload_sha256=bridge.digest(row.payload);
 row.state='confirmed';row.feishu_record_id='recABC123456';
 const comment={id:cid,line_key:'jinuo',harvest_batch:'source102',source_video:row.payload.source_video,
  source_video_url:row.payload.source_video_url,comment_body:row.payload.comment_body,relevance:'相关',intent_grade:'A',
  judgment_config:{run_id:'score103',company_id:policySnapshot.company_id,tenant_id:policySnapshot.tenant_id,version:policySnapshot.version,policy_id:policySnapshot.policy_id}};
 const seen=[];const pool={async query(sql,args=[]){seen.push({sql,args});
  if(sql.includes('leadgen_bridge_outbox'))return {rows:[row]};if(sql.includes('company_config_runs'))return {rows:[{run_id:args[0],snapshot:policySnapshot,company_id:policySnapshot.company_id,tenant_id:policySnapshot.tenant_id,version:policySnapshot.version}]};
  if(sql.includes('leadgen_comments'))return {rows:[comment]};if(sql.includes('leadgen_videos'))return {rows:[{video_url:comment.source_video_url,title:comment.source_video,line_key:'jinuo',judgment_status:'matched'}]};throw Error('unexpected SQL');}};
 const record={record_id:row.feishu_record_id,fields:{'抖音号':row.payload.target_douyin_id,'主页链接':row.payload.profile_url}};
 const ok=await bridge.reviewPreparedOrder(route,record,{pool,run:'contact104',freezeCompanyConfig:async()=>policySnapshot,
  reviewPolicy:(...args)=>require('../leadgen-queue.js').reviewBoundComment(...args, {judgePolicy:policyDeps.judgePolicy})});
 assert.equal(ok,true);assert.ok(seen.some(x=>x.sql.includes('company_config_runs')&&x.args[0]==='mark103-new'));
 assert.ok(seen.some(x=>x.sql.includes('company_config_runs')&&x.args[0]==='score103'));
 assert.equal(await bridge.reviewPreparedOrder(route,record,{pool,run:'mark103-new',freezeCompanyConfig:async()=>policySnapshot}),false);
});
test('旧 score → 新 mark 的唯一订单可由独立 104 run 领单并准备，沙箱无发送',async()=>{
 const bridge=require('../leadgen-outreach-bridge.js'),orders=require('../leadgen-outreach-orders.js'),route=require('../line-routes.js').routeOf('jinuo');
 const row=pendingBridge();row.payload.run='mark103-new';row.payload.scoring_run='score103';row.run_tag='mark103-new';
 Object.assign(row.payload.qualification,{company_id:policySnapshot.company_id,tenant_id:policySnapshot.tenant_id,company_version:policySnapshot.version,policy_id:policySnapshot.policy_id});
 row.payload_sha256=bridge.digest(row.payload);row.state='confirmed';row.feishu_record_id='recABC123456';
 row.fields=bridge.buildOrderFields(row,route,[{field_name:'采集时间',type:1}]);row.fields_sha256=bridge.digest(row.fields);
 const comment={id:cid,line_key:'jinuo',harvest_batch:'source102',source_video:row.payload.source_video,
  source_video_url:row.payload.source_video_url,comment_body:row.payload.comment_body,relevance:'相关',intent_grade:'A',
  judgment_config:{run_id:'score103',company_id:policySnapshot.company_id,tenant_id:policySnapshot.tenant_id,version:policySnapshot.version,policy_id:policySnapshot.policy_id}};
 const pool={async query(sql,args=[]){if(sql.includes('leadgen_bridge_outbox'))return {rows:[row]};
  if(sql.includes('company_config_runs'))return {rows:[{run_id:args[0],snapshot:policySnapshot,company_id:policySnapshot.company_id,tenant_id:policySnapshot.tenant_id,version:policySnapshot.version}]};
  if(sql.includes('leadgen_comments'))return {rows:[comment]};if(sql.includes('leadgen_videos'))return {rows:[{video_url:comment.source_video_url,title:comment.source_video,line_key:'jinuo',judgment_status:'matched'}]};throw Error('unexpected SQL');}};
 const record={record_id:row.feishu_record_id,fields:{...row.fields}},client={all:async()=>[record],get:async()=>record,
  put:async(_id,fields)=>{Object.assign(record.fields,fields);}};
 const reviewPolicy=(...args)=>require('../leadgen-queue.js').reviewBoundComment(...args,{judgePolicy:policyDeps.judgePolicy});
 const eligible=(route,all,input)=>bridge.eligibleOrders(route,all,input,{pool,freezeCompanyConfig:async()=>policySnapshot,reviewPolicy});
 const sourceCommit='a'.repeat(40),run='contact104',profile='legacy',sender_douyin_id='sender987';
 const claimed=await orders.outreachRequest({op:'claim_outreach',line:'jinuo',run,limit:1,profile,sender_douyin_id},
  {sourceCommit,client,lock:async(_line,fn)=>fn(),eligibleOrders:eligible,policy:async()=>({template:{id:'approved',version:'B',message:'你好，请查看资料'}})});
 assert.equal(claimed.length,1);assert.equal(claimed[0].id,row.feishu_record_id);
 const prepared=await orders.outreachRequest({op:'prepare_outreach',line:'jinuo',run,id:claimed[0].id,profile,sender_douyin_id,
  script_id:claimed[0].script_id,script_version:claimed[0].script_version,message_sha256:require('crypto').createHash('sha256').update(claimed[0].message).digest('hex'),
  target_douyin_id:claimed[0].douyin_id,profile_url:claimed[0].profile_url},
  {sourceCommit,client,lock:async(_line,fn)=>fn(),pool,freezeCompanyConfig:async()=>policySnapshot,reviewPolicy});
 assert.equal(prepared.prepared,true);assert.match(record.fields['回复结果'],/\[104 prepared:contact104:/);
});
test('104同一飞书订单映射多个outbox时不允许任选一个CID领单',async()=>{
 const bridge=require('../leadgen-outreach-bridge.js'),route=require('../line-routes.js').routeOf('jinuo'),row=pendingBridge();
 row.state='confirmed';row.feishu_record_id='recABC123456';row.fields=bridge.buildOrderFields(row,route,[{field_name:'采集时间',type:1}]);row.fields_sha256=bridge.digest(row.fields);
 const duplicate={...row,id:'00000000-0000-4000-8000-000000000099'};
 const remote=[{record_id:row.feishu_record_id,fields:structuredClone(row.fields)}];
 const pool={async query(){return {rows:[row,duplicate]}}};
 const opts={pool,freezeCompanyConfig:async()=>({company_id:'company1',tenant_id:'tenant1',version:3,policy_id:'policy3'}),reviewPolicy:async()=>({status:'pass'})};
 assert.deepEqual(await bridge.eligibleOrders(route,remote,{run:'contact104'},opts),[]);
});
test('bridge本次扫描越过前十个政策阻断outbox检查后续合格项',async()=>{
 const rows=Array.from({length:11},(_,i)=>{const r=pendingBridge();r.id=`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`;r.payload.comment_id=r.id;r.payload_sha256=require('../leadgen-outreach-bridge.js').digest(r.payload);return r;});
 const visited=[];const pool={async query(sql,args=[]){if(sql.includes('SELECT * FROM zenithjoy.leadgen_bridge_outbox'))return {rows:rows.slice(0,args[1])};return {rows:[]};}};
 const result=await require('../leadgen-outreach-bridge.js').bridgeOutreach(pool,{line:'jinuo',run:'score103',limit:10},{lock:async(_line,fn)=>fn(),freezeCompanyConfig:async()=>({company_id:'company1',tenant_id:'tenant1',version:3,policy_id:'policy3'}),reviewPolicy:async(_pool,_line,id)=>{visited.push(id);return {status:id===rows[10].id?'pass':'unknown'};},client:{all:async()=>{throw Error('offline')}}});
 assert.ok(visited.includes(rows[10].id));assert.equal(result.verified,false);
});
test('已领订单prepare时原103资格版本与当前冻结104版本不符必须阻断',async()=>{
 const bridge=require('../leadgen-outreach-bridge.js'),route=require('../line-routes.js').routeOf('jinuo'),row=pendingBridge();row.state='confirmed';row.feishu_record_id='recABC123456';
 const pool={async query(){return {rows:[row]}}},record={record_id:row.feishu_record_id,fields:{'抖音号':row.payload.target_douyin_id,'主页链接':row.payload.profile_url}};
 const allowed=await bridge.reviewPreparedOrder(route,record,{pool,run:'contact104',freezeCompanyConfig:async()=>({company_id:'company1',tenant_id:'tenant1',version:4,policy_id:'policy3'}),reviewPolicy:async()=>({status:'pass'})});
 assert.equal(allowed,false);
});

test('同昵称旧PGlead UID不同不能把comment→lead别名冒成ready身份',()=>{
 const {nativeIntent}=require('../leadgen-outreach-bridge.js');const row=pendingBridge();row.payload.lead_identity={id:lid,line_key:'jinuo',douyin_id:'other987'};row.payload_sha256=require('../leadgen-outreach-bridge.js').digest(row.payload);
 assert.throws(()=>nativeIntent(row),/BRIDGE_/);
});
test('未知POST读回须核持久fields hash，篡改expected payload不能假confirmed',()=>{
 const {fieldsMatch,buildOrderFields}=require('../leadgen-outreach-bridge.js'),{routeOf}=require('../line-routes.js');const row=pendingBridge();row.fields=buildOrderFields(row,routeOf('jinuo'),[{field_name:'采集时间',type:1}]);row.fields_sha256='0'.repeat(64);
 assert.equal(fieldsMatch(row,{record_id:'recABC123456',fields:structuredClone(row.fields)}),false);
});

test('桥接HTTP分页有本RPC总截止，过期后不能继续请求或POST，原orderClient默认不改',async()=>{
 const {orderClient}=require('../leadgen-outreach-orders.js');let calls=0;
 const fetcher=async(_url,opts)=>{calls++;assert.ok(opts.signal);return {ok:true,json:async()=>({code:0,tenant_access_token:'fake-token',data:{items:[],has_more:true,page_token:'next'}})};};
 const route=require('../line-routes.js').routeOf('jinuo'),client=await orderClient(route,{deadlineAt:Date.now()+10000,fetcher,read:()=>JSON.stringify({[route.account]:{appId:'fake',appSecret:'fake'}})});
 await assert.rejects(client.all({deadlineAt:Date.now()-1}),/BRIDGE_DEADLINE/);
 assert.equal(calls,1,'已截止不允许任何新分页请求');
});

test('103桥接必须核本run冻结公司版本，旧资格不能POST新版本订单',async()=>{
 const row=pendingBridge(),pool=bridgeStore(row);let posts=0;
 const r=await queueRequest(pool,{op:'bridge_outreach',line:'jinuo',run:'new103',limit:1},{client:{all:async()=>[],fields:async()=>[{field_name:'采集时间',type:1}],post:async()=>{posts++;}},lock:async(_line,fn)=>fn(),freezeCompanyConfig:async()=>({company_id:'company1',version:4})});
 assert.equal(posts,0);assert.equal(r.verified,false);assert.equal(r.unknown,1);
});
test('103标人独立读回必须核真实comment→lead outbox，缺意图不能宣称verified',async()=>{
 const calls=[],pool={query:async(sql,args)=>{calls.push({sql,args});if(sql.includes('leadgen_comments'))return {rows:[{id:cid,relevance:'相关',intent_grade:'A',process_status:'已分拣'}]};if(sql.includes('leadgen_leads'))return {rows:[{id:lid}]};return {rows:[]};}};
 const r=await queueRequest(pool,{op:'mark_readback',line:'jinuo',run:'score103',ids:[cid],lead_ids:[lid]});
 assert.equal(r.verified,false);assert.ok(r.failures>0);assert.ok(calls.some(c=>c.sql.includes('leadgen_bridge_outbox')));
});

test('bridge独立PG读回确认已落实处置，缺行/仍attempted/篡改payload不得完成',async()=>{
 const row=pendingBridge();row.state='excluded';row.qualification_status='excluded';row.payload.qualification.status='excluded';row.payload_sha256=require('../leadgen-outreach-bridge.js').digest(row.payload);
 const pool={query:async()=>({rows:[row]})};const input={op:'bridge_readback',line:'jinuo',run:'score103',ids:[cid]};
 assert.equal((await queueRequest(pool,input)).verified,true);
 for(const change of [{rows:[]},{rows:[{...row,state:'attempted'}]},{rows:[{...row,payload_sha256:'0'.repeat(64)}]}])assert.equal((await queueRequest({query:async()=>change},input)).verified,false);
});

test('Postgres JSONB键序重排后payload/fields语义相同仍应独立验收，值变化仍拒绝',()=>{
 const {nativeIntent,fieldsMatch,buildOrderFields}=require('../leadgen-outreach-bridge.js'),{routeOf}=require('../line-routes.js');const row=pendingBridge();
 const reorder=v=>Array.isArray(v)?v.map(reorder):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).reverse().map(([k,x])=>[k,reorder(x)])):v;
 row.fields=buildOrderFields(row,routeOf('jinuo'),[{field_name:'采集时间',type:1}]);row.fields_sha256=require('../leadgen-outreach-bridge.js').digest(row.fields);
 row.payload=reorder(row.payload);row.fields=reorder(row.fields);
 assert.equal(nativeIntent(row).target_douyin_id,'person987');assert.equal(fieldsMatch(row,{fields:structuredClone(row.fields)}),true);
 row.payload.nickname='别人';assert.throws(()=>nativeIntent(row),/BRIDGE_/);
});

test('bridge同company不同tenant/原policy版本也不得发布，不能只比company_id',async()=>{
 const row=pendingBridge(),pool=bridgeStore(row);let posts=0;
 const r=await queueRequest(pool,{op:'bridge_outreach',line:'jinuo',run:'score103',limit:1},{client:{all:async()=>[],fields:async()=>[{field_name:'采集时间',type:1}],post:async()=>{posts++;}},lock:async(_line,fn)=>fn(),freezeCompanyConfig:async()=>({company_id:'company1',version:3,tenant_id:'differentTenant',policy_id:'differentPolicy'})});
 assert.equal(posts,0);assert.equal(r.verified,false);
});

test('资格unknown旧意图不能重复占满异步领取上限并饿死新pending，attempted仍可GET恢复',async()=>{
 const row=pendingBridge();row.state='unknown';row.qualification_status='unknown';let selected='';const pool={query:async sql=>{if(sql.includes('SELECT *')){selected=sql;return {rows:[]};}return {rows:[],rowCount:1};}};
 await queueRequest(pool,{op:'bridge_outreach',line:'jinuo',run:'next103',limit:2},{lock:async(_line,fn)=>fn(),freezeCompanyConfig:async()=>({company_id:'company1',tenant_id:'tenant1',policy_id:'policy3',version:3})});
 assert.ok(!/state IN \('pending','attempted','unknown'\)/.test(selected),'资格unknown已真实hold，不可再次占原领取窗口');assert.match(selected,/CASE WHEN state='pending' THEN 0/);assert.match(selected,/'attempted'/);
});

test('原飞书采集时间须使用源comment collected_at，不能变成103桥建单时刻',()=>{
 const {buildOrderFields}=require('../leadgen-outreach-bridge.js'),{routeOf}=require('../line-routes.js');const row=pendingBridge();row.payload.collected_at='2026-10-13T01:02:03Z';row.payload_sha256=require('../leadgen-outreach-bridge.js').digest(row.payload);
 const fields=buildOrderFields(row,routeOf('jinuo'),[{field_name:'采集时间',type:5}]);assert.equal(fields['采集时间'],Date.parse(row.payload.collected_at));
});

import {spawn} from 'node:child_process';
test('原line锁真实进程崩溃后可在死owner证明下恢复，活owner仍拒竞争',async()=>{
 const {withOrderLock}=require('../leadgen-outreach-orders.js'),d=mkdtempSync(join(tmpdir(),'bridge-dead-owner-')),module=require.resolve('../leadgen-outreach-orders.js');
 const child=spawn(process.execPath,['-e',`const {withOrderLock}=require(${JSON.stringify(module)});withOrderLock('jinuo',async()=>{console.log('HELD');setInterval(()=>{},1000);await new Promise(()=>{});},{directory:process.argv[1]}).catch(e=>{console.error(e.message);process.exitCode=1;});`,d],{stdio:['ignore','pipe','pipe']});
 try{await new Promise((ok,bad)=>{const timer=setTimeout(()=>bad(Error('owner start bounded timeout')),5000);child.stdout.once('data',()=>{clearTimeout(timer);ok();});child.once('error',bad);});
 await assert.rejects(withOrderLock('jinuo',async()=>{}, {directory:d}),/锁忙/);
 const done=new Promise(ok=>child.once('close',ok));child.kill('SIGKILL');await done;
 let executed=0;await withOrderLock('jinuo',async()=>{executed++;},{directory:d});assert.equal(executed,1);
 }finally{if(child.exitCode===null)child.kill('SIGKILL');rmSync(d,{recursive:true,force:true});}
});

// 显式批次范围必须先于任何桥接行处置或外部访问；同公司/版本不能替代SOURCE_RUN。
const sourceScopeDeps={lock:async(_line,fn)=>fn(),freezeCompanyConfig:async()=>({company_id:'company1',tenant_id:'tenant1',version:3,policy_id:'policy3'})};
test('103显式SOURCE_RUN必须进入bridge SQL选择，而非仅line扫描',async()=>{
 const calls=[],pool={query:async(sql,args)=>{calls.push({sql,args});return {rows:[]};}};
 await require('../leadgen-outreach-bridge.js').bridgeOutreach(pool,{line:'jinuo',run:'score103-new',source_run:'new102',limit:1},sourceScopeDeps);
 const selection=calls.find(c=>c.sql.includes('SELECT * FROM zenithjoy.leadgen_bridge_outbox'));
 assert.ok(selection.args.includes('new102'),'SQL必须绑定请求的实际source_run');
 assert.match(selection.sql,/source_run\s*=\s*\$[0-9]/,'SQL必须对source_run精确限批');
});
for(const qualification of ['excluded','unknown'])test(`103 scoped桥接在${qualification}旧批行UPDATE之前拒绝越批`,async()=>{
 const old=pendingBridge();old.source_run='source102';old.qualification_status=qualification;
 const calls=[],pool={query:async(sql,args)=>{calls.push({sql,args});return {rows:sql.includes('SELECT * FROM zenithjoy.leadgen_bridge_outbox')?[old]:[],rowCount:1};}};
 const result=await require('../leadgen-outreach-bridge.js').bridgeOutreach(pool,{line:'jinuo',run:'score103-new',source_run:'new102',limit:1},sourceScopeDeps);
 assert.deepEqual(calls.filter(c=>/^UPDATE /.test(c.sql)),[],'越批行不得先修改状态');assert.ok(!result.ids.includes(old.id),'旧行不可消耗本批处置数量');
});
test('103 scoped桥接在旧批passed行policy或远端访问前拒绝；同来源仍可核原policy',async()=>{
 const row=pendingBridge();row.source_run='source102';let policies=0,external=0;
 const pool={query:async()=>({rows:[row]})};const deps={...sourceScopeDeps,reviewPolicy:async()=>{policies++;return {status:'unknown'};},client:{all:async()=>{external++;return [];},post:async()=>{external++;}}};
 await require('../leadgen-outreach-bridge.js').bridgeOutreach(pool,{line:'jinuo',run:'score103-new',source_run:'new102',limit:1},deps);
 assert.equal(policies,0,'越批行在policy/外部动作前拒绝');assert.equal(external,0);
 await require('../leadgen-outreach-bridge.js').bridgeOutreach(pool,{line:'jinuo',run:'score103-new',source_run:'source102',limit:1},deps);
 assert.equal(policies,1,'同批仍沿原政策核验，不得全部禁用桥接');assert.equal(external,0);
});
for(const field of ['source_run','comment_run'])test(`103显式批次即使row匹配但payload.${field}矛盾也不处置且保unknown`,async()=>{
 const bridge=require('../leadgen-outreach-bridge.js'),row=pendingBridge();row.source_run='source102';row.payload[field]='other102';
 row.qualification_status='excluded';row.payload.qualification.status='excluded';row.payload_sha256=bridge.digest(row.payload);
 const pool=bridgeStore(row);let external=0,policies=0;
 const result=await bridge.bridgeOutreach(pool,{line:'jinuo',run:'score103-new',source_run:'source102',limit:1},{...sourceScopeDeps,reviewPolicy:async()=>{policies++;return {status:'pass'};},client:{all:async()=>{external++;return [];},post:async()=>{external++;}}});
 assert.deepEqual(pool.calls.filter(c=>/^UPDATE /.test(c.sql)),[]);assert.equal(policies,0);assert.equal(external,0);
 assert.equal(result.verified,false);assert.equal(result.unknown,1);assert.deepEqual(result.ids,[]);
});
for(const field of ['source_run','payload.source_run','payload.comment_run'])test(`103独立readback显式批次拒绝错位${field}`,async()=>{
 const bridge=require('../leadgen-outreach-bridge.js'),row=pendingBridge();row.source_run='source102';row.state='excluded';row.qualification_status='excluded';row.payload.qualification.status='excluded';
 if(field==='source_run')row.source_run='other102';else row.payload[field.split('.')[1]]='other102';row.payload_sha256=bridge.digest(row.payload);
 const result=await bridge.readbackBridge(bridgeStore(row),{line:'jinuo',run:'score103-new',source_run:'source102',ids:[row.id]});
 assert.equal(result.verified,false);assert.ok(result.failures>0);
});
test('103显式同批仍走原durable POST→GET并独立PG读回，无真实外发',async()=>{
 const row=pendingBridge();row.source_run='source102';const pool=bridgeStore(row),events=[],remote=[];
 const client={all:async()=>{events.push('get');return remote;},fields:async()=>[{field_name:'采集时间',type:1}],post:async fields=>{events.push('post');assert.equal(row.state,'attempted');remote.push({record_id:'recABC123456',fields:structuredClone(fields)});}};
 const result=await queueRequest(pool,{op:'bridge_outreach',line:'jinuo',run:'score103',source_run:'source102',limit:1},{...sourceScopeDeps,client,reviewPolicy:async()=>({status:'pass'})});
 assert.deepEqual(events,['get','post','get']);assert.equal(result.published,1);assert.equal(result.verified,true);assert.equal(row.state,'confirmed');
 const readback=await queueRequest(pool,{op:'bridge_readback',line:'jinuo',run:'score103',source_run:'source102',ids:result.ids});
 assert.equal(readback.verified,true);assert.deepEqual(readback.ids,[row.id]);
});
