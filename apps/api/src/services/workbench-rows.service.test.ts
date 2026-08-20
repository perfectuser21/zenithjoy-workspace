/**
 * 路③ 行 service 的纯逻辑单测（test-pairing 车道，L3，无 DB）
 *
 * 只钉两件在真库测试里**照不到**的事：
 *   1. 上限默认值就是 5000 —— CI 与 E2E 一律把 `WORKBENCH_ROW_LIMIT` 覆写成小值来证明"闸真的在"
 *      （真插 5000 行会把 job 预算烧光，合同「未覆盖真实链路清单」已登记）。
 *      于是"默认值到底是不是产品阈值"这件事，只剩这条单测钉得住。合同原文：
 *      「默认值 5000 由 ARTIFACT + 纯逻辑单测双钉，两层都在，缺一即假绿」。
 *   2. 上限判定是**每请求读 env**、且是那个唯一的判定出口 —— `A15-limit-off` 变异注入的就是它，
 *      模块加载期把上限固化成常量会让整条证明链失效。
 *
 * 行的落库语义、乐观锁竞态、跨组织隔离都在合同的真 Postgres 测试里
 * （`sprints/08201850-workbench-sprintB-rows/tests/`），本文件一概不碰。
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  DEFAULT_ROW_LIMIT,
  RowLimitError,
  RowVersionConflictError,
  exceedsRowLimit,
  resolveRowLimit,
} from './workbench-rows.service';

const saved = process.env.WORKBENCH_ROW_LIMIT;

afterEach(() => {
  if (saved === undefined) delete process.env.WORKBENCH_ROW_LIMIT;
  else process.env.WORKBENCH_ROW_LIMIT = saved;
});

describe('单表行数上限', () => {
  it('默认值逐字为 5000（产品阈值，CI 里的小值只是为了证明闸在）', () => {
    delete process.env.WORKBENCH_ROW_LIMIT;
    expect(DEFAULT_ROW_LIMIT).toBe(5000);
    expect(resolveRowLimit()).toBe(5000);
  });

  it('每次调用都重读 env —— 固化成模块常量会让上限闸的证明链整条失效', () => {
    delete process.env.WORKBENCH_ROW_LIMIT;
    expect(resolveRowLimit()).toBe(5000);
    process.env.WORKBENCH_ROW_LIMIT = '3';
    expect(resolveRowLimit()).toBe(3);
    process.env.WORKBENCH_ROW_LIMIT = '7';
    expect(resolveRowLimit()).toBe(7);
  });

  it('非法 / 空 / 非正数的 env 一律回落默认值，绝不退化成 0（0 会把整张表锁死）', () => {
    for (const bad of ['', 'abc', '0', '-5', 'NaN']) {
      process.env.WORKBENCH_ROW_LIMIT = bad;
      expect(resolveRowLimit(), `WORKBENCH_ROW_LIMIT=${bad}`).toBe(5000);
    }
  });

  it('判定是「已有 + 本批 > 上限」——恰好等于上限时放行，超出一行即拒', () => {
    expect(exceedsRowLimit(2, 1, 3)).toBe(false);
    expect(exceedsRowLimit(2, 2, 3)).toBe(true);
    expect(exceedsRowLimit(3, 1, 3)).toBe(true);
    // 整批算一次：已有 0 行时粘贴 4 行也照样越界，不许"落到哪算哪"
    expect(exceedsRowLimit(0, 4, 3)).toBe(true);
  });
});

describe('行写回的两类失败各有自己的身份', () => {
  it('超上限与版本冲突是两个类型：前端据此分文案、分状态码（400 vs 409）', () => {
    const limit = new RowLimitError('已有 3 行，超过单表上限 3 行，未新增');
    const conflict = new RowVersionConflictError();
    expect(limit).toBeInstanceOf(Error);
    expect(limit.name).toBe('RowLimitError');
    expect(conflict.name).toBe('RowVersionConflictError');
    expect(conflict).not.toBeInstanceOf(RowLimitError);
    // 冲突文案是用户直接看到的那一句，改它等于改产品承诺
    expect(conflict.message).toBe('该行已被他人修改，你的改动未保存');
  });
});
