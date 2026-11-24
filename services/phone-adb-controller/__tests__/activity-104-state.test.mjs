import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {syncLeadResult,readLeadResult} from '../activity-104-state.mjs';
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const hash=v=>createHash('sha256').update(v).digest('hex');
function fixture(outcome='sent'){
 const s={record_id:'rec104',comment_id:'00000000-0000-4000-8000-000000000103',lead_id:'00000000-0000-4000-8000-000000000104',target_douyin_id:'target104',profile_url:'https://www.douyin.com/user/target104',source_102_run:'collect102',source_103_run:'score103'};
 const t={task_id:'task104',run_id:'run104',run_tag:'tag104'},c={company_id:'00000000-0000-4000-8000-000000000101',tenant_id:'00000000-0000-4000-8000-000000000100',line:'line104',profile:'phone104',serial:'serial104',source_commit:'a'.repeat(40),sender_id:'sender104',tasks:{104:t},verification:{104:s,policy_version:34,policy_id:'policy104'}};
 const profile={company_id:c.company_id,tenant_id:c.tenant_id,config_version:34,runtime_config:{policy_id:'policy104'}};
 const payload={line_key:c.line,run:'mark-run',source_run:s.source_102_run,lead_id:s.lead_id,lead_identity:{id:s.lead_id,line_key:c.line,douyin_id:s.target_douyin_id},comment_id:s.comment_id,target_douyin_id:s.target_douyin_id,profile_url:s.profile_url,comment_run:s.source_102_run,scoring_run:s.source_103_run,qualification:{status:'passed',company_id:c.company_id,tenant_id:c.tenant_id,company_version:34,policy_id:'policy104'}};
 const outbox={id:'outbox104',line_key:c.line,comment_id:s.comment_id,lead_id:s.lead_id,feishu_record_id:s.record_id,state:'confirmed',qualification_status:'passed',run_tag:'mark-run',source_run:s.source_102_run,payload,payload_sha256:hash(canonical(payload))};
 const lead={id:s.lead_id,line_key:c.line,douyin_id:s.target_douyin_id,profile_url:s.profile_url,status:'待触达',send_status:'未发送',reached_at:null,script_version:null,feishu_record_id:null};
 const fields={'抖音号':s.target_douyin_id,'主页链接':s.profile_url,'实际分发号':'phone104(sender104)','话术ID':'task-task104','话术版本':'task-authorized','话术内容':'已批准正文','状态':outcome==='sent'?'已触达':'触达受阻','发送状态':outcome==='sent'?'已发送':'发送失败','触达时间':'2026-11-18T16:00:00.000Z'};
 fields['回复结果']=`[104 ${outcome}:${t.run_tag}:${c.source_commit}] ${hash(fields['话术内容'])} 送达未证`;
 const journal={scope:{...t,company_id:c.company_id,tenant_id:c.tenant_id,line:c.line,source:c.source_commit,profile:c.profile,serial:c.serial,sender_id:c.sender_id,profile_url:s.profile_url,record_id:s.record_id,comment_id:s.comment_id,target_douyin_id:s.target_douyin_id,message_sha256:hash(fields['话术内容'])},terminal_outcome:outcome,terminal_fields:structuredClone(fields)};
 journal.action_key=hash(canonical(journal.scope));
 const native={source_verified:true,outcome,sent_at_ms:Date.parse(fields['触达时间'])},record={record_id:s.record_id,fields};
 const counts={writes:0,connections:0,active:0},control={loseCommit:false,duplicateOutbox:false},queries=[];
 const pool={async connect(){counts.connections++;counts.active++;let closed=false;return {release(){assert.equal(closed,false);closed=true;counts.active--;},async query(sql,args=[]){queries.push({sql,args});
  if(/^(BEGIN|ROLLBACK|SET LOCAL)/.test(sql))return {rows:[]};
  if(sql==='COMMIT'){if(control.loseCommit){control.loseCommit=false;throw Error('COMMIT_REPLY_LOST');}return {rows:[]};}
  if(sql==='SELECT current_database() AS db')return {rows:[{db:'zenithjoy'}]};
  if(sql.includes('FROM zenithjoy.tenant_company_profiles'))return {rows:[structuredClone(profile)]};
  if(sql.includes('FROM zenithjoy.leadgen_bridge_outbox')){assert.deepEqual(args,[c.line,s.comment_id,s.lead_id,s.record_id]);return {rows:control.duplicateOutbox?[structuredClone(outbox),structuredClone(outbox)]:[structuredClone(outbox)]};}
  if(sql.includes('FROM zenithjoy.leadgen_leads')){assert.deepEqual(args,[s.lead_id,c.line]);return {rows:[structuredClone(lead)]};}
  if(sql.startsWith('UPDATE zenithjoy.leadgen_leads')){counts.writes++;assert.deepEqual(args.slice(0,2),[s.lead_id,c.line]);Object.assign(lead,{status:args[2],send_status:args[3],reached_at:args[4],script_version:args[5],feishu_record_id:args[6]});return {rows:[{id:s.lead_id}],rowCount:1};}
  throw Error('UNEXPECTED_SQL');}};}};
 return {c,s,profile,payload,outbox,lead,journal,record,native,counts,control,queries,args:{pool,context:c,scope:s,journal,record,native}};
}
test('PG exact terminal source writes only existing columns once and independently reads committed facts',async()=>{
 const f=fixture(),a=await syncLeadResult(f.args),b=await syncLeadResult(f.args);
 assert.equal(a.changed,true);assert.equal(b.changed,false);assert.equal(f.counts.writes,1);assert.equal(f.counts.active,0);
 assert.equal(a.lead.status,'已触达');assert.equal(a.lead.script_version,'task-authorized');assert.equal(a.order_fields.script_id,'task-task104');assert.equal(a.delivery_verified,false);
 assert.equal(Object.hasOwn(a.lead,'sender_id'),false);assert.equal(Object.hasOwn(a.lead,'script_id'),false);
 assert.ok(f.queries.some(q=>q.sql.endsWith('FOR UPDATE')));assert.ok(f.queries.some(q=>q.sql==='BEGIN READ ONLY'));
});
test('PG lost COMMIT reply is reconciled without a second UPDATE or external send',async()=>{
 const f=fixture();f.control.loseCommit=true;await assert.rejects(syncLeadResult(f.args),/COMMIT_REPLY_LOST/);
 const r=await syncLeadResult(f.args);assert.equal(r.changed,false);assert.equal(f.counts.writes,1);assert.equal(f.counts.active,0);
});
for(const outcome of ['restricted','rate_limited'])test('PG '+outcome+' is blocked delivery, never fabricated sent',async()=>{
 const f=fixture(outcome),r=await syncLeadResult(f.args);assert.equal(r.lead.status,'触达受阻');assert.equal(r.lead.send_status,'发送失败');assert.equal(r.delivery_verified,false);
});
test('PG unknown or unproven native outcome performs zero database operations',async()=>{
 for(const mutate of [f=>f.journal.terminal_outcome='unknown',f=>f.native.source_verified=false,f=>f.native.outcome='unknown']){
  const f=fixture();mutate(f);await assert.rejects(syncLeadResult(f.args),/LEAD_NATIVE_TERMINAL/);assert.equal(f.counts.connections,0);
 }
});
test('PG current policy, outbox source/company/hash and lead identities reject before UPDATE',async()=>{
 const mutations=[f=>f.profile.tenant_id='other',f=>f.profile.config_version=35,f=>f.outbox.payload_sha256='0'.repeat(64),f=>f.payload.comment_run='other',f=>f.payload.scoring_run='other',f=>f.payload.lead_id='other',f=>f.payload.qualification.company_id='other',f=>f.payload.target_douyin_id='other',f=>f.lead.douyin_id='other',f=>f.lead.profile_url='other',f=>f.lead.feishu_record_id='other',f=>f.control.duplicateOutbox=true];
 for(const mutate of mutations){const f=fixture();mutate(f);await assert.rejects(syncLeadResult(f.args),/LEAD_/);assert.equal(f.counts.writes,0);assert.equal(f.counts.active,0);}
});
test('PG locked outbox row/payload lineage cannot drift even with a recomputed payload digest',async()=>{
 for(const mutate of [f=>f.outbox.run_tag='different',f=>f.outbox.source_run='different',f=>f.payload.lead_identity.id='different',f=>f.payload.source_run='different']){
  const f=fixture();mutate(f);f.outbox.payload_sha256=hash(canonical(f.payload));await assert.rejects(syncLeadResult(f.args),/LEAD_OUTBOX_/);assert.equal(f.counts.writes,0);
 }
});
test('PG consumes the real enqueueBridge payload and digest rather than a parallel canonicalization',async()=>{
 const {enqueueBridge}=createRequire(import.meta.url)('../leadgen-outreach-bridge.js'),f=fixture();
 const comment={id:f.s.comment_id,line_key:f.c.line,harvest_batch:f.s.source_102_run,judgment_config:{run_id:f.s.source_103_run},douyin_id:f.s.target_douyin_id,profile_url:f.s.profile_url,nickname:'fixture',comment_body:'fixture',recipient_evidence:null};
 await enqueueBridge({query:async(sql,args)=>{
  if(sql.startsWith('SELECT'))return {rows:[{id:f.s.lead_id,line_key:f.c.line,douyin_id:f.s.target_douyin_id}]};
  f.outbox.payload=JSON.parse(args[5]);f.outbox.payload_sha256=args[6];return {rows:[]};
 }},{lineKey:f.c.line,run:'mark-run',sourceRun:f.s.source_102_run,comment,lead:{id:f.s.lead_id},config:{}},{qualifyRecipient:async()=>f.payload.qualification});
 assert.equal((await syncLeadResult(f.args)).lead.status,'已触达');assert.equal(f.counts.writes,1);
});
test('PG refuses conflicting prior terminal state and preserves every original value',async()=>{
 for(const mutate of [f=>f.lead.status='已触达',f=>f.lead.reached_at='2020-01-01',f=>f.lead.script_version='different']){
  const f=fixture();mutate(f);const old=structuredClone(f.lead);await assert.rejects(syncLeadResult(f.args),/LEAD_RESULT_CONFLICT/);assert.deepEqual(f.lead,old);assert.equal(f.counts.writes,0);
 }
});
test('PG wrong task, order, sender, message or actual timestamp cannot self-authorize result',async()=>{
 const mutations=[f=>f.journal.scope.task_id='other',f=>f.record.record_id='other',f=>f.record.fields['实际分发号']='other',f=>f.record.fields['话术内容']='other',f=>f.native.sent_at_ms++,f=>f.record.fields['话术版本']='guessed'];
 for(const mutate of mutations){const f=fixture();mutate(f);await assert.rejects(syncLeadResult(f.args),/LEAD_/);assert.equal(f.counts.connections,0);}
});
test('PG readLeadResult exposes original facts only with read-only transaction',async()=>{
 const f=fixture(),r=await readLeadResult(f.args);assert.deepEqual(r.lead,f.lead);assert.equal(r.source.record_id,'rec104');assert.equal(f.counts.writes,0);assert.equal(Object.hasOwn(r,'verified'),false);assert.ok(f.queries.some(q=>q.sql==='BEGIN READ ONLY'));assert.ok(!f.queries.some(q=>q.sql==='BEGIN'||q.sql==='COMMIT'));
});
test('real local scratch transaction persists exact source, replays once, and loses COMMIT acknowledgement safely',{skip:!process.env.ZJ_104_STATE_SCRATCH},async()=>{
 const require=createRequire(process.env.ZJ_104_PG_MODULE_ROOT||import.meta.url),{Pool}=require('pg');
 const actual=new Pool({host:'127.0.0.1',port:5432,database:'cecelia_scratch',max:2});
 const admin=await actual.connect(),schema='state104_'+createHash('sha256').update(String(process.pid)+String(Date.now())).digest('hex').slice(0,16);
 let created=false;
 try{
  assert.equal((await admin.query('SELECT current_database() AS db')).rows[0].db,'cecelia_scratch');
  assert.equal((await admin.query('SELECT inet_server_addr() AS addr')).rows[0].addr,'127.0.0.1');
  await admin.query('CREATE SCHEMA '+schema);created=true;
  await admin.query(`CREATE TABLE ${schema}.leadgen_leads(id uuid primary key,line_key text,douyin_id text,profile_url text,status text,send_status text,reached_at timestamptz,script_version text,feishu_record_id text,updated_at timestamptz);
   CREATE TABLE ${schema}.leadgen_bridge_outbox(id uuid primary key,line_key text,comment_id uuid,lead_id uuid,feishu_record_id text,state text,qualification_status text,payload jsonb,payload_sha256 text,run_tag text,source_run text);
   CREATE TABLE ${schema}.tenant_company_profiles(company_id uuid,tenant_id uuid,config_version integer,runtime_config jsonb);`);
  const f=fixture();await admin.query(`INSERT INTO ${schema}.tenant_company_profiles VALUES($1,$2,$3,$4)`,[f.c.company_id,f.c.tenant_id,34,f.profile.runtime_config]);
  await admin.query(`INSERT INTO ${schema}.leadgen_leads(id,line_key,douyin_id,profile_url,status,send_status) VALUES($1,$2,$3,$4,'待触达','未发送')`,[f.s.lead_id,f.c.line,f.s.target_douyin_id,f.s.profile_url]);
  await admin.query(`INSERT INTO ${schema}.leadgen_bridge_outbox VALUES($1,$2,$3,$4,$5,'confirmed','passed',$6,$7,$8,$9)`,['00000000-0000-4000-8000-000000000105',f.c.line,f.s.comment_id,f.s.lead_id,f.s.record_id,f.payload,f.outbox.payload_sha256,f.outbox.run_tag,f.outbox.source_run]);
  let lost=true,writes=0;
  // Only fixture namespace and database identity are adapted; the actual SQL/transaction executes in PG.
  const pool={async connect(){const db=await actual.connect();return {release:()=>db.release(),async query(sql,args){if(sql==='SELECT current_database() AS db')return {rows:[{db:'zenithjoy'}]};if(sql.startsWith('UPDATE '))writes++;const r=await db.query(sql.replaceAll('zenithjoy.',schema+'.'),args);if(sql==='COMMIT'&&lost){lost=false;throw Error('COMMIT_REPLY_LOST');}return r;}};}};
  await assert.rejects(syncLeadResult({...f.args,pool}),/COMMIT_REPLY_LOST/);
  const r=await syncLeadResult({...f.args,pool});assert.equal(r.changed,false);assert.equal(writes,1);
  const real=(await admin.query(`SELECT * FROM ${schema}.leadgen_leads WHERE id=$1`,[f.s.lead_id])).rows[0];
  assert.equal(real.status,'已触达');assert.equal(real.send_status,'已发送');assert.equal(real.reached_at.toISOString(),f.record.fields['触达时间']);assert.equal(real.feishu_record_id,f.s.record_id);assert.equal(real.script_version,'task-authorized');
  const before=JSON.stringify(real);f.native.outcome='unknown';await assert.rejects(syncLeadResult({...f.args,pool}),/LEAD_NATIVE_TERMINAL/);assert.equal(JSON.stringify((await admin.query(`SELECT * FROM ${schema}.leadgen_leads WHERE id=$1`,[f.s.lead_id])).rows[0]),before);
 }finally{if(created)await admin.query('DROP SCHEMA '+schema+' CASCADE');admin.release();await actual.end();}
});
test('104 accepts only the exact committed-partial comment as an alternative persisted 102 lineage',async()=>{
 const f=fixture();
 f.outbox.source_run=null;
 f.payload.source_run=null;
 f.payload.committed_partial_ids=[f.s.comment_id];
 f.outbox.payload_sha256=hash(canonical(f.payload));
 assert.equal((await readLeadResult(f.args)).source.source_102_run,f.s.source_102_run);
 for(const ids of [[],['different'],[f.s.comment_id,'different']]){
  f.payload.committed_partial_ids=ids;
  f.outbox.payload_sha256=hash(canonical(f.payload));
  await assert.rejects(readLeadResult(f.args),/LEAD_OUTBOX_LINEAGE/);
 }
});
test('104 direct-send repair uses the completed original task and verifies the same external order before updating PG once',async()=>{
 const {recoverDirectSentLead}=await import('../activity-104-state.mjs');
 const f=fixture();
 const approval='approval-for-one-order';
 const terminal=f.record.fields;
 terminal['话术ID']='session-'+approval;
 terminal['成功触达']='待确认';
 terminal['触达时间']=f.native.sent_at_ms;
 terminal['合规核验状态']=`[103 bridge:${f.outbox.id}:${f.outbox.payload_sha256}]`;
 f.outbox.fields={'抖音号':f.s.target_douyin_id,'主页链接':f.s.profile_url,'状态':'待触达','发送状态':'未发送'};
 f.outbox.fields_sha256=hash(canonical(f.outbox.fields));

 const ctx={...f.c,tasks:{104:{task_id:'task104',run_id:'task104',run_tag:'tag104'}}};
 const originalTask={id:'task104',status:'completed',result:{actor:'codex',status_detail:{
  order:{order_id:f.s.record_id,marker:'sent',own_marker:true,order_status:'已触达',send_status:'已发送',timestamp:f.native.sent_at_ms},
  send_outcome:'sent',native_command_calls:1,prepared_observed:true,delivery_verified:false,
 }}};
 const args={pool:f.args.pool,context:ctx,scope:f.s,record:f.record,originalTask,decisionId:approval,messageSha256:hash(terminal['话术内容'])};
 assert.equal((await recoverDirectSentLead({...args,dryRun:true})).lead.send_status,'未发送');
 assert.equal(f.counts.writes,0);
 const result=await recoverDirectSentLead(args);
 assert.equal(result.changed,true);
 assert.equal((await recoverDirectSentLead(args)).changed,false);
 assert.equal(f.counts.writes,1);
 assert.equal(result.lead.send_status,'已发送');
 const misleading=structuredClone(originalTask);misleading.result.status_detail.native_command_calls=2;
 await assert.rejects(recoverDirectSentLead({...args,originalTask:misleading}),/DIRECT_/);
 await assert.rejects(recoverDirectSentLead({...args,messageSha256:'a'.repeat(64)}),/DIRECT_/);
 assert.equal(f.counts.writes,1);
});
