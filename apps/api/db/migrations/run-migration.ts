/**
 * Migration runner — 自动发现 apps/api/db/migrations 下所有 .sql 文件
 * 并按文件名排序依次执行未应用的 migration。
 *
 * 使用 zenithjoy.schema_migrations 追踪表（每条记录一个文件名 + 应用时间）。
 *
 * 首次运行自动建表；重复运行幂等（已应用的跳过）；任一 migration 失败 → 整体 exit 1。
 *
 * 发版集成：deploy-us-vps.yml 在 build 后、重启前执行 `npm run migrate`，
 * 失败 → 发版红、不继续重启（治"migration 没跑到生产库要手动 psql"的根）。
 *
 * 纯逻辑（列文件 / 算 pending）抽到 migration-core.ts 便于单测；
 * 本文件只负责 DB I/O + CLI 入口（require.main 守卫，importing 不自动跑）。
 */

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { listMigrationFiles, computePending } from './migration-core';

dotenv.config();

const MIGRATIONS_DIR = __dirname;

function makePool(): Pool {
  // 优先 DATABASE_URL（生产 .env 用连接串，对齐 startup-check 必检项），否则用离散变量。
  if (process.env.DATABASE_URL) {
    return new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return new Pool({
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432'),
    database: process.env.DATABASE_NAME || 'cecelia',
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD,
  });
}

async function ensureMigrationsTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS zenithjoy;

    CREATE TABLE IF NOT EXISTS zenithjoy.schema_migrations (
      filename    TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getAppliedMigrations(pool: Pool): Promise<Set<string>> {
  const { rows } = await pool.query<{ filename: string }>(
    'SELECT filename FROM zenithjoy.schema_migrations'
  );
  return new Set(rows.map((r) => r.filename));
}

async function applyMigration(pool: Pool, filename: string): Promise<void> {
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

/**
 * 幂等 backfill — 每次 `npm run migrate` 都跑一遍（不受 schema_migrations 跳过影响）。
 *
 * 为什么放这儿而不是只靠 *_create_wechat_cs_account_config.sql 的 INSERT：
 * 版本化 migration 只在「首次」应用一次（之后被 schema_migrations 标记跳过）。但「先种存量
 * 全局配置、再 `npm run migrate` 让它迁过去」的可重跑要求（合同 DoD）需要在 migration 已
 * 应用之后再跑一次迁移逻辑。故把同款幂等 SQL 抽成 backfill，在 pending 应用完后无条件再跑一遍：
 *   - 仅当存在全局 persona 行时才迁移（空源 → 不建 legacy 行）
 *   - ON CONFLICT DO NOTHING 保证重复跑不重复插/不覆盖
 *   - 任一异常只 warn 不 rethrow（不阻塞发版主流程）
 */
export async function backfillLegacyCSConfig(pool: Pool): Promise<void> {
  try {
    await pool.query(`
      INSERT INTO zenithjoy.wechat_cs_account_config
        (wechat_id, persona, auto_agent_enabled, business_hours_start, business_hours_end, key_contact_wechat, whitelist, daily_limit)
      SELECT
        'wxid_legacy_global',
        COALESCE(p.value, '{}'::jsonb),
        COALESCE((a.value->>'auto_agent_enabled')::boolean, false),
        COALESCE(a.value->>'business_hours_start', '06:00'),
        COALESCE(a.value->>'business_hours_end', '24:00'),
        COALESCE(a.value->>'key_contact_wechat', ''),
        '[]'::jsonb,
        COALESCE((a.value->>'daily_limit')::int, 0)
      FROM zenithjoy.wechat_cs_config p
      LEFT JOIN zenithjoy.wechat_cs_config a ON a.key = 'auto_agent'
      WHERE p.key = 'persona'
      ON CONFLICT (wechat_id) DO NOTHING;
    `);
  } catch (err) {
    console.warn('[migrate] backfillLegacyCSConfig 跳过（表可能尚未建好）:', err);
  }
}

export async function runMigrations(pool: Pool): Promise<void> {
  await ensureMigrationsTable(pool);

  const applied = await getAppliedMigrations(pool);
  const all = listMigrationFiles(MIGRATIONS_DIR);
  const pending = computePending(all, applied);

  if (pending.length === 0) {
    console.log('✅ All migrations already applied. Nothing to do.');
    await backfillLegacyCSConfig(pool);
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
    await applyMigration(pool, filename);
  }

  await backfillLegacyCSConfig(pool);

  console.log('');
  console.log(`✅ All ${pending.length} pending migrations completed successfully.`);
}

// CLI 入口：仅在直接执行时运行（importing 进测试不会触发）。
if (require.main === module) {
  const pool = makePool();
  runMigrations(pool)
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (error) => {
      console.error('Migration error:', error);
      await pool.end();
      process.exit(1);
    });
}
