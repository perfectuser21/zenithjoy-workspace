import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {companyFixture} from './company-config-fixture.mjs';

const require=createRequire(import.meta.url);
const {queueRequest}=require('../leadgen-queue.js');
const {judgeComment}=require('../judge-comment.js');

test('Commander连续两次证据不合格时PG回滚、原评论不写入且Jev只调用一次',async()=>{
 const calls=[];let claimed=false;
 const client={async query(sql,args){calls.push({sql,args});
  if(/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)||sql.includes('pg_advisory_xact_lock'))return {rows:[]};
  if(sql.includes('SELECT * FROM zenithjoy.leadgen_comments')){if(claimed)return {rows:[]};claimed=true;return {rows:[{
   id:'c1',comment_body:'如何报名',source_video:'培训',source_video_url:'https://www.douyin.com/video/7617837149999841201',
  }]};}
  if(sql.includes('SELECT video_id,video_url,title,judgment_status'))return {rows:[{title:'培训',judgment_status:'matched'}]};
  throw Error('unexpected SQL');
 },release(){}};
 const urls=[];const httpPost=async(url)=>{urls.push(url);return url.endsWith('/decisions')
  ?{answers:{grade:{choice:'A',confidence:.1}}}
  :{id:'response-invalid',model:'google/gemini-2.5-flash',choices:[{message:{content:JSON.stringify({grade:'A',policy_evidence:{audience_id:'missing',matched_rule:'报名',reason:'有意向'}})}}]};};
 const result=await queueRequest({connect:async()=>client},{op:'score',line:'jinuo',run:'test'},
  {freezeCompanyConfig:async()=>companyFixture(),judgeComment:(body,video,profile,opts)=>judgeComment(body,video,profile,{...opts,httpPost,apiKey:'k'})});
 assert.equal(result.status,'partial');
 assert.deepEqual(result.blocked_reasons,[{id:'c1',code:'POLICY_SCORE_COMMANDER_EVIDENCE_INVALID',stage:'commander',evidence_check:'missing_exclusion_rule'}]);
 assert.equal(urls.filter(url=>url.endsWith('/decisions')).length,1);
 assert.equal(urls.filter(url=>url.endsWith('/chat/completions')).length,2);
 assert.ok(calls.some(c=>c.sql==='ROLLBACK'));
 assert.ok(!calls.some(c=>/UPDATE zenithjoy\.leadgen_comments/.test(c.sql)));
});
