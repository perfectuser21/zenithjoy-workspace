import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireDisposableDatabases } from './disposable-db';
import { Client } from 'pg';
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

// pg accepts query-string overrides that WHATWG URL.hostname does not expose.
// Constructing a Client parses settings only; these negative cases never connect.
describe('pg URL parameter override admission', () => {
  it.each(['127.0.0.1','localhost'])('real pg parser overrides %s to a remote host; admission rejects it', host => {
    fixture();
    vi.stubEnv('DATABASE_HOST',host);
    const url=`postgresql://postgres:fixture@${host}:5432/cecelia_scratch?host=production.example.com`;
    expect(new URL(url).hostname).toBe(host);
    const client=new Client({connectionString:url}) as Client & {connectionParameters:{host:string}};
    expect(client.connectionParameters.host).toBe('production.example.com');
    vi.stubEnv('COMPANY_CONFIG_SCRATCH_URL',url);
    expect(() => requireDisposableDatabases()).toThrow('Company scratch URL must target');
  });
  it.each([
    '?host=production.example.com', '?host=%2Ftmp%2Fpostgres-socket',
    '?port=9999', '?user=other', '?database=production', '?dbname=production',
    '?options=-csearch_path%3Dpublic', '?sslmode=require', '#host=production.example.com', '?', '#',
  ])('rejects all query/fragment parameters: %s', suffix => {
    fixture();
    vi.stubEnv('COMPANY_CONFIG_SCRATCH_URL','postgresql://postgres:fixture@127.0.0.1:5432/cecelia_scratch'+suffix);
    expect(() => requireDisposableDatabases()).toThrow('Company scratch URL must target');
  });
});

it('invalid URL diagnostic does not expose credentials or raw input', () => {
  fixture();
  const secret='do-not-log-fixture-password';
  vi.stubEnv('COMPANY_CONFIG_SCRATCH_URL',`postgresql://[invalid-${secret}`);
  try { requireDisposableDatabases(); throw new Error('expected admission rejection'); }
  catch (error) {
    expect(String(error)).not.toContain(secret);
    expect(error).not.toHaveProperty('input');
    expect(error).not.toHaveProperty('cause');
  }
});
