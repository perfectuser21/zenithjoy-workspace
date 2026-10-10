import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
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
