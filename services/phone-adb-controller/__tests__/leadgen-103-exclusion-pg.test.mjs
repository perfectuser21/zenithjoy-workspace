import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {policy} from './fixtures/leadgen-103-v14.mjs';
const require=createRequire(import.meta.url);
const {queueRequest}=require('../leadgen-queue.js');

test('真实PG scratch：已排除是独立终态且不能携带旧A评分',
 {skip:process.env.ZJ_METRICS_PG_REQUIRED!=='1'},async()=>{
  const {Pool}=await import('pg');
  const pool=new Pool(),client=await pool.connect();
  const schema=`leadgen_exclusion_${randomUUID().replaceAll('-','')}`;
  let created=false;
  try{
    const db=(await client.query('SELECT current_database() AS db')).rows[0].db;
    assert.match(db,/(?:^|_)scratch$/);
    await client.query(`CREATE SCHEMA ${schema}`);created=true;
    const base=readFileSync(new URL('../../../apps/api/db/migrations/20260922_220000_leadgen_ssot_tables.sql',import.meta.url),'utf8');
    const ddl=base.match(/CREATE TABLE IF NOT EXISTS zenithjoy\.leadgen_comments \([\s\S]+?\n\);/)[0];
    await client.query(ddl.replaceAll('zenithjoy.',`${schema}.`));
    const migration=readFileSync(new URL('../../../apps/api/db/migrations/20261031_180000_leadgen_comment_policy_exclusion.sql',import.meta.url),'utf8');
    await client.query(migration.replaceAll('zenithjoy.',`${schema}.`));
    const id=randomUUID();
    await client.query(`INSERT INTO ${schema}.leadgen_comments(id,line_key,dedup_key,process_status,relevance,intent_grade,comment_body)
      VALUES($1,'jinuo','one','待分拣','相关','A','fixture')`,[id]);
    await client.query(`UPDATE ${schema}.leadgen_comments SET process_status='已排除',relevance=NULL,intent_grade=NULL
      WHERE id=$1`,[id]);
    const row=(await client.query(`SELECT process_status,relevance,intent_grade FROM ${schema}.leadgen_comments WHERE id=$1`,[id])).rows[0];
    assert.deepEqual(row,{process_status:'已排除',relevance:null,intent_grade:null});
    await assert.rejects(client.query(`UPDATE ${schema}.leadgen_comments SET intent_grade='A' WHERE id=$1`,[id]),
      /chk_leadgen_comments_excluded_unscored/);
  }finally{
    if(created)await client.query(`DROP SCHEMA ${schema} CASCADE`);
    client.release();await pool.end();
  }
});

test('真实PG scratch：并发限1只排除一次，读回留双审摘要，标记人不建线索',
 {skip:process.env.ZJ_METRICS_PG_REQUIRED!=='1'},async()=>{
  const {Pool}=await import('pg');const pool=new Pool();
  const schema=`leadgen_exclusion_${randomUUID().replaceAll('-','')}`;
  const admin=await pool.connect();let created=false;
  try{
    assert.match((await admin.query('SELECT current_database() AS db')).rows[0].db,/(?:^|_)scratch$/);
    await admin.query(`CREATE SCHEMA ${schema}`);created=true;
    const base=readFileSync(new URL('../../../apps/api/db/migrations/20260922_220000_leadgen_ssot_tables.sql',import.meta.url),'utf8');
    for(const table of ['leadgen_videos','leadgen_comments']){
      const ddl=base.match(new RegExp(`CREATE TABLE IF NOT EXISTS zenithjoy\\.${table} \\([\\s\\S]+?\\n\\);`))[0];
      await admin.query(ddl.replaceAll('zenithjoy.',`${schema}.`));
    }
    await admin.query(`ALTER TABLE ${schema}.leadgen_comments ADD COLUMN judgment_config jsonb`);
    const migration=readFileSync(new URL('../../../apps/api/db/migrations/20261031_180000_leadgen_comment_policy_exclusion.sql',import.meta.url),'utf8');
    await admin.query(migration.replaceAll('zenithjoy.',`${schema}.`));
    await admin.query(`CREATE TABLE ${schema}.leadgen_bridge_outbox(comment_id uuid,line_key text)`);
    await admin.query(`CREATE TABLE ${schema}.company_config_runs(company_id uuid,tenant_id uuid,version int,run_id text,snapshot jsonb)`);
    const run='terminal_pg',source='test102',id=randomUUID(),url='https://www.douyin.com/video/7617837149999841201';
    const title='FDE证书刚出第二张',comment='FDE到底有几张证，哪张才是能查的';
    await admin.query(`INSERT INTO ${schema}.leadgen_videos(line_key,video_id,video_url,title,harvest_batch,process_status,judgment_status)
      VALUES('jinuo','7617837149999841201',$1,$2,$3,'评论已采','matched')`,[url,title,source]);
    await admin.query(`INSERT INTO ${schema}.leadgen_comments(id,line_key,dedup_key,harvest_batch,source_video,source_video_url,comment_body)
      VALUES($1,'jinuo','one',$2,$3,$4,$5)`,[id,source,title,url,comment]);
    await admin.query(`INSERT INTO ${schema}.company_config_runs VALUES($1,$2,$3,$4,$5::jsonb)`,
      [policy.company_id,policy.tenant_id,policy.version,run,JSON.stringify(policy)]);
    const rewrite=sql=>sql.replaceAll('zenithjoy.',`${schema}.`);
    const scoped={query:(sql,args)=>pool.query(rewrite(sql),args),connect:async()=>{
      const client=await pool.connect();return {query:(sql,args)=>client.query(rewrite(sql),args),release:()=>client.release()};
    }};
    let review=0,scoreCalls=0;
    const deps={freezeCompanyConfig:async()=>policy,
      judgeComment:async()=>{scoreCalls++;return {relevance:'相关',grade:'A',reason:'候选A',
        audit:{model:'score-model',response_id:'score-pg'}};},
      judgePolicy:async()=>({grade:'A',audit:{model:'policy-model',response_id:`policy-pg-${++review}`,
        policy_evidence:{audience_id:'recvvcNzUv5rzl',matched_rule:'考证视频',comment_signal:'FDE证书',
          video_signal:'FDE证书',exclusion_rule:null,reason:'缺可证个人意向'}}})};
    const input={op:'score',line:'jinuo',run,source_run:source,ids:[id],budget_max:1,limit:1};
    const results=await Promise.all([queueRequest(scoped,input,deps),queueRequest(scoped,input,deps)]);
    assert.equal(results.reduce((sum,r)=>sum+r.excluded,0),1);
    assert.equal(scoreCalls,1);assert.equal(review,2);
    const row=(await scoped.query('SELECT process_status,relevance,intent_grade,judgment_config FROM zenithjoy.leadgen_comments WHERE id=$1',[id])).rows[0];
    assert.equal(row.process_status,'已排除');assert.equal(row.relevance,null);assert.equal(row.intent_grade,null);
    assert.equal(row.judgment_config.policy_reviews.length,2);
    const readback=await queueRequest(scoped,{op:'score_exclusion_readback',line:'jinuo',run,source_run:source,ids:[id]},deps);
    assert.equal(readback.verified,true);
    const mark=await queueRequest(scoped,{op:'mark_leads',line:'jinuo',run:'mark_terminal_pg',source_run:source,limit:1},deps);
    assert.equal(mark.marked,0);assert.equal(mark.created,0);
    assert.equal((await scoped.query('SELECT count(*)::int AS n FROM zenithjoy.leadgen_bridge_outbox')).rows[0].n,0);
  }finally{
    if(created)await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    admin.release();await pool.end();
  }
});
