import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
import {freezeFixture} from './company-config-fixture.mjs';
const queueRequest=(pool,input,deps={})=>require('../leadgen-queue.js').queueRequest(pool,input,{freezeCompanyConfig:freezeFixture,...deps});

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
  const pool = fakePool([{ rows: [{ id: 'c1', comment_body: '如何报名', source_video: '培训' }] }]);
  await assert.rejects(queueRequest(pool, { op: 'score', line: 'jinuo', run: 'test' }, {
    judgeComment: async () => { throw Error('AUTH_FAILED'); },
  }), /AUTH_FAILED/);
  assert.ok(pool.calls.some(c => c.sql === 'ROLLBACK'));
  assert.ok(!pool.calls.some(c => /UPDATE zenithjoy.leadgen_comments/.test(c.sql)));
});

test('标记人的更新与评论完成状态原子提交，已有已触达人只增加重复标记', async () => {
  const pool = fakePool([
    { rows: [] }, { rows: [{ id: 'c1', line_key:'jinuo', dedup_key: '甲|id|报名', nickname: '甲', douyin_id: 'id',
      comment_body: '如何报名', source_video: '培训', relevance: '相关', intent_grade: 'A' }] },
    { rows: [{ id: 'l1', dup_hit_count: 2 }] }, { rows: [] }, {rows:[{id:'l1',line_key:'jinuo',douyin_id:'id'}]}, { rows: [] }, {rows:[]},
  ]);
  const result = await queueRequest(pool, { op: 'mark_leads', line: 'jinuo', run: 'test', limit: 1 });
  assert.deepEqual(result, { marked: 1, created: 0, repeats: 1,ids:['c1'],lead_ids:['l1'],recipient_calls:{model_call_count:0,passed:0,excluded:0,unknown:1} });
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
