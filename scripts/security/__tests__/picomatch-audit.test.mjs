import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAuditReport } from '../picomatch-audit.mjs';

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
