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
  return { calls, alerts, options: { targets: [target], run, sleep: async () => {}, notify: async x => alerts.push(x), bins: { adb: 'adb', ctl: 'ctl', hub: 'hub', profiler: 'profiler', disk: 'disk' }, state: {}, now: 100000, log: () => {} } };
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
