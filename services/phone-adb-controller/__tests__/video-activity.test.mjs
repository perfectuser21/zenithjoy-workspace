import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const entry = new URL('../video-activity.js', import.meta.url).pathname;
const vid = '7412345678901234567';
const input = (status = 'matched') => ({ run_tag: 'phase3-smoke', line_key: 'jinuo',
  device: { profile: 'jinoshengyuan-work', serial: 'fixture-serial', lock_holder: 'phase3-smoke' },
  video: { video_id: vid, video_url: 'https://v.douyin.com/fixture/', title: 'AI课程',
    keyword: 'AI 考证', duration: '00:30', judgment_status: status }, budget: { max_duration_s: 60 } });
const adb = `#!/bin/sh
shift 2
cmd="$1"; shift
printf 'adb %s %s\\n' "$cmd" "$*" >> "$HOME/calls"
if [ "$cmd" = "$ADVANCE_ON" ]; then n=$(cat "$HOME/now"); echo $((n + ADVANCE_BY)) > "$HOME/now"; [ "$DYNAMIC_CLOCK" = 1 ] && /bin/date +%s > "$HOME/clock-start"; fi
case "$cmd" in
 preflight) printf 'serial=%s\\nstate=device\\n' "\${TARGET_SERIAL:-fixture-serial}";;
 lock-status) [ -z "$BORROWED_OWNER" ] && echo 'lock=free' || echo "lock=held owner=$BORROWED_OWNER stale=false";;
 lock-acquire) [ "$LOCK_FAIL" = 1 ] && exit 2; echo "lock=acquired owner=$1";;
 lock-refresh) echo "lock=refreshed owner=$1";;
 lock-release) echo "lock=released owner=$1";;
 open-video) echo 'video_opened=1';;
 current-video-link) [ "$LINK_EMPTY" = 1 ] && exit 0; [ "$LINK_MULTIPLE" = 1 ] && echo video_id=7412345678901234568; printf 'video_id=%s\\nshort_url=https://v.douyin.com/fixture/\\n' "\${CURRENT_VID:-7412345678901234567}"; exit "\${LINK_RC:-0}";;
 open-comments) [ "$OPEN_FAIL" = 1 ] && exit 2; printf 'comments_opened=1\\ncomment_count=1\\n';;
 collect-comments) [ "$OWN_FIRST" = 1 ] && printf '躺赢AI学姐\\t自有评论\\t今天\\t北京\\tpersonal\\ttap=30 40\\tb64=BBB\\n'; printf '小李\\t如何报名\\t今天\\t北京\\tpersonal\\ttap=10 20\\tb64=AAA\\nexhausted=1\\n';;
 commenter-identity) if [ "$1" = 30 ]; then printf 'nickname=躺赢AI学姐\\ndouyin_id=langzi63485\\naccount_type=personal\\n'; else printf 'nickname=小李\\ndouyin_id=123\\naccount_type=personal\\n'; fi;;
 commenter-card-link) echo 'profile_url=https://www.douyin.com/user/fixture';;
 record-stop) echo 'record_stopped duration_seconds=15 mean_volume_db=-30';;
 record-extract-audio) echo 'audio_extracted path=/tmp/fixture.wav';;
esac
exit 0`;
const ssh = `#!/bin/sh
printf 'ssh %s\\n' "$*" >> "$HOME/calls"
case "$*" in
 *'qualify-video.js discover'*) printf 'QUAL_DISCOVER {"status":"%s","has_transcript":%s}\\n' "\${DISCOVER_STATUS:-matched}" "\${HAS_TRANSCRIPT:-true}";;
 *'qualify-video.js judge'*) [ -n "$JUDGE_SLEEP" ] && /bin/sleep "$JUDGE_SLEEP"; printf 'QUAL_RESULT {"verdict":"%s","kind":"judged"}\\n' "\${JUDGE_STATUS:-matched}";;
 *'qualify-video.js collected'*) echo 'QUAL_COLLECTED {"updated":1}';;
esac`;
const scp = `#!/bin/sh
printf 'scp started\\n' >> "$HOME/calls"
[ -n "$SCP_SLEEP" ] && /bin/sleep "$SCP_SLEEP"
printf 'scp ended\\n' >> "$HOME/calls"
exit 0`;
function run(action, request = input(), extra = {}) {
  const home = mkdtempSync(join(tmpdir(), 'video-activity-'));
  const bin = join(home, '.local', 'bin'); mkdirSync(bin, { recursive: true });
  for (const [name, code] of [['douyin-phone-adb', adb], ['ssh', ssh], ['scp', scp], ['date', `#!/bin/sh\n[ "$1" = +%s ] && { n=$(cat "$HOME/now"); [ "$DYNAMIC_CLOCK" = 1 ] && [ -f "$HOME/clock-start" ] && n=$(( $(/bin/date +%s) - $(cat "$HOME/clock-start") + n )); echo "$n"; exit; }\nexec /bin/date "$@"`]]) {
    if (name === 'date' && extra.REAL_CLOCK === '1') continue;
    writeFileSync(join(bin, name), code); chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(join(home, 'now'), '1000');
  const result = spawnSync(process.execPath, [entry, action], { encoding: 'utf8', input: JSON.stringify(request),
    timeout: 20000, env: { ...process.env, HOME: home, PATH: bin + ':' + process.env.PATH,
      HARVEST_KEYWORD_TESTING: '1', WF_BOUNDED_POLL: '0.05', ...extra } });
  const calls = existsSync(join(home, 'calls')) ? readFileSync(join(home, 'calls'), 'utf8') : '';
  return { ...result, calls, output: result.stdout.trim() ? JSON.parse(result.stdout) : null };
}

test('判定JSON入口仅判显式视频，缓存matched不录音、不采集、不发现关键词', () => {
  const result = run('qualification');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output.outputs.videos[0].judgment_status, 'matched');
  assert.equal(result.output.metrics.videos_matched, 1);
  assert.deepEqual(result.output.evidence[0].identity_binding, {
    expected_video_id: vid, observed_video_id: vid, command_exit_code: 0,
  });
  assert.match(result.calls, /lock-release phase3-smoke/);
  assert.doesNotMatch(result.calls, /open-comments|collect-comments|record-start|search-video/);
});

test('函数提取后自有账号检查仍执行，跳过自有评论但继续采后面的真实客户', () => {
  const result = run('collection', input(), { OWN_FIRST: '1' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.output.outputs.comments.map(row => row.fields.评论者昵称), ['小李']);
  assert.match(result.calls, /commenter-identity 10 20/);
});

test('真实子进程非零退出携带已采stdout时，活动仍保留评论产物供落池', async () => {
  const { runVideoActivity } = require('../video-activities.js');
  const error = Object.assign(new Error('child interrupted'), { code: 1,
    stdout: 'LEAD\t小李\t123\tpersonal\t如何报名\t今天\t北京\tAI课程\tAI 考证\t\t\thttps://v.douyin.com/fixture/\nACTIVITY_STATUS\tpending\tinterrupted\n' });
  const result = await runVideoActivity('collection', input(), { run: async () => { throw error; } });
  assert.equal(result.status, 'partial');
  assert.equal(result.reason_code, 'interrupted');
  assert.equal(result.outputs.comments[0].fields.评论原文, '如何报名');
});

test('采集在单条评论后的预算边界停止，已采产物仍可落池，不能标整视频采完', () => {
  const result = run('collection', { ...input(), budget: { max_duration_s: 2 } },
    { ADVANCE_ON: 'commenter-card-link', ADVANCE_BY: '3' });
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.output.status, 'partial');
  assert.equal(result.output.outputs.comments.length, 1);
  assert.equal(result.output.metrics.videos_processed, 0);
  assert.doesNotMatch(result.calls, /qualify-video.js collected/);
  assert.match(result.calls, /lock-release/);
});

test('判定远端调用卡住也受自身预算封顶，手机锁仍正常收尾', () => {
  const start = Date.now();
  const result = run('qualification', { ...input('pending'), budget: { max_duration_s: 3 } },
    { DISCOVER_STATUS: 'pending', JUDGE_SLEEP: '8', REAL_CLOCK: '1' });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.output.reason_code, 'budget_exceeded');
  assert.match(result.calls, /qualify-video.js judge/, '必须实际进入卡住的远端模型边界');
  assert.ok(Date.now() - start < 7500, '不应等待8秒判定调用完成');
  assert.match(result.calls, /lock-release/);
});

test('有效音频上传卡住受活动剩余预算封顶，停止判定并释放手机锁', () => {
  const start = Date.now();
  const result = run('qualification', { ...input('pending'),
    video: { ...input('pending').video, duration: '00:01' }, budget: { max_duration_s: 20 } },
  { DISCOVER_STATUS: 'pending', HAS_TRANSCRIPT: 'false', SCP_SLEEP: '8', DYNAMIC_CLOCK: '1',
    ADVANCE_ON: 'record-extract-audio', ADVANCE_BY: '17' });
  assert.match(result.calls, /scp started/, '必须实际进入有效音频上传边界');
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.output.reason_code, 'budget_exceeded');
  assert.doesNotMatch(result.calls, /scp ended|qualify-video.js judge/);
  assert.ok(Date.now() - start < 6500, '不能等待8秒上传完成；只剩最多3秒活动预算');
  assert.match(result.calls, /lock-release phase3-smoke/);
});

test('未判过的视频复用真实资格判定函数；pending保持可重试', () => {
  const result = run('qualification', input('pending'), { DISCOVER_STATUS: 'pending', JUDGE_STATUS: 'pending' });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.output.failure_class, 'retryable');
  assert.equal(result.output.outputs.videos[0].judgment_status, 'pending');
  assert.match(result.calls, /qualify-video.js judge/);
  assert.doesNotMatch(result.calls, /collect-comments/);
});

test('采集JSON入口真实调用单视频采集函数，输出评论和视频绑定；自建锁收尾释放', () => {
  const result = run('collection');
  assert.equal(result.status, 0, result.stderr);
  const comment = result.output.outputs.comments[0];
  assert.equal(comment.fields.评论原文, '如何报名');
  assert.equal(comment.video_id, vid);
  assert.equal(result.output.metrics.comments_collected, 1);
  assert.match(result.calls, /qualify-video.js collected/);
  assert.match(result.calls, /lock-release phase3-smoke/);
  assert.doesNotMatch(result.calls, /qualify-video.js judge|record-start|search-video/);
});

test('rejected和pending输入不采集、不碰手机；matched须再核对持久化判定', () => {
  for (const status of ['rejected', 'pending']) {
    const result = run('collection', input(status));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output.status, 'completed');
    assert.equal(result.output.metrics.videos_skipped, 1);
    assert.equal(result.calls, '');
  }
  const stale = run('collection', input(), { DISCOVER_STATUS: 'pending' });
  assert.equal(stale.status, 1);
  assert.equal(stale.output.failure_class, 'retryable');
  assert.doesNotMatch(stale.calls, /open-video|open-comments|collect-comments/);
});

test('输入业务线/profile错误和现场serial不符，不执行手机写动作', () => {
  const badProfile = run('collection', { ...input(), device: { ...input().device, profile: 'yueshengyun-work' } });
  assert.equal(badProfile.output.failure_class, 'fatal');
  assert.equal(badProfile.calls, '');
  const serial = run('collection', input(), { TARGET_SERIAL: 'wrong-serial' });
  assert.equal(serial.output.failure_class, 'fatal');
  assert.doesNotMatch(serial.calls, /lock-acquire|open-video|open-comments/);
});

test('借用本run已持有锁不提前释放，其他run持锁时拒绝采集', () => {
  const borrowed = run('collection', input(), { BORROWED_OWNER: 'phase3-smoke' });
  assert.equal(borrowed.status, 0, borrowed.stderr);
  assert.match(borrowed.calls, /lock-refresh phase3-smoke/);
  assert.doesNotMatch(borrowed.calls, /lock-acquire|lock-release/);
  const foreign = run('collection', input(), { BORROWED_OWNER: 'other-run' });
  assert.equal(foreign.status, 1);
  assert.doesNotMatch(foreign.calls, /open-video|open-comments|lock-release/);
});

test('独立采集预算在安全边界封顶，不借判定预算；超时与打不开评论仍释放自建锁', () => {
  const timed = run('collection', { ...input(), budget: { max_duration_s: 2 } }, { ADVANCE_ON: 'open-video', ADVANCE_BY: '3' });
  assert.equal(timed.status, 1);
  assert.equal(timed.output.reason_code, 'budget_exceeded');
  assert.doesNotMatch(timed.calls, /open-comments|collect-comments/);
  assert.match(timed.calls, /lock-release phase3-smoke/);
  const closed = run('collection', input(), { OPEN_FAIL: '1' });
  assert.equal(closed.status, 1);
  assert.match(closed.calls, /lock-release phase3-smoke/);
});

test('手机实际落点换视频则拒绝采集；平滑停止不启动下一动作', () => {
  const drift = run('collection', input(), { CURRENT_VID: '7412345678901234568' });
  assert.equal(drift.status, 1);
  assert.equal(drift.output.reason_code, 'video_mismatch');
  assert.doesNotMatch(drift.calls, /open-comments|collect-comments/);
  assert.match(drift.calls, /lock-release/);
  const stop = join(mkdtempSync(join(tmpdir(), 'video-stop-')), 'stop'); writeFileSync(stop, '');
  const stopped = run('qualification', input(), { WF_STOP_FILE: stop });
  assert.equal(stopped.status, 1);
  assert.equal(stopped.output.reason_code, 'commander_stop');
  assert.doesNotMatch(stopped.calls, /open-video|record-start/);
});

for (const [label, extra, expectedExit, expectedObserved] of [
  ['命令非零但输出匹配ID', { LINK_RC: '28' }, 28, vid],
  ['成功但无ID', { LINK_EMPTY: '1' }, 0, null],
  ['非法ID', { CURRENT_VID: 'not-an-id' }, 0, null],
  ['多个ID', { LINK_MULTIPLE: '1' }, 0, null],
]) {
  test(`真实资格CLI：${label}应为身份不可用且禁止判定/采集`, () => {
    const result = run('qualification', input('pending'), extra);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.output.reason_code, 'video_identity_unavailable');
    assert.equal(result.output.failure_class, 'retryable');
    assert.equal(result.output.outputs.videos[0].judgment_status, 'pending');
    assert.deepEqual(result.output.evidence[0].identity_binding, {
      expected_video_id: vid, observed_video_id: expectedObserved, command_exit_code: expectedExit,
    });
    assert.equal(result.output.outputs.comments.length, 0);
    assert.doesNotMatch(result.calls, /qualify-video.js (?:discover|judge)|open-comments|collect-comments/);
    assert.match(result.calls, /lock-release phase3-smoke/);
  });
}

test('真实资格CLI：合法不同ID仍为视频不匹配，证据保留两侧ID', () => {
  const observed = '7412345678901234568';
  const result = run('qualification', input('pending'), { CURRENT_VID: observed });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.output.reason_code, 'video_mismatch');
  assert.deepEqual(result.output.evidence[0].identity_binding, {
    expected_video_id: vid, observed_video_id: observed, command_exit_code: 0,
  });
  assert.doesNotMatch(result.calls, /qualify-video.js (?:discover|judge)|open-comments|collect-comments/);
  assert.match(result.calls, /lock-release phase3-smoke/);
});

for (const extra of [{ LINK_RC: '28' }, { LINK_EMPTY: '1' }]) {
  test(`真实采集CLI：身份不可用禁止评论开窗并释放自有锁 ${JSON.stringify(extra)}`, () => {
    const result = run('collection', input(), extra);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.output.reason_code, 'video_identity_unavailable');
    assert.equal(result.output.outputs.comments.length, 0);
    assert.equal(result.output.metrics.videos_processed, 0);
    assert.doesNotMatch(result.calls, /open-comments|collect-comments|qualify-video.js (?:judge|collected)/);
    assert.match(result.calls, /lock-release phase3-smoke/);
  });
}
