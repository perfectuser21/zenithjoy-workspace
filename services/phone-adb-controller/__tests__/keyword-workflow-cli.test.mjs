import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { keywordFixture, ids, route, words } from './keyword-workflow-cli-fixture.mjs';

const opts = { timeout: 60000 };
const diagnostic = r => JSON.stringify({status:r.status,activities:r.activities.map(a=>({key:a.key,item:a.item,status:a.status,attempts:a.attempts.map(x=>({status:x.status,reason:x.reason_code,stderr:x.runtime?.stderr}))})),artifacts:Object.fromEntries(Object.entries(r.outputs.workflow_artifacts||{}).map(([k,v])=>[k,{status:v.status,probe_error:v.probe_error,probes:v.probes?.flatMap(p=>p.probes.filter(x=>x.pass!==true))}]))});
function lockReleased(f) {
  const state = f.read('phone-state.json');
  assert.equal(state.owner, null);
  assert.deepEqual(state.owners, [null, f.input.run_tag, null], '一次根获锁，子活动借锁，根最终释放');
  assert.equal((f.log().match(/adb lock-acquire /g) || []).length, 1);
  assert.equal((f.log().match(/adb lock-release /g) || []).length, 1);
}
function artifact(receipt, stage) { return receipt.outputs.workflow_artifacts[stage]; }
function probes(receipt, stage) { return artifact(receipt, stage).probes.flatMap(report => report.probes); }

// 真实compiler→keyword runner→Cec CLI→wrapper→native→gateway probes，仅运输fixture。
test('整批CLI：两词七活动、真实资格与读回、历史和批内去重、根持锁至清理', opts, async t => {
  const f = await keywordFixture(t);
  const { output, receipt } = await f.run();
  assert.equal(output.code, 0, diagnostic(receipt)); assert.equal(receipt.status, 'completed');
  assert.deepEqual(receipt.activities.map(row => row.key), ['preflight', 'discovery', 'qualification', 'collection', 'qualification', 'collection', 'scoring', 'delivery', 'cleanup']);
  assert.ok(receipt.activities.every(row => row.status === 'completed'));
  assert.deepEqual(receipt.outputs.videos.map(row => row.video_id), ids.slice(0, 2));
  assert.equal(artifact(receipt, 'discovery').metrics.seen_skipped, 1);
  assert.equal(artifact(receipt, 'discovery').metrics.duplicates_skipped, 1);
  const sql = f.events('sql-events.jsonl');
  assert.deepEqual(sql.filter(row => row.key === 'disc_candidates_persisted').map(row => [row.values[1], row.answer]), words.map(word => [word, 1]));
  assert.ok(sql.some(row => row.key === 'qual_none_pending' && row.answer === 0));
  for (const row of Object.values(f.read('pg.json').videos)) {
    assert.equal(row.judgment_status, 'matched'); assert.equal(row.process_status, '评论已采');assert.ok(row.judgment_reason);
  }
  assert.equal(f.modelCalls.length, 2); assert.equal(f.pool.size, 2); assert.equal(f.leads.size, 2);
  assert.deepEqual(receipt.outputs.comments.map(row => row.id), ['pool-1', 'pool-2']);
  assert.deepEqual(receipt.outputs.comments.map(row => row.source_id), ids.slice(0, 2).map(id => id + ':1'));
  assert.ok(receipt.outputs.comments.every(row => row.verdict.grade === 'A' && row.delivery_status === 'completed'));
  assert.ok(f.modelCalls.every(call => call.event.activity === 'scoring'));
  assert.ok([...f.pool.values()].every(row => row.fields.处理状态 === '已分拣'));
  assert.ok(f.events('phone-events.jsonl').every(event => event.event_type === 'ACTIVITY_STARTED'));
  assert.ok(f.events('ssh-events.jsonl').some(row => row.command.includes('workflow-probe.js')));
  lockReleased(f);
});

test('整批CLI：只删评分bindings仍落原始待分拣池、无模型与线索访问', opts, async t => {
  const f = await keywordFixture(t, ['matched', 'matched'], { withoutScore: true });
  const { output, receipt } = await f.run();
  assert.equal(output.code, 0, diagnostic(receipt)); assert.equal(receipt.status, 'completed');
  assert.ok(receipt.activities.every(row => row.key !== 'scoring'));
  assert.equal(f.modelCalls.length, 0); assert.equal(f.pool.size, 2); assert.equal(f.leads.size, 0);
  assert.ok(f.calls.every(call => !call.url.includes('/tables/' + route.lead + '/')));
  assert.ok([...f.pool.values()].every(row => row.fields.处理状态 === '待分拣'));
  assert.ok(receipt.outputs.comments.every(row => row.delivery_status === 'unscored' && row.verdict === undefined));
  lockReleased(f);
});

test('整批CLI：pending全批资格探针判红，已采matched仍完成配送清理', opts, async t => {
  const f = await keywordFixture(t, ['matched', 'pending']);
  const { output, receipt } = await f.run();
  assert.equal(output.code, 2, diagnostic(receipt)); assert.equal(receipt.status, 'partial');
  assert.equal(f.pool.size, 1); assert.equal(f.leads.size, 1);assert.equal(f.modelCalls.length, 1);
  const pending = probes(receipt, 'qualification').filter(row => row.key === 'qual_none_pending' && row.status !== 'deferred');
  assert.ok(pending.some(row => row.observed === 1 && row.pass === false));
  assert.equal(f.read('pg.json').videos[ids[1]].judgment_status, 'pending');
  assert.equal(receipt.outputs.comments[0].delivery_status, 'completed');
  assert.equal(receipt.activities.find(row => row.key === 'collection' && row.item === ids[1]).status, 'skipped');
  lockReleased(f);
});

test('整批CLI：父TERM在手机动作内到达，首条原评论保留至finalize配送并根放锁', opts, async t => {
  const f = await keywordFixture(t, ['matched'], { mode: 'cancel', singleWord: true });
  const { output, receipt } = await f.run({ cancelWhen: join(f.home, 'cancel-ready') });
  assert.equal(output.code, 2, diagnostic(receipt)); assert.equal(receipt.status, 'partial');
  assert.equal(receipt.outputs.comments.length, 1);
  assert.equal(receipt.outputs.comments[0].fields.评论原文, '如何报名1');
  assert.equal(f.pool.size, 1);assert.equal(f.modelCalls.length, 0);assert.equal(f.leads.size, 0);
  assert.ok(receipt.activities.some(row => row.key === 'delivery'));
  assert.ok(receipt.activities.some(row => row.key === 'cleanup'));
  assert.match(f.log(), /native-action-completed commenter-card-link/);
  assert.doesNotMatch(f.log(), /commenter-identity 30 40|qualify-video.js collected/);
  lockReleased(f);
});

test('整批CLI：逐词归位率不能被另一词无重搜稀释', opts, async t => {
  const f = await keywordFixture(t, ['matched', 'matched'], { rescanWords: [words[0]] });
  const { output, receipt } = await f.run();
  assert.equal(output.code, 2, diagnostic(receipt));
  const reports = artifact(receipt, 'collection').probes.filter(report => report.scope.word);
  const first = reports.filter(report => report.scope.word === words[0]).flatMap(report => report.probes);
  assert.ok(first.some(row => row.key === 'coll_rescan_rate' && row.observed === 1 && row.pass === false));
  assert.equal(f.pool.size, 2); lockReleased(f);
});


for (const budgetSource of ['run_budget_s', 'WF_RUN_MAX_SECONDS']) {
  test(`整批CLI：${budgetSource}截止软取消评分，原评论仍finalize落池并清理`, opts, async t => {
    const f = await keywordFixture(t, ['matched'], { singleWord: true, modelDelayMs: 20000 });
    if (budgetSource === 'run_budget_s') f.input.run_budget_s = 16;
    else f.env.WF_RUN_MAX_SECONDS = '16';
    const { output, receipt } = await f.run();
    assert.ok(existsSync(join(f.home, 'model-ready')), '截止应发生在真实模型请求之后');
    assert.equal(f.modelCalls.length, 1);
    assert.equal(output.code, 2, diagnostic(receipt));assert.equal(receipt.status, 'partial');
    assert.notEqual(receipt.activities.find(row => row.key === 'scoring').status, 'completed', '整批截止必须实际中止评分活动');
    assert.equal(receipt.outputs.comments.length, 1, '评分中止不能覆盖既有原评论');
    assert.equal(receipt.outputs.comments[0].verdict, undefined);
    assert.equal(receipt.outputs.comments[0].fields.评论原文, '如何报名1');
    assert.equal(f.pool.size, 1);assert.equal(f.leads.size, 0);
    assert.equal([...f.pool.values()][0].fields.处理状态, '待分拣');
    assert.ok(receipt.activities.some(row => row.key === 'delivery'));
    assert.ok(receipt.activities.some(row => row.key === 'cleanup'));
    lockReleased(f);
  });
}
