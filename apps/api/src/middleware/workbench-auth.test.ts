/**
 * G0 闸的**响应形状**部分（不碰会话解析与成员表 —— 那两条边在合同「禁 mock 边清单」里，
 * 由合同的真会话 + 真 Postgres 测试与 `--a1-a3-only` / `--a11-only` 真库真验覆盖）。
 *
 * 这里钉的是三件光看行为测试容易漏掉的事：
 *   1. 四态文案两两不同 —— 文案撞车前端就分不出"重新登录"和"找管理员"
 *   2. 反枚举 404 体**不带 timestamp** —— 带上两次响应字节就不同，拿两个 id 各打一次
 *      比对响应即可分辨哪个真实存在，反枚举当场失效
 *   3. 错误体形状与路① 逐字一致 —— 两路共用同一个前端解析器，形状分叉就要改前端
 */
import { describe, it, expect } from 'vitest';
import {
  workbenchErrorBody,
  notFoundBody,
  SESSION_REQUIRED_MESSAGE,
  NO_TENANT_MESSAGE,
  MULTI_ORG_MESSAGE,
  LEDGER_UNREACHABLE_MESSAGE,
} from './workbench-auth';

describe('workbench-auth 响应形状', () => {
  it('错误体形状与路① 逐字一致（success/data/error.code/error.message/timestamp）', () => {
    const body = workbenchErrorBody('SESSION_REQUIRED', SESSION_REQUIRED_MESSAGE) as Record<
      string,
      unknown
    >;
    expect(body.success).toBe(false);
    expect(body.data).toBeNull();
    expect(body.error).toEqual({ code: 'SESSION_REQUIRED', message: SESSION_REQUIRED_MESSAGE });
    expect(typeof body.timestamp).toBe('string');
    expect(new Date(body.timestamp as string).toString()).not.toBe('Invalid Date');
  });

  it('四态文案两两不同 —— 撞车前端就分不出该重新登录还是该找管理员', () => {
    const msgs = [
      SESSION_REQUIRED_MESSAGE,
      NO_TENANT_MESSAGE,
      MULTI_ORG_MESSAGE,
      LEDGER_UNREACHABLE_MESSAGE,
    ];
    expect(new Set(msgs).size).toBe(4);
    for (const m of msgs) expect(m.length).toBeGreaterThan(0);
  });

  it('反枚举 404 体不带 timestamp，且两次调用逐字节相同', () => {
    const a = notFoundBody();
    const b = notFoundBody();
    expect('timestamp' in a).toBe(false);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect((a as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('404 文案不透露被访问的 id 或表是否存在', () => {
    const msg = (notFoundBody() as { error: { message: string } }).error.message;
    expect(msg).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
    // 同一句话要同时覆盖"不存在"和"没权限"两种情形，才谈得上不可区分
    expect(msg).toContain('或');
  });
});
