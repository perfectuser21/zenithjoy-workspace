import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

const entry = new URL('../video-activity.js', import.meta.url).pathname;
test('视频活动根进程收到TERM按安全边界停止，保留已采JSON且释放自有锁', async t => {
  const home = mkdtempSync(join(tmpdir(), 'video-cancel-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const bin = join(home, '.local', 'bin'); mkdirSync(bin, { recursive: true });
  const scripts = {
    'douyin-phone-adb': `#!/bin/sh
shift 2
cmd="$1"; shift
printf '%s\\n' "$cmd" >> "$HOME/calls"
case "$cmd" in
 preflight) echo serial=fixture-serial;;
 lock-status) echo lock=free;;
 lock-acquire) echo lock=acquired;;
 lock-release) echo lock=released;;
 open-video) echo video_opened=1;;
 current-video-link) printf 'video_id=7412345678901234567\\nshort_url=https://v.douyin.com/fixture/\\n';;
 open-comments) printf 'comments_opened=1\\ncomment_count=2\\n';;
 collect-comments) printf '小李\\t如何报名\\t今天\\t北京\\tpersonal\\ttap=10 20\\tb64=AAA\\n小王\\t多少钱\\t今天\\t北京\\tpersonal\\ttap=30 40\\tb64=BBB\\nexhausted=1\\n';;
 commenter-identity) printf 'nickname=小李\\ndouyin_id=123\\naccount_type=personal\\n';;
 commenter-card-link) /bin/sleep 1; echo profile_url=https://www.douyin.com/user/fixture;;
esac
exit 0`,
    ssh: `#!/bin/sh
printf 'ssh %s\\n' "$*" >> "$HOME/calls"
case "$*" in
 *'qualify-video.js discover'*) echo 'QUAL_DISCOVER {"status":"matched","has_transcript":true}';;
 *'qualify-video.js collected'*) echo 'QUAL_COLLECTED {"updated":1}';;
esac`,
  };
  for (const [name, code] of Object.entries(scripts)) { writeFileSync(join(bin, name), code); chmodSync(join(bin, name), 0o755); }
  const child = spawn(process.execPath, [entry, 'collection'], { stdio: ['pipe', 'pipe', 'pipe'], detached: true,
    env: { HOME: home, PATH: [bin, dirname(process.execPath), '/usr/bin', '/bin'].join(':'), HARVEST_KEYWORD_TESTING: '1', WF_BOUNDED_POLL: '0.05' } });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
  const done = new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal })));
  t.after(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } });
  child.stdin.end(JSON.stringify({ run_tag: 'video-cancel', line_key: 'jinuo',
    device: { profile: 'jinoshengyuan-work', serial: 'fixture-serial', lock_holder: 'video-cancel' },
    video: { video_id: '7412345678901234567', title: 'AI课程', judgment_status: 'matched' }, budget: { max_duration_s: 60 } }));
  const deadline = Date.now() + 10000;
  while ((!existsSync(join(home, 'calls')) || !readFileSync(join(home, 'calls'), 'utf8').includes('commenter-card-link')) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.match(readFileSync(join(home, 'calls'), 'utf8'), /commenter-card-link/, stderr);
  child.kill('SIGTERM');
  const { code, signal } = await done;
  assert.equal(signal, null, `活动未清理便被信号终结: ${signal}`);
  assert.equal(code, 2, stderr);
  const result = JSON.parse(stdout);
  assert.equal(result.status, 'partial');
  assert.equal(result.outputs.comments.length, 1);
  assert.equal(result.outputs.comments[0].fields.评论原文, '如何报名');
  assert.equal(result.metrics.videos_processed, 0);
  const calls = readFileSync(join(home, 'calls'), 'utf8');
  assert.match(calls, /lock-release/);
  assert.equal(calls.match(/^commenter-identity$/gm).length, 1);
  assert.doesNotMatch(calls, /qualify-video.js collected/);
});
