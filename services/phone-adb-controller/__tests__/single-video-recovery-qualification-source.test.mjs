import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {randomUUID,createHash} from 'node:crypto';
const require=createRequire(import.meta.url),{queueRequest}=require('../leadgen-queue.js');
const api=require('../single-video-recovery-0353.js'),legacy=require('../single-video-recovery.js');
const raw=gunzipSync(readFileSync(new URL('fixtures/recovery0353-qualification-owner.json.gz',import.meta.url)));
const fixture=JSON.parse(raw),vid=fixture.video.video_id,qualificationRun='cicd24c9_102_20261023_2052';
const scope=api.SCOPE,company=scope.company_id,tenant=scope.tenant_id,newRun='qualification_source_consumed_test';
test('真实来源fixture保持完整双snapshot和2052资格/0353owner，不含设备XML',()=>{
 assert.equal(createHash('sha256').update(raw).digest('hex'),'28deb91a1aa8774d527e089ce96ab2d8b9c45fa312dffbbcbd700098279d7443');
 assert.equal(fixture.video.judgment_config.run_id,qualificationRun);assert.equal(fixture.video.harvest_batch,scope.original_run);
 assert.deepEqual(fixture.frozen[0].snapshot,fixture.frozen[1].snapshot);assert.equal(fixture.frozen.length,2);
});
test('0353新scope显式固定资格run2052而旧V1常量不变',()=>{
 assert.equal(scope.qualification_run,qualificationRun);assert.equal(legacy.DECISION,'ab68977b-2670-4a90-9d84-bdd3b25f3e04');
 assert.equal(legacy.SCOPE.original_run,qualificationRun);assert.equal(Object.hasOwn(legacy.SCOPE,'qualification_run'),false);
});
test('真实PG：固定资格2052与owner0353的严格preapply及consumed来源核验',{skip:process.env.ZJ_METRICS_PG_REQUIRED!=='1'},async t=>{
 const {Pool}=require('pg'),pool=new Pool(),schema='qualification_source_'+randomUUID().replaceAll('-','');let created=false;
 const q=(sql,args)=>pool.query(sql.replaceAll('zenithjoy.',schema+'.'),args);
 const scoped={query:q,connect:async()=>{const c=await pool.connect();return {query:(sql,args)=>c.query(sql.replaceAll('zenithjoy.',schema+'.'),args),release:e=>c.release(e)};}};
 const input={op:'recover_single_video_0353',line:'jinuo',run:api.RECOVERY_RUN,decision_id:randomUUID(),maintenance_task_id:randomUUID(),video_id:vid};
 const auth=()=>({decision:{id:input.decision_id,made_by:'user',status:'active',decision:JSON.stringify(scope)},originalTask:{id:scope.original_task_id,status:'failed'},maintenanceTask:{id:input.maintenance_task_id,project_id:scope.project_id,parent_task_id:scope.root_task_id,status:'in_progress',claimed_by:'codex:single-video-recovery'},actor:'codex:single-video-recovery',evidence_sha256:'a'.repeat(64)});
 const guard={read:async()=>({observed_at:Date.now(),old_session_terminal:true,old_native_stopped:true,pending:0,active:0,local_owner:input.run,central_owner:input.maintenance_task_id,guard_held:true,evidence_sha256:'b'.repeat(64)}),release:async()=>{}};
 const deps={recovery0353:{readAuthority:async()=>auth(),acquireGuard:async()=>guard}};
 const rows=async()=>(await q('SELECT to_jsonb(v) row FROM zenithjoy.leadgen_videos v ORDER BY video_id')).rows.map(x=>x.row);
 async function init(){
  await q('TRUNCATE zenithjoy.leadgen_videos,zenithjoy.db_audit,zenithjoy.company_config_runs,zenithjoy.leadgen_comments');
  for(const f of fixture.frozen)await q('INSERT INTO zenithjoy.company_config_runs VALUES($1,$2,$3,$4,$5::jsonb,$6)',[f.company_id,f.tenant_id,f.version,f.run_id,JSON.stringify(f.snapshot),f.source_run]);
  for(const [id,status] of [[vid,'matched'],['7699406826379298531','rejected']]){
   const v=fixture.video;await q('INSERT INTO zenithjoy.leadgen_videos(line_key,video_id,video_url,harvest_batch,process_status,judgment_status,judgment_config) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[v.line_key,id,'https://www.douyin.com/video/'+id,v.harvest_batch,v.process_status,status,JSON.stringify(v.judgment_config)]);
  }
 }
 async function consumed(){
  const f=fixture.frozen[0];await q('INSERT INTO zenithjoy.company_config_runs VALUES($1,$2,$3,$4,$5::jsonb,$6)',[f.company_id,f.tenant_id,f.version,newRun,JSON.stringify(f.snapshot),f.source_run]);
  await q('UPDATE zenithjoy.leadgen_videos SET process_status=$2,harvest_batch=$3 WHERE video_id=$1',[vid,'处理中:'+newRun,newRun]);
  const d={scope_sha256:legacy.hash(scope),video_id:vid,decision_id:input.decision_id,before_sha256:'c'.repeat(64),after_sha256:'d'.repeat(64)};
  await q('INSERT INTO zenithjoy.db_audit(id,org_id,table_id,member_id,action,detail) VALUES($1,$2,NULL,$3,$4,$5::jsonb)',[input.decision_id,tenant,'codex:single-video-recovery','leadgen_single_video_recovery',JSON.stringify(d)]);
 }
 try{
  assert.match((await pool.query('select current_database() db')).rows[0].db,/(?:^|_)scratch$/);await pool.query('CREATE SCHEMA '+schema);created=true;
  const migration=readFileSync(new URL('../../../apps/api/db/migrations/20260922_220000_leadgen_ssot_tables.sql',import.meta.url),'utf8');await q(migration.match(/CREATE TABLE IF NOT EXISTS zenithjoy\.leadgen_videos \([\s\S]+?\n\);/)[0]);await q('ALTER TABLE zenithjoy.leadgen_videos ADD COLUMN judgment_config jsonb, ADD COLUMN discovery_metrics jsonb');
  const audit=readFileSync(new URL('../../../apps/api/db/migrations/20260820_120000_structured_workbench.sql',import.meta.url),'utf8');await q(audit.match(/CREATE TABLE IF NOT EXISTS zenithjoy\.db_audit \([\s\S]+?\n\);/)[0]);
  await q('CREATE TABLE zenithjoy.leadgen_comments(id uuid default gen_random_uuid(),line_key text,source_video_url text,harvest_batch text)');await q('CREATE TABLE zenithjoy.company_config_runs(company_id uuid,tenant_id uuid,version int,run_id text,snapshot jsonb,source_run text)');
  await t.test('真实row2052资格/0353owner获精确授权可apply且只改目标状态，旁行不变',async()=>{
   await init();const before=await rows();assert.equal((await queueRequest(scoped,input,deps)).status,'applied');const after=await rows();assert.equal(after.find(v=>v.video_id===vid).process_status,'待采评论');assert.deepEqual(after.find(v=>v.video_id!==vid),before.find(v=>v.video_id!==vid));assert.deepEqual(after.find(v=>v.video_id===vid).judgment_config,fixture.video.judgment_config);assert.equal((await queueRequest(scoped,input,deps)).status,'already_applied');
  });
  await t.test('合法后续harvest保留2052资格时只读consumed、不二次恢复',async()=>{
   await init();await consumed();const before=await rows();assert.equal((await queueRequest(scoped,{...input,op:'recover_single_video_0353_readback'},deps)).status,'consumed');assert.deepEqual(await rows(),before);
  });
  for(const [name,mutate] of Object.entries({
   '恶意第三资格run':async()=>q("UPDATE zenithjoy.leadgen_videos SET judgment_config=jsonb_set(judgment_config,'{run_id}',to_jsonb('unapproved_third_run'::text)) WHERE video_id=$1",[vid]),
   '资格错tenant':async()=>q('UPDATE zenithjoy.company_config_runs SET tenant_id=$2 WHERE run_id=$1',[qualificationRun,randomUUID()]),
   '资格错version':async()=>q('UPDATE zenithjoy.company_config_runs SET version=15 WHERE run_id=$1',[qualificationRun]),
   '资格错source':async()=>q('UPDATE zenithjoy.company_config_runs SET source_run=$2 WHERE run_id=$1',[qualificationRun,'different_101']),
   '资格错policy':async()=>q("UPDATE zenithjoy.company_config_runs SET snapshot=jsonb_set(snapshot,'{policy_id}',to_jsonb('different_policy'::text)) WHERE run_id=$1",[qualificationRun]),
   '资格隐藏policy字段漂移':async()=>q("UPDATE zenithjoy.company_config_runs SET snapshot=jsonb_set(snapshot,'{customer_problem}',to_jsonb('changed_private_policy'::text)) WHERE run_id=$1",[qualificationRun]),
   'owner隐藏policy字段漂移':async()=>q("UPDATE zenithjoy.company_config_runs SET snapshot=jsonb_set(snapshot,'{customer_problem}',to_jsonb('changed_owner_policy'::text)) WHERE run_id=$1",[scope.original_run]),
  }))await t.test(name+'拒绝且无恢复写入',async()=>{await init();await mutate();const before=await rows();await assert.rejects(queueRequest(scoped,input,deps),/RECOVERY_/);assert.deepEqual(await rows(),before);assert.equal((await q('SELECT count(*)::int n FROM zenithjoy.db_audit')).rows[0].n,0);});
  for(const [name,sql,args] of [
   ['consumed资格snapshot漂移',"UPDATE zenithjoy.company_config_runs SET snapshot=jsonb_set(snapshot,'{customer_problem}',to_jsonb('changed'::text)) WHERE run_id=$1",[qualificationRun]],
   ['consumed新harvest完整policy漂移',"UPDATE zenithjoy.company_config_runs SET snapshot=jsonb_set(snapshot,'{customer_problem}',to_jsonb('changed'::text)) WHERE run_id=$1",[newRun]],
   ['consumed新harvest错source','UPDATE zenithjoy.company_config_runs SET source_run=$2 WHERE run_id=$1',[newRun,'different_101']],
  ])await t.test(name+'仅读拒绝不写',async()=>{await init();await consumed();await q(sql,args);const before=await rows();await assert.rejects(queueRequest(scoped,{...input,op:'recover_single_video_0353_readback'},deps),/RECOVERY_/);assert.deepEqual(await rows(),before);});
 }finally{if(created)await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end();}
});
