import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import fs from 'node:fs';
import path from 'node:path';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  'postgres://cecelia@localhost:5432/cecelia_test';

// CI 不一定起 postgres — vitest API Test 跑不带 db; API Integration Test 才带
const HAS_DB = !!process.env.TEST_DATABASE_URL || !!process.env.DATABASE_URL || !!process.env.RUN_DB_TESTS;

const SCHEMA = 'zenithjoy_2_1f_test';
let pool: Pool;

async function runSqlFile(rel: string) {
  const sql = fs.readFileSync(path.join(__dirname, '..', rel), 'utf-8');
  await pool.query(sql.replace(/zenithjoy\./g, `${SCHEMA}.`));
}

describe.skipIf(!HAS_DB)('Sprint 2.1f Fix 2 — normalize hex licenses to base32 migration', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL });
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.query(`CREATE SCHEMA ${SCHEMA}`);
    // 最小 fixture：只建 licenses 表 + 9 条 hex license（含 0/1 字符）
    await pool.query(`
      CREATE TABLE ${SCHEMA}.licenses (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        license_key text UNIQUE NOT NULL,
        tier text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const fixtures = [
      'ZJ-TUSMOKE-A0000001',  // smoke 豁免，不 normalize
      'ZJ-TUSMOKE-B0000001',  // smoke 豁免
      'ZJ-F-BA6C851E',
      'ZJ-F-AA724212',
      'ZJ-F-B2D0AEE8',
      'ZJ-F-K3MYP4VR',  // 已是 base32
      'ZJ-F-640DDB65',
      'ZJ-F-48022F1C',
      'ZJ-F-87E07BC8',
    ];
    for (const k of fixtures) {
      await pool.query(`INSERT INTO ${SCHEMA}.licenses (license_key, tier) VALUES ($1, 'free')`, [k]);
    }
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.end();
  });

  it('migration 跑后非 TUSMOKE 行全部匹配 ZJ-[FBMSE]-[A-Z0-9]{8}', async () => {
    await runSqlFile('20260509_120000_normalize_hex_licenses_to_base32.sql');
    const { rows } = await pool.query(
      `SELECT count(*) AS bad
         FROM ${SCHEMA}.licenses
        WHERE license_key !~ '^ZJ-[FBMSE]-[A-Z0-9]{8}$'
          AND license_key NOT LIKE 'ZJ-TUSMOKE-%'`
    );
    expect(Number(rows[0].bad)).toBe(0);
  });
});

describe.skipIf(!HAS_DB)('Sprint 2.1f Fix 4 — gen_base32_chars(n) PG function', () => {
  const SCHEMA_FN = `${SCHEMA}_fn`;
  let pool2: Pool;

  beforeAll(async () => {
    pool2 = new Pool({ connectionString: TEST_DB_URL });
    await pool2.query(`DROP SCHEMA IF EXISTS ${SCHEMA_FN} CASCADE`);
    await pool2.query(`CREATE SCHEMA ${SCHEMA_FN}`);
  });

  afterAll(async () => {
    await pool2.query(`DROP SCHEMA IF EXISTS ${SCHEMA_FN} CASCADE`);
    await pool2.end();
  });

  it('gen_base32_chars(8) 返 8 字符 [A-Z2-9]', async () => {
    const sql = fs
      .readFileSync(
        path.join(__dirname, '..', '20260509_120100_gen_base32_chars_function.sql'),
        'utf-8'
      )
      .replace(/zenithjoy\./g, `${SCHEMA_FN}.`);
    await pool2.query(sql);
    for (let i = 0; i < 100; i++) {
      const { rows } = await pool2.query(`SELECT ${SCHEMA_FN}.gen_base32_chars(8) AS s`);
      expect(rows[0].s).toMatch(/^[A-Z2-9]{8}$/);
    }
  });

  it('gen_base32_chars(12) 返 12 字符 [A-Z2-9]', async () => {
    const { rows } = await pool2.query(`SELECT ${SCHEMA_FN}.gen_base32_chars(12) AS s`);
    expect(rows[0].s).toMatch(/^[A-Z2-9]{12}$/);
  });
});
