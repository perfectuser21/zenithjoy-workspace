/**
 * Brain 库连接池的守卫（task 3abb7f8c）
 *
 * 要害只有一个：**没配置时必须返回 null，而不是抛错或连到本地库**。
 * 连错库比连不上更毒 —— 排程会写进 zenithjoy 库的另一张 tasks 表，账实分叉且没人知道
 * （2026-07-13 P0 事故正是 zenithjoy.tasks 抢先解析了 Brain 的 public.tasks）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ctorArgs: Array<Record<string, unknown>> = [];
vi.mock('pg', () => ({
  Pool: class {
    constructor(cfg: Record<string, unknown>) { ctorArgs.push(cfg); }
    on() { /* noop */ }
  },
}));

import { getBrainPool, __resetBrainPoolForTest, BRAIN_CONNECT_TIMEOUT_MS } from '../brain-pool';

const KEYS = [
  'BRAIN_DATABASE_HOST', 'BRAIN_DATABASE_PORT', 'BRAIN_DATABASE_NAME',
  'BRAIN_DATABASE_USER', 'BRAIN_DATABASE_PASSWORD',
];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  ctorArgs.length = 0;
  __resetBrainPoolForTest();
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k] as string;
  }
  __resetBrainPoolForTest();
});

describe('未配置时', () => {
  it('返回 null 而不是抛错（本地/CI 不配也要能起服务）', () => {
    expect(getBrainPool()).toBeNull();
  });

  it('绝不退回连本地库（连错库=账实分叉，比连不上更毒）', () => {
    getBrainPool();
    expect(ctorArgs).toHaveLength(0);
  });
});

describe('已配置时', () => {
  beforeEach(() => { process.env.BRAIN_DATABASE_HOST = '100.79.41.61'; });

  it('按 BRAIN_* 而不是 DATABASE_* 建池（两套库绝不能串）', () => {
    process.env.DATABASE_HOST = 'should-not-be-used';
    getBrainPool();
    expect(ctorArgs[0].host).toBe('100.79.41.61');
  });

  it('跨境连接超时给 8 秒（3 秒不够，PR#1892 丢单教训）', () => {
    getBrainPool();
    expect(ctorArgs[0].connectionTimeoutMillis).toBe(BRAIN_CONNECT_TIMEOUT_MS);
    expect(BRAIN_CONNECT_TIMEOUT_MS).toBeGreaterThanOrEqual(8000);
  });

  it('search_path 钉死 public —— Brain 的 tasks 在 public，别被 zenithjoy schema 抢先解析', () => {
    getBrainPool();
    expect(String(ctorArgs[0].options)).toMatch(/search_path=public/);
  });

  it('同一进程内只建一次池', () => {
    const a = getBrainPool();
    const b = getBrainPool();
    expect(a).toBe(b);
    expect(ctorArgs).toHaveLength(1);
  });
});
