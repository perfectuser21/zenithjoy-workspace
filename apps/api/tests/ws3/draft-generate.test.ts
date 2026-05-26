/**
 * Path 4 Sprint 1 ws3 — /api/wechat/draft-generate 端点契约（合同 RED）。
 *
 * 校验：
 *   1) routes/wechat.ts 含 /api/wechat/draft-generate 字面量（grep）
 *   2) services/wechat-draft.ts 文件存在 + export generateChatDraft
 *
 * 注：tests/ws3/** 在 vitest.config.ts 里被 exclude，不会进 CI vitest 集；
 * 这里作为合同 RED 验证文件，由 sprint-evaluator 在合同验证阶段执行。
 */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const WECHAT_ROUTE = path.join(REPO_ROOT, 'apps', 'api', 'src', 'routes', 'wechat.ts');
const DRAFT_SERVICE = path.join(REPO_ROOT, 'apps', 'api', 'src', 'services', 'wechat-draft.ts');

describe('ws3 /api/wechat/draft-generate — 端点存在', () => {
  it('routes/wechat.ts 文件存在', () => {
    expect(fs.existsSync(WECHAT_ROUTE)).toBe(true);
  });

  it('routes/wechat.ts 含 /draft-generate 路由字面量', () => {
    const src = fs.readFileSync(WECHAT_ROUTE, 'utf-8');
    expect(src).toMatch(/['"`]\/draft-generate['"`]|['"`]\/api\/wechat\/draft-generate['"`]/);
  });

  it('services/wechat-draft.ts 文件存在 + export generateChatDraft', () => {
    expect(fs.existsSync(DRAFT_SERVICE)).toBe(true);
    const src = fs.readFileSync(DRAFT_SERVICE, 'utf-8');
    expect(src).toMatch(/export\s+(async\s+)?function\s+generateChatDraft\b|export\s+\{[^}]*generateChatDraft[^}]*\}/);
  });

  it('services/wechat-draft.ts 调用 callOpenRouter（DeepSeek 真调用接入）', () => {
    const src = fs.readFileSync(DRAFT_SERVICE, 'utf-8');
    expect(src).toMatch(/callOpenRouter\b/);
  });

  it('services/wechat-draft.ts INSERT wechat_publish_task 时 type=chat（A 路线护栏）', () => {
    const src = fs.readFileSync(DRAFT_SERVICE, 'utf-8');
    // 必须显式 type='chat' 而不是动态字段，确保 SQL 防作弊查询命中
    expect(src).toMatch(/['"]chat['"]/);
    expect(src).toMatch(/wechat_publish_task/);
  });
});
