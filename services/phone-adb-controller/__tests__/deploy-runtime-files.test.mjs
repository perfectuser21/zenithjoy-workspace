import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('正式部署在系统 bash nounset 下组装完整去重的 MMV 运行包，SSH 前不报空数组错误', () => {
  const path = fileURLToPath(new URL('../deploy.sh', import.meta.url));
  const source = readFileSync(path, 'utf8');
  const marker = '# 在任何SSH前核验部署源字节';
  assert.ok(source.includes(marker));
  const prefix = source.slice(0, source.indexOf(marker));
  const result = spawnSync('/bin/bash', ['-c', prefix + `
    printf 'RUNTIME:%s\n' "\${MMV_RUNTIME_FILES[@]}"
    printf 'EXPECTED:%s\n' "\${DEVICE_SH_FILES[@]}" "\${DEVICE_NODE_FILES[@]}" "\${DEVICE_PLAN_FILES[@]}" "\${DEVICE_RPC_PROBE_FILES[@]}" "\${DEVICE_CTL_FILES[@]}" "\${MMV_JS_FILES[@]}" "\${MMV_PROBE_FILES[@]}"
  `, path], {encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split('\n');
  const runtime = lines.filter(x=>x.startsWith('RUNTIME:')).map(x=>x.slice(8));
  const expected = lines.filter(x=>x.startsWith('EXPECTED:')).map(x=>x.slice(9));
  assert.equal(runtime.length, new Set(runtime).size);
  assert.deepEqual(new Set(runtime), new Set(expected));
  assert.ok(runtime.includes('leadgen-workflow.mjs'));
  assert.ok(runtime.includes('plans/douyin_comment_scoring.plan'));
});
