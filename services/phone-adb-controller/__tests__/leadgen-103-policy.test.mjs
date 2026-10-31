import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {comments,originalRun,sourceRun,video,policy} from './fixtures/leadgen-103-v14.mjs';
const require=createRequire(import.meta.url);
const {queueRequest,evaluatePolicy,reviewBoundComment}=require('../leadgen-queue.js');
const {judgeCommander,JudgeApiError}=require('../judge-comment.js');
const {safePolicyReviewReason}=require('../leadgen-policy-review.js');
const input={op:'policy_review',line:'jinuo',run:originalRun,claim:originalRun,source_run:sourceRun,ids:comments.map(c=>c.id)};
const primaryAudit={model:'typesafe/jev-1.13',response_id:'jev-response-1',confidence:.99};

test('政策复核原因码只准固定枚举，模型正文与凭据样式不得进入回执',()=>{
 assert.equal(safePolicyReviewReason('personal_intent_evidence_missing'),'personal_intent_evidence_missing');
 assert.equal(safePolicyReviewReason('audience_or_topic_evidence_missing'),'audience_or_topic_evidence_missing');
 assert.equal(safePolicyReviewReason('raw comment API key'),null);
});

test('政策模型异常分别保留安全类别与HTTP状态，未知内部异常不能伪装服务不可用',async()=>{
 const row={id:'00000000-0000-4000-8000-000000000099',comment_body:'人工智能训练师证书怎么报名',
  source_video:video.title,source_video_url:video.video_url,relevance:'相关',intent_grade:'A',
  judgment_config:{company_id:policy.company_id,tenant_id:policy.tenant_id,version:14,policy_id:policy.policy_id,run_id:originalRun}};
 const cases=[
  [new JudgeApiError('private body',{stage:'commander',status:429}),'policy_model_http',{model_stage:'commander',http_status:429}],
  [new JudgeApiError('private body',{stage:'commander'}),'policy_model_transport',{model_stage:'commander'}],
  [Object.assign(Error('COMMANDER_EVIDENCE_INVALID'),{evidence_check:'missing_exclusion_rule'}),'policy_model_evidence_invalid',{model_stage:'commander',evidence_check:'missing_exclusion_rule'}],
  [Error('COMPANY_COMMENT_SCORING_REQUIRED'),'policy_review_config_invalid',{}],
  [Error('private body api_key=secret'),'policy_review_internal_error',{}],
 ];
 for(const [failure,reason,detail] of cases){
  const actual=await evaluatePolicy(row,policy,{judgePolicy:async()=>{throw failure;}});
  assert.deepEqual(actual,{id:row.id,status:'unknown',reason,...detail});
  assert.equal(JSON.stringify(actual).includes('private body'),false);
  assert.equal(JSON.stringify(actual).includes('secret'),false);
 }
});

test('103新run先走正式公司冻结；首轮与丢回执恢复共享原CID和一次评分预算',async t=>{
 const {createHandlers}=await import('../leadgen-handlers.mjs');
 const {companyFixture}=await import('./company-config-fixture.mjs');
 const {rmSync}=await import('node:fs');
 for(const loseReply of [false,true]){
  const dir=mkdtempSync(join(tmpdir(),'fresh-score-freeze-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const run='fresh103',id='00000000-0000-4000-8000-000000000191',sources={[id]:'original102'};
  const snapshot=companyFixture();snapshot.config_status='enabled';snapshot.runtime_config.routing={line_key:'jinuo'};snapshot.runtime_config.policy_id=snapshot.policy_id;
  let frozen=null,scored=false,modelCalls=0,inserts=0,lost=loseReply;const calls=[];
  const row=()=>({id,harvest_batch:sources[id],line_key:'jinuo',relevance:scored?'相关':null,intent_grade:scored?'A':null,
   judgment_config:scored?{run_id:run,company_id:snapshot.company_id,tenant_id:snapshot.tenant_id,version:snapshot.version,policy_id:snapshot.policy_id,
    model_audit:{model:'fixture',response_id:'response'},policy_audit:{status:'pass',response_id:'review'}}:null});
  const client={async query(sql,args=[]){
   if(/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql))return {rows:[]};
   if(sql.startsWith('SELECT company_id FROM zenithjoy.tenant_company_profiles'))return {rows:[{company_id:snapshot.company_id}]};
   if(sql.startsWith('SELECT * FROM zenithjoy.tenant_company_profiles'))return {rows:[{config_status:'enabled',config_version:1,tenant_id:snapshot.tenant_id}]};
   if(sql.includes('FROM zenithjoy.company_config_versions'))return {rows:[{snapshot}]};
   if(sql.startsWith('INSERT INTO zenithjoy.company_config_runs')){
    assert.equal(args[1],run);assert.equal(args[6],null);inserts++;frozen={snapshot:JSON.parse(args[4]),task_inputs:JSON.parse(args[5]),source_run:args[6]};return {rows:[frozen]};
   }
   if(sql.includes('FROM zenithjoy.company_config_runs'))return {rows:frozen?[{...frozen,run_id:run,company_id:snapshot.company_id,tenant_id:snapshot.tenant_id,version:1}]:[]};
   if(sql.includes('SELECT id,harvest_batch FROM zenithjoy.leadgen_comments'))return {rows:[{id,harvest_batch:sources[id]}]};
   if(sql.includes('SELECT id,harvest_batch,line_key,process_status'))return {rows:[{...row(),process_status:'待分拣'}]};
   throw Error('unexpected SQL '+sql);
  },release(){}};
  const pool={query:client.query.bind(client),connect:async()=>client};
  const rpc=async({request:r})=>{calls.push(r.op);
   if(['company_config','score_scope','score_recovery'].includes(r.op))return {result:await queueRequest(pool,r)};
   if(r.op==='score'){
    assert.ok(frozen,'必须由真实freezeCompanyConfig持久冻结后才能评分');assert.deepEqual(r.ids,[id]);assert.deepEqual(r.sources,sources);assert.equal(r.limit,1);assert.equal(r.budget_max,1);
    modelCalls++;scored=true;if(lost){lost=false;throw Error('score reply lost');}return {result:{ids:[id],scored:1,blocked_ids:[]}};
   }
   if(r.op==='score_readback')return {result:{verified:true,failures:0}};
   if(r.op==='policy_review')return {result:{verified:true,rows:[{id,status:'pass'}]}};
   throw Error('unexpected op '+r.op);
  };
  const h=createHandlers({root:dir,env:{P:'mmv-scoring',SERIAL:'none',WFR_TAG:run,LEADGEN_LINE:'jinuo',LEADGEN_LIMIT:'1',WFR_RUN_DIR:dir,HOME:dir},rpc});
  if(loseReply)await assert.rejects(h.scoring(),/score reply lost/);
  const result=await h.scoring();assert.equal(result.scored,1);assert.equal(result.recovered,loseReply?1:0);
  assert.equal(inserts,1);assert.equal(modelCalls,1);assert.equal(calls[0],'company_config');
  const again=await h.scoring();assert.equal(again.recovered,1);assert.equal(modelCalls,1);assert.equal(inserts,1);
 }
});

test('103正式公司冻结拒绝时不读评分范围、不占本地attempt、不调用模型',async t=>{
 const {createHandlers}=await import('../leadgen-handlers.mjs');
 const {existsSync,rmSync}=await import('node:fs');
 for(const reason of ['COMPANY_CONFIG_NOT_ENABLED','COMPANY_SOURCE_RUN_CHANGED','COMPANY_TASK_INPUTS_CHANGED']){
  const dir=mkdtempSync(join(tmpdir(),'score-freeze-denied-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const calls=[];
  const h=createHandlers({root:dir,env:{P:'mmv-scoring',SERIAL:'none',WFR_TAG:'denied103',LEADGEN_LINE:'jinuo',LEADGEN_LIMIT:'1',WFR_RUN_DIR:dir,HOME:dir},
   rpc:async({request:r})=>{calls.push(r);if(r.op!=='company_config')assert.fail('冻结拒绝后不得继续');throw Error(reason);}});
  await assert.rejects(h.scoring(),new RegExp(reason));assert.equal(calls.length,1);assert.equal(calls[0].step,'103');
  assert.equal(existsSync(join(dir,'denied103-score-attempt.json')),false);
 }
});

 test('QA 沙箱实际 RPC 同批先排除缺受众证据再持久评分后行正例',()=>{
 const dir=mkdtempSync(join(tmpdir(),'leadgen-103-sandbox-')),file=join(dir,'fixture.json'),output=join(dir,'state');
 const rows=[{...comments[0],id:'00000000-0000-4000-8000-000000000051',collected_at:'2026-10-20T00:00:00Z',response:{primary_grade:'B',policy_grade:'B',policy_evidence:{audience_id:'recvvcNzUv5rzl',matched_rule:'就业焦虑',exclusion_rule:null,reason:'泛焦虑'}}},
  {id:'00000000-0000-4000-8000-000000000052',comment_body:'人工智能训练师证书怎么报名',collected_at:'2026-10-20T00:01:00Z',response:{primary_grade:'A',policy_grade:'A',policy_evidence:{audience_id:'recvvcNzUv5rzl',matched_rule:'怎么报',exclusion_rule:null,reason:'报名咨询'}}}]
  .map(r=>({...r,line_key:'jinuo',harvest_batch:sourceRun,source_video:video.title,source_video_url:video.video_url,process_status:'待分拣',relevance:null,intent_grade:null}));
 writeFileSync(file,JSON.stringify({snapshot:policy,rows,line:'jinuo',run:originalRun,source_run:sourceRun,limit:2,video}));
 const cli=new URL('./helpers/leadgen-103-sandbox.mjs',import.meta.url);
 const result=spawnSync(process.execPath,[cli.pathname,'score','--fixture',file,'--output',output],{encoding:'utf8'});
 assert.equal(result.status,0,result.stdout+result.stderr);const data=JSON.parse(result.stdout);
 assert.deepEqual(data.result.ids,[rows[1].id],JSON.stringify(data.result));
 assert.deepEqual(data.result.excluded_ids,[rows[0].id]);assert.deepEqual(data.result.blocked_ids,[]);
 assert.equal(data.rows[0].process_status,'已排除');assert.equal(data.rows[0].relevance,null);
 assert.equal(data.rows[1].intent_grade,'A');assert.ok(data.requests.some(r=>r.path==='/api/v1/chat/completions'));
});

test('终审只接单个 JSON 或单层 json fence，保留真实模型响应身份与独立置信',async()=>{
 const answer={grade:'A',confidence:.83,policy_evidence:{audience_id:'recvvcNzUv5rzl',matched_rule:'怎么报',exclusion_rule:null,reason:'报名咨询'}};
 const requests=[];const httpPost=async(url,body)=>{requests.push({url,body});return {id:'actual-response-id',model:'google/gemini-2.5-flash',choices:[{message:{content:`\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``}}]};};
 const r=await judgeCommander('人工智能训练师证书怎么报名',video.title,'冻结画像','jev low confidence',
  {apiKey:'fixture-only',scoringRules:policy.runtime_config.comment_scoring,httpPost});
 assert.equal(r.grade,'A');assert.equal(r.audit.response_id,'actual-response-id');assert.equal(r.audit.confidence,.83);
 assert.match(requests[0].url,/\/api\/v1\/chat\/completions$/);assert.equal(requests[0].body.model,'google/gemini-2.5-flash');
 assert.match(requests[0].body.messages[0].content,/comment_signal 与 video_signal 必须分别逐字引用评论原文与视频标题/);
 await judgeCommander('人工智能训练师证书怎么报名',video.title,'冻结画像','video quote invalid',
  {apiKey:'fixture-only',scoringRules:policy.runtime_config.comment_scoring,httpPost,retryVideoQuote:true});
 assert.match(requests[1].body.messages[0].content,/上次 video_signal 未能逐字引用视频标题/);
 await assert.rejects(judgeCommander('人工智能训练师证书怎么报名',video.title,'冻结画像','low',
  {apiKey:'fixture-only',scoringRules:policy.runtime_config.comment_scoring,httpPost:async()=>({id:'r',model:'google/gemini-2.5-flash',choices:[{message:{content:`${JSON.stringify(answer)} ${JSON.stringify(answer)}`}}]})}),/COMMANDER_EVIDENCE_INVALID/);
});

test('完整 v14 下合法错误 B 与真实引用不能放行泛焦虑，明确报名 A 可过',async()=>{
 const proof=(grade,rule)=>({grade,audit:{model:'google/gemini-2.5-flash',response_id:'response-1',confidence:.99,
  policy_evidence:{audience_id:'recvvcNzUv5rzl',matched_rule:rule,exclusion_rule:null,reason:'按冻结画像判断'}}});
 const binding={run_id:originalRun,company_id:policy.company_id,tenant_id:policy.tenant_id,version:14,policy_id:policy.policy_id};
 for(const c of comments){const r=await evaluatePolicy({...c,source_video:video.title,source_video_url:video.video_url,relevance:'相关',intent_grade:'B',judgment_config:binding},policy,{judgePolicy:async()=>proof('B','就业焦虑')});assert.notEqual(r.status,'pass');}
 const good=await evaluatePolicy({id:'00000000-0000-4000-8000-000000000041',comment_body:'人工智能训练师证书怎么报名',source_video:video.title,source_video_url:video.video_url,relevance:'相关',intent_grade:'A',judgment_config:binding},policy,{judgePolicy:async()=>proof('A','怎么报')});
 assert.equal(good.status,'pass');
});
test('本人明确追问可由同视频政策主题补足省略指代，不能只凭视频话题',async()=>{
 const config={run_id:originalRun,company_id:policy.company_id,tenant_id:policy.tenant_id,version:14,policy_id:policy.policy_id};
 const row={id:'00000000-0000-4000-8000-000000000045',comment_body:'这个适合我吗？',source_video:'人工智能训练师证书怎么考',
  source_video_url:video.video_url,relevance:'相关',intent_grade:'A',judgment_config:config};
 const verdict={grade:'A',audit:{model:'google/gemini-2.5-flash',response_id:'actual-context',policy_evidence:{audience_id:'recvvcNzUv5rzl',
  matched_rule:'怎么考',comment_signal:'适合我吗？',video_signal:'怎么考',exclusion_rule:null,reason:'本人追问视频中的考证主题'}}};
 const r=await evaluatePolicy(row,policy,{judgePolicy:async()=>verdict});assert.equal(r.status,'pass');
 const unrelated=await evaluatePolicy({...row,comment_body:'最近压力很大'},policy,{judgePolicy:async()=>verdict});assert.notEqual(unrelated.status,'pass');
});

test('同批首 CID 双审缺证据排除后仍提交后行 A，不跨批',async()=>{
 const first={...comments[0],line_key:'jinuo',harvest_batch:sourceRun,source_video:video.title,source_video_url:video.video_url,collected_at:new Date('2026-10-20T00:00:00Z')};
 const second={id:'00000000-0000-4000-8000-000000000043',comment_body:'人工智能训练师证书怎么报名',line_key:'jinuo',harvest_batch:sourceRun,source_video:video.title,source_video_url:video.video_url,collected_at:new Date('2026-10-20T00:01:00Z')};
 const other={...second,id:'00000000-0000-4000-8000-000000000044',harvest_batch:'another-batch'};const updates=[];const calls=[];let reviewSeq=0;
 const client={async query(sql,args=[]){calls.push({sql,args});if(sql.includes('SELECT * FROM zenithjoy.leadgen_comments')){const excluded=args.find(Array.isArray)||[];return {rows:[first,second,other].filter(r=>r.harvest_batch===sourceRun&&!excluded.includes(r.id)&&!updates.includes(r.id)).slice(0,1)};}if(sql.includes('leadgen_videos'))return {rows:[{...video,judgment_status:'matched'}]};if(sql.includes('leadgen_bridge_outbox'))return {rows:[]};if(sql.includes('UPDATE zenithjoy.leadgen_comments')){updates.push(args[0]);return {rows:[],rowCount:1};}return {rows:[]};},release(){}};
 const r=await queueRequest({connect:async()=>client},{op:'score',line:'jinuo',run:originalRun,source_run:sourceRun,limit:2},{freezeCompanyConfig:async()=>policy,
  judgeComment:async(body)=>({grade:body===first.comment_body?'B':'A',relevance:'相关',reason:'模型判定',audit:primaryAudit}),
  judgePolicy:async(body)=>({grade:body===first.comment_body?'B':'A',audit:{model:'google/gemini-2.5-flash',response_id:`response-${++reviewSeq}`,policy_evidence:{audience_id:'recvvcNzUv5rzl',matched_rule:body===first.comment_body?'就业焦虑':'怎么报',exclusion_rule:null,reason:'冻结规则依据'}}})});
 assert.deepEqual(updates,[first.id,second.id]);assert.equal(r.scored,1);assert.deepEqual(r.excluded_ids,[first.id]);
 assert.ok(calls.some(c=>c.sql.includes('id<>ALL')&&c.args.some(a=>Array.isArray(a)&&a.includes(first.id))));
});

test('合法错误 B 加真实规则引用不得 UPDATE COMMIT 原 CID',async()=>{
 const row={...comments[1],line_key:'jinuo',harvest_batch:sourceRun,source_video:video.title,source_video_url:video.video_url,
  collected_at:new Date('2026-10-20T00:00:00Z')};let selects=0;const calls=[];
 const client={async query(sql,args=[]){calls.push({sql,args});if(sql.includes('SELECT * FROM zenithjoy.leadgen_comments'))return {rows:selects++?[]:[row]};
  if(sql.includes('leadgen_videos'))return {rows:[{...video,judgment_status:'matched'}]};return {rows:[]};},release(){}};
 const r=await queueRequest({connect:async()=>client},{op:'score',line:'jinuo',run:originalRun,source_run:sourceRun,limit:1},
  {freezeCompanyConfig:async()=>policy,judgeComment:async()=>({grade:'B',relevance:'相关',reason:'model:B',audit:primaryAudit}),
   judgePolicy:async()=>({grade:'B',audit:{model:'google/gemini-2.5-flash',response_id:'actual-response',confidence:.99,
    policy_evidence:{audience_id:'recvvcNzUv5rzl',matched_rule:'就业焦虑',exclusion_rule:null,reason:'人群描述引用'}}})});
 assert.equal(r.scored,0);assert.deepEqual(r.blocked_ids,[row.id]);
 assert.ok(calls.some(c=>c.sql==='ROLLBACK'));assert.ok(!calls.some(c=>c.sql.includes('UPDATE zenithjoy.leadgen_comments')));
});

test('旧代码确实阻断首行时仍须扫描同批后行',async()=>{
 const first={...comments[0],line_key:'jinuo',harvest_batch:sourceRun,source_video:video.title,source_video_url:video.video_url,collected_at:new Date('2026-10-20T00:00:00Z')};
 const second={id:'00000000-0000-4000-8000-000000000061',comment_body:'人工智能训练师证书怎么报名',line_key:'jinuo',harvest_batch:sourceRun,
  source_video:video.title,source_video_url:video.video_url,collected_at:new Date('2026-10-20T00:01:00Z')};const writes=[];let reviewSeq=0;
 const client={async query(sql,args=[]){if(sql.includes('SELECT * FROM zenithjoy.leadgen_comments'))return {rows:[first,second].filter(r=>!(args[2]||[]).includes(r.id)&&!writes.includes(r.id)).slice(0,1)};
  if(sql.includes('leadgen_videos'))return {rows:[{...video,judgment_status:'matched'}]};if(sql.includes('UPDATE zenithjoy.leadgen_comments'))writes.push(args[0]);return {rows:[]};},release(){}};
 const r=await queueRequest({connect:async()=>client},{op:'score',line:'jinuo',run:originalRun,source_run:sourceRun,limit:1},
  {freezeCompanyConfig:async()=>policy,judgeComment:async(body)=>({grade:body===first.comment_body?'B':'A',relevance:'相关',reason:'model',audit:primaryAudit}),
   judgePolicy:async(body)=>({grade:body===first.comment_body?'不相关':'A',audit:{model:'google/gemini-2.5-flash',response_id:`actual-${++reviewSeq}`,
    policy_evidence:{audience_id:'recvvcNzUv5rzl',matched_rule:body===first.comment_body?'就业焦虑':'怎么报',
     exclusion_rule:body===first.comment_body?'泛失业或创业焦虑但未指向AI学习、考证或转行':null,reason:'冻结规则依据'}}})});
 assert.deepEqual(r.blocked_ids,[first.id]);assert.deepEqual(writes,[second.id]);
});

test('旧评分 run 与新标人 run 分别绑定后缺双审证据不补第三次模型',async()=>{
 const scoreRun=originalRun,markRun='mark103_new';const id='00000000-0000-4000-8000-000000000042';
 const row={id,line_key:'jinuo',harvest_batch:sourceRun,comment_body:'人工智能训练师证书怎么报名',source_video:video.title,source_video_url:video.video_url,relevance:'相关',intent_grade:'A',judgment_config:{run_id:scoreRun,company_id:policy.company_id,tenant_id:policy.tenant_id,version:14,policy_id:policy.policy_id}};
 const pool={async query(sql,args){if(sql.includes('leadgen_comments'))return {rows:[row]};if(sql.includes('company_config_runs'))return {rows:[{snapshot:policy,company_id:policy.company_id,tenant_id:policy.tenant_id,version:14,run_id:args[0]}]};if(sql.includes('leadgen_videos'))return {rows:[{...video,line_key:'jinuo',judgment_status:'matched'}]};throw Error('unexpected SQL');}};
 let modelCalls=0;const result=await reviewBoundComment(pool,'jinuo',id,{run:markRun,scoring_run:scoreRun,source_run:sourceRun,source_video:video.title,source_video_url:video.video_url},
  {judgePolicy:async()=>{modelCalls++;throw Error('third call forbidden');}});
 assert.equal(result.status,'unknown');assert.equal(modelCalls,0);
});

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

test('冻结v14的B相关讨论无行动意向与C画像内寒暄可核通过，A无个人意向仍阻断',async()=>{
 const examples=[
  {grade:'B',comment:'这个考证视频挺有意思',rule:'考证视频',signal:'考证视频',expected:'pass'},
  {grade:'C',comment:'职场人来打个卡',rule:'职场人',signal:'职场人来打个卡',expected:'pass'},
  {grade:'A',comment:'这个考证视频挺有意思',rule:'考证视频',signal:'考证视频',expected:'unknown'},
  {grade:'B',comment:'这是什么背景音乐',rule:'考证视频',signal:'背景音乐',expected:'unknown'},
 ];
 for(const example of examples){
  const row={id:'00000000-0000-4000-8000-000000000026',comment_body:example.comment,
   source_video:video.title,source_video_url:video.video_url,relevance:'相关',intent_grade:example.grade,
   judgment_config:{company_id:policy.company_id,tenant_id:policy.tenant_id,version:14,policy_id:policy.policy_id}};
  const review=await evaluatePolicy(row,policy,{judgePolicy:async()=>({grade:example.grade,
   audit:{model:'fixture-model',response_id:'fixture-response',policy_evidence:{audience_id:'recvvcNzUv5rzl',
    matched_rule:example.rule,comment_signal:example.signal,exclusion_rule:null,reason:'按冻结画像分级'}}})});
  assert.equal(review.status,example.expected,`${example.grade} ${example.comment}`);
  if(example.grade==='A')assert.equal(review.reason,'personal_intent_evidence_missing');
 }
});

test('A档中文直接提问须双引用同主题；无问词、错误视频或模型自由改写仍阻断',async()=>{
 const cases=[
  {comment:'FDE到底有几张证，哪张才是能查的',video:'FDE证书刚出第二张',signal:'FDE到底有几张证，哪张才是能查的',videoSignal:'FDE证书',expected:'pass'},
  {comment:'FDE证书确实很多',video:'FDE证书刚出第二张',signal:'FDE证书确实很多',videoSignal:'FDE证书',expected:'unknown'},
  {comment:'FDE到底有几张证，哪张才是能查的',video:'如何制作水彩画',signal:'FDE到底有几张证，哪张才是能查的',videoSignal:'如何制作水彩画',expected:'unknown'},
  {comment:'FDE到底有几张证，哪张才是能查的',video:'FDE证书刚出第二张',signal:'FDE到底有几张证，哪张才是能查的',videoSignal:'FDE证书咨询',expected:'unknown'},
 ];
 for(const item of cases){
  const row={id:'00000000-0000-4000-8000-000000000027',comment_body:item.comment,
   source_video:item.video,source_video_url:video.video_url,relevance:'相关',intent_grade:'A',
   judgment_config:{company_id:policy.company_id,tenant_id:policy.tenant_id,version:14,policy_id:policy.policy_id}};
  const review=await evaluatePolicy(row,policy,{judgePolicy:async()=>({grade:'A',audit:{model:'fixture-model',response_id:'fixture-response',
   policy_evidence:{audience_id:'recvvcNzUv5rzl',matched_rule:'考证视频',comment_signal:item.signal,
    video_signal:item.videoSignal,exclusion_rule:null,reason:'明确证书咨询'}}})});
  assert.equal(review.status,item.expected,JSON.stringify({expected:item.expected,reason:review.reason}));
 }
});

test('政策视频引用不合格只重试一次；第二次有效通过，仍无效则unknown',async()=>{
 const row={id:'00000000-0000-4000-8000-000000000028',comment_body:'FDE到底有几张证，哪张才是能查的',
  source_video:'FDE证书刚出第二张',source_video_url:video.video_url,relevance:'相关',intent_grade:'A',
  judgment_config:{company_id:policy.company_id,tenant_id:policy.tenant_id,version:14,policy_id:policy.policy_id}};
 const make=(videoSignal)=>({grade:'A',audit:{model:'fixture-model',response_id:'fixture-response',policy_evidence:{
  audience_id:'recvvcNzUv5rzl',matched_rule:'考证视频',comment_signal:row.comment_body,
  video_signal:videoSignal,exclusion_rule:null,reason:'证书直接咨询'}}});
 for(const second of ['FDE证书','FDE证书咨询']){
  let calls=0;const r=await evaluatePolicy(row,policy,{judgePolicy:async(_body,_video,_profile,_reason,opts)=>{
   calls++;assert.ok(calls<=2,'政策复核不得超过两次');if(calls===2)assert.equal(opts.retryVideoQuote,true);
   return make(calls===1?'FDE证书咨询':second);
  }});
  assert.equal(calls,2);assert.equal(r.status,second==='FDE证书'?'pass':'unknown');
  if(second!=='FDE证书')assert.equal(r.reason,'personal_intent_evidence_missing');
 }
});

test('103政策双次无效最多一次评分加两次复核且事务回滚，回执只含安全原因',async()=>{
 const row={id:'00000000-0000-4000-8000-000000000029',line_key:'jinuo',harvest_batch:sourceRun,
  comment_body:'FDE到底有几张证，哪张才是能查的',source_video:'FDE证书刚出第二张',source_video_url:video.video_url};
 const calls=[];let scoreCalls=0,reviewCalls=0;
 const client={async query(sql,args=[]){calls.push(sql);
  if(sql.includes('SELECT * FROM zenithjoy.leadgen_comments'))return {rows:args[2]?.includes(row.id)?[]:[row]};
  if(sql.includes('leadgen_videos'))return {rows:[{title:row.source_video,judgment_status:'matched'}]};
  return {rows:[]};},release(){}};
 const result=await queueRequest({connect:async()=>client},
  {op:'score',line:'jinuo',run:originalRun,source_run:sourceRun,limit:1},
  {freezeCompanyConfig:async()=>policy,
   judgeComment:async()=>{scoreCalls++;return {grade:'A',relevance:'相关',reason:'model:A',audit:primaryAudit};},
   judgePolicy:async()=>{reviewCalls++;return {grade:'A',audit:{model:'fixture-model',response_id:'fixture-response',
    policy_evidence:{audience_id:'recvvcNzUv5rzl',matched_rule:'考证视频',comment_signal:row.comment_body,
     video_signal:'FDE证书咨询',exclusion_rule:null,reason:'证书咨询'}}};}});
 assert.equal(scoreCalls,1);assert.equal(reviewCalls,2);assert.equal(result.scored,0);
 assert.deepEqual(result.blocked_reasons,[{id:row.id,code:'POLICY_SCORE_NOT_VERIFIED',
  policy_review_reason:'policy_review_budget_exhausted',policy_review_model_calls:2}]);
 assert.ok(calls.includes('ROLLBACK'));
 assert.ok(!calls.some(sql=>sql.includes('UPDATE zenithjoy.leadgen_comments')));
});

test('新评分语义未通过时回滚且不写旧评分，模型B也不能绕过排除项',async()=>{
 const row={...comments[0],source_video:video.title,source_video_url:video.video_url,harvest_batch:sourceRun,line_key:'jinuo',relevance:null};
 const calls=[];const client={async query(sql){calls.push(sql);if(sql.includes('SELECT * FROM zenithjoy.leadgen_comments'))return {rows:[row]};if(sql.includes('leadgen_videos'))return {rows:[{...video,judgment_status:'matched'}]};return {rows:[]};},release(){}};
 const pool={async connect(){return client}};
 await assert.rejects(queueRequest(pool,{op:'score',line:'jinuo',run:originalRun,source_run:sourceRun,limit:1},{freezeCompanyConfig:async()=>policy,
  judgeComment:async()=>({grade:'B',relevance:'相关',reason:'model:B',audit:primaryAudit}),
  judgePolicy:async()=>({grade:'不相关',audit:{model:'fake',response_id:'r1',policy_evidence:{audience_id:'recvvcNzUv5rzl',matched_rule:'就业焦虑',exclusion_rule:'泛失业或创业焦虑但未指向AI学习、考证或转行',reason:'无考证学习诉求'}}})}),/POLICY_SCORE_NOT_VERIFIED/);
 assert.ok(calls.includes('ROLLBACK'));assert.ok(!calls.some(sql=>sql.includes('UPDATE zenithjoy.leadgen_comments')));
});

test('103政策复核缺个人意向但复用同一模型身份时保留待分拣且不写评分',async()=>{
 const row={id:'00000000-0000-4000-8000-000000000025',line_key:'jinuo',harvest_batch:sourceRun,
  comment_body:'这是什么背景音乐',source_video:video.title,source_video_url:video.video_url};
 const calls=[];let selected=0;
 const client={async query(sql){calls.push(sql);
  if(sql.includes('SELECT * FROM zenithjoy.leadgen_comments'))return {rows:selected++?[]:[row]};
  if(sql.includes('leadgen_videos'))return {rows:[{...video,judgment_status:'matched'}]};
  return {rows:[]};},release(){}};
 const result=await queueRequest({connect:async()=>client},
  {op:'score',line:'jinuo',run:originalRun,source_run:sourceRun,limit:1},
  {freezeCompanyConfig:async()=>policy,
   judgeComment:async()=>({grade:'A',relevance:'相关',reason:'model:A',audit:primaryAudit}),
   judgePolicy:async()=>({grade:'A',audit:{model:'fixture-model',response_id:'fixture-response',
    policy_evidence:{audience_id:'recvvcNzUv5rzl',matched_rule:'怎么考',exclusion_rule:null,reason:'fixture'}}})});
 assert.equal(result.scored,0);assert.equal(result.blocked,1);
 assert.deepEqual(result.blocked_reasons,[{id:row.id,code:'POLICY_SCORE_NOT_VERIFIED',
  policy_review_reason:'policy_review_identity_reused',policy_review_model_calls:2}]);
 assert.ok(calls.includes('ROLLBACK'));
 assert.ok(!calls.some(sql=>sql.includes('UPDATE zenithjoy.leadgen_comments')));
});

test('新评分的真实视频与评论语境不一致时回滚，不调用评分模型',async()=>{
 const row={...comments[0],source_video:video.title,source_video_url:video.video_url,harvest_batch:sourceRun,line_key:'jinuo'};let model=0;
 const client={async query(sql){if(sql.includes('SELECT * FROM zenithjoy.leadgen_comments'))return {rows:[row]};if(sql.includes('leadgen_videos'))return {rows:[{...video,title:'其他视频'}]};return {rows:[]};},release(){}};
 await assert.rejects(queueRequest({connect:async()=>client},{op:'score',line:'jinuo',run:originalRun,source_run:sourceRun,limit:1},{freezeCompanyConfig:async()=>policy,judgeComment:async()=>{model++;return {grade:'B',relevance:'相关'};}}),/POLICY_VIDEO_SCOPE_INVALID/);
 assert.equal(model,0);
});
test('合格新评分只在双重语义通过后写私有可审模型与政策依据',async()=>{
 const id='00000000-0000-4000-8000-000000000031',row={id,line_key:'jinuo',harvest_batch:sourceRun,comment_body:'人工智能训练师证书怎么报名',source_video:video.title,source_video_url:video.video_url};let writes=[];let selected=0,reviewSeq=0;
 const client={async query(sql,args=[]){if(sql.includes('SELECT * FROM zenithjoy.leadgen_comments'))return {rows:selected++?[]:[row]};if(sql.includes('leadgen_videos'))return {rows:[{...video,judgment_status:'matched'}]};if(sql.includes('UPDATE zenithjoy.leadgen_comments'))writes.push(args);return {rows:[]};},release(){}};
 const result=await queueRequest({connect:async()=>client},{op:'score',line:'jinuo',run:originalRun,source_run:sourceRun,limit:1},{freezeCompanyConfig:async()=>policy,
  judgeComment:async()=>({grade:'A',relevance:'相关',reason:'jev:A',audit:{model:'typesafe/jev-1.13',response_id:'primary-1',confidence:.9}}),
  judgePolicy:async()=>({grade:'A',audit:{model:'google/gemini-2.5-flash',response_id:`final-${++reviewSeq}`,confidence:null,policy_evidence:{audience_id:'recvvcNzUv5rzl',matched_rule:'怎么考',exclusion_rule:null,reason:'明确咨询考证报名'}}})});
 assert.equal(result.scored,1);assert.equal(writes.length,1);const saved=JSON.parse(writes[0][4]);
 assert.equal(saved.model_audit.response_id,'primary-1');assert.equal(saved.policy_audit.response_id,'final-1');
 assert.equal(saved.policy_audit.policy_evidence.matched_rule,'怎么考');assert.equal(saved.policy_audit.id,id);
});
test('四档中的不相关在语义一致时仍可记录，intent_grade保持null',async()=>{
 const row={id:'00000000-0000-4000-8000-000000000032',line_key:'jinuo',harvest_batch:sourceRun,comment_body:'这是什么背景音乐',source_video:video.title,source_video_url:video.video_url};let selected=0,saved,reviewSeq=0;
 const client={async query(sql,args=[]){if(sql.includes('SELECT * FROM zenithjoy.leadgen_comments'))return {rows:selected++?[]:[row]};if(sql.includes('leadgen_videos'))return {rows:[{...video,judgment_status:'matched'}]};if(sql.includes('UPDATE zenithjoy.leadgen_comments'))saved=args;return {rows:[]};},release(){}};
 const result=await queueRequest({connect:async()=>client},{op:'score',line:'jinuo',run:originalRun,source_run:sourceRun,limit:1},{freezeCompanyConfig:async()=>policy,
  judgeComment:async()=>({grade:'不相关',relevance:'不相关',reason:'非业务话题',audit:primaryAudit}),
  judgePolicy:async()=>({grade:'不相关',audit:{model:'fake',response_id:`r${++reviewSeq}`,policy_evidence:{audience_id:'recvvcNzUv5rzl',matched_rule:'怎么考',exclusion_rule:null,reason:'与业务画像无关'}}})});
 assert.equal(result.scored,1);assert.equal(saved[2],null);
});

test('标记人扫描越过政策阻断行，前十条不占limit且第十一条可处理',async()=>{
 const blocked=Array.from({length:10},(_,i)=>({...comments[i%2],id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,source_video:video.title,source_video_url:video.video_url,line_key:'jinuo',harvest_batch:sourceRun,relevance:'相关',intent_grade:'B',judgment_config:{run_id:originalRun,company_id:policy.company_id,tenant_id:policy.tenant_id,version:14,policy_id:policy.policy_id}}));
 const good={...blocked[0],id:'00000000-0000-4000-8000-000000000011',comment_body:'人工智能训练师证书怎么报名',intent_grade:'A'};
 Object.assign(good,{nickname:'测试客户',douyin_id:'test-user',dedup_key:'test-dedup',profile_url:'https://www.douyin.com/user/test-user'});
 let policySeq=0;const judgePolicy=async()=>({grade:'A',audit:{model:'fake',response_id:`review-${++policySeq}`,
  policy_evidence:{audience_id:'recvvcNzUv5rzl',matched_rule:'怎么考',exclusion_rule:null,reason:'政策判断'}}});
 const first=await evaluatePolicy(good,policy,{judgePolicy}),second=await evaluatePolicy(good,policy,{judgePolicy});
 assert.equal(first.status,'pass');assert.equal(second.status,'pass');
 good.judgment_config={...good.judgment_config,policy_audit:first,policy_reviews:[first,second]};
 const calls=[];const rows=[...blocked,good];const client={async query(sql,args=[]){calls.push({sql,args});if(sql.includes('SELECT * FROM zenithjoy.leadgen_comments')){if(sql.includes('AND id=$2'))return {rows:rows.filter(r=>r.id===args[1])};if(sql.includes('id=ANY'))return {rows:rows.filter(r=>args[1].includes(r.id))};const excluded=args.find(Array.isArray)||[];return {rows:rows.filter(r=>!excluded.includes(r.id)).slice(0,1)};}if(sql.includes('company_config_runs'))return {rows:[{snapshot:policy,company_id:policy.company_id,tenant_id:policy.tenant_id,version:14,run_id:originalRun}]};if(sql.includes('leadgen_videos'))return {rows:[{...video,line_key:'jinuo',judgment_status:'matched'}]};if(sql.includes('INSERT INTO zenithjoy.leadgen_leads'))return {rows:[{id:'lead-1'}]};if(sql.includes('SELECT id,line_key,douyin_id FROM zenithjoy.leadgen_leads'))return {rows:[{id:'lead-1',line_key:'jinuo',douyin_id:'test-user'}]};return {rows:[]};},release(){}};
 const pool={async connect(){return client}};
 const result=await queueRequest(pool,{op:'mark_leads',line:'jinuo',run:originalRun,source_run:sourceRun,limit:10},{freezeCompanyConfig:async()=>policy,
  judgePolicy:async()=>{throw Error('mark_leads不得调用第三次政策模型');}});
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

test('103评分失败后inspect保留真实冻结公司，上下文不要求MMV借用手机账号',async t=>{
 const {createHandlers}=await import('../leadgen-handlers.mjs');const {rmSync}=await import('node:fs');
 const dir=mkdtempSync(join(tmpdir(),'score-frozen-inspect-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const h=createHandlers({root:dir,env:{P:'mmv-scoring',SERIAL:'none',WFR_TAG:originalRun,LEADGEN_LINE:'jinuo',LEADGEN_LIMIT:'1',WFR_RUN_DIR:dir,HOME:dir},
  rpc:async({request:r})=>{if(r.op==='company_config')return {result:policy};throw Error('fixture scoring unavailable');}});
 await assert.rejects(h.scoring(),/fixture scoring unavailable/);
 const context=await h.handoffContext();assert.equal(context.company_id,policy.company_id);assert.equal(context.account,null);
 assert.deepEqual(h.state.company_config,policy,'must retain the returned frozen receipt, not infer company from a line label');
});
for(const badSource of ['missing','duplicate','title-mismatch','not-qualified','all-orphan'])test('103孤儿来源明确隔离且同run仅评分后续合格CID：'+badSource,async()=>{
 const bad={id:'cc160b18-9189-4447-9c32-abd71daa8ce0',line_key:'jinuo',harvest_batch:'old102',comment_body:'legacy orphan',source_video:'原历史视频',source_video_url:'https://www.douyin.com/video/7617837149999841201',collected_at:new Date('2026-10-20T00:00:00Z')};
 const good={...bad,id:'00000000-0000-4000-8000-000000000192',comment_body:'人工智能训练师证书怎么报名',source_video:video.title,source_video_url:video.video_url,collected_at:new Date('2026-10-20T00:01:00Z')};
 const updated=[],judged=[];const sources={[bad.id]:bad.harvest_batch,[good.id]:good.harvest_batch};let reviewSeq=0;
 const client={async query(sql,args=[]){
  if(sql.includes('SELECT count(*)::int AS used'))return {rows:[{used:updated.length}]};
  if(sql.includes('SELECT * FROM zenithjoy.leadgen_comments'))return {rows:(badSource==='all-orphan'?[bad]:[bad,good]).filter(r=>!args[2].includes(r.id)&&!updated.includes(r.id)).slice(0,1)};
  if(sql.includes('FROM zenithjoy.leadgen_videos')){
   if(args[1]===good.source_video_url)return {rows:[{...video,judgment_status:'matched'}]};
   const original={title:bad.source_video,judgment_status:'matched'};
   return {rows:['missing','all-orphan'].includes(badSource)?[]:badSource==='duplicate'?[original,original]:[{...original,...(badSource==='title-mismatch'?{title:'别的视频'}:{judgment_status:'pending'})}]};
  }
  if(sql.includes('UPDATE zenithjoy.leadgen_comments'))updated.push(args[0]);return {rows:[]};
 },release(){}};
 const r=await queueRequest({connect:async()=>client},{op:'score',line:'jinuo',run:originalRun,source_run:null,limit:1,budget_max:1,ids:[bad.id,good.id],sources},{freezeCompanyConfig:async()=>policy,
  judgeComment:async body=>{judged.push(body);assert.equal(body,good.comment_body,'orphan must never be sent to a model');return {grade:'A',relevance:'相关',reason:'原政策报名咨询',audit:primaryAudit};},
  judgePolicy:async()=>({grade:'A',audit:{model:'fixture-policy',response_id:`policy-response-${++reviewSeq}`,policy_evidence:{audience_id:'recvvcNzUv5rzl',matched_rule:'怎么报',exclusion_rule:null,reason:'按冻结政策'}}})});
 const expected=badSource==='all-orphan'?[]:[good.id];assert.deepEqual(updated,expected);assert.deepEqual(judged,badSource==='all-orphan'?[]:[good.comment_body]);assert.equal(r.scored,expected.length);assert.deepEqual(r.ids,expected);assert.equal(r.status,'partial');
 assert.deepEqual(r.blocked_ids,[bad.id]);assert.deepEqual(r.blocked_reasons,[{id:bad.id,code:'POLICY_VIDEO_SCOPE_INVALID'}]);assert.equal(bad.relevance,undefined);
});
