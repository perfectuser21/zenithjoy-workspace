import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {queueRequest}=require('../leadgen-queue.js');
import {freezeFixture} from './company-config-fixture.mjs';
const cid='11111111-1111-4111-8111-111111111111',lid='22222222-2222-4222-8222-222222222222';
function markPool({failOutbox=false}={}) {
 const calls=[],comment={id:cid,line_key:'jinuo',dedup_key:'comment1',nickname:'待核个人',douyin_id:'person987',profile_url:'https://www.douyin.com/user/person987',comment_body:'在哪里报名',source_video:'人工智能训练师',source_video_url:'https://www.douyin.com/video/7637880891511528896',harvest_batch:'source102',relevance:'相关',intent_grade:'A',judgment_reason:'真实原分档'};
 const client={async query(sql,args){calls.push({sql,args});
  if(/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql))return {rows:[]};
  if(/SELECT \* FROM zenithjoy.leadgen_comments/.test(sql))return {rows:[comment]};
  if(/SELECT id, dup_hit_count/.test(sql))return {rows:[]};
  if(/INSERT INTO zenithjoy.leadgen_leads/.test(sql))return {rows:[{id:lid}]};
  if(/INSERT INTO zenithjoy.leadgen_bridge_outbox/.test(sql)){if(failOutbox)throw Error('outbox unavailable');return {rows:[{id:cid}]};}
  return {rows:[],rowCount:1};
 },release(){calls.push({sql:'RELEASE'});}};
 return {calls,async connect(){return client},query:client.query.bind(client)};
}
test('103真实mark入口须同事务保comment→lead桥接意图，旧personal/A无native证明仍unknown',async()=>{
 const pool=markPool();await queueRequest(pool,{op:'mark_leads',line:'jinuo',run:'score103',source_run:'source102',limit:1},{freezeCompanyConfig:freezeFixture});
 const i=pool.calls.findIndex(c=>/INSERT INTO zenithjoy.leadgen_bridge_outbox/.test(c.sql));
 assert.ok(i>0,'PG已标已分拣却没有durable飞书outbox意图，异步104永远读不到');
 assert.ok(i<pool.calls.findIndex(c=>c.sql==='COMMIT'));
 const intent=pool.calls[i];assert.ok(intent.args.includes(cid));assert.ok(intent.args.includes(lid));
 assert.ok(intent.args.some(v=>typeof v==='string'&&v.includes('unknown')),'无真实主页证据不能以personal/A冒ready');
});
test('103标记/outbox插入失败必须原评论与lead事务整体回滚，不丢重放意图',async()=>{
 const pool=markPool({failOutbox:true});await assert.rejects(queueRequest(pool,{op:'mark_leads',line:'jinuo',run:'score103',source_run:'source102',limit:1},{freezeCompanyConfig:freezeFixture}),/outbox unavailable/);
 assert.ok(pool.calls.some(c=>c.sql==='ROLLBACK'));assert.ok(!pool.calls.some(c=>c.sql==='COMMIT'));
});

test('103桥接资格必须独立使用native主页+V3，不能只沿用personal/A等级',async()=>{
 const {enqueueBridge}=require('../leadgen-outreach-bridge.js');let called=0;const client={query:async()=>({rows:[]})};
 const row={id:cid,line_key:'jinuo',nickname:'机构样本',douyin_id:'fixtureOrg',comment_body:'在哪里报名',intent_grade:'A',account_type:'personal',recipient_evidence:{version:1,fixture_native:true}};
 const result=await enqueueBridge(client,{lineKey:'jinuo',run:'score103',sourceRun:'source102',comment:row,lead:{id:lid},config:{version:3}},
  {qualifyRecipient:async(comment,config)=>{called++;assert.equal(comment.intent_grade,'A');assert.equal(config.version,3);return {status:'excluded',reason:'原V3同行机构排除'};}});
 assert.equal(called,1,'不能忽略新的独立资格输入');assert.equal(result.qualification.status,'excluded');assert.equal(row.intent_grade,'A','不得改原评分');
});

import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
function pendingBridge(){
 const p={version:1,line_key:'jinuo',run:'score103',source_run:'source102',comment_id:cid,lead_id:lid,target_douyin_id:'person987',nickname:'待核个人',comment_body:'在哪里报名',profile_url:'https://www.douyin.com/user/person987',source_video:'人工智能训练师',source_video_url:'https://www.douyin.com/video/7637880891511528896',intent_grade:'A',judgment_reason:'原分档',qualification:{status:'passed',company_id:'company1',company_version:3}};
 const pkg='com.ss.android.ugc.aweme',vid='7637880891511528896',prefix='source102-v'+vid+'-collection';
 const profile=`<hierarchy><node package="${pkg}" text="待核个人" content-desc="待核个人，复制名字和修改备注"/><node package="${pkg}" text="抖音号：person987"/><node package="${pkg}" text="普通职员，想学习AI考证"/></hierarchy>`;
 const returned=`<hierarchy><node package="${pkg}" class="android.widget.TextView" resource-id="${pkg}:id/title" text="4条评论"/><node package="${pkg}" class="android.widget.EditText" resource-id="${pkg}:id/ety"/><node package="${pkg}" text="待核个人"/><node package="${pkg}" text="在哪里报名"/></hierarchy>`;
 const hash=v=>require('crypto').createHash('sha256').update(v).digest('hex');
 p.comment_run='source102';p.recipient_evidence={version:1,status:'verified',scope:{line_key:'jinuo',run:'source102',profile:'legacy',video_id:vid,video_url:p.source_video_url,douyin_id:p.target_douyin_id,nickname:p.nickname,comment_body_sha256:hash(p.comment_body),profile_eid:prefix+'-person1-t1',video_identity_eid:prefix+'-after-card1'},raw:{profile,returned},sha256:{profile:hash(profile),returned:hash(returned)},video_identity:{verified:true,content_type:'video',expected_video_id:vid,observed_video_id:vid,evidence_id:prefix+'-after-card1'}};
 return {id:cid,line_key:'jinuo',payload:p,payload_sha256:require('crypto').createHash('sha256').update(JSON.stringify(p)).digest('hex'),qualification_status:'passed',state:'pending',created_at:'2026-10-14T00:00:00Z'};
}
function bridgeStore(row){
 const calls=[];return {calls,async query(sql,args){calls.push({sql,args});
  if(/SELECT \* FROM zenithjoy.leadgen_bridge_outbox/.test(sql))return {rows:[row]};
  if(/SET state='attempted'/.test(sql)){row.state='attempted';row.fields=JSON.parse(args[2]);return {rows:[row],rowCount:1};}
  if(/SET state='confirmed'/.test(sql)){row.state='confirmed';row.feishu_record_id=args[2];return {rows:[row],rowCount:1};}
  return {rows:[],rowCount:1};
 }};
}
test('103正常mark活动须消费durable bridge，不等待104 preflight',async()=>{
 const {createHandlers}=await import(process.env.BRIDGE_WORKFLOW_MODULE||'../leadgen-workflow.mjs');const d=mkdtempSync(join(tmpdir(),'async-mark-'));
 try{const calls=[];const h=createHandlers({root:d,env:{P:'legacy',SERIAL:'mock',WFR_TAG:'score103',LEADGEN_LINE:'jinuo',WFR_RUN_DIR:d,WF_HOME:d,HOME:d},rpc:async b=>{calls.push(b.request.op);return {result:b.request.op==='mark_leads'?{marked:1,ids:[cid],lead_ids:[lid]}:b.request.op==='mark_readback'?{verified:true,failures:0}:{published:1,unknown:0,verified:true}};}});
 await h.mark_leads();assert.ok(calls.includes('bridge_outreach'),'103仍只写PG，104原飞书表没有生产者');
 }finally{rmSync(d,{recursive:true,force:true});}
});
test('桥接POST前durable attempted；响应未知仅GET匹配marker/UID/payload，重放不能POST第二次',async()=>{
 const row=pendingBridge(),pool=bridgeStore(row),events=[],remote=[];let posts=0,gets=0;
 const api={all:async()=>{events.push('get');gets++;if(gets===2)throw Error('first readback unavailable');return remote;},fields:async()=>[{field_name:'采集时间',type:1}],post:async fields=>{posts++;events.push('post');assert.equal(row.state,'attempted');remote.push({record_id:'recABC123456',fields});throw Error('HTTP response unknown');}};
 const opts={client:api,lock:async(_line,fn)=>fn(),freezeCompanyConfig:async()=>({company_id:'company1',version:3})};
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

test('同昵称旧PGlead UID不同不能把comment→lead别名冒成ready身份',()=>{
 const {nativeIntent}=require('../leadgen-outreach-bridge.js');const row=pendingBridge();row.payload.lead_identity={id:lid,line_key:'jinuo',douyin_id:'other987'};row.payload_sha256=require('crypto').createHash('sha256').update(JSON.stringify(row.payload)).digest('hex');
 assert.throws(()=>nativeIntent(row),/BRIDGE_/);
});
test('未知POST读回须核持久fields hash，篡改expected payload不能假confirmed',()=>{
 const {fieldsMatch,buildOrderFields}=require('../leadgen-outreach-bridge.js'),{routeOf}=require('../line-routes.js');const row=pendingBridge();row.fields=buildOrderFields(row,routeOf('jinuo'),[{field_name:'采集时间',type:1}]);row.fields_sha256='0'.repeat(64);
 assert.equal(fieldsMatch(row,{record_id:'recABC123456',fields:structuredClone(row.fields)}),false);
});
