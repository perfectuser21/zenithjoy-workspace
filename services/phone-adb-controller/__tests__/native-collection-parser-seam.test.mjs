import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {usingPhoneQueue} from './fixtures/native-phone-queue-fixture.mjs';
const require=createRequire(import.meta.url),{queueRequest}=require('../leadgen-queue.js'),native=require('../queued-recipient-evidence.js');

// This test exercises the existing queue, not the new opaque-cap admission.
// Its XML is a declared synthetic fixture; actual PostgreSQL owns the result.
test('original collect consumes Code recipient parser dependency and persists actual PG row',async t=>usingPhoneQueue(t,async f=>{
 const allocation=await f.createPool(),client=await allocation.pool.connect();
 try{
  const migration=readFileSync(new URL('../../../apps/api/db/migrations/20260922_220000_leadgen_ssot_tables.sql',import.meta.url),'utf8');
  await client.query(migration.match(/CREATE TABLE IF NOT EXISTS zenithjoy\.leadgen_comments \([\s\S]+?\n\);/)[0]);
  await client.query('ALTER TABLE zenithjoy.leadgen_comments ADD COLUMN recipient_evidence jsonb');
  await client.query('ALTER TABLE zenithjoy.company_config_runs ADD COLUMN source_run text,ADD COLUMN task_inputs jsonb');
  const run=f.scope.run,sourceRun='fixture_source101',videoId=f.video.videoId,url='https://www.douyin.com/video/'+videoId;
  const binding={company_id:f.company.company_id,tenant_id:f.company.tenant_id,version:1,run_id:run,line_key:'yuesheng',source_run:sourceRun,profile:f.scope.profile,device_serial:f.scope.serial,douyin_id:'fixture-owner',verification_status:'verified',enabled:true};
  const snapshot={...f.company.snapshot,config_status:'enabled',runtime_config:{routing:{line_key:'yuesheng',profiles:[binding.profile]},platform_accounts:[{...binding,platform:'douyin'}]}};
  await client.query('UPDATE zenithjoy.company_config_runs SET snapshot=$1,source_run=$2,task_inputs=$3',[snapshot,sourceRun,{device_binding:{profile:binding.profile,device_serial:binding.device_serial}}]);
  await client.query('INSERT INTO zenithjoy.leadgen_videos(video_id,video_url,title,line_key,judgment_status,process_status,harvest_batch) VALUES($1,$2,$3,$4,$5,$6,$7)',[videoId,url,'isolated fixture','yuesheng','matched','处理中:'+run,run]);
  const raw={profile:readFileSync(new URL('./fixtures/honor-e1b-recipient/profile.xml',import.meta.url),'utf8'),returned:readFileSync(new URL('./fixtures/honor-e1b-recipient/returned.xml',import.meta.url),'utf8')},nickname='测试评论人',douyinId='fixture-account-102',commentBody='测试完整评论 首评',prefix=run+'-v'+videoId+'-collection';
  const scope={comment_encoding:'canonical',line_key:'yuesheng',run,source_run:sourceRun,video_id:videoId,video_url:url,profile:binding.profile,douyin_id:douyinId,nickname,comment_body_sha256:native.hash(commentBody),profile_eid:prefix+'-person1-t1',video_identity_eid:prefix+'-after-card1'};
  const evidence={version:1,status:'verified',scope,company_binding:binding,raw,sha256:{profile:native.hash(raw.profile),returned:native.hash(raw.returned)},video_identity:{verified:true,content_type:'video',expected_video_id:videoId,observed_video_id:videoId,evidence_id:scope.video_identity_eid}};
  let reads=0;const deps={recipientNative:{parseNative(...args){reads++;return native.parseNative(...args);}}};
  const pool={connect:async()=>({query:(...args)=>client.query(...args),release(){}})};
  const result=await queueRequest(pool,{op:'collect_partial',line:'yuesheng',run,source_run:sourceRun,video_id:videoId,video_url:url,comments:[{nickname,douyinId,commentBody,sourceVideoUrl:url,recipientEvidence:evidence}]},deps);
  assert.equal(result.inserted,1);assert.equal(reads,1,'Code-owned parser callback must be consumed, never silently spawn the default parser');
  const actual=await client.query('SELECT douyin_id,comment_body,recipient_evidence FROM zenithjoy.leadgen_comments');
  assert.equal(actual.rows[0].douyin_id,douyinId);assert.equal(actual.rows[0].comment_body,commentBody);assert.deepEqual(actual.rows[0].recipient_evidence,evidence);
 }finally{client.release();await allocation.pool.end();await allocation.transport.close();}
}));
