import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { runProbes } from '../verify-step.mjs';
const require = createRequire(import.meta.url);
const { loadChecks } = require('../checks/probes-lib.js');
const { runVideoActivity } = require('../video-activities.js');
const entry = new URL('../video-activity.js', import.meta.url).pathname;
const input = () => ({ run_tag: 'collection-return', line_key: 'jinuo', return_to_results: true,
  device: { profile: 'jinoshengyuan-work', serial: 'fixture-serial', lock_holder: 'collection-return' },
  video: { video_id: '7412345678901234567', title: 'AI课程', keyword: 'AI 考证', judgment_status: 'matched' },
  budget: { max_duration_s: 60 } });

function fixture(t, extra = {}) {
  const home = mkdtempSync(join(tmpdir(), 'collection-return-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const bin = join(home, '.local', 'bin'); mkdirSync(bin, { recursive: true });
  const scripts = {
    'douyin-phone-adb': `#!/bin/sh
shift 2
cmd="$1"; shift
printf '%s\\t%s\\n' "$cmd" "$*" >> "$HOME/calls"
case "$cmd" in
 preflight) echo serial=fixture-serial;;
 lock-status) [ "$BORROWED" = 1 ] && echo 'lock=held owner=collection-return stale=false' || echo lock=free;;
 lock-acquire) echo lock=acquired;;
 lock-refresh) echo lock=refreshed;;
 lock-release) echo lock=released;;
 open-video) echo video_opened=1;;
 current-video-link) printf 'video_id=7412345678901234567\\nshort_url=https://v.douyin.com/fixture/\\n';;
 open-comments) printf 'comments_opened=1\\ncomment_count=1\\n';;
 collect-comments) printf '小李\\t如何报名\\t今天\\t北京\\tpersonal\\ttap=10 20\\tb64=AAA\\nexhausted=1\\n';;
 commenter-identity) printf 'nickname=小李\\ndouyin_id=123\\naccount_type=personal\\n';;
 commenter-card-link) [ "$WAIT_CARD" = 1 ] && /bin/sleep 1; echo profile_url=https://www.douyin.com/user/fixture;;
 back-to-results)
   echo '归位动作日志 recovered_via=research' >&2
   [ "$RETURN_MODE" = fail ] && { echo back_to_results=0; exit 1; }
   [ "$RETURN_MODE" = missing ] && exit 0
   if [ "$RETURN_MODE" = research ]; then echo 'back_to_results=1 backs=4 recovered_via=research'
   else echo 'back_to_results=1 backs=2'; fi
   ;;
esac
exit 0`,
    ssh: `#!/bin/sh
printf 'ssh\\t%s\\n' "$*" >> "$HOME/calls"
case "$*" in
 *'qualify-video.js discover'*) echo 'QUAL_DISCOVER {"status":"matched","has_transcript":true}';;
 *'qualify-video.js collected'*)
   [ "$STOP_AFTER_COLLECTION" = 1 ] && touch "$WF_STOP_FILE"
   [ "$BUDGET_AFTER_COLLECTION" = 1 ] && echo 1061 > "$HOME/now"
   echo 'QUAL_COLLECTED {"updated":1}';;
esac`,
    scp: '#!/bin/sh\nexit 91',
    date: '#!/bin/sh\n[ "$1" = +%s ] && { cat "$HOME/now"; exit; }\nexec /bin/date "$@"',
  };
  for (const [name, code] of Object.entries(scripts)) {
    writeFileSync(join(bin, name), code); chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(join(home, 'now'), '1000');
  const env = { HOME: home, PATH: [bin, dirname(process.execPath), '/usr/bin', '/bin'].join(':'),
    HARVEST_KEYWORD_TESTING: '1', WF_BOUNDED_POLL: '0.05', WF_STOP_FILE: join(home, 'stop'), ...extra };
  const calls = () => existsSync(join(home, 'calls')) ? readFileSync(join(home, 'calls'), 'utf8') : '';
  return { home, env, calls };
}
function run(t, request = input(), extra = {}) {
  const f = fixture(t, extra);
  const result = spawnSync(process.execPath, [entry, 'collection'], { env: f.env, encoding: 'utf8',
    input: JSON.stringify(request), timeout: 15000 });
  assert.ok(result.stdout.trim(), result.stderr);
  return { ...result, stderr: result.stderr + '\n' + result.stdout, output: JSON.parse(result.stdout), calls: f.calls() };
}
async function probe(metrics) {
  const { doc } = loadChecks(new URL('../checks/social-keyword-leadgen.yaml', import.meta.url).pathname,
    new URL('../checks/schema.json', import.meta.url).pathname);
  return runProbes({ doc: { ...doc, probes: doc.probes.filter(p => p.key === 'coll_rescan_rate') },
    stage: 'collection', params: { metrics } });
}

test('真实采完后持锁归位核关键词，正常成功率0且stdout之外日志不冒充重搜', async t => {
  const r = run(t);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.calls, /back-to-results\t4 AI 考证 collection-return-v1-return/);
  assert.ok(r.calls.indexOf('back-to-results') < r.calls.indexOf('lock-release'));
  assert.equal(r.output.metrics.returns_attempted, 1);
  assert.equal(r.output.metrics.rescan_count, 0);
  assert.equal(r.output.metrics.rescan_rate, 0);
  assert.deepEqual(r.output.evidence[0].return_to_results,
    { attempted: 1, confirmed: 1, rescans: 0, reason_code: null });
  assert.equal((await probe(r.output.metrics)).gate.verdict, 'pass');
});

test('真实recovered_via=research记1并通过现有SSOT探针报红，直接ID链不扫卡片', async t => {
  const r = run(t, input(), { RETURN_MODE: 'research', BORROWED: '1' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.output.metrics.rescan_count, 1);
  assert.equal(r.output.metrics.rescan_rate, 1);
  assert.equal(r.output.evidence[0].return_to_results.rescans, 1);
  assert.doesNotMatch(r.calls, /search-video|lock-release|lock-acquire/);
  const result = await probe(r.output.metrics);
  assert.equal(result.gate.verdict, 'fail');
  assert.deepEqual(result.gate.failed, ['coll_rescan_rate']);
});

test('归位失败或缺成功标记保留已采评论，指标缺失使探针unknown', async t => {
  for (const mode of ['fail', 'missing']) {
    const r = run(t, input(), { RETURN_MODE: mode });
    assert.equal(r.status, 2, r.stderr);
    assert.equal(r.output.status, 'partial');
    assert.equal(r.output.reason_code, 'return_to_results_unconfirmed');
    assert.equal(r.output.outputs.comments[0].fields.评论原文, '如何报名');
    assert.equal(r.output.metrics.videos_processed, 0);
    assert.equal(r.output.metrics.returns_attempted, 1);
    assert.equal(r.output.metrics.rescan_rate, undefined);
    assert.equal(r.output.metrics.rescan_count, undefined);
    assert.equal(r.output.evidence[0].return_to_results.confirmed, 0);
    assert.match(r.calls, /lock-release/);
    assert.equal((await probe(r.output.metrics)).gate.verdict, 'unknown');
  }
});

test('可选归位默认关闭，旧入口没有额外动作或虚构过程指标', t => {
  for (const flag of [undefined, false]) {
    const request = input();
    if (flag === undefined) delete request.return_to_results;
    else request.return_to_results = flag;
    const r = run(t, request);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.calls, /back-to-results/);
    assert.equal(r.output.metrics.returns_attempted, undefined);
    assert.equal(r.output.metrics.rescan_rate, undefined);
    assert.equal(r.output.evidence[0].return_to_results, undefined);
  }
});

test('采完后预算或Commander到点不新开归位，评论保留且探针unknown', async t => {
  for (const extra of [{ BUDGET_AFTER_COLLECTION: '1' }, { STOP_AFTER_COLLECTION: '1' }]) {
    const r = run(t, input(), extra);
    assert.equal(r.status, 2, r.stderr);
    assert.equal(r.output.outputs.comments.length, 1);
    assert.equal(r.output.metrics.returns_attempted, 0);
    assert.equal(r.output.metrics.rescan_rate, undefined);
    assert.equal(r.output.evidence[0].return_to_results.rescans, null);
    assert.equal(r.output.reason_code, extra.BUDGET_AFTER_COLLECTION ? 'budget_exceeded' : 'commander_stop');
    assert.doesNotMatch(r.calls, /back-to-results/);
    assert.match(r.calls, /lock-release/);
    assert.equal((await probe(r.output.metrics)).gate.verdict, 'unknown');
  }
});

test('return_to_results非法flag在任何外调前拒绝', t => {
  for (const flag of ['true', 1, null, {}]) {
    const r = run(t, { ...input(), return_to_results: flag });
    assert.equal(r.status, 1);
    assert.equal(r.output.reason_code, 'invalid_input');
    assert.equal(r.calls, '');
  }
});

test('启用归位缺真实关键词在外调前拒绝，默认关闭仍兼容无关键词输入', async () => {
  for (const keyword of [undefined, null, 42, '', '  ']) {
    let calls = 0;
    await assert.rejects(runVideoActivity('collection', { ...input(), video: { ...input().video, keyword } },
      { run: async () => { calls++; return { stdout: 'ACTIVITY_STATUS\tcompleted\t\n' }; } }), /关键词/);
    assert.equal(calls, 0);
  }
  const result = await runVideoActivity('collection', { ...input(), return_to_results: false,
    video: { ...input().video, keyword: undefined } },
  { run: async () => ({ stdout: 'ACTIVITY_STATUS\tcompleted\t\n' }) });
  assert.equal(result.status, 'completed');
});

test('采集stdout缺归位回执不能凭completed或stderr伪造0，已采JSON仍保留', async () => {
  const result = await runVideoActivity('collection', input(), { run: async () => ({
    stdout: 'LEAD\t小李\t123\tpersonal\t如何报名\t今天\t北京\tAI课程\tAI 考证\t\t\thttps://v.douyin.com/fixture/\nACTIVITY_STATUS\tcompleted\t\n',
    stderr: 'ACTIVITY_RETURN\t1\t1\t0\t\n',
  }) });
  assert.equal(result.status, 'partial');
  assert.equal(result.reason_code, 'return_to_results_unconfirmed');
  assert.equal(result.outputs.comments.length, 1);
  assert.equal(result.metrics.rescan_rate, undefined);
  assert.equal(result.metrics.returns_attempted, undefined);
  assert.equal(result.evidence[0].return_to_results.attempted, null);
  assert.equal((await probe(result.metrics)).gate.verdict, 'unknown');
});

test('根进程TERM等当前手机动作完毕再收工，保留评论并拒绝新开归位', async t => {
  const f = fixture(t, { WAIT_CARD: '1' });
  const child = spawn(process.execPath, [entry, 'collection'], { env: f.env, detached: true,
    stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') throw e; } });
  let stdout = '', stderr = '';
  child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
  const done = new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal })));
  child.stdin.end(JSON.stringify(input()));
  const deadline = Date.now() + 10000;
  while (!f.calls().includes('commenter-card-link') && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
  assert.match(f.calls(), /commenter-card-link/, stderr);
  child.kill('SIGTERM');
  const result = await done;
  assert.equal(result.signal, null);
  assert.equal(result.code, 2, stderr);
  const output = JSON.parse(stdout);
  assert.equal(output.outputs.comments.length, 1);
  assert.equal(output.metrics.returns_attempted, 0);
  assert.equal(output.metrics.rescan_rate, undefined);
  assert.equal(output.evidence[0].return_to_results.confirmed, 0);
  assert.doesNotMatch(f.calls(), /back-to-results/);
  assert.match(f.calls(), /lock-release/);
});
