import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

beforeEach(() => {
  vi.resetModules();
});

function mockRes(): { written: string[]; ended: boolean; headers: Record<string, string>; setHeader(k: string, v: string): void; flushHeaders(): void; write(c: string): boolean; end(): void } {
  return {
    written: [] as string[],
    ended: false,
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) { this.headers[k] = v; },
    flushHeaders() {},
    write(chunk: string) { this.written.push(chunk); return true; },
    end() { this.ended = true; },
  };
}

function mockReq(): { listeners: Record<string, (() => void)[]>; on(e: string, cb: () => void): void } {
  return {
    listeners: {} as Record<string, (() => void)[]>,
    on(event: string, cb: () => void) { (this.listeners[event] ??= []).push(cb); },
  };
}

describe('sseService', () => {
  it('subscribe 设置正确响应头', async () => {
    const { sseService } = await import('../sse.service');
    const req = mockReq();
    const res = mockRes();
    sseService.subscribe('task-1', req as unknown as Request, res as unknown as Response, { status: 'pending' });
    expect(res.headers['Content-Type']).toBe('text/event-stream');
    expect(res.headers['Cache-Control']).toBe('no-cache');
    expect(res.headers['X-Accel-Buffering']).toBe('no');
  });

  it('subscribe 立即发送 catch-up 初始数据', async () => {
    const { sseService } = await import('../sse.service');
    const req = mockReq();
    const res = mockRes();
    sseService.subscribe('task-2', req as unknown as Request, res as unknown as Response, { status: 'running', progress: 30 });
    expect(res.written.length).toBeGreaterThan(0);
    expect(res.written[0]).toContain('"status":"running"');
    expect(res.written[0]).toContain('"progress":30');
  });

  it('emit 将事件发送到所有订阅者', async () => {
    const { sseService } = await import('../sse.service');
    const req1 = mockReq();
    const res1 = mockRes();
    const req2 = mockReq();
    const res2 = mockRes();
    sseService.subscribe('task-3', req1 as unknown as Request, res1 as unknown as Response, { status: 'pending' });
    sseService.subscribe('task-3', req2 as unknown as Request, res2 as unknown as Response, { status: 'pending' });
    sseService.emit('task-3', { status: 'done', progress: 100 });
    const lastWrite1 = res1.written[res1.written.length - 1];
    const lastWrite2 = res2.written[res2.written.length - 1];
    expect(lastWrite1).toContain('"status":"done"');
    expect(lastWrite2).toContain('"status":"done"');
  });

  it('emit 对未知 taskId 不报错', async () => {
    const { sseService } = await import('../sse.service');
    expect(() => sseService.emit('nonexistent', { x: 1 })).not.toThrow();
  });

  it('close 发送最终事件并断开所有订阅', async () => {
    const { sseService } = await import('../sse.service');
    const req = mockReq();
    const res = mockRes();
    sseService.subscribe('task-4', req as unknown as Request, res as unknown as Response, { status: 'pending' });
    sseService.close('task-4', { status: 'done' });
    expect(res.ended).toBe(true);
  });

  it('req close 事件触发自动清理', async () => {
    const { sseService } = await import('../sse.service');
    const req = mockReq();
    const res = mockRes();
    sseService.subscribe('task-5', req as unknown as Request, res as unknown as Response, { status: 'pending' });
    req.listeners['close']?.[0]?.();
    expect(() => sseService.emit('task-5', { status: 'done' })).not.toThrow();
  });
});
