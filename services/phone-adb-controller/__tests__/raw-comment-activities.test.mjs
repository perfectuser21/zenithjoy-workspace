import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const load = () => require('../raw-comment-activities.js');
const row = (id = 'source-1', comment = '在哪里报名？') => ({ id, fields: {
  评论者昵称: '小李', 评论原文: comment, 来源视频: 'AI训练师'.repeat(30),
  抖音号: '123', 主页链接: 'https://example.com/123', 账号类型: '个人',
  用户主页标识: '123 | https://example.com/123 | 个人',
  命中关键词: '训练师', 评论作品视频链接: 'https://example.com/video',
  留言时间: '昨天', 地区: '广东', 主页IP: ' 深圳 ',
} });
const input = (comments = [row()]) => ({ run_tag: 'raw-phase3', line_key: 'jinuo', comments });
const verdict = { grade: 'A', relevance: '相关', reason: '报名意向' };
const rawid = r => `${r.fields.评论者昵称}|${r.fields.抖音号 || 'noid'}|${r.fields.评论原文.slice(0, 20)}`;
const deps = (extra = {}) => ({ seen: new Map(), now: '2026-10-01 12:00(UTC+8)',
  asTime: (_name, value) => value,
  postPool: async () => ({ code: 0, data: { record: { record_id: 'pool-1' } } }), ...extra });

test('先评分再落池：保留评分与source_id，持久化ID能直接交既有配送结算', async () => {
  const { scoreComments, deliverComments } = require('../comment-activities.js');
  const scored = await scoreComments(input(), { judge: async () => verdict });
  const before = structuredClone(scored.outputs.comments);
  const writes = [];
  const persisted = await load().persistRawComments(input(scored.outputs.comments), deps({
    postPool: async fields => { writes.push(fields); return { code: 0, data: { record: { record_id: 'pool-1' } } }; },
  }));
  assert.equal(persisted.schema_version, 1);
  assert.equal(persisted.status, 'completed');
  assert.equal(persisted.outputs.comments[0].id, 'pool-1');
  assert.equal(persisted.outputs.comments[0].source_id, 'source-1');
  assert.deepEqual(persisted.outputs.comments[0].verdict, verdict);
  assert.deepEqual(scored.outputs.comments, before);
  assert.equal(writes[0].来源视频.length, 100);
  assert.equal(writes[0].原始评论ID, rawid(row()));
  assert.equal(writes[0].处理状态, '待分拣');
  assert.equal(writes[0].运行批次, 'raw-phase3');
  assert.equal(writes[0].主页IP, '深圳');
  assert.equal(writes[0].抖音号, '123');
  assert.equal(writes[0].主页链接, 'https://example.com/123');
  assert.equal(writes[0].账号类型, '个人');
  const settled = [];
  const delivered = await deliverComments(input(persisted.outputs.comments), {
    seen: new Map(), now: 'now', asLeadTime: (_n, v) => v, deps: {
      postLead: async () => ({ code: 0, data: { record: { record_id: 'lead-1' } } }),
      putLead: async () => { throw new Error('unexpected duplicate'); },
      putPool: async id => { settled.push(id); return { code: 0 }; },
    },
  });
  assert.equal(delivered.metrics.leads_written, 1);
  assert.deepEqual(settled, ['pool-1']);
});

test('无评分落池不依赖线索存储，保留待分拣且空批也完成', async () => {
  const result = await load().persistRawComments(input(), deps());
  assert.equal(result.outputs.comments[0].verdict, undefined);
  assert.equal(result.outputs.comments[0].fields.处理状态, '待分拣');
  assert.deepEqual(result.metrics, { comments_written: 1, duplicates: 0, pending: 0 });
  assert.equal((await load().persistRawComments(input([]), deps())).status, 'completed');
});

test('旧rawid相同的同内容输入合并一个真实池ID，证据覆盖每条源记录', async () => {
  const options = deps();
  const first = await load().persistRawComments(input([row('one'), row('two')]), options);
  assert.equal(first.outputs.comments.length, 1);
  assert.equal(first.evidence.length, 2);
  assert.deepEqual(first.metrics, { comments_written: 1, duplicates: 1, pending: 0 });
  options.postPool = async () => { throw new Error('must not post replay'); };
  const replay = await load().persistRawComments(input([row('one'), row('two')]), options);
  assert.equal(replay.outputs.comments[0].id, 'pool-1');
  assert.deepEqual(replay.metrics, { comments_written: 0, duplicates: 2, pending: 0 });
});

test('同批合并重复池ID时，后续源记录评分仍保留在唯一配送输出中', async () => {
  const scored = { ...row('scored'), verdict, score_status: 'completed' };
  const result = await load().persistRawComments(input([row('unscored'), scored]), deps());
  assert.equal(result.outputs.comments.length, 1);
  assert.deepEqual(result.outputs.comments[0].verdict, verdict);
  assert.equal(result.outputs.comments[0].score_status, 'completed');
  assert.equal(result.evidence.length, 2);
});

test('前20字rawid碰撞不同原文永久拒绝，不能返回别人的池ID', async () => {
  const historical = row('old', '同'.repeat(20) + '旧内容');
  const source = row('new', '同'.repeat(20) + '新内容');
  const result = await load().persistRawComments(input([source]), deps({
    seen: new Map([[rawid(historical), { id: 'other-pool', fields: historical.fields }]]),
    postPool: async () => { throw new Error('must not write collision'); },
  }));
  assert.equal(result.status, 'failed');
  assert.equal(result.failure_class, 'fatal');
  assert.equal(result.outputs.comments.length, 0);
  assert.equal(result.outputs.pending_comments[0].id, 'new');
  assert.equal(result.evidence[0].reason_code, 'rawid_conflict');
});

test('同rawid的历史昵称或主页不符也永久拒绝', async () => {
  for (const field of ['评论者昵称', '用户主页标识']) {
    const remote = row(); remote.fields[field] = '他人';
    const result = await load().persistRawComments(input(), deps({
      seen: new Map([[rawid(row()), { id: 'other-pool', fields: remote.fields }]]),
    }));
    assert.equal(result.failure_class, 'fatal');
    assert.equal(result.outputs.comments.length, 0);
  }
});

test('逐条失败仍继续，只有code0且真实record_id才能更新去重并在重试成功', async () => {
  for (const broken of [{ code: 1 }, { code: 0 }, new Error('transport failed')]) {
    const comments = [row('one'), { ...row('two'), fields: { ...row().fields, 评论者昵称: '小王' } }];
    let count = 0;
    const options = deps({ postPool: async () => {
      if (++count === 1) { if (broken instanceof Error) throw broken; return broken; }
      return { code: 0, data: { record: { record_id: 'pool-2' } } };
    } });
    const result = await load().persistRawComments(input(comments), options);
    assert.equal(result.status, 'partial');
    assert.equal(result.failure_class, 'retryable');
    assert.equal(result.metrics.pending, 1);
    assert.equal(options.seen.has(rawid(comments[0])), false);
    assert.equal(result.outputs.comments[0].id, 'pool-2');
    assert.deepEqual(result.outputs.pending_comments[0].fields, comments[0].fields);
    options.postPool = async () => ({ code: 0, data: { record: { record_id: 'pool-1' } } });
    const retry = await load().persistRawComments(input(comments), options);
    assert.equal(retry.status, 'completed');
    assert.deepEqual(retry.metrics, { comments_written: 1, duplicates: 1, pending: 0 });
    assert.deepEqual(retry.outputs.comments.map(x => x.id), ['pool-1', 'pool-2']);
  }
});

test('复用显式输入验证，在写入前拒绝未知线及重复源ID', async () => {
  await assert.rejects(load().persistRawComments({ ...input(), line_key: 'unknown' }, deps()), /未配路由/);
  await assert.rejects(load().persistRawComments(input([row(), row()]), deps()), /重复/);
});

test('TSV纯转换仅保留本批LEAD行，重复内容仍用独立源ID交落池去重', () => {
  const tsv = ['debug line',
    'LEAD\t甲\t123\t个人\t想报名\t昨天\t广东\t视频\t培训\t深圳\thttps://example.com/123\thttps://example.com/v',
    'LEAD\t甲\t123\t个人\t想报名\t昨天\t广东\t视频\t培训\t深圳\thttps://example.com/123\thttps://example.com/v',
  ].join('\n');
  const batch = load().harvestTsvInput(tsv, { run_tag: 'legacy', line_key: 'jinuo' });
  assert.equal(batch.run_tag, 'legacy');
  assert.equal(batch.comments.length, 2);
  assert.notEqual(batch.comments[0].id, batch.comments[1].id);
  assert.equal(batch.comments[0].fields.抖音号, '123');
  assert.equal(batch.comments[0].fields.主页链接, 'https://example.com/123');
  assert.equal(batch.comments[0].fields.用户主页标识, '123 | https://example.com/123 | 个人');
});

for (const diagnostic of [
  { reason_code: 'raw_storage_http_failed', http_status: 503 },
  { reason_code: 'raw_storage_api_failed', http_status: 200, feishu_code: 1254060 },
  { reason_code: 'raw_storage_timeout' },
  { reason_code: 'raw_storage_transport_failed' },
  { reason_code: 'raw_storage_response_invalid', http_status: 200 },
]) {
  test(`落池安全字段白名单传播：${diagnostic.reason_code}`, async () => {
    const result = await load().persistRawComments(input(), deps({ postPool: async () => {
      throw Object.assign(new Error('message-canary'), diagnostic, { cause: 'cause-canary', body: 'body-canary', headers: 'headers-canary', credential: 'credential-canary', url: 'url-canary' });
    } }));
    const { source_id, rawid, status, failure_class, ...actual } = result.evidence[0];
    assert.deepEqual(actual, diagnostic);
    assert.doesNotMatch(JSON.stringify(result), /canary/);
  });
}

test('落池拒绝伪造诊断任意值及越界状态码，不做字符串数字转换', async () => {
  for (const value of ['secret-canary', '503', -1, 0.5, NaN, Infinity, {}, 2147483648]) {
    const result = await load().persistRawComments(input(), deps({ postPool: async () => {
      throw Object.assign(new Error('message-canary'), { reason_code: 'secret-canary', http_status: value, feishu_code: value });
    } }));
    assert.equal(result.evidence[0].reason_code, 'raw_storage_unconfirmed');
    assert.equal(result.evidence[0].http_status, undefined);
    assert.equal(result.evidence[0].feishu_code, undefined);
    assert.doesNotMatch(JSON.stringify(result), /canary/);
  }
  for (const http_status of [99, 600, 2147483647]) {
    const result = await load().persistRawComments(input(), deps({ postPool: async () => {
      throw { reason_code: 'raw_storage_http_failed', http_status };
    } }));
    assert.equal(result.evidence[0].http_status, undefined);
  }
});

test('缺记录ID或未确认返回保留pending并明确unconfirmed', async () => {
  for (const result of [{ code: 0 }, { code: 1 }, null]) {
    const receipt = await load().persistRawComments(input(), deps({ postPool: async () => result }));
    assert.equal(receipt.evidence[0].reason_code, 'raw_storage_unconfirmed');
    assert.equal(receipt.metrics.pending, 1);
  }
});


test('不可信错误的动态getter只读一次快照，不能绕过白名单把秘密带进证据', async () => {
  const reads = { reason_code: 0, http_status: 0, feishu_code: 0 };
  const error = new Error('message-getter-canary-secret');
  const first = { reason_code: 'raw_storage_http_failed', http_status: 503, feishu_code: 1254060 };
  for (const key of Object.keys(reads)) Object.defineProperty(error, key, { get() {
    reads[key]++;
    return reads[key] === 1 ? first[key] : `${key}-getter-canary-secret`;
  } });
  const receipt = await load().persistRawComments(input(), deps({ postPool: async () => { throw error; } }));
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.metrics.pending, 1);
  assert.equal(receipt.outputs.pending_comments[0].id, 'source-1');
  const { source_id, rawid, status, failure_class, ...diagnostic } = receipt.evidence[0];
  assert.deepEqual(diagnostic, first);
  assert.deepEqual(reads, { reason_code: 1, http_status: 1, feishu_code: 1 });
  assert.doesNotMatch(JSON.stringify(receipt), /canary-secret/);
});

for (const key of ['reason_code', 'http_status', 'feishu_code']) {
  test(`不可信错误${key} getter抛错仍保留pending并安全回退`, async () => {
    let reads = 0;
    const error = new Error('message-getter-canary-secret');
    Object.defineProperty(error, key, { get() { reads++; throw new Error('getter-canary-secret'); } });
    const receipt = await load().persistRawComments(input(), deps({ postPool: async () => { throw error; } }));
    assert.equal(receipt.status, 'failed');
    assert.equal(receipt.failure_class, 'retryable');
    assert.equal(receipt.metrics.pending, 1);
    assert.equal(receipt.outputs.pending_comments[0].id, 'source-1');
    const { source_id, rawid, status, failure_class, ...diagnostic } = receipt.evidence[0];
    assert.deepEqual(diagnostic, { reason_code: 'raw_storage_unconfirmed' });
    assert.equal(reads, 1);
    assert.doesNotMatch(JSON.stringify(receipt), /canary-secret/);
  });
}


test('诊断getter抛错不终止后续行：第一条pending第二条真实落池产生partial', async () => {
  for (const key of ['reason_code', 'http_status', 'feishu_code']) {
    const error = new Error('message-getter-canary-secret');
    Object.defineProperty(error, key, { get() { throw new Error('getter-canary-secret'); } });
    let posts = 0;
    const first = row('one');
    const second = { ...row('two'), fields: { ...row().fields, 评论者昵称: '小王' } };
    const receipt = await load().persistRawComments(input([first, second]), deps({ postPool: async () => {
      if (++posts === 1) throw error;
      return { code: 0, data: { record: { record_id: 'pool-two' } } };
    } }));
    assert.equal(posts, 2);
    assert.equal(receipt.status, 'partial');
    assert.equal(receipt.failure_class, 'retryable');
    assert.deepEqual(receipt.metrics, { comments_written: 1, duplicates: 0, pending: 1 });
    assert.equal(receipt.outputs.pending_comments[0].id, 'one');
    assert.equal(receipt.outputs.comments[0].id, 'pool-two');
    assert.equal(receipt.evidence[0].reason_code, 'raw_storage_unconfirmed');
    assert.equal(receipt.evidence[1].status, 'completed');
    assert.doesNotMatch(JSON.stringify(receipt), /canary-secret/);
  }
});
