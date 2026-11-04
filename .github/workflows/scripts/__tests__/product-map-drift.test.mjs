import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import YAML from 'yaml';
import {createProductMapFixture} from '../../../../scripts/product-map/__tests__/helpers/cli-fixture.js';

const workflow = YAML.parse(readFileSync(new URL('../../ci-l2-consistency.yml', import.meta.url), 'utf8'));
const command = workflow.jobs['product-map-contract'].steps.find(step => step.name === 'Check product-map drift').run;
function run(t, mutate) {
  const root = createProductMapFixture();
  t.after(() => rmSync(root, {recursive: true, force: true}));
  if (mutate) mutate(root);
  return spawnSync('bash', ['-e', '-o', 'pipefail', '-c', command], {cwd: root, encoding: 'utf8'});
}
test('real L2 drift step accepts the checked-in matching projections', t => {
  const result = run(t);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
for (const file of ['product-map.json', 'contracts.json']) {
  test(`real L2 step rejects stale ${file} before generation can conceal drift`, t => {
    const result = run(t, root => {
      const path = resolve(root, 'product-map/generated', file);
      const document = JSON.parse(readFileSync(path, 'utf8'));
      document.digest = '0'.repeat(64);
      writeFileSync(path, JSON.stringify(document));
    });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /drift|mismatch/i);
  });
}
test('real L2 step rejects stale Markdown projection', t => {
  const result = run(t, root => writeFileSync(resolve(root, 'product-map/generated/product-map.md'), '# stale projection\n'));
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /drift|mismatch/i);
});
