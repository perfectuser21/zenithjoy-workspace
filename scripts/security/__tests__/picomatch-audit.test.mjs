import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAuditReport, npmProjectRoot } from '../picomatch-audit.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const clean = () => ({ auditReportVersion: 2, vulnerabilities: {}, metadata: {
  vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
} });
test('接受实际有效npm审计报告', () => assert.deepEqual(validateAuditReport(JSON.stringify(clean())), clean()));
for (const [name, value] of [
  ['error', { ...clean(), error: { code: 'registry unavailable' } }],
  ['count', { ...clean(), metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 } } }],
  ['version', { ...clean(), auditReportVersion: 1 }],
  ['empty', {}], ['null', null], ['array', []],
]) test('原始或修补审计均拒绝无效报告 ' + name, () => assert.throws(() => validateAuditReport(JSON.stringify(value)), /REPORT/));

test('workspace与独立发布分别选择实际锁，不能混用审计证明', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'audit-workspace-'))), child = join(root, 'apps/dashboard');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(child, { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'root-fixture', version: '1.0.0', workspaces: ['apps/*'] }));
  writeFileSync(join(child, 'package.json'), JSON.stringify({ name: 'dashboard-fixture', version: '1.0.0' }));
  assert.equal(await npmProjectRoot(child), root);
  assert.equal(await npmProjectRoot(child, 'standalone'), child);
  assert.equal(await npmProjectRoot(root, 'standalone'), root);
  await assert.rejects(npmProjectRoot(child, 'unknown'), /MODE/);
});
