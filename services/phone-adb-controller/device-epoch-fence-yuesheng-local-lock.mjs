import { execFile } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { bytes, digest } from './device-epoch-fence-reference.mjs';
import { yueshengMigrationRoute as route } from './device-epoch-fence-yuesheng-readback.mjs';

const run = promisify(execFile);
const profile = 'wuying_android14';
const registry = 'config/collection-phone-hosts.json';
const artifacts = ['douyin-phone-adb', 'phone-lock-root.py', 'phone-lock-lib.sh', 'phone-lock-helper.py', registry];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const sha = /^[a-f0-9]{64}$/;

function need(value, reason) {
  if (value) return;
  const code = 'YUESHENG_MIGRATION_LOCAL_' + reason;
  throw Object.assign(Error(code), { code });
}

function frozenRegistry(controllerPath, manifest) {
  try {
    const root = dirname(controllerPath);
    let registered;
    for (const name of artifacts) {
      const rows = manifest.files.filter(entry => entry.deployed_path === name);
      const raw = bytes(join(root, name));
      need(rows.length === 1 && rows[0].path === 'services/phone-adb-controller/' + name
        && rows[0].content_sha256 === digest(raw), 'CANDIDATE');
      if (name === registry) registered = JSON.parse(raw);
    }
    const matches = registered.hosts.filter(row => row.profile === profile);
    need(matches.length === 1 && matches[0].target === 'mmv'
      && matches[0].serial === route.physical_serial, 'CANDIDATE');
    return matches[0].serial;
  } catch {
    need(false, 'CANDIDATE');
  }
}

function observed(result, owner, manifest) {
  const observation = result?.observation;
  return result?.protocol === 'yuesheng-adb-migration-transaction/v1' && result.status === 'observed'
    && sha.test(result.plan_sha256 ?? '') && observation?.protocol === 'yuesheng-adb-migration-observation/v1'
    && observation.authorization === 'none' && observation.task_id === owner
    && ['source_commit', 'release_id', 'observation_id'].every(key => observation[key] === manifest[key])
    && ['physical_serial', 'transport_serial', 'old_endpoint', 'new_endpoint'].every(key => observation[key] === route[key])
    && sha.test(observation.readback_sha256 ?? '');
}

export function createYueshengLocalDeviceGuard({ controllerPath, manifest: installedManifest, owner, invoke = run }) {
  const manifest = structuredClone(installedManifest);
  need(typeof controllerPath === 'string' && isAbsolute(controllerPath) && basename(controllerPath) === 'douyin-phone-adb'
    && uuid.test(owner ?? '') && typeof invoke === 'function', 'SCOPE');
  need(manifest?.target === 'mmv' && manifest.source_repo === 'perfectuser21/zenithjoy-workspace'
    && /^[a-f0-9]{40}$/.test(manifest.source_commit ?? '') && manifest.environment === 'staging:' + manifest.source_commit
    && uuid.test(manifest.release_id ?? '') && uuid.test(manifest.observation_id ?? '') && Array.isArray(manifest.files), 'CANDIDATE');

  return async function withDeviceGuard(serial, callback) {
    need(serial === route.physical_serial && typeof callback === 'function', 'SCOPE');
    const physical = frozenRegistry(controllerPath, manifest);
    const directory = mkdtempSync(join(realpathSync(tmpdir()), 'zj-yuesheng-lock-'));
    // Older runs address the common lock root by the transport locator.
    const bindings = [
      { name: 'legacy', serial: route.transport_serial, owner: owner + '-legacy' },
      { name: 'physical', serial: physical, owner },
    ].map(lock => ({
      ...lock,
      registryPath: join(directory, `${lock.name}-profiles.tsv`),
      // The lock-only CLI does not use display metadata.
      tsv: Buffer.from('profile\tserial\tmodel\twidth\theight\tenabled\n'
        + `${profile}\t${lock.serial}\tlock-only\t1\t1\ttrue\n`),
    }));
    let active = true, uncertainHold = false, pending = 0;
    const command = async (binding, verb, reason) => {
      try {
        need(frozenRegistry(controllerPath, manifest) === physical
          && bytes(binding.registryPath).equals(binding.tsv), reason);
        const args = [controllerPath, '--profile', profile, verb];
        if (verb !== 'lock-status') args.push(binding.owner);
        const env = { HOME: userInfo().homedir, PATH: '/opt/homebrew/bin:/usr/bin:/bin',
          DOUYIN_ADB_BIN: '/usr/bin/false', DOUYIN_PHONE_REGISTRY: binding.registryPath };
        const reply = await invoke('/bin/zsh', args, { env, encoding: 'utf8', timeout: 15_000, maxBuffer: 8192 });
        need(typeof reply?.stdout === 'string' && reply.stderr === '', reason);
        return reply.stdout;
      } catch {
        need(false, reason);
      }
    };
    const marker = (binding, kind, state) => {
      const id = `${binding.owner}-lock-${kind}`;
      return `lock_evidence_id=${id} lock_evidence=/private/tmp/openclaw-phone/evidence/${profile}/${id}.json readback_state=${state}\n`;
    };
    const readHeld = async (binding, reason) => {
      const stdout = await command(binding, 'lock-status', reason);
      const held = stdout.match(/^lock=held owner=([^ ]+) age=(0|[1-9][0-9]*)s stale=false reclaimable=false ttl=1800s\n$/);
      need(held?.[0] === stdout && held[1] === binding.owner && Number(held[2]) <= 1800, reason);
    };
    const assertHeld = async () => {
      need(active && !uncertainHold, 'HELD_UNKNOWN');
      pending += 1;
      try {
        for (const binding of bindings) await readHeld(binding, 'HELD_UNKNOWN');
        need(active && !uncertainHold, 'HELD_UNKNOWN');
      } catch (error) {
        uncertainHold = true;
        throw error;
      } finally {
        pending -= 1;
      }
    };
    try {
      for (const binding of bindings) writeFileSync(binding.registryPath, binding.tsv, { flag: 'wx', mode: 0o600 });
      const initial = await Promise.all(bindings.map(binding => command(binding, 'lock-status', 'NOT_FREE')));
      need(initial.every(status => status === 'lock=free\n'), 'NOT_FREE');
      for (const binding of bindings) {
        const acquired = await command(binding, 'lock-acquire-new', 'ACQUIRE_UNKNOWN');
        need(acquired === `run_claim=recorded owner=${binding.owner}\nlock=acquired owner=${binding.owner}\n`
          + marker(binding, 'acquire', 'held'), 'ACQUIRE_UNKNOWN');
      }
      await assertHeld();
      const result = await callback(Object.freeze({ assertHeld }));
      need(pending === 0 && observed(result, owner, manifest), 'RESULT_UNKNOWN');
      await assertHeld();
      need(pending === 0, 'HELD_UNKNOWN');
      active = false;

      for (const binding of bindings) {
        await readHeld(binding, 'RELEASE_UNKNOWN');
        const released = await command(binding, 'lock-release-exact', 'RELEASE_UNKNOWN');
        need(released === `lock=released owner=${binding.owner}\n` + marker(binding, 'release', 'free'), 'RELEASE_UNKNOWN');
        need(await command(binding, 'lock-status', 'RELEASE_UNKNOWN') === 'lock=free\n', 'RELEASE_UNKNOWN');
      }
      return result;
    } finally {
      active = false;
      rmSync(directory, { recursive: true, force: true });
    }
  };
}
