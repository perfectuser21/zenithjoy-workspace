import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {comments,originalRun,sourceRun,video,policy} from './fixtures/leadgen-103-v14.mjs';
const require=createRequire(import.meta.url);
const {queueRequest}=require('../leadgen-queue.js');
const input={op:'policy_review',line:'jinuo',run:originalRun,claim:originalRun,source_run:sourceRun,ids:comments.map(c=>c.id)};

test('原批复核拒绝空、重复与非法CID，查库前停止',async()=>{
 for(const ids of [[],[comments[0].id,comments[0].id],['bad'],Array(51).fill(comments[0].id)]){
  let calls=0;await assert.rejects(queueRequest({query(){calls++;return {rows:[]}}},{...input,ids}),/POLICY_REVIEW_IDS_INVALID/);assert.equal(calls,0);
 }
});

test('原批逐CID只读复核，旧B不能凭枚举通过，缺行不能空批通过',async()=>{
 const calls=[];
 const pool={async query(sql,args){calls.push({sql,args});
  if(sql.includes('company_config_runs'))return {rows:[{snapshot:policy,company_id:policy.company_id,tenant_id:policy.tenant_id,version:14,run_id:originalRun}]};
  if(sql.includes('leadgen_comments'))return {rows:comments.map(c=>({...c,line_key:'jinuo',harvest_batch:sourceRun,source_video:video.title,source_video_url:video.video_url,relevance:'相关',intent_grade:'B',judgment_config:{run_id:originalRun,company_id:policy.company_id,tenant_id:policy.tenant_id,version:14,policy_id:policy.policy_id}}))};
  if(sql.includes('leadgen_videos'))return {rows:[{...video,line_key:'jinuo',judgment_status:'matched'}]};
  throw Error('unexpected SQL');}};
 const result=await queueRequest(pool,input,{judgePolicy:async()=>({grade:'不相关',audit:{model:'fake',response_id:'r1',policy_evidence:{audience_id:'recvvcNzUv5rzl',matched_rule:'就业焦虑',exclusion_rule:'泛失业或创业焦虑但未指向AI学习、考证或转行',reason:'未表达考证学习诉求'}}})});
 assert.equal(result.verified,false);assert.deepEqual(result.rows.map(r=>r.status),['fail','fail']);
 assert.equal(result.rows[0].policy_evidence.exclusion_rule,'泛失业或创业焦虑但未指向AI学习、考证或转行');
 assert.equal(result.rows[0].response_id,'r1');
 assert.ok(calls.every(c=>/^SELECT/.test(c.sql.trim())));
 assert.deepEqual(calls.find(c=>c.sql.includes('leadgen_comments')).args[1],input.ids);
});

test('明确画像正例可通过，错租户与不相关对照不混入同scope',async()=>{
 const good={id:'00000000-0000-4000-8000-000000000021',comment_body:'人工智能训练师证书怎么报名',line_key:'jinuo',harvest_batch:sourceRun,source_video:video.title,source_video_url:video.video_url,relevance:'相关',intent_grade:'A'};
 const foreign={...good,id:'00000000-0000-4000-8000-000000000022',line_key:'yuesheng'};
 const irrelevant={...good,id:'00000000-0000-4000-8000-000000000023',comment_body:'这是什么背景音乐',relevance:'不相关',intent_grade:null};
 for(const row of [good,foreign,irrelevant])row.judgment_config={run_id:originalRun,company_id:policy.company_id,tenant_id:policy.tenant_id,version:14,policy_id:policy.policy_id};
 const pool={async query(sql){if(sql.includes('company_config_runs'))return {rows:[{snapshot:policy,company_id:policy.company_id,tenant_id:policy.tenant_id,version:14,run_id:originalRun}]};if(sql.includes('leadgen_comments'))return {rows:[good,foreign,irrelevant]};if(sql.includes('leadgen_videos'))return {rows:[{...video,line_key:'jinuo',judgment_status:'matched'}]};throw Error('unexpected');}};
 const ids=[good.id,foreign.id,irrelevant.id];const result=await queueRequest(pool,{...input,ids},{judgePolicy:async body=>({grade:body===irrelevant.comment_body?'不相关':'A',audit:{model:'fake',response_id:'r1',policy_evidence:{audience_id:'recvvcNzUv5rzl',matched_rule:'怎么考',exclusion_rule:null,reason:'对照判断'}}})});
 assert.deepEqual(result.rows.map(r=>r.status),['pass','unknown','pass']);
});
test('政策复核不能把未完成评分的空relevance当成A档通过',async()=>{
 const row={id:'00000000-0000-4000-8000-000000000024',line_key:'jinuo',harvest_batch:sourceRun,comment_body:'人工智能训练师怎么报名',source_video:video.title,source_video_url:video.video_url,relevance:null,intent_grade:'A',judgment_config:{run_id:originalRun,company_id:policy.company_id,tenant_id:policy.tenant_id,version:14,policy_id:policy.policy_id}};
 const pool={async query(sql){if(sql.includes('company_config_runs'))return {rows:[{snapshot:policy,company_id:policy.company_id,tenant_id:policy.tenant_id,version:14,run_id:originalRun}]};if(sql.includes('leadgen_comments'))return {rows:[row]};return {rows:[{...video,line_key:'jinuo',judgment_status:'matched'}]};}};
 const r=await queueRequest(pool,{...input,ids:[row.id]},{judgePolicy:async()=>({grade:'A',audit:{model:'fake',response_id:'r1',policy_evidence:{audience_id:'recvvcNzUv5rzl',matched_rule:'怎么考',exclusion_rule:null,reason:'报名咨询'}}})});
 assert.equal(r.verified,false);assert.equal(r.rows[0].status,'unknown');
});

test('新评分语义未通过时回滚且不写旧评分，模型B也不能绕过排除项',async()=>{
 const row={...comments[0],source_video:video.title,source_video_url:video.video_url,harvest_batch:sourceRun,line_key:'jinuo',relevance:null};
 const calls=[];const client={async query(sql){calls.push(sql);if(sql.includes('SELECT * FROM zenithjoy.leadgen_comments'))return {rows:[row]};if(sql.includes('leadgen_videos'))return {rows:[{...video,judgment_status:'matched'}]};return {rows:[]};},release(){}};
 const pool={async connect(){return client}};
 await assert.rejects(queueRequest(pool,{op:'score',line:'jinuo',run:originalRun,source_run:sourceRun,limit:1},{freezeCompanyConfig:async()=>policy,
  judgeComment:async()=>({grade:'B',relevance:'相关',reason:'model:B'}),
  judgePolicy:async()=>({grade:'不相关',audit:{model:'fake',response_id:'r1',policy_evidence:{audience_id:'recvvcNzUv5rzl',matched_rule:'就业焦虑',exclusion_rule:'泛失业或创业焦虑但未指向AI学习、考证或转行',reason:'无考证学习诉求'}}})}),/POLICY_SCORE_NOT_VERIFIED/);
 assert.ok(calls.includes('ROLLBACK'));assert.ok(!calls.some(sql=>sql.includes('UPDATE zenithjoy.leadgen_comments')));
});

test('新评分的真实视频与评论语境不一致时回滚，不调用评分模型',async()=>{
 const row={...comments[0],source_video:video.title,source_video_url:video.video_url,harvest_batch:sourceRun,line_key:'jinuo'};let model=0;
 const client={async query(sql){if(sql.includes('SELECT * FROM zenithjoy.leadgen_comments'))return {rows:[row]};if(sql.includes('leadgen_videos'))return {rows:[{...video,title:'其他视频'}]};return {rows:[]};},release(){}};
 await assert.rejects(queueRequest({connect:async()=>client},{op:'score',line:'jinuo',run:originalRun,source_run:sourceRun,limit:1},{freezeCompanyConfig:async()=>policy,judgeComment:async()=>{model++;return {grade:'B',relevance:'相关'};}}),/POLICY_VIDEO_SCOPE_INVALID/);
 assert.equal(model,0);
});
test('合格新评分只在双重语义通过后写私有可审模型与政策依据',async()=>{
 const id='00000000-0000-4000-8000-000000000031',row={id,line_key:'jinuo',harvest_batch:sourceRun,comment_body:'人工智能训练师证书怎么报名',source_video:video.title,source_video_url:video.video_url};let writes=[];let selected=0;
 const client={async query(sql,args=[]){if(sql.includes('SELECT * FROM zenithjoy.leadgen_comments'))return {rows:selected++?[]:[row]};if(sql.includes('leadgen_videos'))return {rows:[{...video,judgment_status:'matched'}]};if(sql.includes('UPDATE zenithjoy.leadgen_comments'))writes.push(args);return {rows:[]};},release(){}};
 const result=await queueRequest({connect:async()=>client},{op:'score',line:'jinuo',run:originalRun,source_run:sourceRun,limit:1},{freezeCompanyConfig:async()=>policy,
  judgeComment:async()=>({grade:'A',relevance:'相关',reason:'jev:A',audit:{model:'typesafe/jev-1.13',response_id:'primary-1',confidence:.9}}),
  judgePolicy:async()=>({grade:'A',audit:{model:'google/gemini-2.5-flash',response_id:'final-1',confidence:null,policy_evidence:{audience_id:'recvvcNzUv5rzl',matched_rule:'怎么考',exclusion_rule:null,reason:'明确咨询考证报名'}}})});
 assert.equal(result.scored,1);assert.equal(writes.length,1);const saved=JSON.parse(writes[0][4]);
 assert.equal(saved.model_audit.response_id,'primary-1');assert.equal(saved.policy_audit.response_id,'final-1');
 assert.equal(saved.policy_audit.policy_evidence.matched_rule,'怎么考');assert.equal(saved.policy_audit.id,id);
});
test('四档中的不相关在语义一致时仍可记录，intent_grade保持null',async()=>{
 const row={id:'00000000-0000-4000-8000-000000000032',line_key:'jinuo',harvest_batch:sourceRun,comment_body:'这是什么背景音乐',source_video:video.title,source_video_url:video.video_url};let selected=0,saved;
 const client={async query(sql,args=[]){if(sql.includes('SELECT * FROM zenithjoy.leadgen_comments'))return {rows:selected++?[]:[row]};if(sql.includes('leadgen_videos'))return {rows:[{...video,judgment_status:'matched'}]};if(sql.includes('UPDATE zenithjoy.leadgen_comments'))saved=args;return {rows:[]};},release(){}};
 const result=await queueRequest({connect:async()=>client},{op:'score',line:'jinuo',run:originalRun,source_run:sourceRun,limit:1},{freezeCompanyConfig:async()=>policy,
  judgeComment:async()=>({grade:'不相关',relevance:'不相关',reason:'非业务话题'}),
  judgePolicy:async()=>({grade:'不相关',audit:{model:'fake',response_id:'r1',policy_evidence:{audience_id:'recvvcNzUv5rzl',matched_rule:'怎么考',exclusion_rule:null,reason:'与业务画像无关'}}})});
 assert.equal(result.scored,1);assert.equal(saved[2],null);
});

test('标记人扫描越过政策阻断行，前十条不占limit且第十一条可处理',async()=>{
 const blocked=Array.from({length:10},(_,i)=>({...comments[i%2],id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,source_video:video.title,source_video_url:video.video_url,line_key:'jinuo',harvest_batch:sourceRun,relevance:'相关',intent_grade:'B',judgment_config:{run_id:originalRun,company_id:policy.company_id,tenant_id:policy.tenant_id,version:14,policy_id:policy.policy_id}}));
 const good={...blocked[0],id:'00000000-0000-4000-8000-000000000011',comment_body:'人工智能训练师证书怎么报名',intent_grade:'A'};
 Object.assign(good,{nickname:'测试客户',douyin_id:'test-user',dedup_key:'test-dedup',profile_url:'https://www.douyin.com/user/test-user'});
 const calls=[];const rows=[...blocked,good];const client={async query(sql,args=[]){calls.push({sql,args});if(sql.includes('SELECT * FROM zenithjoy.leadgen_comments')){if(sql.includes('AND id=$2'))return {rows:rows.filter(r=>r.id===args[1])};if(sql.includes('id=ANY'))return {rows:rows.filter(r=>args[1].includes(r.id))};const excluded=args.find(Array.isArray)||[];return {rows:rows.filter(r=>!excluded.includes(r.id)).slice(0,1)};}if(sql.includes('company_config_runs'))return {rows:[{snapshot:policy,company_id:policy.company_id,tenant_id:policy.tenant_id,version:14,run_id:originalRun}]};if(sql.includes('leadgen_videos'))return {rows:[{...video,line_key:'jinuo',judgment_status:'matched'}]};if(sql.includes('INSERT INTO zenithjoy.leadgen_leads'))return {rows:[{id:'lead-1'}]};if(sql.includes('SELECT id,line_key,douyin_id FROM zenithjoy.leadgen_leads'))return {rows:[{id:'lead-1',line_key:'jinuo',douyin_id:'test-user'}]};return {rows:[]};},release(){}};
 const pool={async connect(){return client}};
 const result=await queueRequest(pool,{op:'mark_leads',line:'jinuo',run:originalRun,source_run:sourceRun,limit:10},{freezeCompanyConfig:async()=>policy,
  judgePolicy:async(body)=>({grade:body===good.comment_body?'A':'不相关',audit:{model:'fake',response_id:'r',policy_evidence:{audience_id:'recvvcNzUv5rzl',matched_rule:body===good.comment_body?'怎么考':'就业焦虑',exclusion_rule:body===good.comment_body?null:'泛失业或创业焦虑但未指向AI学习、考证或转行',reason:'政策判断'}}})});
 assert.equal(result.blocked,10);assert.equal(result.status,'partial');assert.ok(calls.some(c=>c.sql.includes('UPSERT')||c.sql.includes('INSERT INTO zenithjoy.leadgen_leads')));
 assert.ok(!calls.some(c=>c.sql.includes('UPDATE zenithjoy.leadgen_comments')&&blocked.some(r=>c.args?.includes(r.id))));
});

test('已有pending outbox缺原评论政策绑定时，桥接不能调用出站API',async()=>{
 const {bridgeOutreach}=require('../leadgen-outreach-bridge.js');let posts=0;
 const payload={line_key:'jinuo',run:originalRun,comment_run:sourceRun,comment_id:comments[0].id,source_video:video.title,source_video_url:video.video_url,qualification:{status:'passed',company_id:policy.company_id,tenant_id:policy.tenant_id,company_version:14,policy_id:policy.policy_id}};
 const row={id:'00000000-0000-4000-8000-000000000099',line_key:'jinuo',state:'pending',payload,qualification_status:'passed',payload_sha256:require('../leadgen-outreach-bridge.js').digest(payload)};
 const pool={async query(sql){if(sql.includes('leadgen_bridge_outbox'))return {rows:[row]};return {rows:[]};}};
 const result=await bridgeOutreach(pool,{line:'jinuo',run:originalRun,limit:1},{freezeCompanyConfig:async()=>policy,lock:async(_line,fn)=>fn(),client:{all:async()=>[],post:async()=>{posts++;}}});
 assert.equal(posts,0);assert.equal(result.verified,false);
});

test('outbox到原CID、run、视频一对一绑定错误时只读核验为unknown',async()=>{
 const {reviewBoundComment}=require('../leadgen-queue.js');let writes=0;
 const row={...comments[0],line_key:'jinuo',harvest_batch:sourceRun,source_video:video.title,source_video_url:video.video_url,judgment_config:{run_id:originalRun}};
 const pool={async query(sql){if(!sql.trim().startsWith('SELECT'))writes++;return {rows:sql.includes('leadgen_comments')?[row]:[]};}};
 const result=await reviewBoundComment(pool,'jinuo',comments[0].id,{run:originalRun,source_run:sourceRun,source_video:'错误视频',source_video_url:video.video_url});
 assert.equal(result.status,'unknown');assert.equal(writes,0);
});

test('mark_leads不能只信评论行自报视频，缺原视频行不建lead',async()=>{
 const row={...comments[0],id:'00000000-0000-4000-8000-000000000088',line_key:'jinuo',harvest_batch:sourceRun,source_video:video.title,source_video_url:video.video_url,relevance:'相关',intent_grade:'B',nickname:'测试用户',dedup_key:'test',judgment_config:{run_id:originalRun,company_id:policy.company_id,tenant_id:policy.tenant_id,version:14,policy_id:policy.policy_id}};
 let inserted=0;const client={async query(sql,args=[]){if(sql.includes('SELECT * FROM zenithjoy.leadgen_comments'))return {rows:sql.includes('id<>ALL')&&args[2].includes(row.id)?[]:[row]};if(sql.includes('INSERT INTO zenithjoy.leadgen_leads'))inserted++;return {rows:[]};},release(){}};
 const result=await queueRequest({connect:async()=>client},{op:'mark_leads',line:'jinuo',run:originalRun,source_run:sourceRun,limit:1},{freezeCompanyConfig:async()=>policy,judgePolicy:async()=>({grade:'B',audit:{model:'fake',response_id:'r1',policy_evidence:{audience_id:'recvvcNzUv5rzl',matched_rule:'就业焦虑',exclusion_rule:null,reason:'政策匹配'}}})});
 assert.equal(result.blocked,1);assert.equal(inserted,0);
});
test('mark_leads扫描游标与原line/run/source scope不符时查库前拒绝',async()=>{
 let queries=0;const pool={query(){queries++;return {rows:[]}},connect(){queries++;throw Error('unexpected')}};
 await assert.rejects(queueRequest(pool,{op:'mark_leads',line:'jinuo',run:originalRun,source_run:sourceRun,limit:1,
  cursor:{line:'yuesheng',run:originalRun,source_run:sourceRun,collected_at:'2026-10-20T00:00:00.000Z',id:comments[0].id}},{freezeCompanyConfig:async()=>policy}),/POLICY_MARK_CURSOR_INVALID/);
 assert.equal(queries,0);
});
