import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require = createRequire(import.meta.url);
import {freezeFixture,companyFixture} from './company-config-fixture.mjs';
const queueRequest=(pool,input,deps={})=>require('../leadgen-queue.js').queueRequest(pool,input,{freezeCompanyConfig:freezeFixture,...deps});

test('103独立队列冻结跨批CID来源，提交丢回执后保原范围与总预算',async(t)=>{
 const {createHandlers}=await import('../leadgen-handlers.mjs');const dir=mkdtempSync(join(tmpdir(),'independent-score-'));
 const ids=['00000000-0000-4000-8000-000000000131','00000000-0000-4000-8000-000000000132'];
 const sources=Object.fromEntries(ids.map((id,i)=>[id,`batch${i}`]));let committed=[],lost=true;const requests=[];
 const rpc=async({request:r})=>{requests.push(r);assert.equal(r.source_run,undefined);
  if(r.op==='score_scope')return {result:{line:'jinuo',run:'independent103',source_run:null,ids,sources}};
  assert.deepEqual(r.sources,sources);
  if(r.op==='score_recovery')return {result:{verified:true,ids:committed,scored:committed.length}};
  if(r.op==='score'){assert.deepEqual(r.ids,ids);assert.equal(r.budget_max,2);
   if(lost){lost=false;committed=[ids[0]];throw Error('committed response lost');}
   assert.equal(r.limit,1);committed.push(ids[1]);return {result:{ids:[ids[1]],scored:1,blocked_ids:[]}};}
  if(r.op==='score_readback')return {result:{verified:true,failures:0}};
  if(r.op==='policy_review')return {result:{verified:true,rows:ids.map(id=>({id,status:'pass'}))}};
  throw Error('unexpected '+r.op);};
 const h=createHandlers({root:dir,env:{P:'qa',SERIAL:'fake',LEADGEN_LINE:'jinuo',WFR_TAG:'independent103',LEADGEN_LIMIT:'2',WFR_RUN_DIR:dir,WF_HOME:dir,HOME:dir},rpc});
 await assert.rejects(h.scoring(),/committed response lost/);
 const saved=JSON.parse(readFileSync(join(dir,'independent103-score-attempt.json')));assert.equal(saved.source_run,null);assert.deepEqual(saved.sources,sources);
 const result=await h.scoring();assert.equal(result.scored,2);assert.equal(result.recovered,1);
 assert.equal(requests.filter(r=>r.op==='score').length,2);
 sources[ids[0]]='changed-batch';await assert.rejects(h.scoring(),/POLICY_SCORE_RECOVERY_SCOPE_INVALID/);
 assert.equal(requests.filter(r=>r.op==='score').length,2);
});
test('独立队列scope保逐行批次，恢复时批次漂移拒绝且显式批次不扩大',async()=>{
 const ids=['00000000-0000-4000-8000-000000000141','00000000-0000-4000-8000-000000000142'];
 const rows=ids.map((id,i)=>({id,harvest_batch:`batch${i}`}));const calls=[];
 const pool={async query(sql,args){calls.push({sql,args});return {rows};}};
 const scope=await queueRequest(pool,{op:'score_scope',line:'jinuo',run:'independent103'});
 assert.deepEqual(scope.ids,ids);assert.deepEqual(scope.sources,Object.fromEntries(rows.map(r=>[r.id,r.harvest_batch])));
 assert.match(calls[0].sql,/\$2::text IS NULL OR harvest_batch=\$2/);
 const snapshot=companyFixture();const p={async query(sql){if(sql.includes('company_config_runs'))return {rows:[{run_id:'independent103',company_id:snapshot.company_id,tenant_id:snapshot.tenant_id,version:snapshot.version,snapshot}]};return {rows:[{...rows[0],harvest_batch:'changed',line_key:'jinuo'}, {...rows[1],line_key:'jinuo'}]};}};
 await assert.rejects(queueRequest(p,{op:'score_recovery',line:'jinuo',run:'independent103',ids,sources:scope.sources}),/POLICY_SCORE_RECOVERY_AMBIGUOUS/);
 await assert.rejects(queueRequest(pool,{op:'score_scope',line:'jinuo',run:'independent103',source_run:'batch0'}),/POLICY_SCORE_SCOPE_AMBIGUOUS/);
});

test('跨批冻结范围仍按同run总额锁内读回，来源变更在模型与写入前拒绝',async()=>{
 const id='00000000-0000-4000-8000-000000000151',sources={[id]:'original102'};
 for(const full of [true,false]){
  const calls=[];let model=0;
  const client={async query(sql,args=[]){calls.push({sql,args});
   if(sql.includes('count(*)::int AS used'))return {rows:[{used:full?2:0}]};
   if(sql.includes('SELECT * FROM zenithjoy.leadgen_comments'))return {rows:[{id,harvest_batch:'changed102'}]};
   return {rows:[]};},release(){}};
  const input={op:'score',line:'jinuo',run:'independent103',ids:[id],sources,budget_max:2,limit:2};
  const action=queueRequest({connect:async()=>client},input,{freezeCompanyConfig:async()=>companyFixture(),judgeComment:async()=>{model++;}});
  if(full)assert.equal((await action).scored,0);else await assert.rejects(action,/POLICY_SCORE_ROW_SOURCE_CHANGED/);
  const count=calls.find(x=>x.sql.includes('count(*)::int AS used'));
  assert.deepEqual(count.args,['jinuo',null,'independent103']);assert.match(count.sql,/\$2::text IS NULL OR harvest_batch=\$2/);
  assert.equal(model,0);assert.ok(!calls.some(x=>x.sql.includes('UPDATE zenithjoy.leadgen_comments')));
 }
 for(const bad of [undefined,{}, {[id]:'bad/batch'}])await assert.rejects(queueRequest({}, {op:'score',line:'jinuo',run:'independent103',ids:[id],sources:bad,budget_max:2}),/POLICY_SCORE_IDS_INVALID/);
});

test('评分冻结 CID 范围与提交读回只认本批本 run 的完整证据',async()=>{
 const id1='00000000-0000-4000-8000-000000000101',id2='00000000-0000-4000-8000-000000000102';
 const snapshot=companyFixture();snapshot.runtime_config.routing={line_key:'jinuo'};
 const c={run_id:'score-new',company_id:snapshot.company_id,tenant_id:snapshot.tenant_id,version:snapshot.version,policy_id:snapshot.policy_id,
  model_audit:{model:'typesafe/jev-1.13',response_id:'primary'},policy_audit:{status:'pass',response_id:'review'}};
 const calls=[],pool={async query(sql,args){calls.push({sql,args});
  if(sql.includes('SELECT id,harvest_batch FROM zenithjoy.leadgen_comments'))return {rows:[{id:id1,harvest_batch:'batch-102'},{id:id2,harvest_batch:'batch-102'}]};
  if(sql.includes('company_config_runs'))return {rows:[{run_id:'score-new',company_id:snapshot.company_id,tenant_id:snapshot.tenant_id,version:snapshot.version,snapshot}]};
  if(sql.includes('SELECT id,harvest_batch'))return {rows:[{id:id1,harvest_batch:'batch-102',line_key:'jinuo',relevance:'相关',intent_grade:'A',judgment_config:c},
    {id:id2,harvest_batch:'batch-102',line_key:'jinuo',relevance:null,intent_grade:null,judgment_config:null}]};
  throw Error('unexpected SQL');}};
 const scope={line:'jinuo',run:'score-new',source_run:'batch-102'};
 const frozen=await queueRequest(pool,{...scope,op:'score_scope'});assert.deepEqual(frozen.ids,[id1,id2]);
 const recovered=await queueRequest(pool,{...scope,op:'score_recovery',ids:frozen.ids});assert.deepEqual(recovered.ids,[id1]);assert.equal(recovered.scored,1);
 assert.ok(calls.every(x=>x.args?.includes('batch-102')||x.sql.includes('company_config_runs')));
 await assert.rejects(queueRequest(pool,{...scope,op:'score',cursor:{line:'another',run:'score-new',source_run:'batch-102',collected_at:'2026-10-20T00:00:00.000Z',id:id1}}),/POLICY_SCORE_CURSOR_INVALID/);
});

test('评分提交后丢回执，重启先按原 CID 读回并扣预算再续扫',async()=>{
 const {createHandlers}=await import('../leadgen-handlers.mjs');const dir=mkdtempSync(join(tmpdir(),'leadgen-score-attempt-'));
 const ids=['00000000-0000-4000-8000-000000000111','00000000-0000-4000-8000-000000000112'];
 const requests=[];let lost=true,committed=[];
 const rpc=async body=>{requests.push(body.request);const r=body.request;
  if(r.op==='score_scope')return {result:{line:'jinuo',run:'score103',source_run:'batch102',ids}};
  if(r.op==='score_recovery')return {result:{ids:committed,scored:committed.length,verified:true}};
  if(r.op==='score'){assert.deepEqual(r.ids,ids);if(lost){lost=false;committed=[ids[0]];throw Error('transport reply lost');}
    assert.equal(r.limit,1);committed.push(ids[1]);return {result:{scored:1,ids:[ids[1]],blocked_ids:[],next_cursor:null}};}
  if(r.op==='score_readback')return {result:{verified:true,failures:0,ids:r.ids}};
  if(r.op==='policy_review')return {result:{verified:true,rows:r.ids.map(id=>({id,status:'pass'}))}};
  throw Error('unexpected op');};
 const env={P:'qa',SERIAL:'fake',WFR_TAG:'score103',LEADGEN_LINE:'jinuo',LEADGEN_SOURCE_RUN:'batch102',LEADGEN_LIMIT:'2',WFR_RUN_DIR:dir,WF_HOME:dir,HOME:dir};
 const h=createHandlers({root:dir,env,rpc});await assert.rejects(h.scoring(),/transport reply lost/);
 const saved=JSON.parse(readFileSync(join(dir,'score103-score-attempt.json'),'utf8'));
 assert.deepEqual(saved.ids,ids);assert.equal(saved.budget,2);
 const result=await h.scoring();assert.equal(result.recovered,1);assert.equal(result.scored,2);assert.deepEqual(result.ids,ids);
 assert.equal(requests.filter(r=>r.op==='score').length,2);
});
test('并发同 run 评分在 PG 锁内重读已用额度，满额时不再领行',async()=>{
 const id='00000000-0000-4000-8000-000000000121',calls=[];
 const client={async query(sql,args=[]){calls.push({sql,args});if(sql.includes('count(*)::int AS used'))return {rows:[{used:1}]};return {rows:[]};},release(){}};
 const result=await queueRequest({connect:async()=>client},{op:'score',line:'jinuo',run:'score103',source_run:'batch102',
  limit:1,budget_max:1,ids:[id]},{freezeCompanyConfig:async()=>companyFixture()});
 assert.equal(result.scored,0);assert.ok(calls.some(c=>c.sql.includes('pg_advisory_xact_lock')));
 assert.ok(!calls.some(c=>c.sql.includes('SELECT * FROM zenithjoy.leadgen_comments')));
});
test('执行端非法评分上限在任何 RPC 前拒绝',async()=>{
 const {createHandlers}=await import('../leadgen-handlers.mjs');const dir=mkdtempSync(join(tmpdir(),'leadgen-score-limit-'));let calls=0;
 const h=createHandlers({root:dir,env:{P:'qa',SERIAL:'fake',WFR_TAG:'score103',LEADGEN_LINE:'jinuo',
  LEADGEN_SOURCE_RUN:'batch102',LEADGEN_LIMIT:'not-a-number',WFR_RUN_DIR:dir,WF_HOME:dir,HOME:dir},rpc:async()=>{calls++;return {result:{}};}});
 await assert.rejects(h.scoring(),/POLICY_SCORE_BUDGET_INVALID/);assert.equal(calls,0);
});

function fakePool(responses) {
  const calls = [];
  const client = {
    async query(sql, args) {
      calls.push({ sql, args });
      const placeholders=[...sql.matchAll(/\$(\d+)/g)].map(m=>Number(m[1]));
      assert.equal(args?.length||0,Math.max(0,...placeholders),"PG bind参数数必须与SQL最大placeholder一致");
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [], rowCount: 0 };
      const response = responses.shift();
      if (response instanceof Error) throw response;
      assert.ok(response, `未预期SQL: ${sql}`);
      return response;
    }, release() { calls.push({ sql: 'RELEASE' }); },
  };
  return { calls, query: client.query.bind(client), async connect() { return client; } };
}
// 明示模拟本轮native v2工件；不宣称原始audio为实机采集。
function fakeNativeProof(eid){return {playback_proof_kind:'native_audio',native_audio:Object.fromEntries(['start','end'].map(phase=>[phase,{state:'started',uid:10203,pid:528,piid:73615,package_uid_verified:true,foreign_started:0,...Object.fromEntries([['evidence','audio.txt'],['package_uid','package-uid.txt'],['uid_owners','uid-owners.txt']].flatMap(([k,s])=>[[k+'_file',eid+'-playback-'+phase+'.'+s],[k+'_sha256','a'.repeat(64)]]))}]))};}

test('本轮静音拒绝必须限定真实租约且保留旧转写，PG回执独立读回',async()=>{
 const id='7646309328911907195',proof={version:2,...fakeNativeProof(`audio-run-v${id}-qualification-record`),run:'audio-run',video_id:id,evidence_id:`audio-run-v${id}-qualification-record`,playback_verified:true,playback_package:'com.ss.android.ugc.aweme',playback_state:1,playback_end_state:1,media_volume_verified:true,media_volume:1,audio_status:'silent',mean_volume_db:-91};
 const row={video_id:id,judgment_status:'rejected',judgment_reason:'本轮录音核验拒绝:静音音轨',process_status:'处理中:audio-run'};
 const pool=fakePool([{rows:[row],rowCount:1},{rows:[row],rowCount:1}]);
 const result=await queueRequest(pool,{op:'reject_recording',line:'jinuo',run:'audio-run',video_id:id,recording:proof});
 assert.equal(result.verified,true);assert.equal(result.video_id,id);const update=pool.calls.find(c=>c.sql.startsWith('UPDATE'));assert.match(update.sql,/process_status=\$3/);assert.match(update.sql,/judgment_status='pending'/);assert.ok(!/SET[\s\S]*transcript\s*=/.test(update.sql));assert.ok(pool.calls.some(c=>c.sql.startsWith('SELECT')));
});
test('租约已失效或伪造静音证据不得写rejected',async()=>{
 const id='7646309328911907195',proof={version:2,...fakeNativeProof(`audio-run-v${id}-qualification-record`),run:'audio-run',video_id:id,evidence_id:`audio-run-v${id}-qualification-record`,playback_verified:true,playback_package:'com.ss.android.ugc.aweme',playback_state:1,playback_end_state:1,media_volume_verified:true,media_volume:1,audio_status:'silent',mean_volume_db:-91};
 const pool=fakePool([{rows:[],rowCount:0}]);await assert.rejects(queueRequest(pool,{op:'reject_recording',line:'jinuo',run:'audio-run',video_id:id,recording:proof}),/租约|判定/);assert.ok(pool.calls.some(c=>c.sql==='ROLLBACK'));
 for(const change of [{run:'wrong'},{video_id:'7646309328911907196'},{audio_status:'usable'},{mean_volume_db:-35},{media_volume_verified:false},{playback_verified:false},{native_audio:null},{playback_package:'com.netease.cloudmusic'}]){const p=fakePool([]);await assert.rejects(queueRequest(p,{op:'reject_recording',line:'jinuo',run:'audio-run',video_id:id,recording:{...proof,...change}}),/录音/);assert.equal(p.calls.length,0);}
});

test('视频租约认领同时含待判及合格未采，崩溃可回收，同库竞争跳过锁行', async () => {
  const pool = fakePool([{ rows: [{ video_id: '7646309328911907195' }] }]);
  const result = await queueRequest(pool, { op: 'claim_videos', line: 'jinuo', run: 'test', limit: 2 });
  assert.equal(result.length, 1);
  const claim = pool.calls.find(c => c.sql.startsWith('WITH'));
  assert.match(claim.sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(claim.sql, /15 minutes/);
  assert.match(claim.sql, /待采评论/);
  assert.equal(claim.args[2], '处理中:test');
});

test('评论持久化失败必须回滚，不能先把视频标成已采', async () => {
  const pool = fakePool([{ rows: [{ judgment_status: 'matched' }] }, Error('DB_FAILED')]);
  await assert.rejects(queueRequest(pool, { op: 'collect', line: 'jinuo', run: 'test', video_id: '7646309328911907195',
    comments: [{ nickname: '甲', commentBody: '如何报名' }] }), /DB_FAILED/);
  assert.ok(pool.calls.some(c => c.sql === 'ROLLBACK'));
  assert.ok(!pool.calls.some(c => /SET process_status = '评论已采'/.test(c.sql)));
});

test('评论评分模型失败留在待评分队列，不降成C档', async () => {
  const pool = fakePool([{ rows: [{ id: 'c1', comment_body: '如何报名', source_video: '培训',source_video_url:'https://www.douyin.com/video/7617837149999841201' }] },
    {rows:[{title:'培训',judgment_status:'matched'}]},{rows:[]}]);
  const result=await queueRequest(pool, { op: 'score', line: 'jinuo', run: 'test' }, {
    judgeComment: async () => { throw Error('AUTH_FAILED'); },
  });
  assert.equal(result.status,'partial');assert.deepEqual(result.blocked_reasons,[{id:'c1',code:'POLICY_SCORE_MODEL_UNAVAILABLE'}]);
  assert.ok(pool.calls.some(c => c.sql === 'ROLLBACK'));
  assert.ok(!pool.calls.some(c => /UPDATE zenithjoy.leadgen_comments/.test(c.sql)));
});

test('标记人的更新与评论完成状态原子提交，已有已触达人只增加重复标记', async () => {
  const snapshot=companyFixture();snapshot.runtime_config.comment_scoring.audiences=[{id:'test-audience',fields:{'意向信号':'报名','排除信号':'泛失业','人群描述':'测试画像'}}];
  snapshot.runtime_config.routing={line_key:'jinuo'};
  const cid='11111111-1111-4111-8111-111111111111';
  const row={id:cid,line_key:'jinuo',harvest_batch:'source102',dedup_key:'甲|id|报名',nickname:'甲',douyin_id:'id',comment_body:'如何报名',source_video:'培训',source_video_url:'https://www.douyin.com/video/7617837149999841201',relevance:'相关',intent_grade:'A',judgment_config:{run_id:'test',company_id:snapshot.company_id,tenant_id:snapshot.tenant_id,version:snapshot.version,policy_id:snapshot.policy_id}};
  const pool = fakePool([
    { rows: [] }, { rows: [row] },{rows:[row]},
    {rows:[{snapshot,company_id:snapshot.company_id,tenant_id:snapshot.tenant_id,version:snapshot.version,run_id:'test'}]},
    {rows:[row]},{rows:[{video_url:row.source_video_url,title:row.source_video,line_key:'jinuo',judgment_status:'matched'}]},
    { rows: [{ id: 'l1', dup_hit_count: 2 }] }, { rows: [] }, {rows:[{id:'l1',line_key:'jinuo',douyin_id:'id'}]}, { rows: [] }, {rows:[]},
  ]);
  const result = await queueRequest(pool, { op: 'mark_leads', line: 'jinuo', run: 'test', limit: 1 },{freezeCompanyConfig:async()=>snapshot,
    judgePolicy:async()=>({grade:'A',audit:{model:'fake',response_id:'r1',policy_evidence:{audience_id:'test-audience',matched_rule:'报名',exclusion_rule:null,reason:'咨询报名'}}})});
  assert.deepEqual(result, { marked: 1, created: 0, repeats: 1,blocked:0,ids:[cid],lead_ids:['l1'],recipient_calls:{model_call_count:0,passed:0,excluded:0,unknown:1} });
  const person = pool.calls.find(c => /SET dup_hit_count/.test(c.sql));
  assert.ok(person);
  assert.ok(!/status\s*=|reached_at\s*=|DELETE/.test(person.sql));
  assert.ok(pool.calls.some(c => /SET process_status = '已分拣'/.test(c.sql)));
  assert.ok(pool.calls.some(c => c.sql === 'COMMIT'));
});

test('评分和标记人按实际处理ID独立读回，缺行不得宣称verified',async()=>{
  const payload={line_key:'jinuo',comment_id:'c1',lead_id:'l1'};const sha=require('../leadgen-outreach-bridge.js').digest(payload);
  const pool=fakePool([{rows:[{id:'c1',relevance:'相关',intent_grade:'A',process_status:'已分拣'}]},{rows:[]},{rows:[{line_key:'jinuo',comment_id:'c1',lead_id:'l1',payload,payload_sha256:sha}]}]);
  const result=await queueRequest(pool,{op:'mark_readback',line:'jinuo',run:'test',ids:['c1'],lead_ids:['l1']});
  assert.equal(result.verified,false);assert.equal(result.failures,1);
  assert.match(pool.calls[0].sql,/line_key=\$1 AND id=ANY/);
});

test('验收批次可指定上游run，非法批次在任何数据库动作前拒绝',async()=>{
 const pool=fakePool([]);await assert.rejects(queueRequest(pool,{op:'claim_videos',line:'jinuo',run:'processing',source_run:'bad/run'}),/上游运行号/);assert.equal(pool.calls.length,0);
 const valid=fakePool([{rows:[]}]);await queueRequest(valid,{op:'claim_videos',line:'jinuo',run:'processing',source_run:'discovery-test'});
 const claim=valid.calls.find(c=>c.sql.startsWith('WITH'));assert.equal(claim.args[4],'discovery-test');assert.match(claim.sql,/harvest_batch=\$5/);
 for(const op of ['score','mark_leads']){const p=fakePool(op==='score'?[{rows:[]}]:[{rows:[]},{rows:[]}]);await queueRequest(p,{op,line:'jinuo',run:'scoring',source_run:'processing-test'});
 const selected=p.calls.find(c=>c.sql.includes('SELECT * FROM zenithjoy.leadgen_comments'));assert.equal(selected.args[1],'processing-test');assert.match(selected.sql,/harvest_batch=\$2/);}
});

test('102按101本批明确VID认领，已采旧批次不会被错误搬到新批，不能依赖旧harvest_batch判空',async()=>{
 const vid='7685662999797258417',p=fakePool([{rows:[{video_id:vid,judgment_status:'pending',process_status:'待判定'}]}]);
 const rows=await queueRequest(p,{op:'inspect_videos',line:'jinuo',run:'new102',source_run:'new101',video_ids:[vid]});assert.equal(rows.length,1);assert.ok(p.calls[0].args.some(a=>Array.isArray(a)&&a[0]===vid));
 const c=fakePool([{rows:[{video_id:vid}]}]);await queueRequest(c,{op:'claim_videos',line:'jinuo',run:'new102',source_run:'new101',video_ids:[vid]});const claim=c.calls.find(x=>x.sql.startsWith('WITH'));assert.match(claim.sql,/video_id=ANY/);assert.ok(claim.args.some(a=>Array.isArray(a)&&a[0]===vid));assert.ok(!claim.sql.includes("process_status='评论已采'"));
});
test('显式VID清单非法或空清单不得降级成全库认领',async()=>{const bad=fakePool([]);await assert.rejects(queueRequest(bad,{op:'claim_videos',line:'jinuo',run:'new102',video_ids:['wrong']}),/视频ID/);assert.equal(bad.calls.length,0);const empty=fakePool([{rows:[]}]);await queueRequest(empty,{op:'claim_videos',line:'jinuo',run:'new102',video_ids:[]});assert.ok(empty.calls.some(x=>x.args?.some(a=>Array.isArray(a)&&a.length===0)));});

test('显式null视频清单不能变成全库认领',async()=>{const pool=fakePool([]);await assert.rejects(queueRequest(pool,{op:'claim_videos',line:'jinuo',run:'new102',video_ids:null}),/视频ID/);assert.equal(pool.calls.length,0);});

test('发现恢复只按业务线、实际ID、完整本次URL读回，不把不同链接当成功',async()=>{
 const input={op:'discover_readback',line:'jinuo',run:'receipt-test',video:{videoId:'7617105883093603314',videoUrl:'https://v.douyin.com/yjrYaiSbMcg/'}};
 const p=fakePool([{rows:[{judgment_status:'matched',has_transcript:true}]}]);
 assert.deepEqual(await queueRequest(p,input),{status:'matched',has_transcript:true,inserted:false,recovered:true});
 assert.match(p.calls[0].sql,/line_key=\$1 AND video_id=\$2 AND video_url=\$3/);assert.deepEqual(p.calls[0].args,['jinuo',input.video.videoId,input.video.videoUrl]);
 assert.equal(await queueRequest(fakePool([{rows:[]}]),input),null);
 const bad=fakePool([]);await assert.rejects(queueRequest(bad,{...input,video:{videoId:'wrong',videoUrl:input.video.videoUrl}}));assert.equal(bad.calls.length,0);
});

// 执行生产CTE中的选择SQL，只有PG方言（数组、过期时钟、锁）做显式SQLite适配；排序原样执行。
test('真实领取选择SQL优先新pending而非老matched，仍限定显式VID与limit',async()=>{
 const ids=['7646309328911907191','7646309328911907192','7646309328911907193'];
 const rows=[
  {id:'old',video_id:ids[0],judgment_status:'matched',discovered_at:'2026-10-01'},
  {id:'new1',video_id:ids[1],judgment_status:'pending',discovered_at:'2026-10-02'},
  {id:'new2',video_id:ids[2],judgment_status:'pending',discovered_at:'2026-10-03'},
  {id:'foreign',video_id:'7646309328911907194',judgment_status:'pending',discovered_at:'2026-09-01'},
 ].map(r=>({...r,line_key:'jinuo',process_status:'待判定',harvest_batch:'old102',updated_at:'2099-01-01'}));
 const calls=[];const client={release(){},async query(sql,args){calls.push({sql,args});
  if(/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql))return {rows:[]};
  assert.match(sql,/FOR UPDATE SKIP LOCKED/);assert.match(sql,/15 minutes/);
  let selected=sql.match(/WITH pending AS \(\s*([\s\S]*?) FOR UPDATE SKIP LOCKED\)/)?.[1];assert.ok(selected);
  selected=selected.replace(/\$6::text\[\]/g,'$6').replace(/\$5::text/g,'$5')
    .replace('video_id=ANY($6)','video_id IN (SELECT value FROM json_each($6))')
    .replace("now()-interval '15 minutes'","datetime('now','-15 minutes')");
  const result=spawnSync('python3',['-c',`import json,sqlite3,sys
p=json.load(sys.stdin);c=sqlite3.connect(':memory:')
c.execute('CREATE TABLE leadgen_videos (id,video_id,line_key,judgment_status,process_status,harvest_batch,discovered_at,updated_at)')
for r in p['rows']: c.execute('INSERT INTO leadgen_videos VALUES (?,?,?,?,?,?,?,?)',[r[k] for k in ['id','video_id','line_key','judgment_status','process_status','harvest_batch','discovered_at','updated_at']])
print(json.dumps([r[0] for r in c.execute(p['sql'].replace('zenithjoy.leadgen_videos','leadgen_videos'),{str(i+1):(json.dumps(a) if isinstance(a,list) else a) for i,a in enumerate(p['args'])})]))`],{input:JSON.stringify({sql:selected,args,rows}),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);return {rows:JSON.parse(result.stdout).map(id=>rows.find(r=>r.id===id))};
 }};
 const result=await queueRequest({connect:async()=>client},{op:'claim_videos',line:'jinuo',run:'priority102',source_run:'old101',video_ids:ids,limit:2});
 assert.deepEqual(result.map(r=>r.id),['new1','new2']);
 const claim=calls.find(c=>c.sql.startsWith('WITH'));assert.equal(claim.args[1],2);assert.deepEqual(claim.args[5],ids);
 assert.equal(claim.args[2],'处理中:priority102');assert.equal(claim.args[3],'priority102');assert.ok(calls.some(c=>c.sql==='COMMIT'));
});


test('历史评论只读入口严格核本run租约、VID和唯一完整URL，返回完整正文且不改旧batch',async()=>{
 const v='7646309328911907195',u='https://www.douyin.com/video/'+v,id='11111111-1111-4111-8111-111111111111';
 const p=fakePool([{rows:[{video_id:v,video_url:u,url_bindings:1}]},{rows:[{id,douyin_id:'person123',comment_body:'完整咨询正文'}]}]);
 const r=await queueRequest(p,{op:'comment_history',line:'jinuo',run:'new102',source_run:'source101',video_id:v,video_url:u});
 assert.equal(r.status,'verified');assert.equal(r.video_id,v);assert.equal(r.source_run,'source101');assert.deepEqual(r.rows,[{id,douyin_id:'person123',comment_body:'完整咨询正文'}]);
 assert.ok(p.calls.every(c=>c.sql.startsWith('SELECT')));assert.match(p.calls[0].sql,/process_status=\$3/);assert.ok(p.calls[0].args.includes('处理中:new102'));
 assert.match(p.calls[1].sql,/source_video_url=\$2/);assert.deepEqual(p.calls[1].args,['jinuo',u]);
 const ambiguous=await queueRequest(fakePool([{rows:[{video_id:v,video_url:u,url_bindings:2}]}]),{op:'comment_history',line:'jinuo',run:'new102',source_run:'source101',video_id:v,video_url:u});assert.equal(ambiguous.status,'unknown');assert.deepEqual(ambiguous.rows,[]);
 await assert.rejects(queueRequest(fakePool([{rows:[]}]),{op:'comment_history',line:'jinuo',run:'new102',source_run:'source101',video_id:v,video_url:u}));
});


test('历史消费事务和独立PG读回逐字重验，不搬旧batch，不将已采数冲0',async()=>{
 const v='7646309328911907195',u='https://www.douyin.com/video/'+v,id='11111111-1111-4111-8111-111111111111',old={id,douyinId:'person123',commentBody:'完整正文'};
 const owned={video_id:v,video_url:u,judgment_status:'matched',url_bindings:1},row={id,douyin_id:'person123',comment_body:'完整正文',source_video_url:u};
 const p=fakePool([{rows:[owned]},{rows:[row]},{rows:[{id:'video'}]}]);
 const r=await queueRequest(p,{op:'collect',line:'jinuo',run:'run102',source_run:'source101',video_id:v,video_url:u,comments:[],history:[old]});
 assert.equal(r.comments,0);assert.equal(r.inserted,0);assert.equal(r.history_verified,1);assert.equal(r.coverage,1);
 assert.ok(!p.calls.some(c=>/UPDATE zenithjoy.leadgen_comments|INSERT INTO zenithjoy.leadgen_comments/.test(c.sql)));
 const marked=p.calls.find(c=>/SET process_status = '评论已采'/.test(c.sql));assert.match(marked.sql,/comment_count = \$3/);assert.equal(marked.args[2],1);assert.doesNotMatch(marked.sql,/GREATEST/);
 for(const actual of [[],[{...row,douyin_id:'person1234'}],[{...row,comment_body:'完整正文不同'}]]){
  const bad=fakePool([{rows:[owned]},{rows:actual}]);await assert.rejects(queueRequest(bad,{op:'collect_partial',line:'jinuo',run:'run102',source_run:'source101',video_id:v,video_url:u,comments:[],history:[old]}));
  assert.ok(bad.calls.some(c=>c.sql==='ROLLBACK'));assert.ok(!bad.calls.some(c=>c.sql.startsWith('UPDATE')));
 }
 const b=fakePool([{rows:[owned]},{rows:[row]},{rows:[row]}]);assert.deepEqual(await queueRequest(b,{op:'comment_history_readback',line:'jinuo',run:'run102',source_run:'source101',video_id:v,video_url:u,history:[old]}),{verified:true,video_id:v,ids:[id],history_verified:1});
 await assert.rejects(queueRequest(fakePool([{rows:[owned]},{rows:[]},{rows:[]}]),{op:'comment_history_readback',line:'jinuo',run:'run102',source_run:'source101',video_id:v,video_url:u,history:[old]}));
});

test('两不同短链经只读受信resolver核同VID才纳入历史，异VID和未知不skip',async()=>{
 const v='7646309328911907195',current='https://v.douyin.com/current/',old='https://v.douyin.com/old/',other='https://v.douyin.com/other/',unknown='https://v.douyin.com/unknown/';
 const row={id:'11111111-1111-4111-8111-111111111111',douyin_id:'person123',comment_body:'完整正文',source_video_url:old};
 const p=fakePool([{rows:[{video_id:v,video_url:current,url_bindings:1,title:'同一真实标题'}]},{rows:[]},{rows:[row,{...row,id:'22222222-2222-4222-8222-222222222222',source_video_url:other},{...row,id:'33333333-3333-4333-8333-333333333333',source_video_url:unknown}]}]);
 const resolved=[];
 const r=await queueRequest(p,{op:'comment_history',line:'jinuo',run:'new102',source_run:'source101',video_id:v,video_url:current},{resolveHistoryUrl:async url=>{resolved.push(url);if(url===unknown)throw Error('NETWORK');return {content_id:url===old?v:'7000000000000000001',content_type:'video',resolved_url:'https://www.douyin.com/video/'+(url===old?v:'7000000000000000001')};}});
 assert.equal(r.status,'verified');assert.deepEqual(r.rows,[row]);assert.deepEqual(resolved,[old,other,unknown]);assert.deepEqual(r.url_proofs,[{source_video_url:old,video_id:v,resolved_url:'https://www.douyin.com/video/'+v}]);
 assert.match(p.calls[2].sql,/source_video=\$2/);assert.match(p.calls[2].sql,/LIMIT 1001/);assert.deepEqual(p.calls[2].args,['jinuo','同一真实标题']);
});

test('旧短链历史消费和独立读回重新解析实际VID，错VID回滚不改旧评论',async()=>{
 const v='7646309328911907195',current='https://v.douyin.com/current/',url='https://v.douyin.com/old/',id='11111111-1111-4111-8111-111111111111';
 const owned={video_id:v,video_url:current,judgment_status:'matched',url_bindings:1},row={id,douyin_id:'person123',comment_body:'完整正文',source_video_url:url},old={id,douyinId:row.douyin_id,commentBody:row.comment_body,sourceVideoUrl:url};
 const input={op:'collect',line:'jinuo',run:'new102',source_run:'source101',video_id:v,video_url:current,comments:[],history:[old]};
 let calls=0;const deps={resolveHistoryUrl:async actual=>{calls++;assert.equal(actual,url);return {content_id:v,content_type:'video',resolved_url:'https://www.douyin.com/video/'+v};}};
 const p=fakePool([{rows:[owned]},{rows:[row]},{rows:[{id:'video'}]}]);
 assert.equal((await queueRequest(p,input,deps)).coverage,1);assert.equal(calls,1);assert.ok(p.calls.some(c=>c.sql==='COMMIT'));
 const b=fakePool([{rows:[owned]},{rows:[]},{rows:[row]}]);assert.equal((await queueRequest(b,{...input,op:'comment_history_readback'},deps)).verified,true);assert.equal(calls,2);
 for(const bad of [{content_id:'7000000000000000001',content_type:'video',resolved_url:'https://www.douyin.com/video/7000000000000000001'},null]){
  const q=fakePool([{rows:[owned]},{rows:[row]}]);await assert.rejects(queueRequest(q,input,{resolveHistoryUrl:async()=>{if(!bad)throw Error('NETWORK');return bad;}}));
  assert.ok(q.calls.some(c=>c.sql==='ROLLBACK'));assert.ok(!q.calls.some(c=>/^(UPDATE|INSERT)/.test(c.sql)));
 }
});

test('标题候选只做有界只读筛选，超过4短链或1000行均unknown不发网络请求',async()=>{
 const v='7646309328911907195',url='https://v.douyin.com/current/';
 for(const rows of [Array.from({length:5},(_,i)=>({source_video_url:'https://v.douyin.com/old'+i+'/'})),Array.from({length:1001},()=>({source_video_url:'https://v.douyin.com/old/'}))]){
  let network=0;const p=fakePool([{rows:[{video_id:v,video_url:url,url_bindings:1,title:'title'}]},{rows:[]},{rows}]);
  const r=await queueRequest(p,{op:'comment_history',line:'jinuo',run:'new102',source_run:'source101',video_id:v,video_url:url},{resolveHistoryUrl:async()=>{network++;}});
  assert.equal(r.status,'unknown');assert.deepEqual(r.rows,[]);assert.equal(network,0);assert.ok(p.calls.every(c=>c.sql.startsWith('SELECT')));
 }
});

test('采样独立PG读回严格完整正文URL及真实VID，仅SELECT不抢租约',async()=>{
 const vid='7646309328911907195',url='https://www.douyin.com/video/'+vid,row={id:'11111111-1111-4111-8111-111111111111',douyin_id:'person123',comment_body:'完整正文',source_video_url:url};
 const q={op:'sample_readback',line:'jinuo',run:'next102',source_run:'source101',video_id:vid,video_url:url,rows:[{id:row.id,douyinId:row.douyin_id,commentBody:row.comment_body,sourceVideoUrl:url}]};
 for(const bad of [false,'body','id','missing','duplicate','video']){
  const video={video_id:vid,video_url:url,judgment_status:bad==='video'?'pending':'matched'};
  const rows=bad==='missing'?[]:bad==='duplicate'?[row,row]:[{...row,...(bad==='body'?{comment_body:'同前20字另一正文'}:{}),...(bad==='id'?{id:'other'}:{})}];const p=fakePool([{rows:[video]},{rows}]);
  if(bad)await assert.rejects(queueRequest(p,q));else {const r=await queueRequest(p,q);assert.equal(r.coverage,1);assert.deepEqual(r.rows,q.rows);}
  assert.ok(p.calls.every(c=>c.sql.startsWith('SELECT')));
 }
 const p=fakePool([]);await assert.rejects(queueRequest(p,{...q,source_run:null}));assert.equal(p.calls.length,0);
});

test('采样5允许已受信4个历史URL加当前URL，旧别名超过4仍拒绝',async()=>{
 const vid='7646309328911907195',url='https://www.douyin.com/video/'+vid;
 const wanted=Array.from({length:5},(_,i)=>({id:'id'+i,douyinId:'p'+i,commentBody:'全文'+i,sourceVideoUrl:i===4?url:'https://v.douyin.com/old'+i+'/'}));
 const actual=wanted.map(r=>({id:r.id,douyin_id:r.douyinId,comment_body:r.commentBody,source_video_url:r.sourceVideoUrl}));
 const p=fakePool([{rows:[{video_id:vid,video_url:url,judgment_status:'matched'}]},{rows:actual}]);let network=0;
 const deps={resolveHistoryUrl:async()=>{network++;return {content_type:'video',content_id:vid,resolved_url:url};}};
 const q={op:'sample_readback',line:'jinuo',run:'run102',source_run:'source101',video_id:vid,video_url:url,rows:wanted};
 const r=await queueRequest(p,q,deps);assert.equal(r.coverage,5);assert.equal(network,4);
 const b=fakePool([{rows:[{video_id:vid,video_url:url,judgment_status:'matched'}]}]);await assert.rejects(queueRequest(b,{...q,rows:wanted.map((r,i)=>({...r,sourceVideoUrl:'https://v.douyin.com/old'+i+'/'}))},deps));assert.equal(network,4);
});

test('采样真实领取SQL先matched仍严格source manifest/line/limit',async()=>{
 const ids=['7646309328911907191','7646309328911907192','7646309328911907193'];
 const rows=[
  {id:'old',video_id:ids[0],judgment_status:'matched',discovered_at:'2026-10-01'},
  {id:'new1',video_id:ids[1],judgment_status:'pending',discovered_at:'2026-10-02'},
  {id:'new2',video_id:ids[2],judgment_status:'pending',discovered_at:'2026-10-03'},
  {id:'foreign',video_id:'7646309328911907194',judgment_status:'pending',discovered_at:'2026-09-01'},
 ].map(r=>({...r,line_key:'jinuo',process_status:'待判定',harvest_batch:'old102',updated_at:'2099-01-01'}));
 const calls=[];const client={release(){},async query(sql,args){calls.push({sql,args});
  if(/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql))return {rows:[]};
  assert.match(sql,/FOR UPDATE SKIP LOCKED/);assert.match(sql,/15 minutes/);
  let selected=sql.match(/WITH pending AS \(\s*([\s\S]*?) FOR UPDATE SKIP LOCKED\)/)?.[1];assert.ok(selected);
  selected=selected.replace(/\$6::text\[\]/g,'$6').replace(/\$5::text/g,'$5')
    .replace('video_id=ANY($6)','video_id IN (SELECT value FROM json_each($6))')
    .replace("now()-interval '15 minutes'","datetime('now','-15 minutes')");
  const result=spawnSync('python3',['-c',`import json,sqlite3,sys
p=json.load(sys.stdin);c=sqlite3.connect(':memory:')
c.execute('CREATE TABLE leadgen_videos (id,video_id,line_key,judgment_status,process_status,harvest_batch,discovered_at,updated_at)')
for r in p['rows']: c.execute('INSERT INTO leadgen_videos VALUES (?,?,?,?,?,?,?,?)',[r[k] for k in ['id','video_id','line_key','judgment_status','process_status','harvest_batch','discovered_at','updated_at']])
print(json.dumps([r[0] for r in c.execute(p['sql'].replace('zenithjoy.leadgen_videos','leadgen_videos'),{str(i+1):(json.dumps(a) if isinstance(a,list) else a) for i,a in enumerate(p['args'])})]))`],{input:JSON.stringify({sql:selected,args,rows}),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);return {rows:JSON.parse(result.stdout).map(id=>rows.find(r=>r.id===id))};
 }};
 const result=await queueRequest({connect:async()=>client},{op:'claim_videos',line:'jinuo',run:'priority102',source_run:'old101',video_ids:ids,limit:2,prefer_matched:true});
 assert.deepEqual(result.map(r=>r.id),['old','new1']);
 const claim=calls.find(c=>c.sql.startsWith('WITH'));assert.equal(claim.args[1],2);assert.deepEqual(claim.args[5],ids);
 assert.equal(claim.args[2],'处理中:priority102');assert.equal(claim.args[3],'priority102');assert.ok(calls.some(c=>c.sql==='COMMIT'));
});

test('采样领取优先flag必须真boolean且有明确source与VID清单，非法beforeSQL拒绝',async()=>{
 for(const q of [{prefer_matched:'true',source_run:'s',video_ids:[]},{prefer_matched:1,source_run:'s',video_ids:[]},{prefer_matched:true,video_ids:[]},{prefer_matched:true,source_run:'s'},{prefer_matched:true,source_run:'s',video_ids:null}]){const p=fakePool([]);await assert.rejects(queueRequest(p,{op:'claim_videos',line:'jinuo',run:'sample-run',...q}));assert.equal(p.calls.length,0);}
 const p=fakePool([{rows:[]}]);await queueRequest(p,{op:'claim_videos',line:'jinuo',run:'sample-run',source_run:'s',video_ids:[],prefer_matched:true});assert.deepEqual(p.calls.find(c=>c.sql.startsWith('WITH')).args[5],[]);
 const legacy=fakePool([{rows:[]}]);await queueRequest(legacy,{op:'claim_videos',line:'jinuo',run:'legacy',prefer_matched:false});assert.match(legacy.calls.find(c=>c.sql.startsWith('WITH')).sql,/judgment_status='pending' THEN 0/);
});

test('静音拒绝RPC在任何SQL前拒绝旧版或缺native证明',async()=>{
 const id='7646309328911907195',proof={version:1,run:'audio-run',video_id:id,evidence_id:`audio-run-v${id}-qualification-record`,media_volume_verified:true,media_volume:1,audio_status:'silent',mean_volume_db:-91};
 for(const change of [{},{playback_verified:true,playback_package:'com.netease.cloudmusic',playback_state:3},{playback_verified:true,playback_package:'com.ss.android.ugc.aweme',playback_state:2}]){
  const calls=[],pool={async connect(){calls.push('connect');throw Error('SQL_BYPASS');},async query(){calls.push('query');throw Error('SQL_BYPASS');}};
  await assert.rejects(queueRequest(pool,{op:'reject_recording',line:'jinuo',run:'audio-run',video_id:id,recording:{...proof,...change}}),/播放|录音/);assert.deepEqual(calls,[]);
 }
});

test('RPC只接本轮v2 native真证据，v1/foreign/unknown/错raw/hash在SQL前拒绝',async()=>{
 const id='7646309328911907195',eid=`audio-run-v${id}-qualification-record`,base={version:2,...fakeNativeProof(eid),run:'audio-run',video_id:id,evidence_id:eid,playback_verified:true,playback_package:'com.ss.android.ugc.aweme',playback_state:1,playback_end_state:1,media_volume_verified:true,media_volume:1,audio_status:'silent',mean_volume_db:-91};
 const mutations=[p=>p.version=1,p=>p.native_audio.start.foreign_started=1,p=>p.native_audio.end.state='unknown',p=>p.native_audio.start.evidence_file='other-run.audio.txt',p=>p.native_audio.end.evidence_sha256='bad',p=>p.native_audio.end.uid=10444,p=>p.native_audio.start.package_uid_verified=false];
 for(const mutate of mutations){const p=structuredClone(base);mutate(p);const pool=fakePool([]);await assert.rejects(queueRequest(pool,{op:'reject_recording',line:'jinuo',run:'audio-run',video_id:id,recording:p}),/录音|native/);assert.equal(pool.calls.length,0);}
});

// r102真实失败形态：新native证据属于当前VID，旧PG同人同全文保留另一短链。
test('采样复用旧评论按真实PG身份读回，当前及历史别名必须受信同VID且不更新旧行',async()=>{
 const vid='7646309328911907195',current='https://v.douyin.com/current/',old='https://v.douyin.com/old/';
 const actual={id:'old-id',douyin_id:'native123',comment_body:'完整原评论',source_video_url:old,harvest_batch:'old102',intent_grade:'A',recipient_evidence:null};
 const before=structuredClone(actual),resolved=[];
 const p=fakePool([{rows:[{video_id:vid,video_url:current,judgment_status:'matched'}]},{rows:[actual]}]);
 const input={op:'sample_readback',line:'jinuo',run:'new102',source_run:'source101',video_id:vid,video_url:current,rows:[{douyinId:actual.douyin_id,commentBody:actual.comment_body,sourceVideoUrl:current}]};
 const result=await queueRequest(p,input,{resolveHistoryUrl:async u=>{resolved.push(u);return {content_type:'video',content_id:vid,resolved_url:'https://www.douyin.com/video/'+vid};}});
 assert.equal(result.verified,true);assert.deepEqual(result.rows,[{id:actual.id,douyinId:actual.douyin_id,commentBody:actual.comment_body,sourceVideoUrl:old}]);
 assert.deepEqual(new Set(resolved),new Set([current,old]));assert.deepEqual(actual,before);
 assert.ok(p.calls.every(c=>c.sql.startsWith('SELECT')));const query=p.calls[1];assert.match(query.sql,/line_key=\$1/);assert.match(query.sql,/comment_body/);assert.doesNotMatch(query.sql,/source_video_url=ANY/);assert.ok(query.args.some(x=>Array.isArray(x)&&x.includes(actual.comment_body)));
});
test('采样历史别名跨VID或解析未知须安全阶段码拒绝，不能仅凭同UID全文计覆盖',async()=>{
 const vid='7646309328911907195',url='https://www.douyin.com/video/'+vid,old='https://v.douyin.com/old/';
 const actual={id:'old',douyin_id:'p1',comment_body:'私密完整正文',source_video_url:old};
 const input={op:'sample_readback',line:'jinuo',run:'new102',source_run:'source101',video_id:vid,video_url:url,rows:[{douyinId:'p1',commentBody:actual.comment_body,sourceVideoUrl:url}]};
 for(const mode of ['foreign','unknown']){
  const p=fakePool([{rows:[{video_id:vid,video_url:url,judgment_status:'matched'}]},{rows:[actual]}]);
  await assert.rejects(queueRequest(p,input,{resolveHistoryUrl:async()=>{if(mode==='unknown')throw Error('secret-token:'+actual.comment_body);return {content_type:'video',content_id:'7000000000000000001',resolved_url:'https://www.douyin.com/video/7000000000000000001'};}}),e=>e.message==='RPC_SAMPLE_URL_IDENTITY_INVALID');
  assert.ok(p.calls.every(c=>c.sql.startsWith('SELECT')));
 }
});
test('采样精确身份多行歧义不得挑一条同VID行，候选超界先拒绝不发解析',async()=>{
 const vid='7646309328911907195',url='https://www.douyin.com/video/'+vid,row={id:'one',douyin_id:'p1',comment_body:'完整正文',source_video_url:url};
 const q={op:'sample_readback',line:'jinuo',run:'new102',source_run:'source101',video_id:vid,video_url:url,rows:[{douyinId:row.douyin_id,commentBody:row.comment_body,sourceVideoUrl:url}]};
 for(const rows of [[row,{...row,id:'two',source_video_url:'https://v.douyin.com/foreign/'}],Array.from({length:1001},()=>row)]){
  let network=0;const p=fakePool([{rows:[{video_id:vid,video_url:url,judgment_status:'matched'}]},{rows}]);
  await assert.rejects(queueRequest(p,q,{resolveHistoryUrl:async()=>{network++;}}),e=>/^RPC_SAMPLE_(IDENTITY_NOT_UNIQUE|CANDIDATES_EXCEEDED)$/.test(e.message));assert.equal(network,0);
 }
});
test('采样actual新增历史别名超界拒绝，显式PG ID仍不可错配',async()=>{
 const vid='7646309328911907195',url='https://www.douyin.com/video/'+vid;
 const wanted=Array.from({length:5},(_,i)=>({id:'id'+i,douyinId:'p'+i,commentBody:'全文'+i,sourceVideoUrl:url}));const actual=wanted.map((r,i)=>({id:r.id,douyin_id:r.douyinId,comment_body:r.commentBody,source_video_url:'https://v.douyin.com/old'+i+'/'}));
 for(const mode of ['urls','id']){
  let network=0;const p=fakePool([{rows:[{video_id:vid,video_url:url,judgment_status:'matched'}]},{rows:actual}]);
  const rows=mode==='id'?[{...wanted[0],id:'wrong'}]:wanted;
  await assert.rejects(queueRequest(p,{op:'sample_readback',line:'jinuo',run:'new102',source_run:'source101',video_id:vid,video_url:url,rows},{resolveHistoryUrl:async()=>{network++;}}),e=>e.message===(mode==='id'?'RPC_SAMPLE_IDENTITY_NOT_UNIQUE':'RPC_SAMPLE_URLS_EXCEEDED'));assert.equal(network,0);
 }
});

test('采样实际PG已canonical时本轮短链仍须受信同VID，禁止只验证旧来源',async()=>{
 const vid='7646309328911907195',url='https://v.douyin.com/current/',canonical='https://www.douyin.com/video/'+vid;
 const p=fakePool([{rows:[{video_id:vid,video_url:url,judgment_status:'matched'}]},{rows:[{id:'old',douyin_id:'p1',comment_body:'全文',source_video_url:canonical}]}]);
 await assert.rejects(queueRequest(p,{op:'sample_readback',line:'jinuo',run:'new102',source_run:'source101',video_id:vid,video_url:url,rows:[{douyinId:'p1',commentBody:'全文',sourceVideoUrl:url}]},{resolveHistoryUrl:async()=>({content_type:'video',content_id:'7000000000000000001',resolved_url:'https://www.douyin.com/video/7000000000000000001'})}),e=>e.message==='RPC_SAMPLE_URL_IDENTITY_INVALID');
});
test('真实RPC队列调用保留采样阶段安全码，原CLI序列化不会降为泛化错误或泄漏正文',async()=>{
 const {handleRpc}=await import('../leadgen-rpc.mjs');
 const {readFileSync}=await import('node:fs');
 const vid='7646309328911907195',url='https://www.douyin.com/video/'+vid;
 const privateBody='不应进入RPC错误的私人正文';
 const p=fakePool([{rows:[{video_id:vid,video_url:url,judgment_status:'matched'}]},{rows:[]}]);
 let failure;
 try{await handleRpc({kind:'queue',source:{},request:{op:'sample_readback',line:'jinuo',run:'new102',source_run:'source101',video_id:vid,video_url:url,rows:[{douyinId:'private-user',commentBody:privateBody,sourceVideoUrl:url}]}},{verify:()=>{},pool:p});}catch(error){failure=error;}
 assert.equal(failure?.message,'RPC_SAMPLE_IDENTITY_NOT_UNIQUE');
 // 执行原CLI catch正文（不是复制其regex），验证新码确实穿过现有序列化。
 const source=readFileSync(new URL('../leadgen-rpc.mjs',import.meta.url),'utf8');
 const emission=source.match(/catch \(error\) \{\n([\s\S]*?)\n  \}\n\}\s*$/)?.[1];assert.ok(emission);
 const child=spawnSync(process.execPath,['-e',`const error=new Error(${JSON.stringify(failure.message)});${emission}`],{encoding:'utf8'});
 assert.equal(child.status,1);assert.deepEqual(JSON.parse(child.stdout),{ok:false,error:'RPC_SAMPLE_IDENTITY_NOT_UNIQUE'});assert.equal(child.stderr,'');assert.ok(!child.stdout.includes(privateBody));assert.ok(!child.stdout.includes('private-user'));
});

test('unknown execution video quarantine CAS binds line/run/VID and reads back persistent status',async()=>{
 const id='7646309328911907195',status='待人工核验:fixture';
 const p=fakePool([{rows:[{video_id:id}],rowCount:1},{rows:[{video_id:id,process_status:status}]}]);
 const r=await queueRequest(p,{op:'quarantine_video',line:'jinuo',run:'fixture',video_id:id});assert.equal(r.quarantined,true);assert.equal(r.process_status,status);
 const update=p.calls.find(c=>c.sql.startsWith('UPDATE'));assert.deepEqual(update.args,['jinuo',id,'处理中:fixture',status]);assert.match(update.sql,/process_status=\$3/);
 for(const responses of [[{rows:[],rowCount:0}],[{rows:[{video_id:id}],rowCount:1},{rows:[{video_id:id,process_status:'处理中:other'}]}]])await assert.rejects(queueRequest(fakePool(responses),{op:'quarantine_video',line:'jinuo',run:'fixture',video_id:id}));
 const bad=fakePool([]);await assert.rejects(queueRequest(bad,{op:'quarantine_video',line:'jinuo',run:'fixture',video_id:'wrong'}));assert.equal(bad.calls.length,0);
});
