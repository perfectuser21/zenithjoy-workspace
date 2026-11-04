/**
 * vitest globalSetup — 在所有 integration test worker 启动前跑一次。
 * 职责：确保 zenithjoy_test 库存在 + 运行所有 pending migrations。
 *
 * 注意：globalSetup 跑在主进程，无法修改 worker 的 process.env。
 * 数据库名通过 CI 环境变量传递（DATABASE_NAME=zenithjoy_test）。
 */
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const DB_NAME = process.env.DATABASE_NAME ?? 'zenithjoy_test';
const PG = {
  host: process.env.DATABASE_HOST ?? 'localhost',
  port: parseInt(process.env.DATABASE_PORT ?? '5432'),
  user: process.env.DATABASE_USER ?? 'postgres',
  password: process.env.DATABASE_PASSWORD ?? 'postgres',
};

export async function setup() {
  if (!['localhost', '127.0.0.1', '::1'].includes(PG.host) || DB_NAME !== 'zenithjoy_test'
    || !Number.isInteger(PG.port) || PG.port < 1 || PG.port > 65535
    || process.env.DATABASE_URL || process.env.PGOPTIONS) {
    throw new Error('Integration setup requires loopback DATABASE_* and the dedicated zenithjoy_test database');
  }
  // Ensure test database exists (no-op in CI — GH Actions service creates it)
  const adminPool = new Pool({ ...PG, database: 'postgres' });
  try {
    await adminPool.query(`CREATE DATABASE "${DB_NAME}"`);
    console.log(`[integration-setup] Created database ${DB_NAME}`);
  } catch (err) {
    // Only the database explicitly provisioned by the CI service may already
    // exist. Authentication, permissions and network errors must fail setup.
    if ((err as { code?: string }).code !== '42P04') throw err;
  } finally { await adminPool.end(); }

  const pool = new Pool({ ...PG, database: DB_NAME });

  try {
    // Bootstrap migration tracking table
    await pool.query(`
      CREATE SCHEMA IF NOT EXISTS zenithjoy;
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE TABLE IF NOT EXISTS zenithjoy.schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    // process.cwd() = apps/api when vitest is invoked from that directory
    const migrationsDir = path.join(process.cwd(), 'db/migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const { rows } = await pool.query<{ filename: string }>(
      'SELECT filename FROM zenithjoy.schema_migrations'
    );
    const applied = new Set(rows.map((r) => r.filename));
    const pending = files.filter((f) => !applied.has(f));

    let appliedCount = 0;
    for (const file of pending) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          `INSERT INTO zenithjoy.schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING`,
          [file]
        );
        await client.query('COMMIT');
        appliedCount++;
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch { /* preserve the original migration failure */ }
        throw new Error(`[integration-setup] Migration ${file} failed after ${appliedCount} successfully applied migrations`, { cause: err });
      } finally {
        client.release();
      }
    }

    console.log(`[integration-setup] Applied ${appliedCount} migrations to ${DB_NAME}`);
  } finally { await pool.end(); }
}

export async function teardown() {}
