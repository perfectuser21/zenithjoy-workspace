import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { testPool } from '../helpers';

it('actual setup fails on SQL error, rolls back failed DDL/tracking, and counts only committed migrations on replay', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'integration-migration-contract-'));
 const id = randomUUID().replaceAll('-', '');
 const good = `fixture_${id}_good`, bad = `fixture_${id}_bad`;
 const first = `9999_${id}_01.sql`, second = `9999_${id}_02.sql`;
 try {
  const migrations = join(dir, 'db/migrations'); mkdirSync(migrations, { recursive: true });
  writeFileSync(join(migrations, first), `CREATE TABLE zenithjoy.${good}(value integer); INSERT INTO zenithjoy.${good} VALUES(17);`);
  writeFileSync(join(migrations, second), `CREATE TABLE zenithjoy.${bad}(value integer CHECK(value > 0)); INSERT INTO zenithjoy.${bad} VALUES(-1);`);
  // Execute the real globalSetup in a separate Node process with a disposable
  // migration directory. Only TypeScript syntax is removed; SQL/Pool are real.
  const source = readFileSync(new URL('../global-setup.ts', import.meta.url), 'utf8');
  const pg = pathToFileURL(createRequire(import.meta.url).resolve('pg')).href;
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
   .replace(/import \{ Pool \} from ['"]pg['"];?/, `import pg from ${JSON.stringify(pg)}; const { Pool } = pg;`);
  const entry = join(dir, 'setup.mjs'); writeFileSync(entry, compiled + '\nawait setup();\n');
  const run = (extra = {}) => spawnSync(process.execPath, [entry], { cwd: dir, env: { ...process.env, ...extra }, encoding: 'utf8', timeout: 10_000 });
  const failed = run();
  expect(failed.error).toBeUndefined(); expect(failed.status).not.toBe(0);
  expect(failed.stderr).toContain(second); expect(failed.stdout).not.toContain('Applied 2');
  expect((await testPool.query(`SELECT value FROM zenithjoy.${good}`)).rows).toEqual([{ value: 17 }]);
  expect((await testPool.query('SELECT to_regclass($1) AS name', [`zenithjoy.${bad}`])).rows[0].name).toBeNull();
  expect((await testPool.query('SELECT filename FROM zenithjoy.schema_migrations WHERE filename=ANY($1) ORDER BY filename', [[first, second]])).rows).toEqual([{ filename: first }]);
  writeFileSync(join(migrations, second), `CREATE TABLE zenithjoy.${bad}(value integer CHECK(value > 0)); INSERT INTO zenithjoy.${bad} VALUES(23);`);
  const replay = run(); expect(replay.error).toBeUndefined(); expect(replay.status, replay.stderr).toBe(0);
  expect(replay.stdout).toContain('Applied 1 migrations');
  expect((await testPool.query(`SELECT value FROM zenithjoy.${bad}`)).rows).toEqual([{ value: 23 }]);
  const noop = run(); expect(noop.status, noop.stderr).toBe(0); expect(noop.stdout).toContain('Applied 0 migrations');
  for (const extra of [{ DATABASE_HOST: 'never-connect.example.invalid' }, { DATABASE_NAME: 'cecelia' }, { PGOPTIONS: '-c search_path=public' }]) {
   const refused = run(extra); expect(refused.error).toBeUndefined(); expect(refused.status).not.toBe(0);
   expect(refused.stderr).toContain('Integration setup requires loopback');
  }
 } finally {
  await testPool.query(`DROP TABLE IF EXISTS zenithjoy.${good},zenithjoy.${bad}`);
  await testPool.query('DELETE FROM zenithjoy.schema_migrations WHERE filename=ANY($1)', [[first, second]]);
  rmSync(dir, { recursive: true, force: true });
 }
});
