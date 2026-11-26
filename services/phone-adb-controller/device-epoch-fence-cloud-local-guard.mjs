import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { userInfo } from 'node:os';
import { bytes, digest } from './device-epoch-fence-reference.mjs';
import { cloudFenceRoute } from './device-epoch-fence-cloud-migration.mjs';

const helper = fileURLToPath(new URL('./device-epoch-fence-cloud-guard.py', import.meta.url));
const error = () => Object.assign(Error('CLOUD_FENCE_LOCAL_GUARD'), { code: 'CLOUD_FENCE_LOCAL_GUARD' });

export async function withCloudDeviceGuard({ serial, python, home = userInfo().homedir }, run) {
  if (serial !== cloudFenceRoute.serial || digest(bytes(python.path)) !== python.sha256) throw error();
  const child = spawn(python.path, ['-I', '-B', '-S', helper, join(home, '.local/share/zenithjoy/phone-locks'),
    '/private/tmp/openclaw-phone/locks', serial], {
    env: { PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'pipe', 'ignore'],
  });
  child.on('error', () => {});
  child.stdin.on('error', () => {});
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  const reader = createInterface({ input: child.stdout });
  const lines = reader[Symbol.asyncIterator]();
  const getHeld = async () => {
    let timer;
    try {
      const { value } = await Promise.race([lines.next(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(error()), 5000); })]);
      if (value !== 'held' || child.exitCode !== null || child.signalCode !== null) throw error();
    } finally { clearTimeout(timer); }
  };
  try {
    await getHeld();
    let checked = Promise.resolve();
    return await run({
      assertHeld() {
        checked = checked.then(async () => {
          if (!child.stdin.writable) throw error();
          child.stdin.write('assert\n');
          await getHeld();
        });
        return checked;
      },
    });
  } finally {
    child.stdin.end();
    try {
      let time;
      try { await Promise.race([closed, new Promise(resolve => { time = setTimeout(resolve, 5000); })]); }
      finally { clearTimeout(time); }
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await closed; }
    } finally { reader.close(); }
  }
}
