import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const gate = fileURLToPath(new URL('../audit-gate.sh', import.meta.url));

function report(packages = []) {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: packages.length };
  const vulnerabilities = {};
  for (const [name, severity] of packages) {
    counts[severity]++;
    vulnerabilities[name] = {
      name, severity, isDirect: true, via: [], effects: [], range: '*',
      nodes: [`node_modules/${name}`], fixAvailable: false,
    };
  }
  return { auditReportVersion: 2, vulnerabilities, metadata: {
    vulnerabilities: counts,
    dependencies: { prod: 1, dev: 0, optional: 0, peer: 0, peerOptional: 0, total: 1 },
  } };
}

function runGate({ payload = report(), npmExit = 0, realNpm = false,
  packageJson = true, lock = true, missingDir = false, brokenJq = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'audit-gate-test-'));
  try {
    const project = join(root, 'project');
    const bin = join(root, 'bin');
    mkdirSync(project);
    mkdirSync(bin);
    if (packageJson) writeFileSync(join(project, 'package.json'), '{"name":"audit-fixture","version":"1.0.0"}\n');
    if (lock) writeFileSync(join(project, 'package-lock.json'), '{"name":"audit-fixture","version":"1.0.0","lockfileVersion":3,"packages":{"":{"name":"audit-fixture","version":"1.0.0"}}}\n');
    const fixture = join(root, 'audit.json');
    writeFileSync(fixture, typeof payload === 'string' ? payload : JSON.stringify(payload));
    // Replace only the external registry boundary; Bash, jq, cwd and exit handling stay real.
    if (!realNpm) writeFileSync(join(bin, 'npm'), '#!/bin/sh\n[ "$#" = 2 ] && [ "$1" = audit ] && [ "$2" = --json ] || exit 99\ncat "$AUDIT_FIXTURE"\nexit "$AUDIT_EXIT"\n', { mode: 0o755 });
    if (brokenJq) writeFileSync(join(bin, 'jq'), '#!/bin/sh\nexit 2\n', { mode: 0o755 });
    return spawnSync('bash', [gate, missingDir ? join(root, 'missing') : project], {
      cwd: project, encoding: 'utf8', timeout: 15000,
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`,
        AUDIT_FIXTURE: fixture, AUDIT_EXIT: String(npmExit), npm_config_cache: join(root, 'cache'),
        npm_config_update_notifier: 'false', npm_config_fetch_retries: '0', npm_config_offline: 'true' },
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
}

function rejects(options) {
  const result = runGate(options);
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /✅/);
}

for (const [name, options] of [
  ['registry error JSON', { payload: { error: { code: 'EAI_AGAIN', summary: 'registry unavailable', detail: '' } }, npmExit: 1 }],
  ['ENOLOCK error JSON', { payload: { error: { code: 'ENOLOCK', summary: 'lockfile missing', detail: '' } }, npmExit: 1 }],
  ['malformed JSON', { payload: 'not JSON', npmExit: 1 }],
  ['empty output', { payload: '', npmExit: 1 }],
  ['JSON null', { payload: 'null', npmExit: 1 }],
  ['empty JSON object', { payload: {} }],
  ['multiple JSON documents', { payload: `${JSON.stringify({ error: { code: 'EFAIL' } })}\n${JSON.stringify(report())}` }],
  ['unexpected npm exit with valid report', { npmExit: 2 }],
  ['failed directory change', { missingDir: true }],
  ['jq failure', { brokenJq: true }],
  ['actual npm project without lockfile', { realNpm: true, lock: false }],
  ['actual npm directory without package or lockfile', { realNpm: true, packageJson: false, lock: false }],
  ['actual npm lockfile without package.json', { realNpm: true, packageJson: false }],
]) test(`rejects ${name}`, () => rejects(options));

for (const [name, mutate] of [
  ['missing report version', value => { delete value.auditReportVersion; }],
  ['unsupported report version', value => { value.auditReportVersion = 1; }],
  ['missing vulnerabilities', value => { delete value.vulnerabilities; }],
  ['null vulnerabilities', value => { value.vulnerabilities = null; }],
  ['array vulnerabilities', value => { value.vulnerabilities = []; }],
  ['missing metadata', value => { delete value.metadata; }],
  ['missing critical count', value => { delete value.metadata.vulnerabilities.critical; }],
  ['string count', value => { value.metadata.vulnerabilities.high = '0'; }],
  ['negative count', value => { value.metadata.vulnerabilities.high = -1; }],
  ['fractional count', value => { value.metadata.vulnerabilities.high = 0.5; }],
  ['inconsistent severity count', value => { value.metadata.vulnerabilities.high = 1; value.metadata.vulnerabilities.total = 1; }],
  ['inconsistent total count', value => { value.metadata.vulnerabilities.total = 1; }],
  ['embedded error with valid report', value => { value.error = { code: 'EFAIL' }; }],
  ['unknown vulnerability severity', value => { value.vulnerabilities.bad = { name: 'bad', severity: 'unknown' }; }],
  ['null vulnerability', value => { value.vulnerabilities.bad = null; }],
]) test(`rejects report with ${name}`, () => {
  const payload = report();
  mutate(payload);
  rejects({ payload, npmExit: 1 });
});

for (const severity of ['high', 'critical']) {
  test(`blocks unlisted ${severity} vulnerability on normal audit exit 1`, () => {
    rejects({ payload: report([['unlisted-fixture', severity]]), npmExit: 1 });
  });
  test(`permits existing allowlisted ${severity} vulnerability on normal audit exit 1`, () => {
    const result = runGate({ payload: report([['astro', severity]]), npmExit: 1 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /✅/);
  });
}

test('passes a valid clean report', () => {
  const result = runGate();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /✅/);
});

test('passes an actual offline npm audit for a dependency-free locked project', () => {
  const result = runGate({ realNpm: true });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /✅/);
});

test('permits unlisted moderate vulnerabilities on normal audit exit 1', () => {
  const result = runGate({ payload: report([['moderate-fixture', 'moderate']]), npmExit: 1 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
