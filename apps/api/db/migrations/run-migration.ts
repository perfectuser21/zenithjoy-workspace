/**
 * Migration runner — 自动发现 apps/api/db/migrations 下所有 .sql 文件
 * 并按文件名排序依次执行未应用的 migration。
 *
 * 使用 zenithjoy.schema_migrations 追踪表（每条记录一个文件名 + 应用时间）。
 *
 * 首次运行自动建表；重复运行幂等。
 */

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432'),
  database: process.env.DATABASE_NAME || 'cecelia',
  user: process.env.DATABASE_USER || 'postgres',
  password: process.env.DATABASE_PASSWORD,
});

const MIGRATIONS_DIR = __dirname;

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS zenithjoy;

    CREATE TABLE IF NOT EXISTS zenithjoy.schema_migrations (
      filename    TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const { rows } = await pool.query<{ filename: string }>(
    'SELECT filename FROM zenithjoy.schema_migrations'
  );
  return new Set(rows.map((r) => r.filename));
}

function listMigrationFiles(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

async function applyMigration(filename: string): Promise<void> {
  const filePath = path.join(MIGRATIONS_DIR, filename);
  const sql = fs.readFileSync(filePath, 'utf-8');

  console.log(`▶ Applying migration: ${filename}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      'INSERT INTO zenithjoy.schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING',
      [filename]
    );
    await client.query('COMMIT');
    console.log(`✅ Applied: ${filename}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`❌ Failed: ${filename}`);
    throw err;
  } finally {
    client.release();
  }
}

async function runMigrations(): Promise<void> {
  await ensureMigrationsTable();

  const applied = await getAppliedMigrations();
  const all = listMigrationFiles();
  const pending = all.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log('✅ All migrations already applied. Nothing to do.');
    return;
  }

  console.log(
    `Found ${all.length} migration files, ${applied.size} already applied, ${pending.length} pending:`
  );
  for (const f of pending) {
    console.log(`   - ${f}`);
  }
  console.log('');

  for (const filename of pending) {
    await applyMigration(filename);
  }

  console.log('');
  console.log(`✅ All ${pending.length} pending migrations completed successfully.`);
}

runMigrations()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('Migration error:', error);
    await pool.end();
    process.exit(1);
  });
