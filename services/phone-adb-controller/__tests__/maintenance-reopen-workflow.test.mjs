import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const workflow=readFileSync(join(root,'.github/workflows/phone-review-reopen.yml'),'utf8');
const remote=readFileSync(join(root,'.github/workflows/scripts/phone-review-reopen-remote.sh'),'utf8');

test('受控 reopen 只有人工 dispatch，Pilot 同 SHA 来源和独立两阶段',()=>{
 assert.match(workflow,/workflow_dispatch:/);
 assert.doesNotMatch(workflow,/workflow_run:|schedule:|push:/);
 assert.match(workflow,/implementation_run_id:/);
 assert.match(workflow,/phone-deploy-evidence\.mjs/);
 assert.match(workflow,/options: \[prepare, finalize\]/);
 assert.doesNotMatch(workflow,/\bpromote\b|maintenance-install/);
 assert.match(workflow,/concurrency:\s*\n\s*group: deploy-phone-adb-controller/);
});

test('远端仅向 M4 安装固定源码工具，正式 Host 读回后才返回，不恢复旧候选',()=>{
 assert.match(remote,/git -C "\$REPO" archive "\$SHA"/);
 assert.match(remote,/git -C .* rev-parse/);
 assert.match(remote,/xian-m4/);
 assert.match(remote,/maintenance-reopen-host\.py/);
 assert.match(remote,/<\/dev\/null/);
 assert.doesNotMatch(remote,/phone-candidates\.sealed\.[^\n]*mv|docker rm|launchctl bootstrap|crontab -/);
});
