// release_versions 不可变（manifest_sha256 摘要）：校验通过后落本地缓存，下次 prepare 不再跨境下载整包（任务 ed591256）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { deploymentTarget } from '../deployment-release.mjs';
import { freezeDefinition, digest } from '../runtime-definition.mjs';
const actualHost = deploymentTarget(hostname());

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'release-cache-')), sha = 'a'.repeat(40), repo = 'fixture/repo';
  const files = ['entry.sh', 'workflow.plan', 'steps.json'].map((name, i) => { const bytes = ['#!/bin/sh\necho original\n', 'WF_CAP=test\n', '{"steps":[]}'][i]; writeFileSync(join(root, name), bytes); return { path: `services/phone-adb-controller/${name}`, deployed_path: name, content_sha256: digest(bytes) }; });
  const version = (id, payload) => { const source = { repo, path: 'contracts/test.yaml', commit: sha }; return { id, source_repo: repo, source_path: source.path, source_commit: sha, payload, contract_sha256: digest(payload.contract), payload_sha256: digest({ source, payload }) }; };
  const av = version('av-fixed', { activity_id: 'activity', definition_key: 'test.run', contract: { id: 'run' }, steps: [], implementation_bindings: [{ kind: 'code', status: 'verified', repo, path: files[0].path, revision: sha, content_sha256: files[0].content_sha256 }] });
  const wv = version('wv-fixed', { workflow_id: 'workflow', key: 'brain-test', contract: { capability: 'test' }, activities: [{ reference_id: 'ref', slot_key: 'run', sequence_no: 1, activity_id: 'activity', activity_version_id: av.id }] });
  const payload = { schema_version: 1, workflows: [wv], activities: [av], components: [], ci_evidence: [], allowed_enabler_calls: [], verification: {} };
  const release = { id: 'release-fixed', release_key: 'fixture', manifest_sha256: digest({ environment: 'scratch', target: actualHost, payload }), environment: 'scratch', target: actualHost, payload };
  const manifest = { source_repo: repo, source_commit: sha, release_id: release.id, observation_id: 'observation', environment: 'scratch', target: actualHost, files };
  writeFileSync(join(root, 'deployment-manifest.json'), JSON.stringify(manifest));
  const calls = [];
  const get = async (path) => { calls.push(path); if (path === `/api/brain/releases/${release.id}`) return { release }; throw Error(`unexpected ${path}`); };
  const cacheDir = join(root, 'release-cache');
  const options = (run) => ({ releaseId: release.id, requireRelease: true, runDir: join(root, run), deploymentRoot: root, planPath: join(root, 'workflow.plan'), stepSpecPath: join(root, 'steps.json'), rawContractSha256: wv.contract_sha256, workflowKey: 'brain-test', releaseCacheDir: cacheDir, get });
  return { root, release, calls, cacheDir, options };
}

test('首次 prepare 下载并落缓存；第二批 prepare 命中缓存，不再请求 Brain', async () => {
  const f = fixture();
  const first = await freezeDefinition(f.options('run1'));
  assert.equal(first.release.id, 'release-fixed');
  assert.equal(f.calls.filter((p) => p.startsWith('/api/brain/releases/')).length, 1);
  assert.ok(existsSync(join(f.cacheDir, 'release-fixed.json')), '缓存文件应存在');
  const second = await freezeDefinition(f.options('run2'));
  assert.equal(second.release.id, 'release-fixed');
  assert.equal(f.calls.filter((p) => p.startsWith('/api/brain/releases/')).length, 1, '命中缓存不应再联网');
});

test('缓存被篡改（摘要不符）→ 丢弃缓存重新向 Brain 取，并覆盖为正确内容', async () => {
  const f = fixture();
  await freezeDefinition(f.options('run1'));
  const path = join(f.cacheDir, 'release-fixed.json');
  const bad = JSON.parse(readFileSync(path, 'utf8')); bad.payload.verification = { tampered: true };
  writeFileSync(path, JSON.stringify(bad));
  const again = await freezeDefinition(f.options('run2'));
  assert.equal(again.release.id, 'release-fixed');
  assert.equal(f.calls.filter((p) => p.startsWith('/api/brain/releases/')).length, 2, '篡改的缓存不可信，必须重新取');
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')).payload, f.release.payload);
});

test('Brain 返回的 release 本身摘要不符时照旧拒绝，且不写缓存', async () => {
  const f = fixture();
  f.release.manifest_sha256 = 'b'.repeat(64);
  await assert.rejects(freezeDefinition(f.options('run1')), /release摘要不符/);
  assert.equal(existsSync(join(f.cacheDir, 'release-fixed.json')), false);
});
