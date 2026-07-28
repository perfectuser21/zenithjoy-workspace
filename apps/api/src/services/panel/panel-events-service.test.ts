import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';

vi.mock('../../db/connection', () => ({ default: { query: vi.fn() } }));

import pool from '../../db/connection';
import { writePanelEvent } from './panel-events-service';

describe('panel-events-service.writePanelEvent（薄写入，按tenant_id隔离）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('INSERT 语句携带 tenant_id 隔离 + 6种事件类型之一，返回新行 id', async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [{ id: 'row-1' }] });

    const result = await writePanelEvent({
      tenantId: 'tenantA',
      event: 'task_started',
      taskId: 't1',
      line: 'line04',
      device: 'xian-pc',
      title: '回复客户张三',
    });

    expect(result).toEqual({ id: 'row-1' });
    const [sql, params] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sql).toMatch(/INSERT INTO zenithjoy\.panel_events/);
    expect(sql).toMatch(/tenant_id/);
    expect(params).toEqual(['tenantA', 't1', 'task_started', 'line04', 'xian-pc', '回复客户张三', null, null, 'info']);
  });

  it('detail/progress 可选字段有值时正确透传', async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [{ id: 'row-2' }] });

    await writePanelEvent({
      tenantId: 'tenantA',
      event: 'step',
      taskId: 't2',
      line: 'line04',
      device: 'xian-pc',
      title: '回复客户李四',
      detail: '第2/5步：读取对话历史',
      progress: [2, 5],
      severity: 'warn',
    });

    const [, params] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(params[6]).toBe('第2/5步：读取对话历史');
    expect(params[7]).toBe(JSON.stringify([2, 5]));
    expect(params[8]).toBe('warn');
  });

  it('severity 缺省时默认 info', async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [{ id: 'row-3' }] });

    await writePanelEvent({
      tenantId: 'tenantA', event: 'done', taskId: 't3', line: 'line04', device: 'd', title: 'x',
    });

    const [, params] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(params[8]).toBe('info');
  });

  it('DB 抛异常时原样向上抛（路由层负责 500 兜底，不在这层吞）', async () => {
    (pool.query as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'));

    await expect(writePanelEvent({
      tenantId: 'tenantA', event: 'failed', taskId: 't4', line: 'line04', device: 'd', title: 'x',
    })).rejects.toThrow('db down');
  });
});
