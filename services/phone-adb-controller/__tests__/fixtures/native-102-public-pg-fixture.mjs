import {nativePhonePublicPgFixture} from './native-phone-public-pg-fixture.mjs';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';import {join} from 'node:path';
// Reuse the original private cluster identity and owned Socket/Pool fixture.
// Only the new per-test schema receives these explicit business seed records.
export async function native102PublicPgFixture(t,options){
 const pg=await nativePhonePublicPgFixture(t,options),allocation=await pg.createPool();
 try{
  const company=pg.company;company.runtime_config.video_judgment={instructions:'独立判定视频是否涉及企业人工智能课程需求；不得用标题替代本轮转写。'};
  await allocation.pool.query('UPDATE zenithjoy.tenant_company_profiles SET runtime_config=$1 WHERE company_id=$2',[company.runtime_config,company.company_id]);
  await allocation.pool.query('UPDATE zenithjoy.company_config_versions SET snapshot=$1 WHERE company_id=$2',[company,company.company_id]);
  const migration=readFileSync(new URL('../../../../apps/api/db/migrations/20260922_220000_leadgen_ssot_tables.sql',import.meta.url),'utf8');
  await allocation.pool.query(migration.match(/CREATE TABLE IF NOT EXISTS zenithjoy\.leadgen_comments \([\s\S]+?\n\);/)[0]);
  await allocation.pool.query('ALTER TABLE zenithjoy.leadgen_comments ADD COLUMN recipient_evidence jsonb');
 }finally{await allocation.pool.end();await allocation.transport.close();}
 return {...pg,async readRows(){const prior=await pg.readRows(),a=await pg.createPool();try{return {...prior,comments:(await a.pool.query('SELECT * FROM zenithjoy.leadgen_comments')).rows};}finally{await a.pool.end();await a.transport.close();}},async seedUpstream({root,sourceRun,videoId}){
  const require=createRequire(join(root,'leadgen-queue.js')),{queueRequest}=require('./leadgen-queue.js'),db=require('./leadgen-db-lib.js'),allocation=await pg.createPool();
  try{
   await queueRequest(allocation.pool,{op:'company_config',line:'yuesheng',run:sourceRun,step:'101',device_binding:{profile:options.profile,device_serial:options.serial}});
   const inserted=await db.upsertVideo(allocation.pool,{lineKey:'yuesheng',videoId,videoUrl:'https://www.douyin.com/video/'+videoId,title:'隔离上游视频：企业人工智能课程',keyword:'人工智能',commentCount:5,harvestBatch:sourceRun,processStatus:'待判定'});
   return {inserted,video:{videoId,videoUrl:'https://www.douyin.com/video/'+videoId,author:'隔离外部作者',title:'隔离上游视频：企业人工智能课程'}};
  }finally{await allocation.pool.end();await allocation.transport.close();}
 }};
}
