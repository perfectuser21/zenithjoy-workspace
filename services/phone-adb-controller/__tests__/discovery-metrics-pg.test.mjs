import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import db from '../leadgen-db-lib.js';

test('真实PG：101独立观测读回、102实采数隔离、重发现不覆盖历史状态及较新观测', {skip:process.env.ZJ_METRICS_PG_REQUIRED!=='1'},async()=>{
 const {Pool}=await import('pg');const pool=new Pool();const schema='android101_'+randomUUID().replaceAll('-','');
 const connection=await pool.connect();
 try{
  const identity=(await connection.query('SELECT current_database() AS db')).rows[0];
  assert.match(identity.db,/(?:^|_)scratch$/,'真实持久化回归只能使用显式scratch库');
  await connection.query(`CREATE SCHEMA ${schema}`);
  const original=readFileSync(new URL('../../../apps/api/db/migrations/20260922_220000_leadgen_ssot_tables.sql',import.meta.url),'utf8');
  const ddl=original.match(/CREATE TABLE IF NOT EXISTS zenithjoy\.leadgen_videos \([\s\S]+?\n\);/)[0];
  await connection.query(ddl.replaceAll('zenithjoy.',schema+'.'));
  const migration=new URL('../../../apps/api/db/migrations/20261022_120000_discovery_metrics.sql',import.meta.url);
  try{await connection.query(readFileSync(migration,'utf8').replaceAll('zenithjoy.',schema+'.'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const scoped={query:(sql,args)=>connection.query(sql.replaceAll('zenithjoy.',schema+'.'),args)};
  const videoId='7693970762462579121',row={lineKey:'jinuo',videoId,videoUrl:'https://www.douyin.com/video/'+videoId,title:'同视频原件',keyword:'AI',harvestBatch:'run101'};
  const observation={version:1,video_id:videoId,run:'run101',source_commit:'a'.repeat(40),observed_at:'2026-10-22T03:00:00.000Z',likes:{raw:'67',value:67},comment_total:{raw:'4',value:4},comment_tier:'1_100',digest:'b'.repeat(64)};
  await db.discoverVideo(scoped,{...row,discoveryMetrics:observation});
  const read=async()=>(await scoped.query('SELECT to_jsonb(v) AS row FROM zenithjoy.leadgen_videos v WHERE line_key=$1 AND video_id=$2',['jinuo',videoId])).rows[0].row;
  assert.deepEqual((await read()).discovery_metrics,observation,'现行discover必须真正持久化101指标');
  await scoped.query("UPDATE zenithjoy.leadgen_videos SET judgment_status='matched',transcript='保留转写',process_status='评论已采',harvest_batch='historic102',comment_count=2 WHERE video_id=$1",[videoId]);
  const newer={...observation,run:'new101',observed_at:'2026-10-22T04:00:00.000Z',digest:'c'.repeat(64)};
  await db.discoverVideo(scoped,{...row,harvestBatch:'new101',discoveryMetrics:newer});
  await db.markVideoCollected(scoped,{lineKey:'jinuo',videoId,commentCount:3});
  let actual=await read();assert.deepEqual(actual.discovery_metrics,newer);assert.equal(actual.comment_count,3);assert.equal(actual.harvest_batch,'historic102');assert.equal(actual.transcript,'保留转写');assert.equal(actual.judgment_status,'matched');assert.equal(actual.process_status,'评论已采');
  await assert.rejects(db.discoverVideo(scoped,{...row,discoveryMetrics:observation}),/METRICS_READBACK_MISMATCH/);
  actual=await read();assert.deepEqual(actual.discovery_metrics,newer);assert.equal(actual.comment_count,3);
 }finally{await connection.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);connection.release();await pool.end();}
});
