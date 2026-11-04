/** These contracts may write only to databases created by the dedicated test runner. */
export function requireDisposableDatabases() {
  const env = process.env;
  if (env.PG_CONTRACTS_DISPOSABLE !== '1' || !['127.0.0.1', 'localhost', '::1'].includes(env.DATABASE_HOST ?? '') || env.DATABASE_NAME !== 'zenithjoy_contract_test' || !/^\d+$/.test(env.DATABASE_PORT ?? '') || Number(env.DATABASE_PORT) < 1 || Number(env.DATABASE_PORT) > 65535 || !env.DATABASE_USER) {
    throw new Error('PG contracts require explicit loopback DATABASE_* and PG_CONTRACTS_DISPOSABLE=1; no production/default database is permitted');
  }
  let scratch: URL;
  const scratchUrl=env.COMPANY_CONFIG_SCRATCH_URL ?? '';
  try {
    if (scratchUrl.includes('?') || scratchUrl.includes('#')) throw new Error('parameters forbidden');
    scratch = new URL(scratchUrl);
  } catch {
    // Do not attach the native URL error: it contains the original URL/password.
    throw new Error('Company scratch URL must target cecelia_scratch on the same disposable PostgreSQL instance');
  }
  if (!['postgres:', 'postgresql:'].includes(scratch.protocol) || scratch.search || scratch.hash || scratch.hostname !== env.DATABASE_HOST || scratch.port !== env.DATABASE_PORT || decodeURIComponent(scratch.username) !== env.DATABASE_USER || scratch.pathname !== '/cecelia_scratch') {
    throw new Error('Company scratch URL must target cecelia_scratch on the same disposable PostgreSQL instance');
  }
  return { host: env.DATABASE_HOST, port: Number(env.DATABASE_PORT), user: env.DATABASE_USER, password: env.DATABASE_PASSWORD };
}
