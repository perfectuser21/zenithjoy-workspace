/**
 * WS2 RED tests — publish_tasks status enum migration superset
 *
 * 当前 chk_publish_tasks_status enum (apps/api/db/migrations/20260510_0c10fd_*.sql)
 * = 'pending', 'running', 'success', 'failed', 'done' (5 个)
 * 缺：queued / dispatched / in_progress / completed
 *
 * 这些测试在 migration 文件创建前**必须 RED**（找不到文件 / SQL 不含字面量）。
 * 真 DB INSERT 行为靠 contract-dod-ws2.md BEHAVIOR manual:bash 验。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIG_DIR = join(__dirname, '..', '..', '..', 'db', 'migrations');

function findEnumMigration(): string | null {
  const files = readdirSync(MIG_DIR);
  const match = files.find((f) => /publish_tasks_status_enum/.test(f));
  return match ? join(MIG_DIR, match) : null;
}

describe('WS2 — publish_tasks status enum migration [BEHAVIOR]', () => {
  it('migration file 应存在含 publish_tasks_status_enum 关键字', () => {
    const f = findEnumMigration();
    expect(f).not.toBeNull();
  });

  it('migration SQL 应同时含 9 个 status 字面量', () => {
    const f = findEnumMigration();
    expect(f).not.toBeNull();
    const sql = readFileSync(f as string, 'utf8');
    for (const status of [
      'pending',
      'running',
      'success',
      'failed',
      'done',
      'queued',
      'dispatched',
      'in_progress',
      'completed',
    ]) {
      expect(sql.includes(`'${status}'`)).toBe(true);
    }
  });

  it('migration SQL 应同时含 DROP CONSTRAINT IF EXISTS 与 ADD CONSTRAINT chk_publish_tasks_status', () => {
    const f = findEnumMigration();
    expect(f).not.toBeNull();
    const sql = readFileSync(f as string, 'utf8');
    expect(sql).toMatch(/DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+chk_publish_tasks_status/i);
    expect(sql).toMatch(/ADD\s+CONSTRAINT\s+chk_publish_tasks_status/i);
  });

  it('migration filename 严格按 sprint convention YYYYMMDD_HHMMSS_<desc>.sql', () => {
    const f = findEnumMigration();
    expect(f).not.toBeNull();
    const basename = (f as string).split('/').pop() as string;
    expect(basename).toMatch(/^\d{8}_\d{6}_publish_tasks_status_enum.*\.sql$/);
  });
});
