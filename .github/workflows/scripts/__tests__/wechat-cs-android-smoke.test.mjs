import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const source = readFileSync(new URL('../smoke/wechat-cs-android-smoke.sh', import.meta.url), 'utf8');
for (const [name, body, success] of [
  ['real discovered assertion passes', 'def test_contract(self): self.assertEqual(2 + 2, 4)', true],
  ['real discovered assertion fails', 'def test_contract(self): self.fail("fixture assertion")', false],
  ['skipped suite is not coverage', '@unittest.skip("fixture unavailable")\n    def test_contract(self): pass', false],
  ['expected failure is not completed coverage', '@unittest.expectedFailure\n    def test_contract(self): self.fail("known broken")', false],
  ['no discovered tests', '', false],
  ['import failure', 'def test_contract(self): pass\nraise RuntimeError("fixture import failure")', false],
]) {
  test(`actual Android CS smoke: ${name}`, () => {
    const root = mkdtempSync(join(tmpdir(), 'android-cs-smoke-'));
    try {
      const script = join(root, '.github/workflows/scripts/smoke/current.sh');
      const suite = join(root, 'services/wechat-cs-android/tests');
      mkdirSync(join(root, '.github/workflows/scripts/smoke'), { recursive: true });
      mkdirSync(suite, { recursive: true });
      writeFileSync(script, source);
      if (body) writeFileSync(join(suite, 'test_contract.py'), 'import unittest\nclass Contract(unittest.TestCase):\n    ' + body + '\n');
      const result = spawnSync('bash', [script], { encoding: 'utf8', timeout: 10000 });
      assert.ifError(result.error);
      assert.equal(result.status === 0, success, result.stdout + result.stderr);
      if (success) assert.match(result.stdout, /offline_contracts.*device_delivery=not_verified/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
