import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fixture, cli, ids, route, service, repo, compiler } from './workflow-cli-fixture.mjs';
const bindingFile = join(service, 'plans/keyword_activities.bindings.json');
const runtime = process.env.CECELIA_ACTIVITY_RUNTIME;
const optIn = { skip: runtime ? false : '未提供 CECELIA_ACTIVITY_RUNTIME，未执行跨仓库 CLI 验收', timeout: 60000 };

async function compile(f, withoutScore = false, resume = false) {
  let path = bindingFile;
  if (withoutScore || resume) {
    const bindings = JSON.parse(readFileSync(bindingFile, 'utf8'));
    if (withoutScore) {
      bindings.select = bindings.select.filter(key => key !== 'scoring');
      delete bindings.activities.scoring;
      bindings.activities.delivery.outputs = bindings.activities.delivery.outputs.filter(output => output.type !== 'Lead');
    }
    if (resume) {
      bindings.select = ['scoring', 'delivery'];
      delete bindings.activities.qualification; delete bindings.activities.collection;
      bindings.trigger_inputs = [...new Set([...bindings.trigger_inputs, 'Comment'])];
    }
    path = join(f.home, resume ? 'resume.bindings.json' : 'without-scoring.bindings.json');
    writeFileSync(path, JSON.stringify(bindings));
  }
  const output = await cli(compiler, ['keyword_acquisition', '--json', '--bindings', path, '--allow-missing'],
    { cwd: repo, env: f.env });
  assert.equal(output.code, 0, output.stderr);
  const value = JSON.parse(output.stdout);
  assert.ok(value.contract?.activities?.length, '必须使用真实compiler产物');
  return value.contract;
}

async function run(t, statuses, withoutScore = false) {
  const f = await fixture(t, statuses);
  const contract = await compile(f, withoutScore);
  const output = await cli(resolve(runtime), ['--cwd', service, '--receipt', f.receiptPath], {
    cwd: repo, env: f.env, input: { contract, input: f.input },
  });
  assert.equal(f.errors.length, 0, f.errors.map(error => error.stack).join('\n'));
  assert.equal(output.signal, null, output.stderr);
  const receipt = JSON.parse(output.stdout), persisted = JSON.parse(readFileSync(f.receiptPath, 'utf8'));
  assert.deepEqual(persisted, receipt, '真实CLI最终receipt必须持久化');
  assert.equal(receipt.run_tag, f.input.run_tag);
  return { ...f, contract, output, receipt };
}

function videoOrder(receipt, videos) {
  assert.deepEqual(receipt.activities.filter(activity => ['qualification', 'collection'].includes(activity.key))
    .map(activity => [activity.key, activity.item]), videos.flatMap(id => [['qualification', id], ['collection', id]]));
}

test('跨仓CLI：真实编译与Cecelia执行两视频qual→collect交错，再评分落池配送', optIn, async t => {
  const f = await run(t, ['matched', 'matched']);
  assert.equal(f.output.code, 0, f.output.stderr + '\n' + f.output.stdout); assert.equal(f.receipt.status, 'completed');
  videoOrder(f.receipt, ids.slice(0, 2));
  assert.deepEqual(f.receipt.activities.map(activity => activity.key),
    ['qualification', 'collection', 'qualification', 'collection', 'scoring', 'delivery']);
  assert.ok(f.receipt.activities.every(activity => activity.attempts.length === 1 && activity.status === 'completed'));
  const phoneEvents = readdirSync(f.home).filter(name => /^phone-receipt-\d+\.json$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
    .map(name => JSON.parse(readFileSync(join(f.home, name), 'utf8')).last_event);
  assert.deepEqual(phoneEvents.map(event => [event.activity, event.item]),
    ids.slice(0, 2).flatMap(id => [['qualification', id], ['collection', id]]));
  assert.ok(phoneEvents.every(event => event.event_type === 'ACTIVITY_STARTED'));
  const events = [...phoneEvents, ...f.persistedEvents];
  assert.ok(events.every((event, i) => i === 0 || event.cursor >= events[i - 1].cursor));
  assert.equal(f.modelCalls.length, 2); assert.ok(f.modelCalls.every(call => call.event.activity === 'scoring'));
  assert.ok(f.calls.every(call => call.event.activity === 'delivery'));
  assert.equal(f.pool.size, 2); assert.equal(f.leads.size, 2);
  assert.equal(f.videos.size, 2);
  for (const [index, video] of f.receipt.outputs.videos.entries()) {
    const record = f.videos.get(video.video_pool_record_id);
    assert.ok(record, '视频必须保留真实视频表 record_id');
    assert.deepEqual(record.fields, {
      视频ID: ids[index], 视频链接: { link: 'https://v.douyin.com/fixture/', text: 'https://v.douyin.com/fixture/' },
      '视频标题/文案': `AI课程${index + 1}`, 命中关键词: 'AI 考证', 评论数: 1,
      发现时间: record.fields.发现时间, 处理状态: '评论已采', 采收批次: f.input.run_tag,
    });
    assert.match(record.fields.发现时间, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}\(UTC\+8\)$/);
  }
  const comments = f.receipt.outputs.comments;
  assert.deepEqual(comments.map(row => row.id), ['pool-1', 'pool-2']);
  assert.deepEqual(comments.map(row => row.source_id), ids.slice(0, 2).map(id => `${id}:1`));
  for (const [i, comment] of comments.entries()) {
    assert.equal(comment.verdict.grade, 'A'); assert.equal(comment.delivery_status, 'completed');
    assert.equal(f.pool.get(comment.id).fields.处理状态, '已分拣');
    assert.equal(f.pool.get(comment.id).fields.进入最终线索, true);
    assert.equal(f.leads.get(`lead-${i + 1}`).fields.原始评论, `如何报名${i + 1}`);
    assert.equal(f.leads.get(`lead-${i + 1}`).fields.抖音号, `10${i + 1}`);
  }
});

test('跨仓CLI：仅修改bindings省略评分，两视频仍落池，零模型/线索访问', optIn, async t => {
  const f = await run(t, ['matched', 'matched'], true);
  assert.equal(f.output.code, 0, f.output.stderr + '\n' + f.output.stdout); assert.equal(f.receipt.status, 'completed');
  videoOrder(f.receipt, ids.slice(0, 2));
  assert.ok(f.receipt.activities.every(activity => activity.key !== 'scoring'));
  assert.equal(f.modelCalls.length, 0); assert.equal(f.leads.size, 0); assert.equal(f.pool.size, 2);
  assert.ok(f.calls.every(call => !call.url.includes(`/tables/${route.lead}/`)));
  assert.deepEqual(f.receipt.outputs.comments.map(row => row.id), ['pool-1', 'pool-2']);
  assert.ok(f.receipt.outputs.comments.every(row => row.verdict === undefined && row.delivery_status === 'unscored'));
  assert.ok([...f.pool.values()].every(record => record.fields.处理状态 === '待分拣'));
});

test('跨仓CLI：rejected/pending真实资格结果阻止采集，已采matched评论继续配送', optIn, async t => {
  const f = await run(t, ['matched', 'rejected', 'pending']);
  assert.equal(f.output.code, 2, f.output.stderr + '\n' + f.output.stdout); assert.equal(f.receipt.status, 'partial');
  videoOrder(f.receipt, ids);
  for (const id of ids.slice(1)) {
    const activity = f.receipt.activities.find(row => row.key === 'collection' && row.item === id);
    assert.equal(activity.status, 'skipped'); assert.equal(activity.attempts.length, 0);
  }
  assert.equal(f.receipt.outputs.videos[1].judgment_status, 'rejected');
  assert.equal(f.receipt.outputs.videos[2].judgment_status, 'pending');
  assert.equal(f.pool.size, 1); assert.equal(f.leads.size, 1); assert.equal(f.modelCalls.length, 1);
  assert.equal(f.videos.size, 1);
  assert.equal(f.videos.get(f.receipt.outputs.videos[0].video_pool_record_id).fields.视频ID, ids[0]);
  assert.ok(![...f.videos.values()].some(record => ids.slice(1).includes(record.fields.视频ID)));
  const phone = readFileSync(join(f.home, 'calls'), 'utf8');
  assert.equal((phone.match(/adb collect-comments/g) || []).length, 1);
});

test('跨仓CLI：真实采集预算边界保留首条评论，继续评分落池，未采行不得结算', optIn, async t => {
  const f = await fixture(t, ['matched'], 'budget');
  const contract = await compile(f);
  contract.activities.find(activity => activity.key === 'collection').budget.max_duration_s = 5;
  const output = await cli(resolve(runtime), ['--cwd', service, '--receipt', f.receiptPath], {
    cwd: repo, env: f.env, input: { contract, input: f.input },
  });
  assert.equal(f.errors.length, 0, f.errors.map(error => error.stack).join('\n'));
  assert.equal(output.code, 2, output.stderr + '\n' + output.stdout);
  const receipt = JSON.parse(readFileSync(f.receiptPath, 'utf8'));
  assert.deepEqual(receipt, JSON.parse(output.stdout)); assert.equal(receipt.status, 'partial');
  const attempt = receipt.activities.find(activity => activity.key === 'collection').attempts[0];
  assert.equal(attempt.status, 'partial'); assert.equal(attempt.reason_code, 'budget_exceeded');
  assert.equal(attempt.outputs.comments.length, 1); assert.equal(attempt.metrics.videos_processed, 0);
  assert.equal(f.pool.size, 1); assert.equal(f.leads.size, 1); assert.equal(f.modelCalls.length, 1);
  assert.equal(receipt.outputs.comments[0].delivery_status, 'completed');
  assert.equal(f.leads.get('lead-1').fields.原始评论, '如何报名1');
  const phone = readFileSync(join(f.home, 'calls'), 'utf8');
  assert.match(phone, /lock-release cecelia-cli-smoke/);
  assert.doesNotMatch(phone, /commenter-identity 30 40|qualify-video.js collected/);
});

test('跨仓CLI：父取消保留真实采集产物和释放锁，持久receipt可经编译恢复链落池', optIn, async t => {
  const f = await fixture(t, ['matched'], 'cancel');
  const contract = await compile(f);
  const interrupted = await cli(resolve(runtime), ['--cwd', service, '--receipt', f.receiptPath], {
    cwd: repo, env: f.env, input: { contract, input: f.input }, cancelWhen: join(f.home, 'cancel-ready'),
  });
  assert.equal(interrupted.signal, null, interrupted.stderr);
  assert.ok([1, 2].includes(interrupted.code), interrupted.stdout);
  const saved = JSON.parse(readFileSync(f.receiptPath, 'utf8'));
  assert.deepEqual(saved, JSON.parse(interrupted.stdout)); assert.equal(saved.status, 'partial');
  const collection = saved.activities.find(activity => activity.key === 'collection');
  assert.equal(collection.status, 'partial'); assert.equal(collection.attempts[0].outputs.comments.length, 1);
  assert.equal(collection.attempts[0].metrics.videos_processed, 0);
  assert.equal(saved.outputs.comments.length, 1); assert.equal(saved.outputs.comments[0].fields.评论原文, '如何报名1');
  assert.ok(saved.activities.every(activity => !['scoring', 'delivery'].includes(activity.key)));
  assert.equal(f.pool.size, 0); assert.equal(f.modelCalls.length, 0);
  const phone = readFileSync(join(f.home, 'calls'), 'utf8');
  assert.match(phone, /lock-release cecelia-cli-smoke/);
  assert.doesNotMatch(phone, /commenter-identity 30 40|qualify-video.js collected/);
  const resumeContract = await compile(f, false, true);
  const output = await cli(resolve(runtime), ['--cwd', service, '--receipt', f.receiptPath], {
    cwd: repo, env: f.env, input: { contract: resumeContract, input: { ...f.input, comments: saved.outputs.comments } },
  });
  assert.equal(f.errors.length, 0, f.errors.map(error => error.stack).join('\n'));
  assert.equal(output.code, 0, output.stderr + '\n' + output.stdout);
  const restored = JSON.parse(readFileSync(f.receiptPath, 'utf8'));
  assert.deepEqual(restored, JSON.parse(output.stdout)); assert.equal(restored.status, 'completed');
  assert.deepEqual(restored.activities.map(activity => activity.key), ['scoring', 'delivery']);
  assert.equal(restored.outputs.comments[0].source_id, `${ids[0]}:1`);
  assert.equal(restored.outputs.comments[0].id, 'pool-1');
  assert.equal(f.pool.size, 1); assert.equal(f.leads.size, 1); assert.equal(f.modelCalls.length, 1);
  assert.equal(f.pool.get('pool-1').fields.处理状态, '已分拣');
  assert.equal(f.leads.get('lead-1').fields.原始评论, '如何报名1');
});
