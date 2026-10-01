// 开机与定时只读自检；离线时在设备锁内定向恢复，不代替手机端USB授权。
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function targetsForHost(text, host) {
  const targets = [];
  for (const row of text.split(/\r?\n/)) {
    if (!row || row.startsWith('#')) continue;
    const [profile, serial, , , , , machine] = row.split('\t');
    if (machine === host && /^[A-Za-z0-9_-]+$/.test(serial) && !targets.some(x => x.serial === serial)) targets.push({ profile, serial });
  }
  return targets;
}

export function usbPortFor(text, serial) {
  let hub = null;
  for (const row of text.split(/\r?\n/)) {
    const header = row.match(/^Current status for hub ([\d-]+) \[.*\bppps\]/);
    if (row.startsWith('Current status for hub ')) hub = header?.[1] ?? null;
    const port = row.match(/^\s+Port (\d+):.*\[339b:[\da-f]+ HONOR .* ([A-Za-z0-9_-]+)\]$/i);
    if (hub && port?.[2] === serial) return { hub, port: port[1] };
  }
  return null;
}

export function honorDisks(tree, serial) {
  const disks = new Set();
  function walk(value, owner) {
    if (!value || typeof value !== 'object') return;
    if (!Array.isArray(value)) owner = value.serial_num || owner;
    if (owner === serial && (value.volume_name || value._name) === 'HonorSuite' && /^disk\d+(s\d+)?$/.test(value.bsd_name || '')) disks.add(value.bsd_name.replace(/s\d+$/, ''));
    for (const child of Object.values(value)) if (child && typeof child === 'object') walk(child, owner);
  }
  walk(tree, null);
  return [...disks];
}

export function acquireRecoveryLock(root, serial, owner) {
  mkdirSync(root, { recursive: true });
  const lock = join(root, `${serial}.lock`);
  try { mkdirSync(lock); } catch { return false; }
  writeFileSync(join(lock, 'acquired_at'), `${Math.floor(Date.now() / 1000)}\n`);
  writeFileSync(join(lock, 'owner'), `${owner}\n`);
  return true;
}

export async function recoverPhones({ targets, run, sleep, notify, bins, state, now, log, acquire, owns = () => false, loadState = () => null, persist = () => {} }) {
  const results = [];
  const call = (bin, args) => run(bins[bin], args);
  const online = serial => {
    const out = call('adb', ['devices']);
    return out.status === 0 && out.stdout.split(/\r?\n/).some(x => x.trim() === `${serial}\tdevice`);
  };
  for (const { profile, serial } of targets) {
    if (online(serial)) { results.push({ serial, status: 'online' }); continue; }
    const record = state[serial] ||= {};
    let reason = '设备离线';
    if (record.lastAttempt && now - record.lastAttempt < 21600000) reason = '设备离线，恢复冷却中';
    else {
      const lock = call('ctl', ['--profile', profile, 'lock-status']);
      if (lock.status !== 0 || lock.stdout.trim() !== 'lock=free') reason = '设备离线，锁被占或不可确认';
      else {
        const owner = `phone-recovery-${process.pid}-${now}`;
        const acquired = acquire?.(serial, owner);
        if (!acquired) reason = '设备离线，拿锁失败';
        else {
          try {
            if (online(serial)) { results.push({ serial, status: 'online' }); continue; }
            Object.assign(record, loadState(serial) || {});
            if (record.lastAttempt && now - record.lastAttempt < 21600000) throw new Error('设备离线，恢复冷却中');
            const before = call('hub', []);
            const port = before.status === 0 ? usbPortFor(before.stdout, serial) : null;
            if (!port) reason = '设备离线，USB目标端口未确认，禁止恢复';
            else {
              record.lastAttempt = now;
              persist(serial, { lastAttempt: now });
              const inventory = call('profiler', ['SPUSBDataType', '-json']);
              let disks = [];
              if (inventory.status === 0) { try { disks = honorDisks(JSON.parse(inventory.stdout), serial); } catch { log(`${serial} USB清单解析失败，不弹盘`); } }
              for (const disk of disks) {
                if (!owns(serial, owner)) throw new Error('设备锁归属变化，禁止弹盘');
                const out = call('disk', ['eject', disk]);
                log(`${serial} HonorSuite eject ${disk} exit=${out.status}`);
              }
              await sleep(2000);
              if (!online(serial)) {
                const topology = call('hub', []);
                const current = topology.status === 0 ? usbPortFor(topology.stdout, serial) : null;
                if (current?.hub === port.hub && current?.port === port.port && owns(serial, owner)) {
                  const out = call('hub', ['-l', port.hub, '-p', port.port, '-a', 'cycle', '-d', '2']);
                  log(`${serial} cycle hub=${port.hub} port=${port.port} exit=${out.status}`);
                  await sleep(8000);
                } else log(`${serial} USB端口归属变化，禁止cycle`);
              }
              reason = '设备离线，定向恢复后仍无ADB；检查手机USB传输模式与调试授权';
            }
          } catch (err) { reason = err.message; } finally {
            const released = call('ctl', ['--profile', profile, 'lock-release', owner]);
            log(`${serial} lock-release exit=${released.status}`);
          }
        }
      }
    }
    if (online(serial)) { results.push({ serial, status: 'recovered' }); log(`${serial} ADB已恢复`); continue; }
    log(`${serial} ${reason}`);
    results.push({ serial, status: 'offline', reason });
    if (!record.lastAlert || now - record.lastAlert >= 21600000) {
      if (await notify(`${hostname()} ${serial} ${reason}`)) { record.lastAlert = now; persist(serial, { lastAlert: now }); }
    }
  }
  return { ok: targets.length > 0 && results.every(x => x.status !== 'offline'), results };
}

async function main() {
  const base = join(homedir(), '.config/zenithjoy');
  mkdirSync(base, { recursive: true });
  const loadState = serial => {
    const record = {};
    for (const key of ['lastAttempt', 'lastAlert']) {
      try { record[key] = Number(readFileSync(join(base, `phone-recovery-${serial}.${key}`), 'utf8')); } catch {}
    }
    return record;
  };
  const persist = (serial, patch) => {
    // 恢复和告警分文件，持锁恢复与离线告警并发时不会互相覆盖冷却。
    for (const [key, value] of Object.entries(patch)) {
      const file = join(base, `phone-recovery-${serial}.${key}`);
      const temp = `${file}.${process.pid}.new`;
      writeFileSync(temp, String(value), { mode: 0o600 });
      renameSync(temp, file);
    }
  };
  const run = (bin, args) => {
    const out = spawnSync(bin, args, { encoding: 'utf8', timeout: 45000, maxBuffer: 4 * 1024 * 1024 });
    return { status: out.status ?? 1, stdout: out.stdout || '' };
  };
  {
    const state = {};
    const targets = targetsForHost(readFileSync(join(homedir(), '.config/openclaw/douyin-phone-profiles.tsv'), 'utf8'), process.env.PHONE_RECOVERY_HOST || '');
    for (const { serial } of targets) state[serial] = loadState(serial);
    const root = '/private/tmp/openclaw-phone/locks';
    const acquire = (serial, owner) => acquireRecoveryLock(root, serial, owner);
    const owns = (serial, owner) => { try { return readFileSync(join(root, `${serial}.lock/owner`), 'utf8').trim() === owner; } catch { return false; } };
    const bins = { adb: '/opt/homebrew/bin/adb', ctl: join(homedir(), '.local/bin/douyin-phone-adb'), hub: '/opt/homebrew/bin/uhubctl', profiler: '/usr/sbin/system_profiler', disk: '/usr/sbin/diskutil' };
    const notify = async body => {
      const out = run('/usr/bin/ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'mmv', 'node', '/Users/administrator/.openclaw/leadgen-scripts/notify-bark.js', Buffer.from('手机ADB自检异常').toString('base64'), Buffer.from(body).toString('base64'), 'timeSensitive']);
      const ok = out.status === 0 && out.stdout.includes('BARK_OK');
      console.log(`PHONE_RECOVERY bark=${ok ? 'sent' : 'failed'}`);
      return ok;
    };
    const log = text => console.log(`${new Date().toISOString()} PHONE_RECOVERY ${text}`);
    const result = await recoverPhones({ targets, run, sleep: ms => new Promise(resolve => setTimeout(resolve, ms)), notify, bins, state, now: Date.now(), log, acquire, owns, loadState, persist });
    if (!targets.length) { log('本机registry无目标，配置失败'); process.exitCode = 1; }
    log(JSON.stringify(result));
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(err => { console.error(`PHONE_RECOVERY fatal: ${err.message}`); process.exitCode = 1; });
