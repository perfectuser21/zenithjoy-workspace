import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recoverPhones, targetsForHost, usbPortFor, honorDisks } from '../phone-recovery.mjs';

const target = { profile: 'legacy', serial: 'SERIAL1' };
const hub = 'Current status for hub 2-1 [Apple, 2 ports, ppps]\n  Port 1: 0503 power connect [339b:107d HONOR MAA-AN00 SERIAL1]\n  Port 2: 0503 power connect [other SERIAL2]';
function rig({ online = false, locked = false, recover = false, usb = hub } = {}) {
  const calls = [];
  let cycled = false;
  const run = (bin, args) => {
    calls.push([bin, ...args]);
    if (bin === 'adb') return { status: 0, stdout: `List of devices attached\n${online || (recover && cycled) ? 'SERIAL1\tdevice\n' : ''}` };
    if (bin === 'ctl') return { status: 0, stdout: args.includes('lock-status') ? `lock=${locked ? 'held owner=harvest' : 'free'}` : 'lock=acquired' };
    if (bin === 'hub') { if (args.includes('cycle')) cycled = true; return { status: 0, stdout: usb }; }
    if (bin === 'profiler') return { status: 0, stdout: JSON.stringify({ serial_num: 'SERIAL1', volumes: [{ volume_name: 'HonorSuite', bsd_name: 'disk7s1' }] }) };
    return { status: 0, stdout: 'OK' };
  };
  const alerts = [];
  return { calls, alerts, options: { targets: [target], run, sleep: async () => {}, notify: async x => alerts.push(x), bins: { adb: 'adb', ctl: 'ctl', hub: 'hub', profiler: 'profiler', disk: 'disk' }, state: {}, now: 100000, log: () => {}, acquire: (serial, owner) => run('ctl', ['--profile', 'legacy', 'lock-acquire', owner]).status === 0, owns: () => true } };
}
test('正常设备不弹光盘不cycle', async () => {
  const r = rig({ online: true });
  assert.equal((await recoverPhones(r.options)).ok, true);
  assert.equal(r.calls.some(x => x.includes('cycle') || x.includes('eject')), false);
});
test('离线手机先锁再定向eject和cycle，失败告警包含serial且放锁', async () => {
  const r = rig();
  const out = await recoverPhones(r.options);
  assert.equal(out.ok, false);
  const acquire = r.calls.findIndex(x => x.includes('lock-acquire'));
  const eject = r.calls.findIndex(x => x.includes('eject'));
  const cycle = r.calls.findIndex(x => x.includes('cycle'));
  assert.ok(acquire >= 0 && eject > acquire && cycle > eject);
  assert.deepEqual(r.calls[cycle], ['hub', '-l', '2-1', '-p', '1', '-a', 'cycle', '-d', '2']);
  assert.ok(r.calls.some(x => x.includes('lock-release')));
  assert.match(r.alerts[0], /SERIAL1/);
});
test('持锁设备即使过期也不抢占不变更USB', async () => {
  const r = rig({ locked: true });
  await recoverPhones(r.options);
  assert.equal(r.calls.some(x => x.includes('lock-acquire') || x.includes('cycle') || x.includes('eject')), false);
});
test('端口归属变化后禁止cycle；USB拓扑必须ppps且精确serial匹配', async () => {
  assert.equal(usbPortFor(hub.replace('ppps', 'ganged'), 'SERIAL1'), null);
  assert.equal(usbPortFor(hub, 'SERIAL'), null);
  const r = rig({ usb: hub.replace('SERIAL1', 'OTHER') });
  await recoverPhones(r.options);
  assert.equal(r.calls.some(x => x.includes('cycle') || x.includes('eject')), false);
});
test('cycle后恢复停止告警；冷却期不重复断电并保留offline结果', async () => {
  const r = rig({ recover: true });
  assert.equal((await recoverPhones(r.options)).ok, true);
  assert.equal(r.alerts.length, 0);
  const offline = rig();
  offline.options.state.SERIAL1 = { lastAttempt: 99000, lastAlert: 99000 };
  assert.equal((await recoverPhones(offline.options)).ok, false);
  assert.equal(offline.calls.some(x => x.includes('cycle')), false);
  assert.equal(offline.alerts.length, 0);
});
test('registry只选本机；HonorSuite eject必须在目标serial下', () => {
  assert.deepEqual(targetsForHost('a\tSERIAL1\tMODEL\t1\t2\t名称\txian-m4\nb\tSERIAL2\tMODEL\t1\t2\t名称\txian-m1', 'xian-m4'), [{ profile: 'a', serial: 'SERIAL1' }]);
  assert.deepEqual(honorDisks({ items: [{ serial_num: 'OTHER', volumes: [{ volume_name: 'HonorSuite', bsd_name: 'disk9s1' }] }, { serial_num: 'SERIAL1', volumes: [{ volume_name: 'HonorSuite', bsd_name: 'disk7s1' }, { volume_name: 'Photos', bsd_name: 'disk8s1' }] }] }, 'SERIAL1'), ['disk7']);
});
test('启动安装随部署执行；采收离线预检保留可见日志及事件', () => {
  const deploy = readFileSync(new URL('../deploy.sh', import.meta.url), 'utf8');
  assert.match(deploy, /phone-recovery\.mjs/);
  assert.match(deploy, /install-phone-recovery\.sh/);
  const wf = readFileSync(new URL('../wf-run.sh', import.meta.url), 'utf8');
  assert.match(wf, /log "设备离线,退出"/);
  assert.match(wf, /wr fail "\$SERIAL" 1 device_offline/);
});

test('不回收任何既有设备锁目录，含owner尚未写的起锁窗口', async () => {
  const { acquireRecoveryLock } = await import('../phone-recovery.mjs');
  const { mkdtempSync, mkdirSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const root = mkdtempSync(`${tmpdir()}/recovery-lock-`);
  try {
    mkdirSync(`${root}/SERIAL1.lock`);
    assert.equal(acquireRecoveryLock(root, 'SERIAL1', 'recovery'), false);
    assert.equal(acquireRecoveryLock(root, 'SERIAL2', 'recovery'), true);
    assert.equal(readFileSync(`${root}/SERIAL2.lock/owner`, 'utf8').trim(), 'recovery');
    assert.match(readFileSync(`${root}/SERIAL2.lock/acquired_at`, 'utf8'), /^\d+\n$/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('动作前持久化恢复时间；USB操作异常后重启仍受冷却保护', async () => {
  const r = rig();
  const saved = {};
  const actualRun = r.options.run;
  r.options.persist = (serial, patch) => { Object.assign(saved, patch); };
  r.options.run = (bin, args) => {
    if (args.includes('cycle')) { assert.equal(saved.lastAttempt, r.options.now); throw Error('模拟恢复操作中断'); }
    return actualRun(bin, args);
  };
  await recoverPhones(r.options);
  assert.equal(saved.lastAttempt, 100000);
  assert.ok(r.calls.some(x => x.includes('lock-release')));
  const next = rig();
  next.options.state.SERIAL1 = saved;
  next.options.now = 101000;
  await recoverPhones(next.options);
  assert.equal(next.calls.some(x => x.includes('cycle')), false);
});

test('拿锁后重新读取冷却，不能使用拿锁前的过期state重复cycle', async () => {
  const r = rig();
  r.options.loadState = () => ({ lastAttempt: 99000 });
  const result = await recoverPhones(r.options);
  assert.equal(result.ok, false);
  assert.equal(r.calls.some(x => x.includes('cycle') || x.includes('eject')), false);
  assert.ok(r.calls.some(x => x.includes('lock-release')));
});

test('安装bootstrap失败后，plist相同的下一次部署仍可重新加载', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync, rmSync } = await import('node:fs');
  const { spawnSync } = await import('node:child_process');
  const root = mkdtempSync('/tmp/phone-install-');
  try {
    mkdirSync(`${root}/bin-harvest`); mkdirSync(`${root}/daemons`); mkdirSync(`${root}/mockbin`);
    writeFileSync(`${root}/bin-harvest/phone-recovery.mjs`, 'export {};');
    writeFileSync(`${root}/mockbin/sudo`, `#!/bin/bash\nshift\ncase "$1" in\n install) cp "\${@: -2:1}" "\${@: -1}";;\n launchctl)\n case "$2" in\n print) test -f "$HOME/loaded";;\n bootstrap) if [[ ! -f "$HOME/first-failed" ]]; then touch "$HOME/first-failed"; exit 1; fi; touch "$HOME/loaded";;\n bootout) rm -f "$HOME/loaded";;\n esac;;\n *) exit 99;;\n esac\n`);
    chmodSync(`${root}/mockbin/sudo`, 0o755);
    const script = readFileSync(new URL('../install-phone-recovery.sh', import.meta.url), 'utf8').replaceAll('/Library/LaunchDaemons', `${root}/daemons`).replace('/usr/bin/plutil', 'true');
    const execute = () => spawnSync('/bin/bash', ['-c', script, 'install', 'xian-m4'], { encoding: 'utf8', env: { ...process.env, HOME: root, PATH: `${root}/mockbin:${process.env.PATH}` } });
    assert.notEqual(execute().status, 0, '首次bootstrap应失败');
    assert.equal(execute().status, 0, '同plist重试应bootstrap成功');
    assert.ok(existsSync(`${root}/loaded`));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
