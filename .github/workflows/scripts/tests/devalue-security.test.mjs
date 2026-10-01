import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { stringify, parse, uneval } from 'devalue';

const root = resolve(import.meta.dirname, '../../../..');
const require = createRequire(import.meta.url);
const installed = JSON.parse(readFileSync(resolve(dirname(require.resolve('devalue')), 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));

test('actual resolved package matches the lock and is outside official affected <=5.9.2', () => {
  const entry = lock.packages['node_modules/devalue'];
  assert.equal(installed.name, 'devalue'); assert.equal(installed.version, entry.version);
  const [major, minor, patch] = entry.version.split('.').map(Number);
  assert.ok(major > 5 || (major === 5 && (minor > 9 || (minor === 9 && patch >= 3))),
    `GHSA-j22f-vq7h-c4qm affects ${entry.version}; official patched version is 5.9.3`);
  assert.equal(lock.packages['node_modules/astro'].dependencies.devalue, '^5.6.2');
});

function viewFixture(kind) {
  // Controlled bytes only: never serialize the process's real shared pool.
  const backing = new ArrayBuffer(64);
  new Uint8Array(backing).fill(77);
  const view = kind === 'Buffer' ? Buffer.from(backing, 8, 2) : new Uint8Array(backing, 8, 2);
  view[0] = 1; view[1] = 2;
  return view;
}

for (const kind of ['Uint8Array', 'Buffer']) {
  for (const method of ['stringify', 'uneval']) {
    test(`${method} ${kind}: protect Buffer pools and retain explicit ArrayBuffer view semantics`, () => {
      const view = viewFixture(kind);
      const output = method === 'stringify' ? parse(stringify(view)) : runInNewContext(`(${uneval(view)})`);
      assert.deepEqual(Array.from(output), [1, 2]);
      if (kind === 'Buffer') {
        assert.equal(output.buffer.byteLength, 2, 'Node Buffer shared-pool bytes must not be serialized');
        assert.equal(Array.from(new Uint8Array(output.buffer)).includes(77), false);
      } else {
        // Ordinary typed-array views intentionally retain their caller-supplied backing object.
        assert.equal(output.buffer.byteLength, 64); assert.equal(output.byteOffset, 8);
      }
    });
  }
}

for (const method of ['stringify', 'uneval']) {
  test(`${method}: nested Buffer views never hoist their shared backing pool`, () => {
    const first = viewFixture('Buffer');
    const second = Buffer.from(first.buffer, 20, 2); second[0] = 3; second[1] = 4;
    const value = { first, second };
    const output = method === 'stringify' ? parse(stringify(value)) : runInNewContext(`(${uneval(value)})`);
    assert.deepEqual([...output.first], [1, 2]); assert.deepEqual([...output.second], [3, 4]);
    assert.equal(output.first.buffer.byteLength, 2); assert.equal(output.second.buffer.byteLength, 2);
  });
}

test('normal structured values and deliberately supplied full ArrayBuffers still round trip', () => {
  const full = new Uint8Array([5, 6, 7]).buffer;
  const payload = { text: '正常文本', date: new Date('2026-10-01T00:00:00Z'),
    map: new Map([['item', 3]]), nil: null, full };
  const output = parse(stringify(payload));
  assert.equal(output.text, payload.text); assert.equal(output.date.toISOString(), payload.date.toISOString());
  assert.deepEqual([...output.map], [['item', 3]]); assert.equal(output.nil, null);
  assert.deepEqual([...new Uint8Array(output.full)], [5, 6, 7]);
});

test('the actual workspace npm audit has no high/critical devalue advisory', () => {
  const result = spawnSync('npm', ['audit', '--json'], { cwd: root, encoding: 'utf8', timeout: 60000,
    maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.error, undefined, result.error?.message);
  const report = JSON.parse(result.stdout);
  assert.ok(report.vulnerabilities && report.metadata, 'audit availability is required, not a pass on network error');
  const advisory = report.vulnerabilities.devalue;
  assert.ok(!advisory || !['high', 'critical'].includes(advisory.severity), JSON.stringify(advisory));
  // The existing global audit-gate remains responsible for every other dependency and its allowlist.
});

// CI bootstrap regression: inner fixtures retain the nine real serialization/audit tests above.
for (const state of ['missing', 'present', 'install-fails']) {
  test(`CI bootstrap ${state}: rebuild missing workspace dependencies and fail closed`, () => {
    const own = mkdtempSync(join(tmpdir(), 'devalue-ci-bootstrap-'));
    try {
      const testDir = join(own, '.github/workflows/scripts/tests');
      const smokeDir = join(own, '.github/workflows/scripts/smoke');
      const bin = join(own, 'bin');
      for (const dir of [testDir, smokeDir, bin]) mkdirSync(dir, { recursive: true });
      for (const name of ['package.json', 'package-lock.json']) {
        writeFileSync(join(own, name), readFileSync(join(root, name)));
      }
      writeFileSync(join(testDir, 'devalue-security.test.mjs'),
        readFileSync(import.meta.filename, 'utf8').split('// CI bootstrap regression:')[0]);
      writeFileSync(join(smokeDir, 'devalue-security-smoke.sh'),
        readFileSync(join(root, '.github/workflows/scripts/smoke/devalue-security-smoke.sh')));
      const npmPath = spawnSync('sh', ['-c', 'command -v npm'], { encoding: 'utf8' }).stdout.trim();
      assert.ok(npmPath.startsWith('/'), 'real npm audit binary must resolve before the fixture PATH');
      writeFileSync(join(bin, 'npm'), `#!/bin/sh
if [ "$1" = ci ]; then
  printf '%s\\n' "$*" >> "$CI_NPM_CALLS"
  if [ "$CI_INSTALL_FAILS" = yes ]; then exit 42; fi
  ln -s "$CI_INSTALLED_MODULES" "$CI_PROJECT/node_modules"
  exit 0
fi
exec "$CI_REAL_NPM" "$@"
`, { mode: 0o700 });
      if (state === 'present') symlinkSync(join(root, 'node_modules'), join(own, 'node_modules'));
      const calls = join(own, 'npm-ci-calls');
      const childEnv = { ...process.env };
      delete childEnv.NODE_TEST_CONTEXT; // The fixture runs an independent Node test process.
      const result = spawnSync('bash', [join(smokeDir, 'devalue-security-smoke.sh')], {
        cwd: own, encoding: 'utf8', timeout: 65000, maxBuffer: 4 * 1024 * 1024,
        env: { ...childEnv, PATH: bin + ':' + process.env.PATH,
          CI_NPM_CALLS: calls, CI_INSTALL_FAILS: state === 'install-fails' ? 'yes' : 'no',
          CI_INSTALLED_MODULES: join(root, 'node_modules'), CI_PROJECT: own, CI_REAL_NPM: npmPath },
      });
      assert.equal(result.error, undefined, result.error?.message);
      assert.equal(result.status, state === 'install-fails' ? 42 : 0, result.stdout + result.stderr);
      let recorded = '';
      try { recorded = readFileSync(calls, 'utf8'); } catch { /* no installation expected for present */ }
      if (state === 'present') assert.equal(recorded, '');
      else assert.match(recorded, /^ci --no-audit --no-fund/);
      if (state !== 'install-fails') assert.match(result.stdout, /(?:fail 0|# fail 0)/);
      // The ci command is the only fixture boundary. Installed bytes and npm audit above stay real.
    } finally {
      rmSync(own, { recursive: true, force: true });
    }
  });
}
