import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const apiDir = fileURLToPath(new URL('../../', import.meta.url));
const vitest = createRequire(import.meta.url).resolve('vitest/vitest.mjs');
const spec = 'tests/integration/acquisition-cancel-uuid-agent.integration.test.ts';
function selected(config) {
  const result = spawnSync(process.execPath, [vitest, 'list', '--config', config, '--filesOnly', '--passWithNoTests', spec], { cwd: apiDir, encoding: 'utf8', timeout: 30000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

test('legacy config excludes cancellation contract while required real PostgreSQL config selects it', () => {
  assert.ok(!selected('vitest.integration.config.ts').includes(spec));
  assert.deepEqual(selected('vitest.business-pg.config.ts'), [spec]);
  const workflow = YAML.parse(readFileSync(new URL('../../../../.github/workflows/ci-l4-integration.yml', import.meta.url), 'utf8'));
  const job = workflow.jobs['api-integration-test'];
  const guard = job.steps.find(s => s.run?.includes('node --test tests/contracts/cancel-spec-selection.test.mjs'));
  assert.ok(guard, 'selection contract must run in the integration job');
  assert.equal(guard['continue-on-error'], undefined);
  assert.equal(guard.if, undefined);
  const step = job.steps.find(s => s.run?.includes('vitest.business-pg.config.ts'));
  assert.ok(step, 'business PG test must run in the integration job');
  assert.equal(step['continue-on-error'], undefined);
  assert.equal(step.if, undefined);
  assert.equal(job['continue-on-error'], undefined);
  assert.equal(step.env.BUSINESS_PG_DISPOSABLE, '1');
  assert.ok(workflow.jobs['integration-gate'].needs.includes('api-integration-test'));
});
