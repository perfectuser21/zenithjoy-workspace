export function requireBusinessDatabase() {
  const env = process.env;
  if (env.BUSINESS_PG_DISPOSABLE !== '1' || !['127.0.0.1', 'localhost', '::1'].includes(env.DATABASE_HOST ?? '') || env.DATABASE_NAME !== 'zenithjoy_business_contract_test' || !/^\d+$/.test(env.DATABASE_PORT ?? '') || Number(env.DATABASE_PORT) < 1 || Number(env.DATABASE_PORT) > 65535 || !env.DATABASE_USER || env.DATABASE_URL || env.PGOPTIONS) throw new Error('Business contracts require an explicit loopback disposable DATABASE_*; URLs/default/pre-existing databases are forbidden');
  return { host: env.DATABASE_HOST, port: Number(env.DATABASE_PORT), user: env.DATABASE_USER, password: env.DATABASE_PASSWORD };
}
requireBusinessDatabase();
for (const key of ['OPENROUTER_API_KEY','TOAPI_API_KEY','GEMINI_API_KEY','FEISHU_APP_SECRET','GH_SECRETS_WRITE_PAT']) delete process.env[key];
process.env.NODE_ENV = 'test';
process.env.VITEST = ''; // exercise production SQL branches, never built-in fake-empty responses
process.env.BETTER_AUTH_URL = 'http://localhost:5200';
process.env.BETTER_AUTH_SECRET = 'business-contract-local-auth-' + 'x'.repeat(32);
process.env.ZENITHJOY_INTERNAL_TOKEN = 'business-contract-local-internal';
