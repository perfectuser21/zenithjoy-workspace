import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const relativeService = 'services/phone-adb-controller';
const helper = '.github/workflows/scripts/prepare-phone-deploy-fixture.sh';
const smoke = readFileSync(join(repo, '.github/workflows/scripts/smoke/phone-adb-controller-smoke.sh'), 'utf8');
const layer = smoke.slice(smoke.indexOf('_CALL_PATH='), smoke.indexOf('\ngrep -qF \'normalize_nickname\''));

function git(root, ...args) {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
}

function fixture(mode) {
  const temp = mkdtempSync(join(tmpdir(), 'phone-deploy-isolation-'));
  const root = join(temp, 'source'); mkdirSync(root);
  cpSync(join(repo, relativeService), join(root, relativeService), { recursive: true });
  if (existsSync(join(repo, helper))) {
    mkdirSync(dirname(join(root, helper)), { recursive: true }); cpSync(join(repo, helper), join(root, helper));
  }
  writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
  writeFileSync(join(root, 'tracked.txt'), 'base\n');
  git(root, 'init', '-q', '-b', 'cp-fixture');
  git(root, 'remote', 'add', 'origin', 'https://github.com/perfectuser21/zenithjoy-workspace.git');
  const commit = () => {
    git(root, 'add', '.');
    git(root, '-c', 'core.hooksPath=/dev/null', '-c', 'user.email=fixture@invalid', '-c', 'user.name=fixture', 'commit', '-qm', 'test: private deploy fixture');
  };
  commit(); git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  if (mode === 'dirty') writeFileSync(join(root, 'tracked.txt'), 'changed by prior smoke\n');
  if (mode === 'candidate') { writeFileSync(join(root, 'tracked.txt'), 'new candidate\n'); commit(); }
  if (mode === 'evil-origin') git(root, 'remote', 'set-url', 'origin', 'https://github.com/evil/zenithjoy-workspace.git');
  const before = { status: git(root, 'status', '--porcelain'), main: git(root, 'rev-parse', 'origin/main'), head: git(root, 'rev-parse', 'HEAD') };
  const entry = join(temp, 'layer17.sh');
  writeFileSync(entry, `#!/usr/bin/env bash\nset -euo pipefail\nD='${relativeService}'\nfail() { echo "$*" >&2; exit 1; }\n${layer}\n`);
  const result = spawnSync('bash', [entry], { cwd: root, env: { ...process.env, DEPLOY_SHA: '' }, encoding: 'utf8', timeout: 30000 });
  assert.deepEqual({ status: git(root, 'status', '--porcelain'), main: git(root, 'rev-parse', 'origin/main'), head: git(root, 'rev-parse', 'HEAD') }, before, 'original source checkout and main ref must stay untouched');
  return { temp, result };
}

for (const mode of ['dirty', 'candidate']) test(`真实部署落点回归在${mode}共享源上使用隔离clean Git，不松生产来源保护`, () => {
  const f = fixture(mode);
  try { assert.equal(f.result.status, 0, `${f.result.signal ?? ''}\n${f.result.stderr}`); }
  finally { rmSync(f.temp, { recursive: true, force: true }); }
});

test('隔离fixture保留原origin，恶意仓库仍拒部署且无scp', () => {
  const f = fixture('evil-origin');
  try {
    assert.equal(f.result.status, 1, f.result.stderr);
    assert.match(f.result.stderr, /source_repository_mismatch/);
    assert.match(f.result.stderr, /scp.log 为空/);
  } finally { rmSync(f.temp, { recursive: true, force: true }); }
});
