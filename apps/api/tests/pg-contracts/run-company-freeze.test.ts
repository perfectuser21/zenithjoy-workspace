import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { companyFreezeTestName, runCompanyFreezePostgres } from './run-company-freeze.mjs';
const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function child(body: string) {
  const dir = mkdtempSync(join(tmpdir(), 'company-freeze-child-')); directories.push(dir);
  const file = join(dir, 'contract.test.mjs');
  writeFileSync(file, `import test from 'node:test'; import assert from 'node:assert/strict';\n${body}`);
  return file;
}
const connection = { host: '127.0.0.1', port: 5432, user: 'fixture' };
describe('real Node test child admission (no database/network in these fixtures)', () => {
  it('accepts an executed named contract with all assertions passed', () => {
    const out = runCompanyFreezePostgres(connection, child(`test(${JSON.stringify(companyFreezeTestName)},()=>{const url=new URL(process.env.COMPANY_CONFIG_SCRATCH_URL);assert.equal(url.host,'127.0.0.1:5432');assert.equal(url.pathname,'/cecelia_scratch');assert.equal(url.search,'');assert.equal(process.env.DATABASE_URL,undefined);});`));
    expect(out).toContain('# pass 1');
  });
  it('fails on actual child assertion/process failure', () => {
    expect(() => runCompanyFreezePostgres(connection, child(`test(${JSON.stringify(companyFreezeTestName)},()=>assert.fail('fixture'));`))).toThrow('child failed');
  });
  it('fails when the required contract is entirely skipped', () => {
    expect(() => runCompanyFreezePostgres(connection, child(`test(${JSON.stringify(companyFreezeTestName)},{skip:true},()=>assert.fail('skipped body unexpectedly executed'));`))).toThrow('did not execute');
  });
  it('fails when Node reports an empty file as a passing file-level test', () => {
    expect(() => runCompanyFreezePostgres(connection, child(''))).toThrow('did not execute');
  });
  it('rejects a remote connection before starting even a passing child', () => {
    expect(() => runCompanyFreezePostgres({ ...connection, host: 'production.example.com' }, child(`test(${JSON.stringify(companyFreezeTestName)},()=>{const url=new URL(process.env.COMPANY_CONFIG_SCRATCH_URL);assert.equal(url.host,'127.0.0.1:5432');assert.equal(url.pathname,'/cecelia_scratch');assert.equal(url.search,'');assert.equal(process.env.DATABASE_URL,undefined);});`))).toThrow('loopback');
  });
});
