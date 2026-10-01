import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const load = () => require('../raw-comment-delivery.js');
const verdict = { grade: 'A', relevance: '相关', reason: '询问报名' };
const row = id => ({ id, fields: { 评论者昵称: id, 抖音号: id, 评论原文: '如何报名', 来源视频: 'AI课程', 用户主页标识: id }, verdict });
const input = comments => ({ run_tag: 'raw-delivery-smoke', line_key: 'jinuo', comments });
function storage({ failId } = {}) {
  const calls = [];
  const persistDeps = { seen: new Map(), now: '2026-10-01', asTime: (_name, v) => v,
    postPool: async fields => {
      calls.push(['pool-create', fields.评论者昵称]);
      if (fields.评论者昵称 === failId) throw new Error('offline');
      return { code: 0, data: { record: { record_id: 'rec-' + fields.评论者昵称 } } };
    } };
  const deliveryDeps = { seen: new Map(), now: '2026-10-01', asLeadTime: (_name, v) => v,
    deps: { postLead: async fields => { calls.push(['lead-create', fields.抖音昵称]); return { code: 0, data: { record: { record_id: 'lead-' + fields.抖音昵称 } } }; },
      putLead: async () => ({ code: 0 }),
      putPool: async id => { calls.push(['pool-settle', id]); return { code: 0 }; } } };
  return { calls, persistDeps, createDeliveryDeps: async () => deliveryDeps };
}

test('先评分的原始评论经同一个配送活动落池再结算，临时ID不会写入线索结算', async () => {
  const deps = storage();
  const result = await load().deliverRawComments(input([row('one')]), deps);
  assert.equal(result.status, 'completed');
  assert.deepEqual(deps.calls.map(call => call[0]), ['pool-create', 'lead-create', 'pool-settle']);
  assert.equal(result.outputs.comments[0].id, 'rec-one');
  assert.equal(result.outputs.comments[0].source_id, 'one');
  assert.equal(result.metrics.comments_written, 1);
  assert.equal(result.metrics.leads_written, 1);
});

test('删除评分后配送仍真实落池，保持未评分，不加载线索存储或模型', async () => {
  const deps = storage();
  deps.createDeliveryDeps = async () => { throw new Error('不应加载线索存储'); };
  const comment = row('one'); delete comment.verdict;
  const result = await load().deliverRawComments(input([comment]), deps);
  assert.equal(result.status, 'completed');
  assert.equal(result.metrics.comments_written, 1);
  assert.equal(result.metrics.leads_written, 0);
  assert.equal(result.outputs.comments[0].delivery_status, 'unscored');
  assert.deepEqual(deps.calls.map(call => call[0]), ['pool-create']);
});

test('部分落池失败仍结算成功记录，失败原评论留在pending_comments', async () => {
  const deps = storage({ failId: 'one' });
  const result = await load().deliverRawComments(input([row('one'), row('two')]), deps);
  assert.equal(result.status, 'partial');
  assert.equal(result.failure_class, 'retryable');
  assert.equal(result.outputs.pending_comments[0].id, 'one');
  assert.equal(result.outputs.comments[0].id, 'rec-two');
  assert.equal(result.metrics.pending, 1);
  assert.equal(result.metrics.comments_written, 1);
  assert.equal(result.metrics.leads_written, 1);
});

test('池已写成但线索存储初始化失败，回执保留持久化产物和真实写入数供重试', async () => {
  const deps = storage();
  deps.createDeliveryDeps = async () => { throw new Error('network'); };
  const result = await load().deliverRawComments(input([row('one')]), deps);
  assert.equal(result.status, 'failed');
  assert.equal(result.outputs.comments[0].id, 'rec-one');
  assert.deepEqual(result.outputs.comments[0].verdict, verdict);
  assert.equal(result.metrics.comments_written, 1);
  assert.equal(result.metrics.pending, 1);
});

test('非法评分在落池副作用之前拒绝', async () => {
  const deps = storage();
  await assert.rejects(load().deliverRawComments(input([{ ...row('one'), verdict: null }]), deps));
  assert.equal(deps.calls.length, 0);
});

test('配送写入明确永久拒绝须保留fatal及原因，不把已落池产物改报成无限重试', async () => {
  const deps = storage();
  const create = deps.createDeliveryDeps;
  deps.createDeliveryDeps = async () => {
    const context = await create();
    context.deps.putPool = async () => { throw Object.assign(new Error('deleted'),
      { failure_class: 'fatal', reason_code: 'record_not_found' }); };
    return context;
  };
  const comment = { ...row('one'), verdict: { grade: '不相关', relevance: '不相关', reason: '广告' } };
  const result = await load().deliverRawComments(input([comment]), deps);
  assert.equal(result.status, 'failed');
  assert.equal(result.failure_class, 'fatal');
  assert.equal(result.reason_code, 'record_not_found');
  assert.equal(result.outputs.comments[0].id, 'rec-one');
});

test('独立JSON进程支持空批persist和raw-delivery，无凭据仍恰好一个回执', () => {
  for (const action of ['persist', 'raw-delivery']) {
    const result = spawnSync(process.execPath, [new URL('../comment-activity.js', import.meta.url).pathname, action], {
      input: JSON.stringify(input([])), encoding: 'utf8', env: { PATH: process.env.PATH },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, 'completed');
  }
});
