/**
 * Seg3 方案 B′ — `acquisition_leads.douyin_id` 列迁移（静态守卫）。
 *
 * 实测（2026-07-15 staging hk-vps zenithjoy_staging）：`zenithjoy.acquisition_leads`
 * 【没有 douyin_id 列】。抓评论段读出真实抖音号也无处可落 → 派单段只能继续发
 * profile_url → 设备端 DouyinDmOutreachService 把它当抖音号搜 → 必然 NO_MATCH。
 *
 * 纯 .sql 迁移（避开 ts-node migration 部署坑），无真实 PG 时用静态结构断言守关键性质：
 *   1) 加列用 IF NOT EXISTS（重复跑安全）
 *   2) 可空（读不到抖音号的 lead 仍要能进库——宁可空，不可猜）
 *   3) 无破坏性语句（不丢已采到的 lead）
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const MIGRATION = path.join(
  __dirname,
  '../../db/migrations/20260715_150000_acquisition_leads_douyin_id.sql',
);

describe('acquisition_leads.douyin_id 迁移（静态守卫）', () => {
  it('迁移文件存在', () => {
    expect(existsSync(MIGRATION), `缺迁移文件: ${MIGRATION}`).toBe(true);
  });

  it('加 douyin_id 列用 IF NOT EXISTS（重复跑安全）', () => {
    const sql = readFileSync(MIGRATION, 'utf-8');
    expect(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+douyin_id\s+text/i.test(sql)).toBe(true);
  });

  it('douyin_id 可空——不加 NOT NULL（读不到号的 lead 仍要能进库）', () => {
    const sql = readFileSync(MIGRATION, 'utf-8');
    // 「宁可空，不可猜」：加 NOT NULL 会逼落库侧编一个假值填进去。
    expect(/douyin_id[^;]*NOT\s+NULL/i.test(sql)).toBe(false);
  });

  it('打在 zenithjoy.acquisition_leads 上', () => {
    const sql = readFileSync(MIGRATION, 'utf-8');
    expect(/ALTER\s+TABLE\s+zenithjoy\.acquisition_leads/i.test(sql)).toBe(true);
  });

  it('无破坏性语句（不 DROP TABLE / DELETE / TRUNCATE，不丢已采 lead）', () => {
    const sql = readFileSync(MIGRATION, 'utf-8');
    expect(/DROP\s+TABLE|DELETE\s+FROM|TRUNCATE/i.test(sql)).toBe(false);
  });
});
