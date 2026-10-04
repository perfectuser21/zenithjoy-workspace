// 采收保底 10-03 全天拒跑「工作流定义版本冻结失败」（决策 b0dcc509 / 任务 ed591256）：
// prepare 唯一联网是 GET /api/brain/releases/:id（整包约 444KB），request() 写死 curl -m 8；
// m4 → MMV socat → us-vps 经 DERP 中继，晚高峰 6–10 秒，超时即拒跑。另：curl 失败时 Node 报错带整条命令（含 Bearer token）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from '../runtime-receipts.mjs';

function fakeCurl(body) {
  const dir = mkdtempSync(join(tmpdir(), 'wfr-curl-'));
  const argsFile = join(dir, 'args.txt');
  writeFileSync(join(dir, 'curl'), `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a" >> "${argsFile}"; done\n${body}\n`);
  chmodSync(join(dir, 'curl'), 0o755);
  return { dir, argsFile };
}
function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) { saved[k] = process.env[k]; process.env[k] = v; }
  try { return fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

test('GET release 放宽超时并重试：-m 60、--retry 3（8 秒不够跨境下载整包）', () => {
  const c = fakeCurl(`printf '{"ok":1}\\n200'`);
  const out = withEnv({ PATH: `${c.dir}:${process.env.PATH}`, BRAIN_URL: 'http://brain.test', BRAIN_INTERNAL_TOKEN: 'tok' },
    () => request('/api/brain/releases/r1'));
  assert.deepEqual(out, { ok: 1 });
  const args = readFileSync(c.argsFile, 'utf8').split('\n');
  const at = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(at('-m'), '60');
  assert.equal(at('--retry'), '3');
  assert.ok(args.includes('--retry-all-errors'));
});

test('curl 失败时报错带 curl 退出码与 stderr 摘要，但绝不含 token', () => {
  const c = fakeCurl(`echo 'curl: (28) Operation timed out after 60001 milliseconds' >&2\nexit 28`);
  withEnv({ PATH: `${c.dir}:${process.env.PATH}`, BRAIN_URL: 'http://brain.test', BRAIN_INTERNAL_TOKEN: 'SECRET-TOK-123' }, () => {
    assert.throws(() => request('/api/brain/releases/r1'), (err) => {
      assert.match(err.message, /curl=28/);
      assert.match(err.message, /timed out/);
      assert.doesNotMatch(err.message, /SECRET-TOK-123/);
      assert.doesNotMatch(err.message, /Bearer/);
      return true;
    });
  });
});

test('POST 绑定也放宽超时（-m 30），不跟 GET 一样盲目重试', () => {
  const c = fakeCurl(`printf '{"ok":2}\\n200'`);
  withEnv({ PATH: `${c.dir}:${process.env.PATH}`, BRAIN_URL: 'http://brain.test', BRAIN_INTERNAL_TOKEN: 'tok' },
    () => request('/api/brain/runs/x/definition', { a: 1 }));
  const args = readFileSync(c.argsFile, 'utf8').split('\n');
  assert.equal(args[args.indexOf('-m') + 1], '30');
  assert.ok(!args.includes('--retry-all-errors'));
});
