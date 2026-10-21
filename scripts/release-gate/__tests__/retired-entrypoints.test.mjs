import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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
