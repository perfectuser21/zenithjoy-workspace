import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {authorityFixture,digest} from './helpers/qualification-maintenance-fixture.mjs';
import {authorizeMaintenance} from '../qualification-maintenance-authority.mjs';
const require=createRequire(import.meta.url);
const api=await import('../qualification-maintenance-pg.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return null;throw e;});
test('维护事务真实PG：两字段CAS、独立audit与未知提交只读对账',
 {skip:process.env.ZJ_METRICS_PG_REQUIRED!=='1'},async t=>{
  const {Pool}=require('pg'),pool=new Pool({max:1}),schema='maintenance_'+randomUUID().replaceAll('-','');let made=false;
  const rewrite=q=>q.replaceAll('zenithjoy.',schema+'.');
  const scoped={query:(q,a)=>pool.query(rewrite(q),a),connect:async()=>{const c=await pool.connect();return {query:(q,a)=>c.query(rewrite(q),a),release:e=>c.release(e)};}};
  const f=authorityFixture(),authorization=authorizeMaintenance(f),s=f.scope,vid=s.video_ids[0],other='7700112581541257551';
  const snapshot={company_id:s.company_id,tenant_id:s.tenant_id,version:s.config_version,policy_id:s.policy_id,product_ids:['fixture-product'],config_status:'enabled',runtime_config:{routing:{line_key:s.line_key},video_judgment:{rules:['original']},comment_scoring:{rules:['original']}}};
  const input={authorization,expected_snapshot:snapshot,effects_receipt_sha256:'e'.repeat(64)};
  const rows=async()=> (await scoped.query('SELECT to_jsonb(v) AS row FROM zenithjoy.leadgen_videos v ORDER BY video_id')).rows.map(x=>x.row);
  const init=async()=>{
   for(const name of ['db_audit','leadgen_comments','leadgen_videos','company_config_runs','company_config_versions','tenant_company_profiles'])await scoped.query('DELETE FROM zenithjoy.'+name);
   await scoped.query('INSERT INTO zenithjoy.tenant_company_profiles VALUES($1,$2,14,\'enabled\',$3::jsonb)',[s.company_id,s.tenant_id,JSON.stringify(snapshot.runtime_config)]);
   await scoped.query('INSERT INTO zenithjoy.company_config_versions VALUES($1,$2,14,$3::jsonb)',[s.company_id,s.tenant_id,JSON.stringify(snapshot)]);
   for(const [run,up]of [[s.producer_run,null],[s.run_tag,s.producer_run]])await scoped.query('INSERT INTO zenithjoy.company_config_runs VALUES($1,$2,14,$3,$4::jsonb,$5)',[s.company_id,s.tenant_id,run,JSON.stringify(snapshot),up]);
   for(const [id,status,batch,judgment]of [[vid,'处理中:'+s.run_tag,s.run_tag,'pending'],[other,'待人工核验:old102','old102','matched']])await scoped.query('INSERT INTO zenithjoy.leadgen_videos(line_key,video_id,video_url,harvest_batch,process_status,judgment_status) VALUES($1,$2,$3,$4,$5,$6)',[s.line_key,id,'https://www.douyin.com/video/'+id,batch,status,judgment]);
  };
  try{
   const identity=(await pool.query('SELECT current_database() AS db,current_user AS actor')).rows[0];
   assert.ok(['cecelia_scratch','zenithjoy_metrics_scratch'].includes(identity.db),'禁止测试碰非scratch库');
   await pool.query('CREATE SCHEMA '+schema);made=true;
   const ddl=readFileSync(new URL('../../../apps/api/db/migrations/20260922_220000_leadgen_ssot_tables.sql',import.meta.url),'utf8').match(/CREATE TABLE IF NOT EXISTS zenithjoy\.leadgen_videos \([\s\S]+?\n\);/)[0];
   await scoped.query(ddl);await scoped.query('ALTER TABLE zenithjoy.leadgen_videos ADD COLUMN judgment_config jsonb');
   await scoped.query('CREATE TABLE zenithjoy.company_config_runs(company_id uuid,tenant_id uuid,version int,run_id text,snapshot jsonb,source_run text)');
   await scoped.query('CREATE TABLE zenithjoy.tenant_company_profiles(company_id uuid,tenant_id uuid,config_version int,config_status text,runtime_config jsonb)');
   await scoped.query('CREATE TABLE zenithjoy.company_config_versions(company_id uuid,tenant_id uuid,version int,snapshot jsonb)');
   await scoped.query('CREATE TABLE zenithjoy.leadgen_comments(id uuid DEFAULT gen_random_uuid(),line_key text,harvest_batch text)');
   const audit=readFileSync(new URL('../../../apps/api/db/migrations/20260820_120000_structured_workbench.sql',import.meta.url),'utf8').match(/CREATE TABLE IF NOT EXISTS zenithjoy\.db_audit \([\s\S]+?\n\);/)[0];await scoped.query(audit);
   await t.test('正式原producer历史snapshot全文按维护Task固定hash读取，非current自比',async()=>{
    await init();assert.equal(typeof api?.readHistoricalCompanySnapshot,'function');
    const f=authorityFixture();f.scope.original_evidence={company_snapshot_sha256:digest(snapshot)};
    f.originalTask.result.qualification_maintenance_delegation.contract_sha256=digest(f.scope);
    const a=authorizeMaintenance(f),receipt={company_id:s.company_id,tenant_id:s.tenant_id,version:s.config_version,policy_id:s.policy_id,run_id:s.run_tag,product_ids:snapshot.product_ids};
    const read=(authorization=a,company_receipt=receipt)=>api.readHistoricalCompanySnapshot(scoped,{authorization,company_receipt});
    const before=await rows();assert.deepEqual(await read(),snapshot);assert.deepEqual(await rows(),before);
    await assert.rejects(read(a,{...receipt,product_ids:['wrong']}),/MAINTENANCE_/);
    await scoped.query("UPDATE zenithjoy.company_config_runs SET snapshot=jsonb_set(snapshot,'{runtime_config,video_judgment}','{}') WHERE run_id=$1",[s.producer_run]);
    await assert.rejects(read(),/MAINTENANCE_/);assert.deepEqual(await rows(),before);
   });
   await t.test('合法只还原两业务字段，旁manual整行与updated_at不变，一条审计',async()=>{
    await init();assert.equal(typeof api?.restorePendingClaim,'function');const before=await rows();
    const out=await api.restorePendingClaim(scoped,input);assert.equal(out.status,'db_committed');
    const after=await rows(),expected=structuredClone(before);Object.assign(expected.find(x=>x.video_id===vid),{process_status:'待判定',harvest_batch:s.producer_run});assert.deepEqual(after,expected);
    const audits=(await scoped.query('SELECT * FROM zenithjoy.db_audit')).rows;assert.equal(audits.length,1);assert.equal(audits[0].id,s.intent_id);assert.equal(audits[0].detail.contract_sha256,authorization.contract_sha256);
   });
   await t.test('sealed重入可只核已提交审计，不把后续合法业务行变化洗回旧状态',async()=>{
    await init();await api.restorePendingClaim(scoped,input);assert.equal(typeof api?.readCommittedMaintenanceAudit,'function');
    await scoped.query("UPDATE zenithjoy.leadgen_videos SET process_status='处理中:later-run' WHERE video_id=$1",[vid]);
    const before=await rows(),r=await api.readCommittedMaintenanceAudit(scoped,input);
    assert.equal(r.status,'audit_committed');assert.equal(r.effects_receipt_sha256,input.effects_receipt_sha256);
    assert.equal((await api.readPendingClaimOutcome(scoped,input)).status,'blocked');assert.deepEqual(await rows(),before);
   });
   await t.test('未见已提交audit且原精确claim仍在，只报告可检查前态不冒已提交',async()=>{
    await init();const before=await rows();assert.equal((await api.readPendingClaimOutcome(scoped,input)).status,'db_not_committed');assert.deepEqual(await rows(),before);
    await scoped.query("UPDATE zenithjoy.leadgen_videos SET process_status='处理中:foreign' WHERE video_id=$1",[vid]);
    assert.equal((await api.readPendingClaimOutcome(scoped,input)).status,'blocked');
   });
   await t.test('重入纯读不要求伪造新的effects hash，旧audit hash只标历史证据',async()=>{
    await init();await api.restorePendingClaim(scoped,input);
    const out=await api.readPendingClaimOutcome(scoped,{authorization,expected_snapshot:snapshot});
    assert.equal(out.status,'db_committed');assert.equal(out.effects_receipt_sha256,input.effects_receipt_sha256);assert.equal(out.effects_evidence,'historical_audit_not_fresh_stop');
    assert.equal((await api.readPendingClaimOutcome(scoped,{...input,effects_receipt_sha256:'f'.repeat(64)})).status,'blocked');
   });
   for(const [name,sql]of [
    ['新owner',"process_status='处理中:another'"],['批次漂移',"harvest_batch='another'"],['已有判断',"judgment_status='matched'"],
    ['已有正文',"transcript='not empty'"],['已有判断配置',"judgment_config='{}'::jsonb"],['旁manual冒领',"process_status='待人工核验:old'"],
   ])await t.test(name+'拒绝且零写入',async()=>{await init();await scoped.query('UPDATE zenithjoy.leadgen_videos SET '+sql+' WHERE video_id=$1',[vid]);const before=await rows();assert.equal(typeof api?.restorePendingClaim,'function');await assert.rejects(api.restorePendingClaim(scoped,input),/MAINTENANCE_/);assert.deepEqual(await rows(),before);assert.equal((await scoped.query('SELECT count(*)::int AS n FROM zenithjoy.db_audit')).rows[0].n,0);});
   for(const [name,sql,args]of [
    ['同run有评论','INSERT INTO zenithjoy.leadgen_comments(line_key,harvest_batch) VALUES($1,$2)',[s.line_key,s.run_tag]],
    ['current版本变','UPDATE zenithjoy.tenant_company_profiles SET config_version=15',[]],
    ['current同版本政策正文变',"UPDATE zenithjoy.company_config_versions SET snapshot=jsonb_set(snapshot,'{runtime_config,video_judgment}','{}')",[]],
    ['current profile运行政策变',"UPDATE zenithjoy.tenant_company_profiles SET runtime_config=jsonb_set(runtime_config,'{video_judgment}','{}')",[]],
    ['同ID政策正文变',"UPDATE zenithjoy.company_config_runs SET snapshot=jsonb_set(snapshot,'{runtime_config,video_judgment}','{}') WHERE run_id=$1",[s.run_tag]],
   ])await t.test(name+'事务中拒绝',async()=>{await init();await scoped.query(sql,args);const before=await rows();assert.equal(typeof api?.restorePendingClaim,'function');await assert.rejects(api.restorePendingClaim(scoped,input),/MAINTENANCE_/);assert.deepEqual(await rows(),before);});
   await t.test('审计保存完整行前后hash；后续reason写入使当前readback阻断',async()=>{
    await init();const before=(await rows()).find(v=>v.video_id===vid);await api.restorePendingClaim(scoped,input);
    const after=(await rows()).find(v=>v.video_id===vid),audit=(await scoped.query('SELECT detail FROM zenithjoy.db_audit')).rows[0].detail;
    assert.equal(audit.before_row_sha256,digest(before));assert.equal(audit.after_row_sha256,digest(after));
    await scoped.query("UPDATE zenithjoy.leadgen_videos SET judgment_reason='new reason' WHERE video_id=$1",[vid]);
    assert.equal((await api.readPendingClaimOutcome(scoped,input)).status,'blocked');
   });
   await t.test('COMMIT后连接失联保unknown，独立readback证一条audit而不重写',async()=>{
    await init();assert.equal(typeof api?.readPendingClaimOutcome,'function');
    const uncertain={...scoped,connect:async()=>{const c=await scoped.connect();return {query:async(q,a)=>{const r=await c.query(q,a);if(q==='COMMIT')throw Error('fixture connection lost after commit');return r;},release:e=>c.release(e)};}};
    assert.equal((await api.restorePendingClaim(uncertain,input)).status,'commit_unknown');const after=await rows();
    assert.equal((await api.readPendingClaimOutcome(scoped,input)).status,'db_committed');assert.deepEqual(await rows(),after);assert.equal((await scoped.query('SELECT count(*)::int AS n FROM zenithjoy.db_audit')).rows[0].n,1);
   });
   await t.test('COMMIT发送前抛错不得把未提交事务回池冒充已提交',async()=>{
    await init();const independent=new Pool({max:1});
    const uncertain={...scoped,connect:async()=>{const c=await scoped.connect();return {query:async(q,a)=>{if(q==='COMMIT')throw Error('fixture timeout before COMMIT send');return c.query(q,a);},release:e=>c.release(e)};}};
    try{
     assert.equal((await api.restorePendingClaim(uncertain,input)).status,'commit_unknown');
     assert.equal((await independent.query('SELECT count(*)::int AS n FROM '+schema+'.db_audit')).rows[0].n,0,'独立后端确无已提交audit');
     assert.notEqual((await api.readPendingClaimOutcome(scoped,input)).status,'db_committed','不能复用in-doubt连接读取自己的未提交事务');
    }finally{await pool.query('ROLLBACK');await independent.end();}
   });
   await t.test('ROLLBACK失败同样销毁连接，不复用仍开事务的后端',async()=>{
    await init();await scoped.query('UPDATE zenithjoy.tenant_company_profiles SET config_version=15');let backend;
    const uncertain={...scoped,connect:async()=>{const c=await scoped.connect();backend=(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;return {query:async(q,a)=>{if(q==='ROLLBACK')throw Error('fixture rollback transport lost');return c.query(q,a);},release:e=>c.release(e)};}};
    await assert.rejects(api.restorePendingClaim(uncertain,input),/MAINTENANCE_/);
    assert.notEqual((await pool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,backend);
    assert.equal((await scoped.query('SELECT count(*)::int AS n FROM zenithjoy.db_audit')).rows[0].n,0);
   });
   await t.test('双连接同意图只提交一次，另一连接不能重复业务写',async()=>{
    await init();const result=await Promise.allSettled([api.restorePendingClaim(scoped,input),api.restorePendingClaim(scoped,input)]);
    assert.equal(result.filter(r=>r.status==='fulfilled'&&r.value.status==='db_committed').length,1);
    assert.equal(result.filter(r=>r.status==='rejected').length,1);
    assert.equal((await scoped.query('SELECT count(*)::int AS n FROM zenithjoy.db_audit')).rows[0].n,1);
    assert.equal((await api.readPendingClaimOutcome(scoped,input)).status,'db_committed');
   });
   await t.test('旧audit或新owner不准凭intent误认已完成',async()=>{
    await init();await api.restorePendingClaim(scoped,input);
    await scoped.query("UPDATE zenithjoy.leadgen_videos SET process_status='处理中:newowner' WHERE video_id=$1",[vid]);
    const before=await rows();assert.equal((await api.readPendingClaimOutcome(scoped,input)).status,'blocked');
    await assert.rejects(api.restorePendingClaim(scoped,input),/READBACK_REQUIRED/);assert.deepEqual(await rows(),before);
   });
   await t.test('两业务字段以外被trigger改动必须回滚，包括updated_at',async()=>{
    await init();await scoped.query(`CREATE FUNCTION ${schema}.unexpected_touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now()+interval '1 second'; RETURN NEW; END $$`);
    await scoped.query(`CREATE TRIGGER unexpected_touch BEFORE UPDATE ON zenithjoy.leadgen_videos FOR EACH ROW EXECUTE FUNCTION ${schema}.unexpected_touch()`);
    try{const before=await rows();await assert.rejects(api.restorePendingClaim(scoped,input),/MAINTENANCE_/);assert.deepEqual(await rows(),before);assert.equal((await scoped.query('SELECT count(*)::int AS n FROM zenithjoy.db_audit')).rows[0].n,0);}
    finally{await scoped.query('DROP TRIGGER unexpected_touch ON zenithjoy.leadgen_videos');}
   });
  }finally{if(made)await pool.query('DROP SCHEMA '+schema+' CASCADE');await pool.end();}
 });
