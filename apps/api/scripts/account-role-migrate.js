#!/usr/bin/env node
/**
 * account-role-migrate.js
 * Sprint: 07032332-line02-account-role-unify
 *
 * 将 line02_account_sessions.health 迁移到 agent_platform_sessions.status
 * 三值映射：ok→active, expired→expired, unknown→pending
 *
 * 用法:
 *   DATABASE_URL=<conn> node account-role-migrate.js --dry-run   # 只输出冲突日志，不写数据
 *   DATABASE_URL=<conn> node account-role-migrate.js             # 正式 cutover（单事务）
 */

'use strict';

const { Pool } = require('pg');

const isDryRun = process.argv.includes('--dry-run') || process.argv.includes('--dryRun');
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost/cecelia';

const HEALTH_MAP = {
  ok: 'active',
  expired: 'expired',
};

function mapHealth(health) {
  return HEALTH_MAP[health] ?? 'pending';
}

async function run() {
  const pool = new Pool({ connectionString: DATABASE_URL });

  console.log(`[account-role-migrate] dry-run=${isDryRun} db=${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);

  let client;
  try {
    client = await pool.connect();

    // 查询所有 line02_account_sessions 未停写的记录
    const { rows: l02Rows } = await client.query(
      `SELECT l.agent_id, l.platform, l.account_label, l.health, l.tenant_id,
              aps.status AS existing_status
         FROM zenithjoy.line02_account_sessions l
         LEFT JOIN zenithjoy.agent_platform_sessions aps
           ON aps.agent_id = l.agent_id
          AND aps.platform = l.platform
          AND aps.account_label = l.account_label
        WHERE COALESCE(l.write_disabled, false) = false`,
    );

    console.log(`[account-role-migrate] 共 ${l02Rows.length} 条待处理记录`);

    let conflictCount = 0;
    const toInsert = [];

    for (const row of l02Rows) {
      const mappedStatus = mapHealth(row.health);

      if (row.existing_status !== null && row.existing_status !== undefined) {
        // 冲突：agent_platform_sessions 已有记录
        if (row.existing_status !== mappedStatus) {
          conflictCount++;
          console.log(
            `[conflict] tenant_id=${row.tenant_id} account_label=${row.account_label} ` +
            `l02.health=${row.health} → mapped=${mappedStatus} vs aps.status=${row.existing_status} (以 aps 为准)`,
          );
        }
        // 已有记录：不覆盖（agent_platform_sessions 为权威源）
      } else {
        toInsert.push({ ...row, mappedStatus });
      }
    }

    console.log(
      `[account-role-migrate] conflict=${conflictCount} to_insert=${toInsert.length} dry-run=${isDryRun}`,
    );

    if (isDryRun) {
      console.log('[account-role-migrate] dry-run complete — 未写入任何数据');
      await client.release();
      await pool.end();
      return;
    }

    // 正式 cutover：单事务
    await client.query('BEGIN');

    let inserted = 0;
    for (const r of toInsert) {
      await client.query(
        `INSERT INTO zenithjoy.agent_platform_sessions
           (agent_id, platform, account_label, role, status, created_at, bound_at)
         VALUES ($1, $2, $3, 'burner', $4, NOW(), NOW())
         ON CONFLICT (agent_id, platform, account_label) DO NOTHING`,
        [r.agent_id, r.platform, r.account_label, r.mappedStatus],
      );
      inserted++;
    }

    // 停写：将所有 line02_account_sessions 行标记 write_disabled=true
    const { rowCount } = await client.query(
      `UPDATE zenithjoy.line02_account_sessions SET write_disabled = true WHERE COALESCE(write_disabled, false) = false`,
    );

    await client.query('COMMIT');
    console.log(
      `[account-role-migrate] cutover ok — inserted=${inserted} write_disabled_rows=${rowCount}`,
    );
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) {}
    }
    console.error('[account-role-migrate] ERROR:', err.message);
    process.exit(1);
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

run();
