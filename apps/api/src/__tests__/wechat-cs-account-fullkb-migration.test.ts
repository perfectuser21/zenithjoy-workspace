/**
 * IA 重设计刀1 — 迁移幂等 / 不丢已配人设 守卫（静态校验纯 .sql 迁移）。
 *
 * 该迁移把每号配置表 wechat_cs_account_config 升级承载【完整 persona + business_kb】，
 * 并把全局 wechat_cs_config（persona/business_kb）回填到每个现有号作为初值。
 *
 * 因为是纯 .sql（避开 ts-node migration 部署坑），无真实 PG 时用静态结构断言守卫关键性质：
 *   1) 加 business_kb 列用 IF NOT EXISTS（重复跑安全）
 *   2) persona 回填带 collapse-guard（只填还没 style 的行 → 第二次跑命中 0 行，且 self_name 用 COALESCE 保留已配名）
 *   3) business_kb 回填带 empty-guard（只填空 business_kb 的行）
 *   4) 绝不出现破坏性语句（DROP TABLE / DELETE FROM / TRUNCATE）——不丢数据
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const MIGRATION = path.join(
  __dirname,
  '../../db/migrations/20260628_120000_wechat_cs_account_config_full_persona_kb.sql',
);

describe('wechat_cs_account_config 完整 persona + business_kb 迁移（静态守卫）', () => {
  it('迁移文件存在', () => {
    expect(existsSync(MIGRATION), `缺迁移文件: ${MIGRATION}`).toBe(true);
  });

  it('加 business_kb 列用 IF NOT EXISTS（重复跑安全）', () => {
    const sql = readFileSync(MIGRATION, 'utf-8');
    expect(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+business_kb/i.test(sql)).toBe(true);
  });

  it('persona 回填：保留已配 self_name（COALESCE）且带 collapse-guard（幂等）', () => {
    const sql = readFileSync(MIGRATION, 'utf-8');
    // 用 COALESCE 保留已有 self_name（不被全局覆盖）
    expect(/COALESCE[\s\S]*self_name/i.test(sql)).toBe(true);
    // collapse-guard：只更新「persona 去掉 self_name 后为空」的行 → 第二次跑命中 0 行
    expect(/persona\s*-\s*'self_name'/i.test(sql)).toBe(true);
  });

  it('business_kb 回填带 empty-guard（只填空 business_kb 的行 → 幂等）', () => {
    const sql = readFileSync(MIGRATION, 'utf-8');
    expect(/business_kb\s+IS\s+NULL|business_kb\s*=\s*'\{\}'::jsonb/i.test(sql)).toBe(true);
  });

  it('无破坏性语句（不 DROP/DELETE/TRUNCATE，不丢数据）', () => {
    const sql = readFileSync(MIGRATION, 'utf-8');
    expect(/DROP\s+TABLE/i.test(sql)).toBe(false);
    expect(/DELETE\s+FROM/i.test(sql)).toBe(false);
    expect(/TRUNCATE/i.test(sql)).toBe(false);
  });
});
