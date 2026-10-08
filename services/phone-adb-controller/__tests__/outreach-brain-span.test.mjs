// services/phone-adb-controller/__tests__/outreach-brain-span.test.mjs
//
// 10-07 起 outreach-tick 每轮都打 `brain callback skipped: missing WFR_BRAIN_TASK_ID` 和
// `WFR_RUNTIME_ERROR The "paths[0]" argument must be of type string. Received undefined`：
// 触达 tick 不是一次绑定了发布版本的运行，账本写工件时照采收那样发回调/发绑定 span，两样都必然失败，触达结果回不到 Brain。
// 修后：触达 tick 不走绑定回调，改发一条不需要绑定的 Activity span（发私信，挂「抖音·线索触达」流程），
// Brain 的 spans 触发器据此自动建/汇总 runs 行；每轮的 送达/受限/失败 数量在 span evidence 里。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTREACH_WORKFLOW = 'b1000000-0000-4000-8000-000000000104';
const SEND_DM_ACTIVITY = 'bb4fdc47-a543-4374-9078-8e78151b69c6';

function outreachSpan(counts, extraEnv = {}) {
  const home = mkdtempSync(join(tmpdir(), 'outspan-'));
  const r = spawnSync(process.execPath, [join(SRC, 'runtime-receipts.mjs'), 'outreach-span', 'social-keyword-leadgen-outreach-out10081430', '2026-10-08T06:30:00Z', JSON.stringify(counts)],
    { encoding: 'utf8', env: { ...process.env, WFR_HOME: home, BRAIN_URL: 'http://127.0.0.1:9', BRAIN_INTERNAL_TOKEN: '', WFR_HOSTKEY: 'xian-m4', WFR_PROFILE: 'jinoshengyuan-work', ...extraEnv } });
  const dir = join(home, 'outreach-outbox', 'outbox');
  const events = readdirSync(dir).map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')));
  return { r, events };
}

test('每轮触达发一条 Activity span：发私信、挂抖音·线索触达，evidence 带 送达/受限/失败 数', () => {
  const { r, events } = outreachSpan({ orders_picked: 5, delivered: 3, restricted: 1, failed: 1, requeued: 0 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(events.length, 1);
  const [ev] = events;
  assert.equal(ev.endpoint, 'http://127.0.0.1:9/api/brain/spans');
  assert.equal(ev.state, 'pending', '没 token 时留在 outbox 待重发，不丢');
  const [span] = ev.body;
  assert.equal(span.run_id, 'social-keyword-leadgen-outreach-out10081430');
  assert.equal(span.occurrence_key, 'social-keyword-leadgen-outreach-out10081430:send_dm');
  assert.equal(span.workflow_id, OUTREACH_WORKFLOW);
  assert.equal(span.activity_id, SEND_DM_ACTIVITY);
  assert.equal(span.executor_kind, 'code');
  assert.equal(span.executor_id, 'xian-m4');
  assert.equal(span.started_at, '2026-10-08T06:30:00Z');
  assert.ok(span.ended_at);
  assert.equal(span.outcome, 'pass');
  assert.deepEqual(span.evidence, { profile: 'jinoshengyuan-work', orders_picked: 5, delivered: 3, restricted: 1, failed: 1, requeued: 0 });
  assert.equal(span.identity_protocol, undefined, '不需要发布绑定的旧协议 span');
});

test('没取到单 → skipped；只有失败没有送达/受限 → fail', () => {
  assert.equal(outreachSpan({ orders_picked: 0, delivered: 0, restricted: 0, failed: 0, requeued: 0 }).events[0].body[0].outcome, 'skipped');
  assert.equal(outreachSpan({ orders_picked: 2, delivered: 0, restricted: 0, failed: 2, requeued: 0 }).events[0].body[0].outcome, 'fail');
});

test('账本 outreach-run 不再走绑定回调/绑定 span，改发 outreach-span；触达脚本统计 送达/受限/失败 并传给账本', () => {
  const wfr = readFileSync(join(SRC, 'workflow-result.sh'), 'utf8');
  const block = wfr.slice(wfr.indexOf('  outreach-run)'), wfr.indexOf('  finalize)'));
  assert.match(block, /WFR_NO_BINDING=1/);
  assert.match(block, /outreach-span "\$WFR_RUN_ID-\$\{HOSTKEY:-unknown\}"/);
  assert.match(wfr, /brain_post\(\)\{[\s\S]*?\[\[ "\$\{WFR_NO_BINDING:-0\}" == 1 \]\] && return 0/);
  assert.match(wfr, /span_post\(\)\{[\s\S]*?\[\[ "\$\{WFR_NO_BINDING:-0\}" == 1 \]\] && return 0/);
  const tick = readFileSync(join(SRC, 'outreach-tick.sh'), 'utf8');
  assert.match(tick, /\[\[ "\$ORDER_RESULT" == "sent" \]\] && DELIVERED=\$\(\( DELIVERED \+ 1 \)\)/);
  assert.match(tick, /restricted\|rate_limited\) RESTRICTED=/);
  assert.match(tick, /failed\|device_ui\) FAILED=/);
  assert.match(tick, /\\"delivered\\":\$DELIVERED,\\"restricted\\":\$RESTRICTED,\\"failed\\":\$FAILED/);
});
