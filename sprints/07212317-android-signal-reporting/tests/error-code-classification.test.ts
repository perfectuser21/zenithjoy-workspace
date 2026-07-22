/**
 * Contract Test Skeleton — F2 采集失败 error_code 五分类
 * Sprint: f08ab898-2090-4ffb-9aaa-a48c320d42d2
 * DoD: contract-dod.md [BEHAVIOR] B2
 *
 * 这是 (Red) commit 骨架。实现待 commit-5（acquisition-collect.ts 改动）后填充。
 */
import { describe, it, expect } from 'vitest';

// TODO: commit-5 后取消注释
// import { settleCollectTask, COLLECT_ERROR_CODES } from '../../../apps/api/src/services/acquisition-collect';

/** 五分类枚举 + UNKNOWN 兜底，共 6 个合法值 */
const EXPECTED_ERROR_CODES = [
  'KEYWORD_NO_RESULT',
  'KEYWORD_BANNED',
  'PLATFORM_RATE_LIMIT',
  'NETWORK_ERROR',
  'ACCOUNT_STATUS_ERROR',
  'UNKNOWN',
] as const;

describe('F2: 采集失败 error_code 五分类', () => {
  describe('B2.1 六个合法枚举值均能落库（不被服务层改写或丢弃）', () => {
    for (const code of EXPECTED_ERROR_CODES) {
      it(`error_code="${code}" 透传落库，不改写`, async () => {
        // TODO: 实现后填充
        // const result = settleCollectTask({
        //   currentStatus: 'running',
        //   agentTerminal: { terminal: 'failed', error_code: code },
        //   videoTotal: 0,
        //   videoDone: 0,
        // });
        // expect(result.error_code).toBe(code);
        // expect(result.status).toBe('failed');
        expect(true).toBe(false); // Red
      });
    }
  });

  describe('B2.2 COLLECT_ERROR_CODES 枚举类型定义导出', () => {
    it('acquisition-collect.ts 导出 COLLECT_ERROR_CODES 常量，包含全部 6 个值', () => {
      // TODO: 实现后填充
      // expect(COLLECT_ERROR_CODES).toContain('KEYWORD_NO_RESULT');
      // expect(COLLECT_ERROR_CODES).toContain('UNKNOWN');
      // expect(COLLECT_ERROR_CODES).toHaveLength(6);
      expect(true).toBe(false); // Red
    });
  });

  describe('B2.3 历史兼容：旧字面值 failed 不报错', () => {
    it('error_code="failed"（旧格式）仍可落库，不抛 Zod 错误', async () => {
      // TODO: 实现后填充（无 DB CHECK 约束，应用层不拦截旧值）
      expect(true).toBe(false); // Red
    });
  });

  describe('B2.4 静默丢弃禁止', () => {
    it('任何非空 error_code 上报后，DB 记录中 error_code 不为 null', async () => {
      // TODO: 实现后填充
      expect(true).toBe(false); // Red
    });

    it('error_code 为 undefined/null 时，DB 记录中 error_code 为 null（不崩溃）', async () => {
      // TODO: 实现后填充
      expect(true).toBe(false); // Red
    });
  });

  describe('B2.5 settleCollectTask failed 分支携带 error_code', () => {
    it('agentTerminal.terminal=failed + error_code → result.status=failed + result.error_code=<code>', () => {
      // TODO: 实现后填充
      expect(true).toBe(false); // Red
    });
  });
});
