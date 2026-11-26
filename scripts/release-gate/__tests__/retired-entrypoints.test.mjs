import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
const root = new URL('../../../', import.meta.url);
test('已退役的空部署和美国旧staging不再是可触发入口', () => {
  for (const file of ['deploy.yml', 'deploy-us-vps.yml'])
    assert.equal(existsSync(new URL('.github/workflows/' + file, root)), false, file);
});
test('CI演练明确只证明fixture恢复，不接受未实现的生产库选择输入', () => {
  const workflow = JSON.parse(execFileSync('python3', ['-c', 'import json,sys,yaml; print(json.dumps(yaml.safe_load(sys.stdin)))'], {input:readFileSync(new URL('.github/workflows/db-backup.yml', root), 'utf8'),encoding:'utf8'}));
  assert.match(workflow.name, /CI Fixture/);
  assert.equal(workflow.true.workflow_dispatch?.inputs?.database_url_secret_name, undefined);
  assert.equal(workflow.jobs['backup-and-drill'].env.DATABASE_URL, 'postgresql://postgres:postgres@localhost:5432/zenithjoy_backup');
});
test('obsolete root version PR writer and duplicate gate workflow stay retired', () => {
  for (const file of ['auto-version.yml', 'two-column-gate-selftest.yml'])
    assert.equal(existsSync(new URL('.github/workflows/' + file, root)), false, file);
  const workflow = readFileSync(new URL('.github/workflows/ci-l1-process.yml', root), 'utf8');
  assert.match(workflow, /run: python3 scripts\/release-gate\/__tests__\/process-and-business-gates\.test\.py/);
  // Build identity is scoped to the artifact: the API embeds its own package
  // version and git SHA; Agent packaging reads services/agent/package.json.
  assert.match(readFileSync(new URL('apps/api/scripts/write-build-info.sh', root), 'utf8'), /API_DIR.*package\.json/);
  assert.match(readFileSync(new URL('services/agent/scripts/build-install-pack.sh', root), 'utf8'), /VERSION=.*package\.json.*version/);
});

test('旧香港生产发布、回滚和联合晋级入口已退役', () => {
  for (const file of [
    'promote-prod.yml',
    'promote-all-prod.yml',
    'promote-prod-hk.yml',
    'rollback-prod.yml',
    'promote-dashboard-prod.yml',
    'rollback-dashboard-prod.yml',
  ]) {
    assert.equal(existsSync(new URL('.github/workflows/' + file, root)), false, file);
  }
});

test('香港 API 预发保持与已退役的私有画布入口分离', () => {
  for (const file of ['deploy-creative-canvas-staging.yml', 'video-tools-live-acceptance.yml']) {
    assert.equal(existsSync(new URL('.github/workflows/' + file, root)), false, file);
  }
  const staging = readFileSync(new URL('.github/workflows/deploy-staging-hk.yml', root), 'utf8');
  assert.doesNotMatch(staging, /video_tools:|hk-canvas-(production|staging)\.sh/);
});

for (const [file, modeKey] of [
  ['hangzhou-api-release.yml', 'MODE'],
  ['zenithjoy-dashboard-production.yml', 'ACTION'],
]) {
  test(`${file} 在 main 接受只读核对和明确版本的手动发布请求`, () => {
    const yaml = readFileSync(new URL('.github/workflows/' + file, root), 'utf8');
    const request = execFileSync('python3', ['-c',
      'import sys,yaml; print(yaml.safe_load(sys.stdin)["jobs"]["request"]["steps"][0]["run"])',
    ], { input: yaml, encoding: 'utf8' });
    const sha = 'a'.repeat(40);
    for (const [action, input, confirm, ref, expected] of [
      ['inspect', '', '', 'main', 0],
      ['inspect', sha, '', 'main', 1],
      ['promote', sha, 'PROMOTE', 'main', 0],
      ['promote', sha, 'ROLLBACK', 'main', 1],
      ['rollback', sha, 'ROLLBACK', 'main', 0],
      ['rollback', 'abc', 'ROLLBACK', 'main', 1],
      ['rollback', sha, 'ROLLBACK', 'feature', 1],
    ]) {
      const result = spawnSync('bash', ['-c', request], {
        env: {
          PATH: process.env.PATH,
          [modeKey]: action,
          SHA: input,
          CONFIRM: confirm,
          GITHUB_REF: 'refs/heads/' + ref,
          GITHUB_RUN_ATTEMPT: '1',
        },
      });
      assert.equal(result.status, expected, `${ref}: ${action} ${input} ${confirm}`);
    }
  });
}
