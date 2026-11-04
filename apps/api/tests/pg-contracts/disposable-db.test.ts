import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireDisposableDatabases } from './disposable-db';
afterEach(() => vi.unstubAllEnvs());
const fixture = () => {
  for (const [key,value] of Object.entries({PG_CONTRACTS_DISPOSABLE:'1',DATABASE_HOST:'127.0.0.1',DATABASE_PORT:'5432',DATABASE_USER:'postgres',DATABASE_NAME:'zenithjoy_contract_test',COMPANY_CONFIG_SCRATCH_URL:'postgresql://postgres@127.0.0.1:5432/cecelia_scratch'})) vi.stubEnv(key,value);
};
describe('disposable PG admission rejects unsafe/missing connection settings before SQL', () => {
  it('accepts only explicit loopback fixture databases', () => { fixture(); expect(requireDisposableDatabases()).toMatchObject({host:'127.0.0.1',port:5432,user:'postgres'}); });
  it.each([
    ['PG_CONTRACTS_DISPOSABLE',''],
    ['DATABASE_HOST','production.example.com'],
    ['DATABASE_NAME','cecelia'],
    ['DATABASE_NAME','zenithjoy'],
    ['DATABASE_PORT',''],
    ['DATABASE_PORT','NaN'],
    ['DATABASE_PORT','65536'],
    ['DATABASE_USER',''],
    ['COMPANY_CONFIG_SCRATCH_URL','postgresql://postgres@production.example.com:5432/cecelia_scratch'],
    ['COMPANY_CONFIG_SCRATCH_URL','postgresql://postgres@127.0.0.1:5432/cecelia'],
    ['COMPANY_CONFIG_SCRATCH_URL','postgresql://postgres@127.0.0.1:5433/cecelia_scratch'],
    ['COMPANY_CONFIG_SCRATCH_URL','postgresql://other@127.0.0.1:5432/cecelia_scratch'],
  ])('rejects %s=%s', (key,value) => { fixture(); vi.stubEnv(key,value); expect(() => requireDisposableDatabases()).toThrow(); });
});
