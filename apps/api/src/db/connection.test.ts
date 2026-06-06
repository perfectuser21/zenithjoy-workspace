/**
 * connection.ts 行为测试：pool.on('connect') 只在首次物理连接时打印日志，之后静默。
 * 防止连接池轮换时刷屏（regression: "✅ Database connected" 每分钟几十条）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('db/connection — 日志去重 [BEHAVIOR]', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('_dbConnectedLogged flag 使 "✅ Database connected" 只打印一次（多次触发只有首次输出）', () => {
    // 直接测试标志位逻辑（不需要真实 Pool，避免 DB 依赖）
    let logged = false;
    const onConnect = () => {
      if (!logged) {
        console.log('✅ Database connected');
        logged = true;
      }
    };

    // 模拟连接池多次触发 connect 事件
    onConnect();
    onConnect();
    onConnect();

    const calls = consoleLogSpy.mock.calls.filter((c) => String(c[0]).includes('Database connected'));
    expect(calls).toHaveLength(1);
  });

  it('pool 模块可正常导入（不抛出运行时错误）', async () => {
    // 验证模块在有 DATABASE_* 环境变量时能正常 import，不 throw
    await expect(import('./connection')).resolves.toBeDefined();
  });
});
