import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deploymentManifest, runtimeSource, verifyPublishedSource } from '../workflow-source.mjs';

const service = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const producerPath = 'services/phone-adb-controller/workflow-result.sh';
const jq = spawnSync('bash', ['-lc', 'command -v jq'], { encoding: 'utf8' }).stdout.trim();

function git(root, ...args) {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
}

function fixture(manifestChange, { sourced = false, replaceAtStartup = false, invalidFd = false, closeInheritedFd = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'workflow-source-'));
  const deployed = join(dir, 'deployed'); mkdirSync(deployed);
  const script = join(deployed, 'workflow-result.sh');
  copyFileSync(join(service, 'workflow-result.sh'), script);
  copyFileSync(join(service, 'workflow-source.mjs'), join(deployed, 'workflow-source.mjs'));
  const source = join(dir, 'repo'); mkdirSync(dirname(join(source, producerPath)), { recursive: true });
  copyFileSync(script, join(source, producerPath));
  git(source, 'init', '-q', '-b', 'cp-fixture');
  git(source, 'remote', 'add', 'origin', 'https://github.com/perfectuser21/zenithjoy-workspace.git');
  git(source, 'add', producerPath);
  git(source, '-c', 'core.hooksPath=/dev/null', '-c', 'user.email=fixture@invalid', '-c', 'user.name=fixture', 'commit', '-qm', 'test: producer fixture');
  git(source, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const manifest = deploymentManifest(source, git(source, 'rev-parse', 'HEAD'));
  if (manifestChange !== null) writeFileSync(join(deployed, 'workflow-result.source.json'), JSON.stringify({ ...manifest, ...manifestChange }));
  const bin = join(dir, 'bin'); mkdirSync(bin);
  const calls = join(dir, 'calls.jsonl');
  writeFileSync(join(bin, 'curl'), `#!/usr/bin/env bash\npython3 -c 'import json,sys;print(json.dumps(sys.argv[1:]))' "$@" >> '${calls}'\nprintf '{"success":true}\\n200'\n`);
  chmodSync(join(bin, 'curl'), 0o755);
  const words = join(dir, 'words.txt'); writeFileSync(words, 'source-proof\n');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, WFR_HOME: dir,
    WFR_NODE: process.execPath, WFR_JQ: jq, WFR_LEDGER_MJS: join(service, 'ledger.mjs'), WFR_SCP_TARGET: '',
    WFR_BRAIN_ENV: join(dir, 'absent.env'), BRAIN_URL: 'http://brain.test', BRAIN_INTERNAL_TOKEN: 'fixture',
    WFR_BRAIN_TASK_ID: '11111111-1111-4111-8111-111111111111', WFR_PROBE_STAGES: '',
    WFR_STEP_JUDGE: join(dir, 'absent-judge'), WFR_CHECKS_YAML: join(dir, 'absent-checks') };
  if (replaceAtStartup) {
    writeFileSync(join(source, producerPath), readFileSync(script, 'utf8') + '\n# subsequent deployment\n');
    git(source, 'add', producerPath);
    git(source, '-c', 'core.hooksPath=/dev/null', '-c', 'user.email=fixture@invalid', '-c', 'user.name=fixture', 'commit', '-qm', 'test: next producer fixture');
    git(source, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    copyFileSync(join(source, producerPath), join(deployed, 'next.sh'));
    writeFileSync(join(deployed, 'next.json'), JSON.stringify(deploymentManifest(source, git(source, 'rev-parse', 'HEAD'))));
    const node = join(bin, 'fixture-node');
    writeFileSync(node, `#!/usr/bin/env bash\nif [[ "$*" == *ledger.mjs*init* && -f '${deployed}/next.sh' ]]; then mv '${deployed}/next.sh' '${script}'; mv '${deployed}/next.json' '${deployed}/workflow-result.source.json'; fi\nexec '${process.execPath}' "$@"\n`);
    chmodSync(node, 0o755); env.WFR_NODE = node;
  }
  if (closeInheritedFd) {
    const node = join(bin, 'closed-fd-node');
    writeFileSync(node, `#!/usr/bin/env bash\nexec 0<&-\nexec '${process.execPath}' "$@"\n`);
    chmodSync(node, 0o755); env.WFR_NODE = node;
  }
  const args = ['init', 'source-fixture', 'fixture', words, '1', 'S', 'fixture'];
  let entry = script;
  if (sourced || invalidFd) {
    entry = join(dir, 'caller.sh');
    writeFileSync(entry, sourced ? `source '${script}' "$@"\n` : `exec 255<&-\nsource '${script}' "$@"\n`);
  }
  const result = spawnSync('bash', [entry, ...args], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const artdir = result.stdout.match(/^WFR_ART_DIR=(.+)$/m)?.[1];
  const artifact = JSON.parse(readFileSync(join(artdir, readdirSync(artdir).find(f => f.endsWith('.worker-result.json')))));
  const payloads = readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    .filter(args => args.includes('-d')).map(args => ({ endpoint: args.find(x => x.startsWith('http')), body: JSON.parse(args[args.indexOf('-d') + 1]) }));
  return { dir, source, script, artifact, callback: payloads.find(p => p.endpoint.endsWith('/execution-callback'))?.body,
    span: payloads.find(p => p.endpoint.endsWith('/spans'))?.body[0], manifest };
}

test('真实 Git revision 与 producer 文件hash匹配时三个回执面保留同一来源', { skip: !jq && 'jq unavailable' }, () => {
  const f = fixture({});
  try {
    const revision = f.manifest.source_sha;
    assert.match(revision, /^[a-f0-9]{40}$/);
    for (const result of [f.artifact, f.callback.result, f.span.evidence]) {
      assert.equal(result.source_sha, revision, JSON.stringify(result.source_provenance));
      assert.equal(result.source_provenance.status, 'verified');
      assert.equal(result.source_provenance.producer_sha256, f.manifest.producer_sha256);
      assert.equal(result.source_provenance.source_repo, f.manifest.source_repo);
      assert.equal(result.source_provenance.producer_path, producerPath);
    }
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

for (const [name, options] of [['source嵌套不把caller inode作为producer', { sourced: true }],
  ['startup后原子替换路径不冒认新版来源', { replaceAtStartup: true }],
  ['执行FD不可核时保留未知', { invalidFd: true }], ['reader关闭继承FD时保留未知', { closeInheritedFd: true }]]) {
  test(name, { skip: !jq && 'jq unavailable' }, () => {
    const f = fixture({}, options);
    try {
      for (const result of [f.artifact, f.callback.result, f.span.evidence]) {
        assert.equal(result.source_sha, null);
        assert.equal(result.source_provenance.status, 'unknown');
      }
    } finally { rmSync(f.dir, { recursive: true, force: true }); }
  });
}

test('部署只能发布 clean revision 的真实producer对象，漂移核验回到Git对象', { skip: !jq && 'jq unavailable' }, () => {
  const f = fixture({});
  try {
    assert.deepEqual(deploymentManifest(f.source, f.manifest.source_sha), f.manifest);
    const proof = runtimeSource(f.script);
    assert.equal(verifyPublishedSource(f.source, f.manifest.source_sha, proof).verified, true);
    assert.throws(() => verifyPublishedSource(f.source, f.manifest.source_sha,
      { ...proof, source_provenance: { ...proof.source_provenance, producer_sha256: '0'.repeat(64) } }), /not_git_object/);
    assert.throws(() => deploymentManifest(f.source, '0'.repeat(40)), /not_clean_revision/);
    git(f.source, 'remote', 'set-url', 'origin', 'https://github.com/other/repo.git');
    assert.throws(() => deploymentManifest(f.source, f.manifest.source_sha), /repository_mismatch/);
    git(f.source, 'remote', 'set-url', 'origin', 'https://github.com/perfectuser21/zenithjoy-workspace.git');
    writeFileSync(join(f.source, producerPath), 'dirty producer');
    assert.throws(() => deploymentManifest(f.source, f.manifest.source_sha), /not_clean_revision/);
    git(f.source, 'update-index', '--assume-unchanged', producerPath);
    assert.throws(() => deploymentManifest(f.source, f.manifest.source_sha), /not_git_object/);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

for (const [name, change] of [
  ['无 manifest', null], ['producer hash不匹配', { producer_sha256: '0'.repeat(64) }],
  ['其他仓库', { source_repo: 'other/repo' }], ['其他producer', { producer_path: 'other/script.sh' }],
  ['工件hash冒充Git revision', { source_sha: 'a'.repeat(64) }],
]) test(`${name}明确保留 null/unknown，不推断来源`, { skip: !jq && 'jq unavailable' }, () => {
  const f = fixture(change);
  try {
    for (const result of [f.artifact, f.callback.result, f.span.evidence]) {
      assert.equal(result.source_sha, null);
      assert.equal(result.source_provenance.status, 'unknown');
    }
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
