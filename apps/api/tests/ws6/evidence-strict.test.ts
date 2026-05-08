/**
 * Path 4 Sprint 1 ws6 — Lead 自验 evidence 模板严格校验（合同 RED）。
 *
 * 校验：
 *   1) .agent-knowledge/path-4/lead-acceptance-path4-sprint-1.md 存在
 *   2) Worker Machine 锁定 rog-xian / 100.98.253.95 / XX-ROG（任一必含）
 *   3) Checklist + Evidence 章节齐
 *   4) LEAD_ACCEPTANCE_VALIDATION=skip（默认 / template 阶段）→ 模板存在即 PASS
 *   5) LEAD_ACCEPTANCE_VALIDATION=strict（final merge 阶段）→ 4 类真实证据：
 *      - cookie ≥ 50 字节非占位
 *      - wechat_id 非占位（不是 test_wechat_001 / placeholder / <待填> / 待填）
 *      - sent_at ISO8601（YYYY-MM-DDTHH:MM）
 *      - feishu_record_id 含 rec[A-Za-z0-9]{6,}
 *
 * 注：tests/ws6/** 在 vitest.config.ts 里被 exclude，不进 CI vitest 集。
 */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const EVIDENCE = path.join(
  REPO_ROOT,
  '.agent-knowledge',
  'path-4',
  'lead-acceptance-path4-sprint-1.md'
);

describe('ws6 evidence 模板 — 文件 + 章节 + Worker Machine', () => {
  it('evidence 文件存在', () => {
    expect(fs.existsSync(EVIDENCE)).toBe(true);
  });

  it('Worker Machine 锁定 rog-xian / 100.98.253.95 / XX-ROG', () => {
    const src = fs.readFileSync(EVIDENCE, 'utf-8');
    expect(src).toMatch(/rog-xian|100\.98\.253\.95|XX-ROG/);
  });

  it('章节齐：Checklist / Evidence / Worker Machine', () => {
    const src = fs.readFileSync(EVIDENCE, 'utf-8');
    expect(src).toMatch(/^## Checklist/m);
    expect(src).toMatch(/^## Evidence/m);
    expect(src).toMatch(/Worker Machine/);
  });

  it('Validation Mode 字段存在（描述 skip / strict 切换）', () => {
    const src = fs.readFileSync(EVIDENCE, 'utf-8');
    expect(src).toMatch(/LEAD_ACCEPTANCE_VALIDATION/);
    expect(src).toMatch(/skip/);
    expect(src).toMatch(/strict/);
  });
});

describe('ws6 evidence 模板 — LEAD_ACCEPTANCE_VALIDATION 模式切换', () => {
  const mode = process.env.LEAD_ACCEPTANCE_VALIDATION || 'skip';

  if (mode === 'strict') {
    it('strict 模式: cookie ≥ 50 字节非占位', () => {
      const src = fs.readFileSync(EVIDENCE, 'utf-8');
      // 找 cookie 后面一段（≥ 50 字符的连续 token）
      const cookieMatch = src.match(/cookie[\s\S]{0,500}?([A-Za-z0-9_\-+/=]{50,})/i);
      expect(cookieMatch).not.toBeNull();
    });

    it('strict 模式: wechat_id 非占位', () => {
      const src = fs.readFileSync(EVIDENCE, 'utf-8');
      const wechatIdSection = src.match(/wechat_id:\s*([^\n]+)/);
      expect(wechatIdSection).not.toBeNull();
      const value = wechatIdSection![1].trim();
      expect(value).not.toMatch(/test_wechat_001|placeholder|待填|<.*>/i);
      expect(value.length).toBeGreaterThan(0);
    });

    it('strict 模式: sent_at ISO8601 时间戳', () => {
      const src = fs.readFileSync(EVIDENCE, 'utf-8');
      expect(src).toMatch(/sent_at[\s\S]{0,200}\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    });

    it('strict 模式: feishu_record_id 含 rec[A-Za-z0-9]{6,}', () => {
      const src = fs.readFileSync(EVIDENCE, 'utf-8');
      expect(src).toMatch(/feishu_record_id[\s\S]{0,200}rec[A-Za-z0-9]{6,}/);
    });
  } else {
    it('skip 模式（默认 template）: 模板存在即 PASS', () => {
      expect(fs.existsSync(EVIDENCE)).toBe(true);
      const src = fs.readFileSync(EVIDENCE, 'utf-8');
      // 模板阶段允许占位
      expect(src.length).toBeGreaterThan(100);
    });
  }
});
