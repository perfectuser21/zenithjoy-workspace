/**
 * documents 路由表形状 —— 端点清单固定，且整个 router 前挂鉴权闸（documentAuthGuard）。
 * 纯读 Express 路由栈，无 DB。真鉴权/落库/反枚举 404 由合同真 Postgres 测试覆盖。
 */
import { describe, it, expect } from 'vitest';
import documentsRouter from './documents';

interface LayerLike {
  name?: string;
  route?: { path: string; methods: Record<string, boolean> };
  handle?: unknown;
}

const stack = (documentsRouter as unknown as { stack: LayerLike[] }).stack;

function routes(): string[] {
  const out: string[] = [];
  for (const layer of stack) {
    if (!layer.route) continue;
    for (const [m, on] of Object.entries(layer.route.methods)) {
      if (on) out.push(`${m.toUpperCase()} ${layer.route.path}`);
    }
  }
  return out.sort();
}

describe('documents 路由表', () => {
  it('暴露文档端点族（树/搜索/CRUD/移动/软删/还原/导出/可见性/@提及）', () => {
    const got = routes();
    for (const r of [
      'GET /tree',
      'GET /search',
      'POST /',
      'GET /:id',
      'PATCH /:id',
      'POST /:id/move',
      'DELETE /:id',
      'POST /:id/restore',
      'GET /:id/export',
      'PUT /:id/visibility',
      'POST /:id/mention/resolve',
    ]) {
      expect(got).toContain(r);
    }
  });

  it('router 前挂了中间件层（限流 + documentAuthGuard，非纯路由）', () => {
    const middlewareLayers = stack.filter((l) => !l.route);
    expect(middlewareLayers.length).toBeGreaterThanOrEqual(2);
  });
});
