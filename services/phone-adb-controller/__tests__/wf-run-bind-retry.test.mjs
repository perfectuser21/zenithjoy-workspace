// services/phone-adb-controller/__tests__/wf-run-bind-retry.test.mjs
//
// 10-06 22 点几批全部拒跑：`运行发布绑定未确认: WFR_RUNTIME_ERROR Brain请求失败 GET .../api/brain/runs/<run>/definition curl=28`
// ——一次网络超时就放弃整批。修后：bind-run 只在网络超时类失败（curl 28/52/56）时按退避重试（默认 30/60/120 秒），
// 其它失败（409 冲突、发布版本不符、本地校验失败）一律不重试；不绕过发布版本校验。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const ZSH = spawnSync('bash', ['-lc', 'command -v zsh'], { encoding: 'utf8' }).stdout.trim();
const SKIP = !ZSH && 'no zsh (CI: sudo apt-get install -y zsh)';

// fakeWfr: bind-run 按 outcomes 依次给结果（'timeout' | 'conflict' | 'ok'），每次调用记一行
function run(outcomes, delays = '0 0 0') {
  const dir = mkdtempSync(join(tmpdir(), 'wfbind-'));
  const wfr = join(dir, 'fake-wfr.sh');
  writeFileSync(wfr, `#!/bin/bash
n=$(cat "${dir}/count" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "${dir}/count"
o=(${outcomes.join(' ')}); r="\${o[$((n-1))]:-timeout}"
case "$r" in
  ok) echo "WFR_ATTEMPT=a1"; echo "WFR_SKIP_WORDS=";;
  timeout) echo "WFR_RUNTIME_ERROR Brain请求失败 GET /api/brain/runs/x__a1/definition curl=28 curl: (28) Operation timed out" >&2; exit 1;;
  conflict) echo "WFR_RUNTIME_ERROR Brain HTTP 409" >&2; exit 1;;
esac
`);
  chmodSync(wfr, 0o755);
  const script = `
    log(){ print -r -- "LOG $*" >> "${dir}/log"; }
    wf_runtime_why(){ tail -1 "$1"; }
    WFR="${wfr}"
    source "${join(SRC, 'wf-run-lib.sh')}"
    err=$(mktemp)
    if out=$(wf_bind_run "$err"); then print -r -- "OK:$out"; else print -r -- "FAIL:$(cat $err)"; fi
  `;
  const r = spawnSync(ZSH, ['-c', script], { encoding: 'utf8', env: { ...process.env, WF_BIND_RETRY_DELAYS: delays }, timeout: 30000 });
  const count = Number(readFileSync(join(dir, 'count'), 'utf8'));
  const log = existsSync(join(dir, 'log')) ? readFileSync(join(dir, 'log'), 'utf8') : '';
  return { out: r.stdout, err: r.stderr, count, log };
}

test('网络超时后退避重试，第三次成功就照常起跑', { skip: SKIP }, () => {
  const r = run(['timeout', 'timeout', 'ok']);
  assert.equal(r.count, 3, r.err);
  assert.match(r.out, /^OK:WFR_ATTEMPT=a1/m);
  assert.equal((r.log.match(/运行发布绑定网络超时/g) || []).length, 2);
});

test('重试用完（初次 + 3 次）仍超时 → 拒跑，带最后一次原因', { skip: SKIP }, () => {
  const r = run(['timeout', 'timeout', 'timeout', 'timeout', 'ok']);
  assert.equal(r.count, 4, r.err);
  assert.match(r.out, /^FAIL:.*curl=28/m);
});

test('非网络超时（409 冲突等）不重试：不绕过发布版本校验', { skip: SKIP }, () => {
  const r = run(['conflict', 'ok']);
  assert.equal(r.count, 1);
  assert.match(r.out, /^FAIL:.*409/m);
});

test('默认退避间隔是 30/60/120 秒，wf-run.sh 走 wf_bind_run', () => {
  const lib = readFileSync(join(SRC, 'wf-run-lib.sh'), 'utf8');
  assert.match(lib, /WF_BIND_RETRY_DELAYS:-30 60 120/);
  const main = readFileSync(join(SRC, 'wf-run.sh'), 'utf8');
  assert.match(main, /WF_BIND_EXPORTS=\$\(wf_bind_run "\$WF_RT_ERR"\)/);
});
