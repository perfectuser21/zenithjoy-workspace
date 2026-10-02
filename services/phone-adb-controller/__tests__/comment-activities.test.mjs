import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const load = () => require('../comment-activities.js');
const row = (id = 'comment-1') => ({ id, fields: {
  评论者昵称: '小李', 评论原文: '在哪里报名？', 来源视频: 'AI训练师',
  用户主页标识: '123 | https://example.com/123',
} });
const input = (comments = [row()]) => ({ run_tag: 'smoke-phase3', line_key: 'jinuo', comments });
const verdict = { grade: 'A', relevance: '相关', reason: '主动询问报名' };

test('评分独立活动只处理显式输入，输出可交给配送，不读取或修改评论池', async () => {
  const original = input();
  const snapshot = structuredClone(original);
  const calls = [];
  const result = await load().scoreComments(original, {
    judge: async (...args) => { calls.push(args); return verdict; },
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.run_tag, original.run_tag);
  assert.equal(result.line_key, 'jinuo');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '在哪里报名？');
  assert.deepEqual(result.outputs.comments[0].verdict, verdict);
  assert.equal(result.metrics.comments_scored, 1);
  assert.deepEqual(original, snapshot);
});

test('模型故障保留原评论待重试，继续评分后面的输入，不能降为C档成功', async () => {
  const result = await load().scoreComments(input([row('one'), row('two')]), {
    judge: async (_comment, _caption, _profile, { comment_id }) => {
      if (comment_id === 'one') throw new Error('API unavailable');
      return verdict;
    },
  });
  assert.equal(result.status, 'partial');
  assert.equal(result.failure_class, 'retryable');
  assert.equal(result.outputs.comments[0].verdict, undefined);
  assert.equal(result.outputs.comments[0].score_status, 'pending');
  assert.deepEqual(result.outputs.comments[1].verdict, verdict);
  assert.equal(result.metrics.comments_scored, 1);
  assert.equal(result.metrics.pending, 1);
});

test('非法业务线和重复输入ID在模型调用之前拒绝', async () => {
  let called = 0;
  const deps = { judge: async () => { called++; return verdict; } };
  await assert.rejects(load().scoreComments({ ...input(), line_key: 'unknown' }, deps), /未配路由/);
  await assert.rejects(load().scoreComments(input([row(), row()]), deps), /重复/);
  assert.equal(called, 0);
});

test('评分结果→配送活动：复用真实结算逻辑，线索写成后才推进池状态', async () => {
  const { scoreComments, deliverComments } = load();
  const scored = await scoreComments(input(), { judge: async () => verdict });
  const calls = [];
  const delivered = await deliverComments({ ...input(), comments: scored.outputs.comments }, {
    seen: new Map(), now: '2026-10-01 12:00(UTC+8)', asLeadTime: (_name, v) => v,
    deps: {
    putPool: async (id, fields) => { calls.push({ op: 'pool', id, fields }); return { code: 0 }; },
    postLead: async fields => { calls.push({ op: 'lead', fields }); return { code: 0, data: { record: { record_id: 'lead-1' } } }; },
    putLead: async () => { throw new Error('不应更新历史线索'); },
    },
  });
  assert.equal(delivered.status, 'completed');
  assert.equal(delivered.metrics.leads_written, 1);
  assert.equal(calls[0].op, 'lead');
  assert.equal(calls[1].fields.处理状态, '已分拣');
  assert.equal(calls[0].fields.业务线, 'AI人工智能训练师');
});

test('去掉评分即可调用配送：未评分记录保持待分拣，不生成线索', async () => {
  let writes = 0;
  const result = await load().deliverComments(input(), {
    seen: new Map(), now: 'now', asLeadTime: (_name, v) => v,
    deps: {
    putPool: async () => { writes++; return { code: 0 }; },
    postLead: async () => { writes++; return { code: 0 }; },
    putLead: async () => { writes++; return { code: 0 }; },
    },
  });
  assert.equal(writes, 0);
  assert.equal(result.status, 'completed');
  assert.equal(result.metrics.leads_written, 0);
  assert.equal(result.metrics.unscored, 1);
  assert.equal(result.outputs.comments[0].delivery_status, 'unscored');
});

test('配送失败不会吞掉其他评论，失败记录不推进已分拣状态', async () => {
  const first = { ...row('one'), verdict };
  const second = { ...row('two'), fields: { ...row().fields, 评论者昵称: '小王', 用户主页标识: '456' }, verdict };
  const writes = [];
  let n = 0;
  const result = await load().deliverComments(input([first, second]), {
    seen: new Map(), now: 'now', asLeadTime: (_name, v) => v,
    deps: {
    postLead: async () => ++n === 1 ? { code: 1254045 } : { code: 0, data: { record: { record_id: 'lead-2' } } },
    putLead: async () => ({ code: 0 }),
    putPool: async (id, fields) => { writes.push({ id, fields }); return { code: 0 }; },
    },
  });
  assert.equal(result.status, 'partial');
  assert.equal(result.failure_class, 'retryable');
  assert.equal(result.metrics.leads_written, 1);
  assert.equal(result.metrics.pending, 1);
  assert.ok(!writes.some(w => w.id === 'one' && w.fields.处理状态 === '已分拣'));
  assert.equal(result.outputs.comments[1].delivery_status, 'completed');
});

test('重判故障会清除上轮成功结论，不能带旧verdict进入配送', async () => {
  const source = { ...row(), verdict, delivery_status: 'completed' };
  const result = await load().scoreComments(input([source]), { judge: async () => { throw new Error('API down'); } });
  assert.equal(result.status, 'failed');
  assert.equal(result.outputs.comments[0].verdict, undefined);
  assert.equal(result.outputs.comments[0].delivery_status, undefined);
  assert.deepEqual(source.verdict, verdict);
});

test('池写入未确认时配送不能报完成，即使最终线索已经写入', async () => {
  const result = await load().deliverComments(input([{ ...row(), verdict }]), {
    seen: new Map(), now: 'now', asLeadTime: (_name, value) => value,
    deps: {
      postLead: async () => ({ code: 0, data: { record: { record_id: 'lead-1' } } }),
      putLead: async () => ({ code: 0 }),
      putPool: async () => ({ code: 1254043 }),
    },
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.failure_class, 'retryable');
  assert.equal(result.metrics.pending, 1);
  assert.equal(result.metrics.leads_written, 1, '线索已写成，池回执失败不能把真实写入数抹掉');
});

test('JSON进程入口：空批评分及无评分配送不需要凭据，stdout恰好一个结果对象', () => {
  const entry = new URL('../comment-activity.js', import.meta.url).pathname;
  for (const action of ['scoring', 'delivery']) {
    const request = action === 'scoring' ? input([]) : input();
    const result = spawnSync(process.execPath, [entry, action], {
      input: JSON.stringify(request), encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: '/nonexistent' },
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, 'completed');
    assert.equal(output.run_tag, request.run_tag);
    assert.equal(output.outputs.comments.length, request.comments.length);
  }
});

test('JSON进程入口：非法业务线在认证或写库前拒绝，错误回执也带run标识', () => {
  const result = spawnSync(process.execPath,
    [new URL('../comment-activity.js', import.meta.url).pathname, 'delivery'], {
      input: JSON.stringify({ ...input([{ ...row(), verdict }]), line_key: 'unknown' }),
      encoding: 'utf8', env: { PATH: process.env.PATH, HOME: '/nonexistent' },
    });
  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, 'failed');
  assert.equal(output.failure_class, 'fatal');
  assert.equal(output.run_tag, 'smoke-phase3');
});

test('活动接入真实Jev判定函数，低置信复核仍按四档闭集输出', async () => {
  const calls = [];
  const result = await load().scoreComments(input(), {
    judgeOptions: { apiKey: 'fixture-key', httpPost: async (url, payload) => {
      calls.push({ url, payload });
      return url.includes('/decisions')
        ? { answers: { grade: { choice: 'A', confidence: 0.3 } } }
        : { choices: [{ message: { content: 'B' } }] };
    } },
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.outputs.comments[0].verdict.grade, 'B');
  assert.equal(result.metrics.grades.B, 1);
  assert.equal(calls.length, 2);
  assert.match(calls[0].payload.state, /在哪里报名/);
});

test('配送非法评分与账号归属错误返回fatal，不能进入无限存储重试', () => {
  const entry = new URL('../comment-activity.js', import.meta.url).pathname;
  for (const [request, extra, reason] of [
    [input([{ ...row(), verdict: null }]), {}, 'invalid_input'],
    [input([{ ...row(), verdict }]), { FEISHU_ACCOUNT: 'main', FEISHU_APP_ID: 'fixture', FEISHU_APP_SECRET: 'fixture' }, 'account_mismatch'],
  ]) {
    const result = spawnSync(process.execPath, [entry, 'delivery'], {
      input: JSON.stringify(request), encoding: 'utf8', env: { PATH: process.env.PATH, ...extra },
    });
    const output = JSON.parse(result.stdout);
    assert.equal(result.status, 1);
    assert.equal(output.failure_class, 'fatal');
    assert.equal(output.reason_code, reason);
  }
});

test('部署先上传独立活动依赖，再替换旧分拣入口，首次上线无缺模块窗口', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../deploy.sh', import.meta.url), 'utf8');
  const files = source.match(/MMV_JS_FILES=\(([\s\S]*?)\)/)[1].trim().split(/\s+/);
  assert.ok(files.indexOf('comment-activities.js') < files.indexOf('sort-comments.js'));
  for (const name of ['comment-activity.js', 'comment-delivery-storage.js']) assert.ok(files.includes(name));
});


test('阶段3部署携带完整原始评论与视频活动依赖，设备自有账号过滤可运行', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const source = readFileSync(new URL('../deploy.sh', import.meta.url), 'utf8');
  const array = name => source.match(new RegExp(name + '=\\(([\\s\\S]*?)\\)'))[1].trim().split(/\s+/);
  const mmv = array('MMV_JS_FILES');
  for (const name of ['raw-comment-activities.js', 'raw-comment-storage.js', 'raw-comment-delivery.js']) {
    assert.ok(mmv.includes(name), name);
    assert.ok(mmv.indexOf(name) < mmv.indexOf('push-raw-comments.js'));
    assert.ok(mmv.indexOf(name) < mmv.indexOf('comment-activity.js'));
  }
  assert.ok(array('DEVICE_SH_FILES').includes('video-phone-activity.sh'));
  const device = array('DEVICE_NODE_FILES');
  for (const name of ['line-routes.js', 'video-activities.js', 'video-activity.js',
    'own-accounts-lib.js', 'check-own-account.js', 'config/own-accounts.json']) {
    assert.ok(device.includes(name), name);
    assert.ok(existsSync(new URL('../' + name, import.meta.url)));
  }
  assert.match(source, /_ndir=.*bin-harvest/);
  assert.match(source, /mkdir -p \$_ndir/);
});
