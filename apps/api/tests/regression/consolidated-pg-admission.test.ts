import { afterEach, expect, it, vi } from 'vitest';
import { disposableConnection } from '../integration/consolidated-ci/connection';
afterEach(() => vi.unstubAllEnvs());
const fixture = () => {
  for (const [key, value] of Object.entries({ PG_CONSOLIDATION_DISPOSABLE: '1', DATABASE_HOST: '127.0.0.1', DATABASE_PORT: '5432', DATABASE_USER: 'postgres', DATABASE_NAME: 'zenithjoy_consolidation_test' })) vi.stubEnv(key, value);
};
it('accepts explicit isolated loopback configuration', () => {
  fixture(); expect(disposableConnection()).toMatchObject({ host: '127.0.0.1', port: 5432, database: 'zenithjoy_consolidation_test' });
});
it.each([
  ['PG_CONSOLIDATION_DISPOSABLE', ''], ['DATABASE_HOST', 'production.example.test'],
  ['DATABASE_NAME', 'cecelia'], ['DATABASE_NAME', 'zenithjoy'], ['DATABASE_NAME', ''],
  ['DATABASE_PORT', '0'], ['DATABASE_PORT', 'NaN'], ['DATABASE_PORT', '65536'], ['DATABASE_USER', ''],
])('rejects unsafe or missing %s before any SQL', (key, value) => {
  fixture(); vi.stubEnv(key, value); expect(() => disposableConnection()).toThrow('explicit loopback disposable');
});
