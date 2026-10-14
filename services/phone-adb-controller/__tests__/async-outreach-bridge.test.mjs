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
