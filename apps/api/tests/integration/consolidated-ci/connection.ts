export function disposableConnection() {
  const host = process.env.DATABASE_HOST;
  const port = Number(process.env.DATABASE_PORT);
  if (process.env.PG_CONSOLIDATION_DISPOSABLE !== '1' || !['127.0.0.1', 'localhost'].includes(host ?? '')
      || !Number.isInteger(port) || port < 1 || port > 65535 || !process.env.DATABASE_USER
      || process.env.DATABASE_NAME !== 'zenithjoy_consolidation_test') {
    throw new Error('explicit loopback disposable zenithjoy_consolidation_test database required');
  }
  return { host, port, user: process.env.DATABASE_USER, password: process.env.DATABASE_PASSWORD, database: 'zenithjoy_consolidation_test' };
}
