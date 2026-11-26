import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { verifyYueshengMigrationReadback } from '../device-epoch-fence-yuesheng-readback.mjs';

import { now, oldEndpoint, newEndpoint, physicalSerial, transportSerial, sha, releaseId, at, route, fixture } from './fixtures/yuesheng-migration-readback.mjs';

test('验证先 5044 后 5045 各只见同一物理设备，维护锁贯穿两次观察', () => {
  const result = verifyYueshengMigrationReadback(fixture(), now);
  assert.equal(result.physical_serial, physicalSerial);
  assert.equal(result.transport_serial, transportSerial);
  assert.equal(result.source_commit, sha);
  assert.equal(result.old_endpoint, oldEndpoint);
  assert.equal(result.new_endpoint, newEndpoint);
  assert.equal(result.lease_version, '55042631');
  assert.equal(result.authorization, 'none');
  assert.match(result.readback_sha256, /^[a-f0-9]{64}$/);
});

for (const [name, change, error] of [
  ['拒绝把旧 5041 / 5042 包装成此次迁移', x => { x.before.old_route = route('tcp:127.0.0.1:5041', x.before.old_route.devices); x.after.new_route = route('tcp:127.0.0.1:5042', x.after.new_route.devices); }, 'OLD_ROUTE_BEFORE'],
  ['拒绝新监听已启动但仍为空', x => { x.after.new_route.devices = []; }, 'NEW_ROUTE_AFTER'],
  ['拒绝新设备未授权', x => { x.after.new_route.devices = [{ serial: transportSerial, state: 'unauthorized' }]; }, 'NEW_ROUTE_AFTER'],
  ['拒绝同一手机还在老路由', x => { x.after.old_route.devices = x.before.old_route.devices; }, 'OLD_ROUTE_AFTER'],
  ['拒绝未知的额外设备', x => { x.after.new_route.devices = [...x.after.new_route.devices, { serial: 'extra', state: 'device' }]; }, 'NEW_ROUTE_AFTER'],
  ['拒绝只有 TCP 地址且无真实物理读回', x => { delete x.after.physical_readback['ro.serialno']; }, 'NEW_IDENTITY'],
  ['拒绝物理序号不匹配', x => { x.after.physical_readback['ro.serialno'].value = 'OTHER'; }, 'NEW_IDENTITY'],
  ['拒绝物理读回来料用了另一 ADB 地址', x => { x.after.physical_readback.transport_serial = '127.0.0.1:12345'; }, 'NEW_IDENTITY'],
  ['拒绝用上次 claim 以前的读回复用本次授权', x => { x.before.observed_at = at(-91000); x.before.physical_readback.observed_at = x.before.observed_at; }, 'OBSERVATION_WINDOW'],
  ['拒绝活动租约内重放过期的读回', x => { x.task.claimed_at = at(-200000); for (const lock of [x.current_lock, x.before.lock, x.after.lock]) lock.locked_at = at(-195000); x.before.observed_at = at(-121000); x.before.physical_readback.observed_at = x.before.observed_at; }, 'OBSERVATION_WINDOW'],
  ['拒绝新一轮租约复用旧证据', x => { x.current_lock.lease_version = '55042632'; }, 'LEASE_CHANGED'],
  ['拒绝没有原任务持锁', x => { x.current_lock.locked_by = null; }, 'LEASE'],
  ['拒绝引用另一份候选观测', x => { x.candidate.gate.current_observation_id = releaseId; }, 'CANDIDATE_GATE'],
  ['拒绝候选保留旧的认证 verifier', x => { x.candidate.manifest.files.find(row => row.deployed_path === 'device-epoch-fence-review.mjs').content_sha256 = '0'.repeat(64); }, 'CANDIDATE_STARTUP_SOURCE'],
  ['拒绝候选缺少现役登记摘要', x => { x.candidate.manifest.files[0].content_sha256 = '0'.repeat(64); }, 'CANDIDATE_REGISTRY'],
]) {
  test(name, () => {
    const value = fixture();
    change(value);
    assert.throws(() => verifyYueshengMigrationReadback(value, now), { code: `YUESHENG_MIGRATION_${error}` });
  });
}


test('只读 CLI 输出核验结果并保留输入原件，旧证据退出失败', t => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'yuesheng-migration-readback-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const input = join(directory, 'readback.json');
  const executable = fileURLToPath(new URL('../device-epoch-fence-yuesheng-readback.mjs', import.meta.url));
  const current = JSON.stringify(fixture(Date.now()));
  writeFileSync(input, current, { mode: 0o600 });
  const pass = spawnSync(process.execPath, [executable, input], { encoding: 'utf8' });
  assert.equal(pass.status, 0, pass.stderr);
  assert.equal(JSON.parse(pass.stdout).authorization, 'none');
  assert.equal(readFileSync(input, 'utf8'), current);
  writeFileSync(input, JSON.stringify(fixture(now - 86400000)), { mode: 0o600 });
  const refused = spawnSync(process.execPath, [executable, input], { encoding: 'utf8' });
  assert.equal(refused.status, 1);
  assert.equal(refused.stderr.trim(), 'YUESHENG_MIGRATION_OBSERVATION_WINDOW');
  assert.equal(refused.stdout, '');
});
