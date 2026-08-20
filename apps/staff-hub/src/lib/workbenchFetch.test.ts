/**
 * 路③ 前端 fetch 层的常量与端点前缀。
 *
 * 真正的请求行为（只带会话 cookie、一个身份头都不拼）由 knowledgeFetch 那一份实现并已有
 * 覆盖；本文件钉的是本刀自己的两件事：八类字段与服务端 CHECK 约束逐字对齐，
 * 以及端点前缀不许漂到 /api/staff 之下（那个前缀有身份头闸，挂进去命门当场作废）。
 */
import { describe, it, expect } from 'vitest';
import { WORKBENCH_BASE, FIELD_TYPES, FIELD_TYPE_LABELS } from './workbenchFetch';

describe('workbenchFetch 常量', () => {
  it('端点前缀是 /api/knowledge/db，且不在 /api/staff 之下', () => {
    expect(WORKBENCH_BASE).toBe('/api/knowledge/db');
    expect(WORKBENCH_BASE.startsWith('/api/staff')).toBe(false);
  });

  it('八类字段与服务端逐字一致且无重复', () => {
    expect([...FIELD_TYPES]).toEqual([
      'text',
      'long_text',
      'number',
      'date',
      'single_select',
      'multi_select',
      'person',
      'url',
    ]);
    expect(new Set(FIELD_TYPES).size).toBe(8);
  });

  it('每一类都有中文标签，且标签两两不同（撞名用户就分不出选的是哪一类）', () => {
    const labels = FIELD_TYPES.map((t) => FIELD_TYPE_LABELS[t]);
    expect(labels.every((l) => typeof l === 'string' && l.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(FIELD_TYPES.length);
  });
});
