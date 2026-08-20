/**
 * 路③ 路由表的形状 —— 端点清单固定为 9 个（4 写 + 5 读），且整个 router 前面挂着鉴权闸。
 *
 * 为什么值得单独钉：合同把端点数写死为 9，而"少挂一个闸"或"多开一个端点"这两件事
 * 在行为测试里都不会自己冒出来（没人会去测一个还没被写出来的端点）。这里直接读
 * Express 的路由栈，多一个少一个当场看得见。
 *
 * 真实的鉴权判定、落库归属、反枚举 404 由合同的真 Postgres 测试与
 * structured-workbench-smoke.sh 覆盖，本文件不碰它们。
 */
import { describe, it, expect } from 'vitest';
import workbenchRouter from './workbench';

interface LayerLike {
  name?: string;
  route?: { path: string; methods: Record<string, boolean> };
}

const stack = (workbenchRouter as unknown as { stack: LayerLike[] }).stack;

function routes(): Array<{ method: string; path: string }> {
  const out: Array<{ method: string; path: string }> = [];
  for (const layer of stack) {
    if (!layer.route) continue;
    for (const [m, on] of Object.entries(layer.route.methods)) {
      if (on) out.push({ method: m.toUpperCase(), path: layer.route.path });
    }
  }
  return out;
}

describe('路③ 路由表', () => {
  it('端点清单恰好 9 个（4 写 + 5 读），与合同逐字一致', () => {
    const got = routes()
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    expect(got).toEqual(
      [
        'GET /templates',
        'GET /tables',
        'GET /tables/:id',
        'GET /tables/:id/fields',
        'GET /trash',
        'POST /tables',
        'POST /tables/:id/fields',
        'POST /trash/:id/restore',
        'DELETE /tables/:id',
      ].sort()
    );
    expect(got.length).toBe(9);
  });

  it('写端点 4 个、读端点 5 个', () => {
    const all = routes();
    const writes = all.filter((r) => r.method !== 'GET');
    expect(writes.length).toBe(4);
    expect(all.length - writes.length).toBe(5);
  });

  it('鉴权闸挂在所有端点之前 —— 路由栈第一层是中间件而不是某条 route', () => {
    expect(stack.length).toBeGreaterThan(0);
    expect(stack[0].route).toBeUndefined();
  });
});
