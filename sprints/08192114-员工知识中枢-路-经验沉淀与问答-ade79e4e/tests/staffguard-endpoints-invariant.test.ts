/**
 * A31 前置保护 —— 既有 16 个 staffGuard 端点不被本 sprint 误伤
 *
 * 背景（GP 合同 blast_radius ⑧ 实证）：staffGuard 的唯一判据是 X-User-Email / X-Feishu-User-Id
 * 两个明文头，一旦实现期为了"知识面不拼头"而全局摘头，这 16 个端点将对全体用户一律 403、
 * Staff Hub 既有页面整体不可用。知识面必须另起 knowledgeFetch，不得改 adminFetch。
 *
 * TDD Red：计数脚本与 knowledgeFetch 尚不存在，本文件全红。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';

const COUNTER = '.github/workflows/scripts/count-staffguard-endpoints.mjs';

describe('A31 前置保护 [BEHAVIOR]', () => {
  it('staffGuard 端点计数等于 16（11 个 staff.ts + 5 个 skill-drafts.ts）', () => {
    expect(existsSync(COUNTER)).toBe(true);
    const out = execFileSync('node', [COUNTER], { encoding: 'utf8' }).trim();
    expect(out).toBe('16');
  });

  it('adminFetch 仍拼两个身份头（既有 16 端点靠它带头，摘除即全站 403）', () => {
    const c = readFileSync('apps/staff-hub/src/lib/adminFetch.ts', 'utf8');
    expect(c).toContain('X-User-Email');
    expect(c).toContain('X-Feishu-User-Id');
  });

  it('staffGuard 中间件源码未被改动（GP 合同要求语义一行不改）', () => {
    const c = readFileSync('apps/api/src/middleware/staff.ts', 'utf8');
    expect(c).toContain("req.headers['x-user-email']");
    expect(c).toContain("req.headers['x-feishu-user-id']");
    expect(c).toContain('staffIdentity');
  });

  it('知识面用独立 knowledgeFetch，零身份头且不复用 adminFetch', () => {
    const kf = readFileSync('apps/staff-hub/src/lib/knowledgeFetch.ts', 'utf8');
    expect(kf).not.toMatch(/X-User-Email/i);
    expect(kf).not.toMatch(/X-Feishu-User-Id/i);
    expect(kf).toContain('credentials');
    for (const p of [
      'apps/staff-hub/src/pages/KnowledgeNewPage.tsx',
      'apps/staff-hub/src/pages/KnowledgeRecentPage.tsx',
    ]) {
      expect(readFileSync(p, 'utf8')).not.toContain('adminFetch');
    }
  });

  it('knowledgeAuthGuard 与知识路由源码零身份头名（A27 静态守卫的断言对象）', () => {
    for (const p of ['apps/api/src/middleware/knowledge-auth.ts', 'apps/api/src/routes/knowledge.ts']) {
      const c = readFileSync(p, 'utf8');
      expect(c).not.toMatch(/x-user-email/i);
      expect(c).not.toMatch(/x-feishu-user-id/i);
    }
  });
});
