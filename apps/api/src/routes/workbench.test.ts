/**
 * 路③ 路由表的形状 —— 端点清单固定为 17 个（9 写 + 8 读），且整个 router 前面挂着鉴权闸。
 *
 * Sprint A 时是 9 个（4 写 + 5 读），Sprint B 补上行层八个后是 17。**改值不删断言**：
 * 这条断言的价值恰恰在于"多开一个端点必须有人显式认领它"，删掉就等于把认领环节取消了。
 *
 * 为什么值得单独钉：合同把端点数写死，而"少挂一个闸"或"多开一个端点"这两件事
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
  it('端点清单恰好 22 个（12 写 + 10 读），与合同逐字一致', () => {
    const got = routes()
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    expect(got).toEqual(
      [
        // Sprint A 表层九个
        'GET /templates',
        'GET /tables',
        'GET /tables/:id',
        'GET /tables/:id/fields',
        'GET /trash',
        'POST /tables',
        'POST /tables/:id/fields',
        'POST /trash/:id/restore',
        'DELETE /tables/:id',
        // Sprint B 行层八个
        'GET /tables/:id/rows',
        'GET /tables/:id/rows/trash',
        'GET /tables/:id/export',
        'POST /tables/:id/rows',
        'POST /tables/:id/rows/paste',
        'PATCH /rows/:id',
        'DELETE /rows/:id',
        'POST /rows/:id/restore',
        // Sprint C 视图层五个（3 写 + 2 读）
        'GET /tables/:id/views',
        'POST /tables/:id/views',
        'PATCH /views/:id',
        'DELETE /views/:id',
        'GET /assigned-to-me',
      ].sort()
    );
    expect(got.length).toBe(22);
  });

  it('写端点 12 个、读端点 10 个', () => {
    const all = routes();
    const writes = all.filter((r) => r.method !== 'GET');
    expect(writes.length).toBe(12);
    expect(all.length - writes.length).toBe(10);
  });

  it('鉴权闸挂在所有端点之前 —— 路由栈第一层是中间件而不是某条 route', () => {
    expect(stack.length).toBeGreaterThan(0);
    expect(stack[0].route).toBeUndefined();
  });
});
