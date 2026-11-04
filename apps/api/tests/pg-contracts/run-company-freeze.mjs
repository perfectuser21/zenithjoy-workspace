import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const companyFreezeTestName = 'Postgres公司隔离、幂等快照、跨版本恢复、不可变约束';
const contract = fileURLToPath(new URL('../../../../services/phone-adb-controller/__tests__/company-config-postgres.test.mjs', import.meta.url));

// Called only inside the disposable database lifecycle. Never forward a raw URL.
export function runCompanyFreezePostgres(connection, testFile = contract) {
  if (!['localhost', '127.0.0.1'].includes(connection.host) || !Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535 || !connection.user) {
    throw new Error('Company freeze contract requires explicit loopback PostgreSQL');
  }
  const url = new URL('postgresql://127.0.0.1');
  url.hostname = connection.host;
  url.port = String(connection.port);
  url.username = connection.user;
  url.password = connection.password ?? '';
  url.pathname = '/cecelia_scratch';
  const env = { ...process.env, COMPANY_CONFIG_SCRATCH_URL: url.href };
  delete env.DATABASE_URL;
  delete env.DB;
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', testFile], { env, encoding: 'utf8', timeout: 30_000 });
  if (result.error || result.status !== 0) throw new Error('Company freeze PostgreSQL child failed');
  const count = name => Number(result.stdout.match(new RegExp(`^# ${name} (\\d+)$`, 'm'))?.[1] ?? NaN);
  if (!result.stdout.includes(`# Subtest: ${companyFreezeTestName}\n`) || !(count('tests') > 0) || count('pass') !== count('tests') || count('fail') !== 0 || count('skipped') !== 0) {
    throw new Error('Company freeze PostgreSQL child did not execute all required assertions');
  }
  return result.stdout;
}
