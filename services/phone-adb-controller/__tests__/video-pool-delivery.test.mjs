import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { runVideoActivity } = require('../video-activities.js');
const id = '7000000000000000001';
const native = `VIDEO\t${id}\thttps://v.douyin.com/fixture/\tAI课程\t人工智能\t3\nACTIVITY_STATUS\tcompleted\t`;
const input = { run_tag: 'video-delivery-fixture', line_key: 'jinuo', comments: [], device: {
  profile: 'legacy', serial: 'SER1', lock_holder: 'video-delivery-fixture' },
  video: { video_id: id, title: 'AI课程', keyword: '人工智能', judgment_status: 'matched' } };
const expected = { 视频ID: id, 视频链接: { link: 'https://v.douyin.com/fixture/', text: 'https://v.douyin.com/fixture/' },
  '视频标题/文案': 'AI课程', 命中关键词: '人工智能', 评论数: 3, 发现时间: '2026-10-02 08:00(UTC+8)',
  处理状态: '评论已采', 采收批次: input.run_tag };
async function collected(stdout = native) {
  return runVideoActivity('collection', input, { run: async () => ({ stdout }) });
}
async function cli(videos, { fail = false, httpFailure = false, stalledPagination = false, paginationFlag, missingId = false, pagination = false, failPoolFields = false, account = 'jinoshengyuan', comments = [] } = {}) {
  const records = new Map(); const calls = []; let posts = 0;
  const server = createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    const body = text ? JSON.parse(text) : null;
    calls.push({ method: req.method, url: req.url, body });
    let result;
    const videoTable = req.url.includes('tblKHYTMZceFBwHr');
    if (req.url.includes('/auth/')) result = { code: 0, tenant_access_token: 'fixture-token' };
    else if (req.method === 'GET' && req.url.includes('/fields?')) result = { code: 0, data: { items: (failPoolFields ? [] : require('../raw-comment-activities.js').RAW_COMMENT_FIELDS).map(field_name => ({ field_name, type: 1 })) } };
    else if (req.method === 'GET' && req.url.includes('/records?')) {
      const items = videoTable ? [...records].map(([record_id, fields]) => ({ record_id, fields })) : [];
      result = pagination && videoTable && !req.url.includes('page_token=')
        ? { code: 0, data: { items: [], has_more: true, page_token: 'page2' } }
        : { code: 0, data: { items, has_more: Boolean(stalledPagination && videoTable), ...(stalledPagination && videoTable ? { page_token: 'page2' } : {}) } };
    } else if (req.method === 'POST' && videoTable) {
      posts++;
      if (fail || httpFailure) { if (httpFailure) res.statusCode = 500; result = { code: httpFailure ? 0 : 1255001, data: { record: { record_id: 'unconfirmed-id' } } }; }
      else { records.set('video1', body.fields); result = { code: 0, data: { record: missingId ? {} : { record_id: 'video1' } } }; }
    } else if (req.method === 'POST') result = { code: 0, data: { record: { record_id: 'comment1' } } };
    else { res.statusCode = 404; result = { code: 1 }; }
    if (videoTable && req.method === 'GET' && req.url.includes('/records?') && paginationFlag !== undefined) {
      if (paginationFlag === 'missing') delete result.data.has_more; else result.data.has_more = paginationFlag;
    }
    res.end(JSON.stringify(result));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const directory = mkdtempSync(path.join(tmpdir(), 'video-delivery-cli-'));
  const preload = path.join(directory, 'transport.cjs');
  writeFileSync(preload, `const actual=global.fetch; Date.now=()=>Date.parse('2026-10-02T00:00:00Z'); global.fetch=(url,opts)=>{if(!String(url).startsWith('https://open.feishu.cn/'))throw new Error('forbidden remote');return actual('http://127.0.0.1:${server.address().port}'+new URL(url).pathname+new URL(url).search,opts);};`);
  const run = async () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--require', preload, new URL('../comment-activity.js', import.meta.url).pathname, 'raw-delivery'], {
      env: { PATH: process.env.PATH, FEISHU_ACCOUNT: account, FEISHU_APP_ID: 'fixture-app', FEISHU_APP_SECRET: 'fixture-secret' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data);
    child.on('error', reject); child.on('close', code => resolve({ code, result: JSON.parse(stdout), stderr }));
    child.stdin.end(JSON.stringify({ run_tag: input.run_tag, line_key: input.line_key, comments, videos }));
  });
  try { const first = await run(); const replay = !fail && !httpFailure && !stalledPagination && paginationFlag === undefined && !missingId && account === 'jinoshengyuan' ? await run() : null;
    return { ...first, replay, records, calls, posts };
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(directory, { recursive: true }); }
}

test('真实采集 VIDEO 确认经 JSON 配送 CLI 写视频池，所有旧字段相同且重放按视频 ID 去重', async () => {
  const result = await cli((await collected()).outputs.videos, { pagination: true });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.result.metrics.videos_written, 1);
  assert.deepEqual(result.records.get('video1'), expected);
  assert.equal(result.result.outputs.videos[0].video_pool_record_id, 'video1');
  assert.equal(result.replay.result.metrics.videos_duplicates, 1);
  assert.equal(result.replay.result.outputs.videos[0].video_pool_record_id, 'video1');
  assert.equal(result.posts, 1);
  assert.ok(result.calls.some(call => call.url.includes('page_token=page2')));
});

test('VIDEO 行后的取消/PG 更新失败、零评论或错误视频行没有已采视频配送凭证', async () => {
  for (const stdout of [native.replace('completed', 'pending'), 'ACTIVITY_STATUS\tcompleted\t',
    native.replace(id, '7000000000000000002'), native + '\nACTIVITY_CLEANUP\tfailed']) {
    const result = await collected(stdout);
    assert.equal(result.outputs.videos[0].collection_receipt, undefined);
  }
  assert.ok((await collected()).outputs.videos[0].collection_receipt);
});

test('视频写入失败仍落已采评论，视频待配送不覆盖评论 pending', async () => {
  const result = await cli((await collected()).outputs.videos, { fail: true, comments: [{ id: 'raw1', fields: { 评论原文: '怎么报名', 评论者昵称: '小李' } }] });
  assert.equal(result.code, 2);
  assert.equal(result.result.failure_class, 'retryable');
  assert.equal(result.result.metrics.videos_pending, 1);
  assert.equal(result.result.metrics.pending, 0);
  assert.equal(result.result.metrics.comments_written, 1);
  assert.equal(result.result.outputs.pending_videos[0].video_id, id);
});

test('未返回真实 record_id 不能报告视频配送成功', async () => {
  const result = await cli((await collected()).outputs.videos, { missingId: true });
  assert.equal(result.result.metrics.videos_written, 0);
  assert.equal(result.result.metrics.videos_pending, 1);
  assert.equal(result.result.failure_class, 'retryable');
});

test('视频配送账号不符 fail closed，仍保留明确待配送视频且不请求任何远端', async () => {
  const result = await cli((await collected()).outputs.videos, { account: 'main' });
  assert.equal(result.result.failure_class, 'fatal');
  assert.equal(result.result.metrics.videos_pending, 1);
  assert.equal(result.calls.length, 0);
});

test('整链配送适配器必须把合同中的 videos 传入真实原生配送输入', async () => {
  const videos = (await collected()).outputs.videos;
  let received;
  await require('../keyword-workflow-activity.js').runWorkflowActivity('delivery', {
    run_tag: input.run_tag, line_key: input.line_key, comments: [], videos,
  }, { invoke: async (entry, _args, payload) => {
    if (entry === 'comment-activity.js') received = payload;
    return { code: 0, value: { schema_version: 1, run_tag: input.run_tag, line_key: input.line_key,
      status: 'completed', outputs: {}, metrics: {}, evidence: [] } };
  } });
  assert.deepEqual(received.videos, videos);
});

test('失效显式采集凭证 fail closed，保留待配送原视频而不写错误视频池', async () => {
  const video = { ...input.video, collection_receipt: { video_id: '7000000000000000002', url: 'https://v.douyin.com/fixture/',
    title: 'AI课程', keyword: '人工智能', comment_count: 3, batch: input.run_tag } };
  const result = await cli([video]);
  assert.equal(result.result.failure_class, 'fatal');
  assert.equal(result.result.metrics.videos_pending, 1);
  assert.equal(result.calls.length, 0);
});

test('视频已落池后评论存储初始化失败，回执仍保留真实视频 ID 与待配送评论', async () => {
  const result = await cli((await collected()).outputs.videos, { failPoolFields: true, comments: [{ id: 'raw1', fields: { 评论原文: '怎么报名', 评论者昵称: '小李' } }] });
  assert.equal(result.code, 2);
  assert.equal(result.result.metrics.videos_written, 1);
  assert.equal(result.result.outputs.videos[0].video_pool_record_id, 'video1');
  assert.equal(result.result.metrics.pending, 1);
  assert.equal(result.result.outputs.pending_comments[0].id, 'raw1');
});

test('HTTP 失败即便 body code0 带 record_id 也不能确认视频写入', async () => {
  const result = await cli((await collected()).outputs.videos, { httpFailure: true });
  assert.equal(result.result.metrics.videos_written, 0);
  assert.equal(result.result.metrics.videos_pending, 1);
  assert.equal(result.result.failure_class, 'retryable');
  assert.equal(result.result.outputs.videos[0].video_pool_record_id, undefined);
});

test('视频去重分页不推进时留待配送，拒绝不完整历史下的新增写入', async () => {
  const result = await cli((await collected()).outputs.videos, { pagination: true, stalledPagination: true });
  assert.equal(result.result.metrics.videos_pending, 1);
  assert.equal(result.posts, 0);
});

test('视频去重缺少或非法分页终态时失败，仍配送已采评论', async () => {
  for (const paginationFlag of ['missing', 'false', 0]) {
    const result = await cli((await collected()).outputs.videos, { paginationFlag, comments: [{ id: 'raw1', fields: { 评论原文: '怎么报名', 评论者昵称: '小李' } }] });
    assert.equal(result.result.metrics.videos_pending, 1);
    assert.equal(result.result.metrics.comments_written, 1);
    assert.equal(result.posts, 0);
  }
});

test('非法视频容器或行输入明确fatal，仍配送有效已采评论且不能伪completed', async () => {
  for (const videos of [{ wrong: 'shape' }, [null], [42]]) {
    const result = await cli(videos, { comments: [{ id: 'raw1', fields: { 评论原文: '怎么报名', 评论者昵称: '小李' } }] });
    assert.equal(result.result.reason_code, 'invalid_video_delivery_input');
    assert.equal(result.result.failure_class, 'fatal');
    assert.equal(result.result.metrics.comments_written, 1);
    assert.equal(result.result.status, 'partial');
    assert.equal(result.posts, 0);
  }
});

test('存在非法或多条 VIDEO 行、已采评论缺 VIDEO 凭证时不得静默 completed', async () => {
  for (const stdout of [native.replace(id, '7000000000000000002'), native + '\n' + native,
    'LEAD\t小李\t123\t个人\t怎么报名\t昨天\t浙江\tAI课程\t人工智能\t浙江\thttps://douyin.com/user/1\thttps://v.douyin.com/fixture/\nACTIVITY_STATUS\tcompleted\t']) {
    const result = await collected(stdout);
    assert.notEqual(result.status, 'completed');
    assert.equal(result.failure_class, 'retryable');
    assert.equal(result.reason_code, 'video_collection_receipt_unconfirmed');
    assert.equal(result.metrics.videos_processed, 0);
    assert.equal(result.outputs.videos[0].collection_receipt, undefined);
  }
});

test('兼容仅评论原生配送输入：未提供 videos 时不输出视频数组覆盖既有上下文', async () => {
  const result = await cli(undefined, { comments: [{ id: 'raw1', fields: { 评论原文: '怎么报名', 评论者昵称: '小李' } }] });
  assert.equal(result.code, 0);
  assert.equal(result.result.metrics.comments_written, 1);
  assert.equal(Object.hasOwn(result.result.outputs, 'videos'), false);
  assert.equal(Object.hasOwn(result.result.outputs, 'pending_videos'), false);
  const explicitEmpty = await cli([]);
  assert.deepEqual(explicitEmpty.result.outputs.videos, []);
  assert.deepEqual(explicitEmpty.result.outputs.pending_videos, []);
});
