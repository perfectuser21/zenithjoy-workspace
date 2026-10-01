import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
if [ "$cmd" = "$ADVANCE_ON" ]; then n=$(cat "$HOME/now"); echo $((n + ADVANCE_BY)) > "$HOME/now"; fi
case "$cmd" in
 preflight) printf 'serial=%s\\nstate=device\\n' "\${TARGET_SERIAL:-fixture-serial}";;
 lock-status) [ -z "$BORROWED_OWNER" ] && echo 'lock=free' || echo "lock=held owner=$BORROWED_OWNER stale=false";;
 lock-acquire) [ "$LOCK_FAIL" = 1 ] && exit 2; echo "lock=acquired owner=$1";;
 lock-refresh) echo "lock=refreshed owner=$1";;
 lock-release) echo "lock=released owner=$1";;
 open-video) echo 'video_opened=1';;
 current-video-link) printf 'video_id=%s\\nshort_url=https://v.douyin.com/fixture/\\n' "\${CURRENT_VID:-7412345678901234567}";;
 open-comments) [ "$OPEN_FAIL" = 1 ] && exit 2; printf 'comments_opened=1\\ncomment_count=1\\n';;
 collect-comments) printf '小李\\t如何报名\\t今天\\t北京\\tpersonal\\ttap=10 20\\tb64=AAA\\nexhausted=1\\n';;
 commenter-identity) printf 'nickname=小李\\ndouyin_id=123\\naccount_type=personal\\n';;
 commenter-card-link) echo 'profile_url=https://www.douyin.com/user/fixture';;
 record-stop) echo 'record_stopped duration_seconds=15 mean_volume_db=-30';;
 record-extract-audio) echo 'audio_extracted path=/tmp/fixture.wav';;
esac
exit 0`;
const ssh = `#!/bin/sh
printf 'ssh %s\\n' "$*" >> "$HOME/calls"
case "$*" in
 *'qualify-video.js discover'*) printf 'QUAL_DISCOVER {"status":"%s","has_transcript":true}\\n' "\${DISCOVER_STATUS:-matched}";;
 *'qualify-video.js judge'*) printf 'QUAL_RESULT {"verdict":"%s","kind":"judged"}\\n' "\${JUDGE_STATUS:-matched}";;
 *'qualify-video.js collected'*) echo 'QUAL_COLLECTED {"updated":1}';;
esac`;
function run(action, request = input(), extra = {}) {
  const home = mkdtempSync(join(tmpdir(), 'video-activity-'));
  const bin = join(home, '.local', 'bin'); mkdirSync(bin, { recursive: true });
  for (const [name, code] of [['douyin-phone-adb', adb], ['ssh', ssh], ['date', `#!/bin/sh\n[ "$1" = +%s ] && { cat "$HOME/now"; exit; }\nexec /bin/date "$@"`]]) {
    writeFileSync(join(bin, name), code); chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(join(home, 'now'), '1000');
  const result = spawnSync(process.execPath, [entry, action], { encoding: 'utf8', input: JSON.stringify(request),
    timeout: 20000, env: { ...process.env, HOME: home, PATH: bin + ':' + process.env.PATH,
      HARVEST_KEYWORD_TESTING: '1', ...extra } });
  const calls = existsSync(join(home, 'calls')) ? readFileSync(join(home, 'calls'), 'utf8') : '';
  return { ...result, calls, output: result.stdout.trim() ? JSON.parse(result.stdout) : null };
}

test('判定JSON入口仅判显式视频，缓存matched不录音、不采集、不发现关键词', () => {
  const result = run('qualification');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output.outputs.videos[0].judgment_status, 'matched');
  assert.equal(result.output.metrics.videos_matched, 1);
  assert.match(result.calls, /lock-release phase3-smoke/);
  assert.doesNotMatch(result.calls, /open-comments|collect-comments|record-start|search-video/);
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
