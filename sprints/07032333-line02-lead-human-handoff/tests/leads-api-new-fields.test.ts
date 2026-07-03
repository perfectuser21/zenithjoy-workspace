/**
 * TDD Red — Line02 LeadsTable 统一组件：API 新字段 + pickAssignee 验证
 *
 * 故意在 Generator 实现前失败：
 * - GET /api/acquisition/leads 尚未返回 latest_reply / latest_reply_at / assignee
 * - pickAssignee 函数尚未导出
 * - LeadsTable 组件尚未创建
 * - AcquisitionTasksPage 仍含"触达状态"列
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

// ─── pickAssignee 取模轮询分配 ───────────────────────────────────────────────
let pickAssignee: (roster: string[], dayLeadCount: number) => string | null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../../../apps/api/src/services/acquisition-dispatch');
  pickAssignee = mod.pickAssignee;
} catch {
  pickAssignee = () => {
    throw new Error('pickAssignee not implemented');
  };
}

describe('pickAssignee — ASSIGNEE_ROSTER 取模轮询 [BEHAVIOR]', () => {
  it('pickAssignee([A,B], 0) = A', () => {
    expect(pickAssignee(['客服A', '客服B'], 0)).toBe('客服A');
  });

  it('pickAssignee([A,B], 1) = B', () => {
    expect(pickAssignee(['客服A', '客服B'], 1)).toBe('客服B');
  });

  it('pickAssignee([A,B], 2) = A（取模轮回）', () => {
    expect(pickAssignee(['客服A', '客服B'], 2)).toBe('客服A');
  });

  it('pickAssignee([], 0) = null（名单为空时返 null）', () => {
    expect(pickAssignee([], 0)).toBeNull();
  });
});

// ─── GET /api/acquisition/leads 源码含新字段 ────────────────────────────────
describe('GET /api/acquisition/leads — 源码含新字段映射 [BEHAVIOR]', () => {
  it('acquisition.ts 的 /leads 端点 SELECT 含 latest_reply 列', () => {
    const src = readFileSync('apps/api/src/routes/acquisition.ts', 'utf8');
    // 当前 SELECT 不含 latest_reply → FAIL
    expect(src).toContain('latest_reply');
  });

  it('acquisition.ts 的 /leads 端点 SELECT 含 latest_reply_at 列', () => {
    const src = readFileSync('apps/api/src/routes/acquisition.ts', 'utf8');
    expect(src).toContain('latest_reply_at');
  });

  it('acquisition.ts 的 /leads 端点 SELECT 含 assignee 列', () => {
    const src = readFileSync('apps/api/src/routes/acquisition.ts', 'utf8');
    expect(src).toContain('assignee');
  });

  it('acquisition.ts 的 /leads 端点 map 输出不含禁用字段 reply_text', () => {
    const src = readFileSync('apps/api/src/routes/acquisition.ts', 'utf8');
    // 禁用字段名不得出现在 response map 里（只允许在注释里）
    // 检查 GET /leads 相关段落（取 471 行后 100 行检查）
    const leadsSection = src.slice(src.indexOf("router.get('/leads'") > 0
      ? src.indexOf("router.get('/leads'")
      : src.indexOf("get('/leads'"));
    if (leadsSection.length > 0) {
      const mapBlock = leadsSection.slice(0, 3000);
      expect(mapBlock).not.toContain('reply_text:');
    }
  });
});

// ─── DB migration 含新字段 ───────────────────────────────────────────────────
describe('DB migration 含 latest_reply / latest_reply_at / assignee / comment_replied_at [BEHAVIOR]', () => {
  it('存在包含 latest_reply_assignee 的 migration 文件', () => {
    const { readdirSync } = require('fs');
    const files: string[] = readdirSync('apps/api/db/migrations');
    const found = files.find((f: string) =>
      f.includes('leads_reply') || f.includes('reply_assignee')
    );
    // 当前不存在 → FAIL
    expect(found).toBeTruthy();
  });

  it('migration 文件含 latest_reply 列定义', () => {
    const { readdirSync } = require('fs');
    const files: string[] = readdirSync('apps/api/db/migrations');
    const target = files.find((f: string) =>
      f.includes('leads_reply') || f.includes('reply_assignee')
    );
    if (!target) throw new Error('migration 文件不存在');
    const content = readFileSync(`apps/api/db/migrations/${target}`, 'utf8');
    expect(content).toContain('latest_reply');
    expect(content).toContain('assignee');
  });

  it('migration 文件含 acquisition_orphan_replies 表定义', () => {
    const { readdirSync } = require('fs');
    const files: string[] = readdirSync('apps/api/db/migrations');
    const target = files.find((f: string) =>
      f.includes('leads_reply') || f.includes('reply_assignee')
    );
    if (!target) throw new Error('migration 文件不存在');
    const content = readFileSync(`apps/api/db/migrations/${target}`, 'utf8');
    expect(content).toContain('acquisition_orphan_replies');
    expect(content).toContain('commenter_nickname');
  });
});
