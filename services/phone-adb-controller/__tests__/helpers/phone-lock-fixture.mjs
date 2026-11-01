import { isAbsolute, resolve, sep } from 'node:path';

const TEMP_ROOTS = ['/tmp', '/private/tmp', '/var/folders', '/private/var/folders'];

function isolatedPath(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) return false;
  const normalized = resolve(path);
  return TEMP_ROOTS.some(root => normalized.startsWith(root + sep));
}

// Only Node's isolated test subprocesses may select an ephemeral lock root.
export function phoneLockFixtureEnv(registry, tmpRoot) {
  if (process.env.NODE_TEST_CONTEXT !== 'child-v8' || !isolatedPath(registry) || !isolatedPath(tmpRoot)) {
    throw new Error('PHONE_LOCK_FIXTURE_UNSAFE: registry and lock root must be isolated test paths');
  }
  return {
    DOUYIN_PHONE_REGISTRY: registry,
    DOUYIN_PHONE_TMP_ROOT: tmpRoot,
    DOUYIN_PHONE_LOCK_TEST_MODE: '1',
  };
}
