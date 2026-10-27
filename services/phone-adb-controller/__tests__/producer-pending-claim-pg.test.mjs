import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url),{queueRequest}=require('../leadgen-queue.js');
const company='ef8e14b0-4018-4e54-bc7a-866e51a0ce0b',tenant='a4ca8914-f5a7-4928-b1e3-6b69f9c0ab61';
const source='cicdbeb_101_attempt2_20261027_a2dcb023',vid='7689863996204591985',other='7700112581541257551';
const descriptor={schema_version:2,workflow_key:'douyin_video_discovery',run_tag:source,source_commit:'beb37370c047a13013aa0cc997a0fecc09534dde',
  snapshot_sha256:'fe7da095eb9184ae5eba9c71af78b7c679a6f752509e5e8c5ed1a5a4288fee67',progress_sha256:'fbbee23e36623307ab19ca9abbfb1626e6b94a00e05439dad6f3add8174646bc',
  profile:'legacy',serial:'ANGYVB4402004137',line:'jinuo',company_id:company,tenant_id:tenant,company_config_version:14,policy_id:'jinoshengyuan-existing-acquisition-rules-v1',video_ids:[vid]};
const config={company_id:company,tenant_id:tenant,version:14,policy_id:descriptor.policy_id,config_status:'enabled',runtime_config:{routing:{line_key:'jinuo'},platform_accounts:[{profile:'legacy',device_serial:descriptor.serial,douyin_id:'44997267357',company_id:company,tenant_id:tenant,platform:'douyin',enabled:true,verification_status:'verified'}]}};
const request={op:'claim_videos',run:'pending_consumer_102',line:'jinuo',source_run:source,limit:1,config_required:true,video_ids:[vid],producer_descriptor:descriptor};
test('真实PG：v2 pending-only原子领取，不借15分钟租约恢复隔离/旧处理中',{skip:process.env.ZJ_METRICS_PG_REQUIRED!=='1'},async t=>{
  const {Pool}=require('pg'),pool=new Pool(),schema='producer_'+randomUUID().replaceAll('-','');let made=false;
  const rewrite=q=>q.replaceAll('zenithjoy.',schema+'.');
  const scoped={query:(q,a)=>pool.query(rewrite(q),a),connect:async()=>{const c=await pool.connect();return {query:(q,a)=>c.query(rewrite(q),a),release:e=>c.release(e)};}};
  const read=async()=> (await scoped.query('SELECT to_jsonb(v) AS row FROM zenithjoy.leadgen_videos v ORDER BY video_id')).rows.map(r=>r.row);
  const deps={freezeCompanyConfig:async()=>config};
  try{
    const {db}=(await pool.query('SELECT current_database() AS db')).rows[0];assert.match(db,/(?:^|_)scratch$/);
    await pool.query('CREATE SCHEMA '+schema);made=true;
    const ddl=readFileSync(new URL('../../../apps/api/db/migrations/20260922_220000_leadgen_ssot_tables.sql',import.meta.url),'utf8').match(/CREATE TABLE IF NOT EXISTS zenithjoy\.leadgen_videos \([\s\S]+?\n\);/)[0];
    await scoped.query(ddl);await scoped.query('ALTER TABLE zenithjoy.leadgen_videos ADD COLUMN judgment_config jsonb');
    await scoped.query('CREATE TABLE zenithjoy.company_config_runs(company_id uuid,tenant_id uuid,version int,run_id text,snapshot jsonb,source_run text,task_inputs jsonb)');
    const init=async()=>{
      await scoped.query('DELETE FROM zenithjoy.leadgen_videos');await scoped.query('DELETE FROM zenithjoy.company_config_runs');
      for(const [run,up]of [[source,null],[request.run,source]])await scoped.query('INSERT INTO zenithjoy.company_config_runs VALUES($1,$2,14,$3,$4::jsonb,$5,$6::jsonb)',[company,tenant,run,JSON.stringify(config),up,JSON.stringify(run===request.run?{device_binding:{profile:'legacy',device_serial:descriptor.serial}}:{})]);
      for(const [id,status,judgment]of [[vid,'待判定','pending'],[other,'待人工核验:old102','matched']])await scoped.query('INSERT INTO zenithjoy.leadgen_videos(line_key,video_id,video_url,harvest_batch,process_status,judgment_status) VALUES($1,$2,$3,$4,$5,$6)',['jinuo',id,'https://www.douyin.com/video/'+id,source,status,judgment]);
    };
    await t.test('合法原pending只领一次，旁manual全行不变',async()=>{await init();const before=await read();const rows=await queueRequest(scoped,request,deps);assert.deepEqual(rows.map(v=>v.video_id),[vid]);const after=await read();assert.deepEqual(after.find(v=>v.video_id===other),before.find(v=>v.video_id===other));assert.equal(after.find(v=>v.video_id===vid).harvest_batch,request.run);assert.deepEqual(await queueRequest(scoped,request,deps),[]);});
    for(const [name,set]of [['过期处理中',"process_status='处理中:old102',updated_at=now()-interval '1 hour'"],['已判合格',"judgment_status='matched'"],['隔离',"process_status='待人工核验:old102'"],['换上游批次',"harvest_batch='another101'"]])await t.test(name+'不能领取或改变旁行',async()=>{await init();await scoped.query('UPDATE zenithjoy.leadgen_videos SET '+set+' WHERE video_id=$1',[vid]);const before=await read();assert.deepEqual(await queueRequest(scoped,request,deps),[]);assert.deepEqual(await read(),before);});
    for(const [name,change]of [['多领取',q=>q.limit=2],['wrongVID',q=>q.video_ids=[other]],['wrongSource',q=>q.source_run='another101'],['wrongDescriptor',q=>q.producer_descriptor={...descriptor,video_ids:[other]}],['noConfig',q=>q.config_required=false],['matchedPriority',q=>q.prefer_matched=true]])await t.test(name+'请求拒绝不写',async()=>{await init();const before=await read(),q=structuredClone(request);change(q);await assert.rejects(queueRequest(scoped,q,deps),/PRODUCER/);assert.deepEqual(await read(),before);});
    for(const run of [source,request.run])await t.test(run+'公司冻结政策漂移拒绝',async()=>{await init();await scoped.query("UPDATE zenithjoy.company_config_runs SET snapshot=jsonb_set(snapshot,'{version}','15') WHERE run_id=$1",[run]);const before=await read();await assert.rejects(queueRequest(scoped,request,deps),/PRODUCER/);assert.deepEqual(await read(),before);});
    for(const [name,query,args]of [
      ['消费设备漂移',"UPDATE zenithjoy.company_config_runs SET task_inputs=jsonb_set(task_inputs,'{device_binding,device_serial}','\"other\"') WHERE run_id=$1",[request.run]],
      ['来源行被重新挂批',"UPDATE zenithjoy.company_config_runs SET source_run='foreign101' WHERE run_id=$1",[source]],
      ['账号停用',"UPDATE zenithjoy.company_config_runs SET snapshot=jsonb_set(snapshot,'{runtime_config,platform_accounts,0,enabled}','false') WHERE run_id=$1",[request.run]],
      ['同政策ID正文漂移',"UPDATE zenithjoy.company_config_runs SET snapshot=jsonb_set(snapshot,'{runtime_config,video_judgment}','{\"rules\":\"foreign\"}') WHERE run_id=$1",[request.run]]
    ])await t.test(name+'拒绝不写',async()=>{await init();await scoped.query(query,args);const before=await read();await assert.rejects(queueRequest(scoped,request,deps),/PRODUCER/);assert.deepEqual(await read(),before);});
    await t.test('pending行已有foreign资格配置不触碰',async()=>{await init();await scoped.query('UPDATE zenithjoy.leadgen_videos SET judgment_config=$1::jsonb WHERE video_id=$2',[JSON.stringify({company_id:'00000000-0000-4000-8000-000000000001'}),vid]);const before=await read();assert.deepEqual(await queueRequest(scoped,request,deps),[]);assert.deepEqual(await read(),before);});
    await t.test('两并发请求只一领取，事务锁不重领',async()=>{await init();const r=await Promise.all([queueRequest(scoped,request,deps),queueRequest(scoped,request,deps)]);assert.deepEqual(r.map(a=>a.length).sort(),[0,1]);assert.equal((await read()).find(v=>v.video_id===other).process_status,'待人工核验:old102');});
  }finally{if(made)await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end();}
});
