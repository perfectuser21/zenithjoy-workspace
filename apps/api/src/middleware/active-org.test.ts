/**
 * active-org 解析核心的单元测试（纯函数 resolveActiveOrg + 文案常量）——无 I/O、无 PG，跑在 L3。
 *
 * 真库真会话的端到端断言在 sprints/08221800-org-context-switch-core/tests/（真 PG，L4）。
 * 这里只钉纯函数的判定语义：0/1/≥2 家 × active_org 有效/缺失/伪造 的解析矩阵。
 */
import { describe, it, expect } from 'vitest';
import { resolveActiveOrg, ORG_MESSAGES } from './active-org';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const C = 'cccccccc-0000-4000-8000-000000000003';

describe('resolveActiveOrg 判定矩阵', () => {
  it('0 家 → 403 NO_TENANT', () => {
    const r = resolveActiveOrg([], null);
    expect(r).toEqual({ ok: false, status: 403, code: 'NO_TENANT', message: ORG_MESSAGES.NO_TENANT });
  });

  it('1 家 + active_org 未设 → 透明解析（A8 零回归，不弹选择器）', () => {
    expect(resolveActiveOrg([A], null)).toEqual({ ok: true, orgId: A });
  });

  it('1 家 + active_org=那一家 → 解析为它', () => {
    expect(resolveActiveOrg([A], A)).toEqual({ ok: true, orgId: A });
  });

  it('1 家 + active_org=别家（成员从选中企业被移出后只剩一家）→ 403 ORG_FORBIDDEN（不透明落到剩下那家）', () => {
    const r = resolveActiveOrg([B], A);
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ status: 403, code: 'ORG_FORBIDDEN' });
  });

  it('≥2 家 + 未选 → 409 ORG_SELECTION_REQUIRED（停下要求先选，绝不自动挑）', () => {
    const r = resolveActiveOrg([A, B], null);
    expect(r).toEqual({
      ok: false,
      status: 409,
      code: 'ORG_SELECTION_REQUIRED',
      message: ORG_MESSAGES.ORG_SELECTION_REQUIRED,
    });
  });

  it('≥2 家 + active_org ∈ 集合 → 解析为选中的那家', () => {
    expect(resolveActiveOrg([A, B], B)).toEqual({ ok: true, orgId: B });
  });

  it('≥2 家 + active_org 伪造（∉ 集合）→ 403 ORG_FORBIDDEN', () => {
    const r = resolveActiveOrg([A, B], C);
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ status: 403, code: 'ORG_FORBIDDEN', message: ORG_MESSAGES.ORG_FORBIDDEN });
  });

  it('三态文案两两不同（前端两路共用解析器分派）', () => {
    const msgs = Object.values(ORG_MESSAGES);
    expect(new Set(msgs).size).toBe(msgs.length);
  });
});
