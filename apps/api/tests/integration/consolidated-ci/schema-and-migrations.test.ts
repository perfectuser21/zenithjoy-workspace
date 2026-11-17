import { afterAll, expect, it } from 'vitest';
import { Pool } from 'pg';
import { disposableConnection } from './connection';
const db = new Pool(disposableConnection());
afterAll(() => db.end());
it('owns a fresh isolated database with real OAuth and scheduling columns', async () => {
  expect((await db.query('SELECT current_database() AS db')).rows[0].db).toBe('zenithjoy_consolidation_test');
  const columns = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='user_clip_settings'")).rows.map(row => row.column_name);
  for (const name of ['notion_token', 'feishu_user_token', 'feishu_refresh_token', 'feishu_user_id', 'feishu_user_name', 'feishu_token_expires_at']) expect(columns).toContain(name);
  expect((await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='contents' AND column_name='scheduled_at'")).rows).toHaveLength(1);
});

// Exercise the real migration runner against its own database. Other filenames
// are fixture ledger entries, not a claim that their SQL ran in this database.
import { beforeAll, beforeEach, describe } from 'vitest';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { runMigrations } from '../../../db/migrations/run-migration';
import { listMigrationFiles } from '../../../db/migrations/migration-core';

const migration = '20261031_180000_leadgen_comment_policy_exclusion.sql';
const constraint = 'chk_leadgen_comments_excluded_unscored';
const fixtureName = `leadgen_migration_${randomUUID().replaceAll('-', '')}`;
const connection = disposableConnection();
const admin = new Pool({ ...connection, database: 'postgres' });
const fixture = new Pool({ ...connection, database: fixtureName });
let owned = false;

async function snapshot() {
  const constraints = await fixture.query(`SELECT conname, pg_get_constraintdef(oid) AS definition, convalidated
    FROM pg_constraint WHERE conrelid='zenithjoy.leadgen_comments'::regclass ORDER BY conname`);
  const rows = await fixture.query('SELECT * FROM zenithjoy.leadgen_comments ORDER BY id');
  const ledger = await fixture.query('SELECT * FROM zenithjoy.schema_migrations ORDER BY filename');
  return { constraints: constraints.rows, rows: rows.rows, ledger: ledger.rows };
}
async function addExistingConstraint() {
  await fixture.query(`ALTER TABLE zenithjoy.leadgen_comments ADD CONSTRAINT ${constraint}
    CHECK (process_status <> '已排除' OR (relevance IS NULL AND intent_grade IS NULL))`);
}
async function expectApplied() {
  expect((await fixture.query('SELECT filename FROM zenithjoy.schema_migrations WHERE filename=$1', [migration])).rows)
    .toEqual([{ filename: migration }]);
  const saved = await snapshot();
  expect(saved.constraints.find(row => row.conname === constraint)).toMatchObject({ convalidated: true });
  await expect(fixture.query("INSERT INTO zenithjoy.leadgen_comments VALUES (2,'已排除','相关',NULL)"))
    .rejects.toMatchObject({ code: '23514', constraint });
}

describe.sequential('policy exclusion migration reentry on real PostgreSQL', () => {
  beforeAll(async () => {
    await admin.query(`CREATE DATABASE "${fixtureName}"`);
    owned = true;
    expect((await fixture.query('SELECT current_database() AS db')).rows[0].db).toBe(fixtureName);
  });
  afterAll(async () => {
    await fixture.end();
    try { if (owned) await admin.query(`DROP DATABASE "${fixtureName}"`); }
    finally { await admin.end(); }
  });
  beforeEach(async () => {
    await fixture.query(`DROP SCHEMA IF EXISTS zenithjoy CASCADE; CREATE SCHEMA zenithjoy;
      CREATE TABLE zenithjoy.schema_migrations(filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE zenithjoy.leadgen_comments(id int PRIMARY KEY, process_status text, relevance text, intent_grade text,
        CONSTRAINT chk_leadgen_comments_status CHECK(process_status IN ('待分拣','已分拣','已排除')));
      INSERT INTO zenithjoy.leadgen_comments VALUES (1,'已排除',NULL,NULL)`);
    const others = listMigrationFiles(resolve('db/migrations')).filter(file => file !== migration);
    await fixture.query('INSERT INTO zenithjoy.schema_migrations(filename) SELECT unnest($1::text[])', [others]);
  });

  it('reconciles an existing valid constraint without a ledger entry, preserving rows', async () => {
    await addExistingConstraint();
    const before = await snapshot();
    await runMigrations(fixture);
    await expectApplied();
    const after = await snapshot();
    expect(after.rows).toEqual(before.rows);
    expect(after.constraints).toEqual(before.constraints);
  });

  it('creates a missing constraint and a second runner invocation does not change the ledger', async () => {
    await runMigrations(fixture);
    await expectApplied();
    const first = await snapshot();
    await runMigrations(fixture);
    expect(await snapshot()).toEqual(first);
  });

  it('rejects invalid existing rows and rolls back both replaced constraints and the ledger', async () => {
    // An older weaker same-name constraint allows the bad historical row.
    await fixture.query(`ALTER TABLE zenithjoy.leadgen_comments ADD CONSTRAINT ${constraint} CHECK (id > 0);
      ALTER TABLE zenithjoy.leadgen_comments DROP CONSTRAINT chk_leadgen_comments_status;
      ALTER TABLE zenithjoy.leadgen_comments ADD CONSTRAINT chk_leadgen_comments_status CHECK(process_status IS NOT NULL);
      UPDATE zenithjoy.leadgen_comments SET relevance='相关' WHERE id=1`);
    const before = await snapshot();
    await expect(runMigrations(fixture)).rejects.toMatchObject({ code: '23514' });
    expect(await snapshot()).toEqual(before);
    expect(before.ledger.some(row => row.filename === migration)).toBe(false);
  });
});
