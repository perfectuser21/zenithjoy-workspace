import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { queueRequest } = require('../leadgen-queue.js');

function fakePool(responses) {
  const calls = [];
  const client = {
    async query(sql, args) {
      calls.push({ sql, args });
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [], rowCount: 0 };
      const response = responses.shift();
      if (response instanceof Error) throw response;
      assert.ok(response, `未预期SQL: ${sql}`);
      return response;
    }, release() { calls.push({ sql: 'RELEASE' }); },
  };
  return { calls, query: client.query.bind(client), async connect() { return client; } };
}

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
    { rows: [] }, { rows: [{ id: 'c1', dedup_key: '甲|id|报名', nickname: '甲', douyin_id: 'id',
      comment_body: '如何报名', source_video: '培训', relevance: '相关', intent_grade: 'A' }] },
    { rows: [{ id: 'l1', dup_hit_count: 2 }] }, { rows: [] }, { rows: [] },
  ]);
  const result = await queueRequest(pool, { op: 'mark_leads', line: 'jinuo', run: 'test', limit: 1 });
  assert.deepEqual(result, { marked: 1, created: 0, repeats: 1,ids:['c1'],lead_ids:['l1'] });
  const person = pool.calls.find(c => /SET dup_hit_count/.test(c.sql));
  assert.ok(person);
  assert.ok(!/status\s*=|reached_at\s*=|DELETE/.test(person.sql));
  assert.ok(pool.calls.some(c => /SET process_status = '已分拣'/.test(c.sql)));
  assert.ok(pool.calls.some(c => c.sql === 'COMMIT'));
});

test('评分和标记人按实际处理ID独立读回，缺行不得宣称verified',async()=>{
  const pool=fakePool([{rows:[{id:'c1',relevance:'相关',intent_grade:'A',process_status:'已分拣'}]},{rows:[]}]);
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
