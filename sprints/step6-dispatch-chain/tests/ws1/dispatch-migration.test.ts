/**
 * WS1 RED tests — works.publish_status migration
 *
 * 当前无 20260519_000000_step6_dispatch_chain.sql migration 文件。
 * 这些测试在 migration 文件创建前**必须 RED**（文件不存在 → accessSync 抛出）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, accessSync } from 'node:fs';
import { join } from 'node:path';

const MIG_DIR = join(__dirname, '..', '..', '..', '..', 'apps', 'api', 'db', 'migrations');
const MIG_NAME = '20260519_000000_step6_dispatch_chain.sql';
const MIG_PATH = join(MIG_DIR, MIG_NAME);

describe('WS1 — works.publish_status migration [BEHAVIOR]', () => {
  it('migration file 20260519_000000_step6_dispatch_chain.sql 应存在', () => {
    expect(() => accessSync(MIG_PATH)).not.toThrow();
  });

  it('migration SQL 应含 publish_status 列定义（ADD COLUMN IF NOT EXISTS）', () => {
    const sql = readFileSync(MIG_PATH, 'utf8');
    expect(sql).toContain('publish_status');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS');
  });

  it('publish_status CHECK 约束应包含 queued/success/failed 三个合法值', () => {
    const sql = readFileSync(MIG_PATH, 'utf8');
    expect(sql).toContain('queued');
    expect(sql).toContain('success');
    expect(sql).toContain('failed');
    const checkMatch = sql.match(/CHECK\s*\([^)]+\)/is)?.[0] ?? '';
    expect(checkMatch).not.toContain('pending');
    expect(checkMatch).not.toContain('dispatched');
  });

  it('migration 应含 CREATE INDEX（为 publish_status 查询加速）', () => {
    const sql = readFileSync(MIG_PATH, 'utf8');
    expect(sql).toContain('CREATE INDEX');
  });
});
