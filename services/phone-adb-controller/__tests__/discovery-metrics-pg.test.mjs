import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import db from '../leadgen-db-lib.js';
import {handleRpc} from '../leadgen-rpc.mjs';
import {createRpc,RPC_FILES} from '../leadgen-client.mjs';
import {queueMetricsFixture} from './helpers/discovery-metrics-fixture.mjs';
import {parse as parseYaml} from 'yaml';

test('真实PG：101独立观测读回、102实采数隔离、重发现不覆盖历史状态及较新观测', {skip:process.env.ZJ_METRICS_PG_REQUIRED!=='1'},async()=>{
 const {Pool}=await import('pg');const pool=new Pool();const schema='android101_'+randomUUID().replaceAll('-','');
 const connection=await pool.connect();let created=false;
 try{
  const identity=(await connection.query('SELECT current_database() AS db')).rows[0];
  assert.match(identity.db,/(?:^|_)scratch$/,'真实持久化回归只能使用显式scratch库');
  await connection.query(`CREATE SCHEMA ${schema}`);created=true;
  const original=readFileSync(new URL('../../../apps/api/db/migrations/20260922_220000_leadgen_ssot_tables.sql',import.meta.url),'utf8');
  const ddl=original.match(/CREATE TABLE IF NOT EXISTS zenithjoy\.leadgen_videos \([\s\S]+?\n\);/)[0];
  await connection.query(ddl.replaceAll('zenithjoy.',schema+'.'));
  const migration=new URL('../../../apps/api/db/migrations/20261022_120000_discovery_metrics.sql',import.meta.url);
  await connection.query(readFileSync(migration,'utf8').replaceAll('zenithjoy.',schema+'.'));
  const scoped={query:(sql,args)=>connection.query(sql.replaceAll('zenithjoy.',schema+'.'),args)};
  const videoId='7693970762462579121',row={lineKey:'jinuo',videoId,videoUrl:'https://www.douyin.com/video/'+videoId,title:'同视频原件',keyword:'AI',harvestBatch:'run101'};
  const observation={version:1,video_id:videoId,run:'run101',source_commit:'a'.repeat(40),observed_at:'2026-10-22T03:00:00.000Z',likes:{raw:'67',value:67},comment_total:{raw:'4',value:4},comment_tier:'1_100',digest:'b'.repeat(64)};
  await db.discoverVideo(scoped,{...row,discoveryMetrics:observation});
  const read=async()=>(await scoped.query('SELECT to_jsonb(v) AS row FROM zenithjoy.leadgen_videos v WHERE line_key=$1 AND video_id=$2',['jinuo',videoId])).rows[0].row;
  assert.deepEqual((await read()).discovery_metrics,observation,'现行discover必须真正持久化101指标');
  const beforeStale=await read();
  await assert.rejects(db.discoverVideo(scoped,{...row,keyword:'错误旧关键词',harvestBatch:'old101',videoUrl:'https://www.douyin.com/video/'+videoId+'?stale=1',discoveryMetrics:{...observation,observed_at:'2026-10-22T02:00:00.000Z'}}),/METRICS_READBACK_MISMATCH/);
  assert.deepEqual(await read(),beforeStale,'被拒绝的旧观测不能改动任何已有字段');
  await scoped.query("UPDATE zenithjoy.leadgen_videos SET judgment_status='matched',transcript='保留转写',process_status='评论已采',harvest_batch='historic102',comment_count=2 WHERE video_id=$1",[videoId]);
  const newer={...observation,run:'new101',observed_at:'2026-10-22T04:00:00.000Z',digest:'c'.repeat(64)};
  await db.discoverVideo(scoped,{...row,harvestBatch:'new101',discoveryMetrics:newer});
  await db.markVideoCollected(scoped,{lineKey:'jinuo',videoId,commentCount:3});
  let actual=await read();assert.deepEqual(actual.discovery_metrics,newer);assert.equal(actual.comment_count,3);assert.equal(actual.harvest_batch,'historic102');assert.equal(actual.transcript,'保留转写');assert.equal(actual.judgment_status,'matched');assert.equal(actual.process_status,'评论已采');
  await assert.rejects(db.discoverVideo(scoped,{...row,discoveryMetrics:observation}),/METRICS_READBACK_MISMATCH/);
  actual=await read();assert.deepEqual(actual.discovery_metrics,newer);assert.equal(actual.comment_count,3);
  await scoped.query('CREATE TABLE zenithjoy.company_config_runs (company_id uuid,tenant_id uuid,version integer,run_id text,snapshot jsonb)');
  const f=queueMetricsFixture({run:'rpc101',videoId:'7695303157311884570'}),company=f.company;
  await scoped.query('INSERT INTO zenithjoy.company_config_runs VALUES($1,$2,$3,$4,$5::jsonb)',[company.company_id,company.tenant_id,company.version,company.run_id,JSON.stringify(company.snapshot)]);
  const frozen={deployment:{source_commit:f.deps.sourceCommit},files:Object.fromEntries(RPC_FILES.map(path=>['runtime/'+path,'b'.repeat(64)]))};
  const request={kind:'queue',request:{op:'discover',run:'rpc101',line:'jinuo',video:f.video}};
  let first=true;const operations=[];
  const rpc=createRpc({frozen,runContext:f.deps.execution,execute:async(_command,_args,options)=>{
   const input=JSON.parse(options.input);operations.push(input.request.op);
   const result=await handleRpc(input,{pool:scoped,verify:source=>assert.equal(source.commit,f.deps.sourceCommit)});
   if(first){first=false;return {code:255,stdout:'',stderr:'connection closed'};}
   return {code:0,stdout:JSON.stringify(result),stderr:''};
  }});
  const receipt=await rpc(request);assert.equal(receipt.result.metrics_verified,true);assert.equal(receipt.result.recovered,true);assert.equal(receipt.result.metrics_digest,f.video.metrics.digest);
  assert.deepEqual(operations,['discover','discover_readback']);
  const persisted=(await scoped.query('SELECT discovery_metrics FROM zenithjoy.leadgen_videos WHERE video_id=$1',[f.video.videoId])).rows[0].discovery_metrics;
  const contract=parseYaml(readFileSync(new URL('../../../product-map/contracts/douyin_video_discovery.yaml',import.meta.url),'utf8'));
  const activity=contract.activities.find(item=>item.key==='collect_videos');
  assert.ok(activity.outputs.find(item=>item.type==='Video').fields.includes('discovery_metrics'));
  assert.ok(activity.postconditions.some(item=>item.probe==='discovery_metrics_verified'));
  const {company_binding:companyBinding,...storedObservation}=persisted;
  assert.deepEqual(storedObservation,f.video.metrics,'正式Video.discovery_metrics由真实RPC将运行Video.metrics映射至专用PG列');
  assert.deepEqual(companyBinding,{company_id:company.company_id,tenant_id:company.tenant_id,version:company.version,run_id:company.run_id,line_key:'jinuo'});
  assert.equal(persisted.company_binding.company_id,company.company_id);assert.equal(persisted.comment_total.value,4);
  for(const change of [m=>{m.source_commit='f'.repeat(40);},m=>{m.run='foreign';},m=>{m.video_id=videoId;},m=>{m.evidence.xml+=' ';},m=>{m.comment_total.value=0;}]){
   const bad=structuredClone(request);change(bad.request.video.metrics);await assert.rejects(rpc(bad),/METRICS_/);
  }
  assert.deepEqual((await scoped.query('SELECT discovery_metrics FROM zenithjoy.leadgen_videos WHERE video_id=$1',[f.video.videoId])).rows[0].discovery_metrics,persisted);
 }finally{try{if(created)await connection.query(`DROP SCHEMA ${schema} CASCADE`);}finally{connection.release();await pool.end();}}
});
