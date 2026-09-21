/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 批量混剪横竖屏选择（GP line05/batch_mashup#step4）：POST /api/mashup/runs 端点契约。
 *
 * 客户原话"抖音横屏和竖屏是我们要选择的呀，有的是横屏，有的是竖屏"——这个决定
 * 跟着 run 走（同一个 run 里客户选一次，渲染时才用），是"这批片子怎么出"的设定，
 * 与套路模板同一层级、同一个端点提交。
 *
 * assignSlots（mashup-slot-assignment.ts）本身不碰——那是任务铁律明确禁止改动
 * 的文件，run 的 INSERT 发生在它内部。这里验证路由层在 assignSlots 成功之后，
 * 额外发一条 UPDATE 把 aspectRatio 落到刚创建的 run 上；非法值在碰 DB 之前就
 * 400 拒绝；不传该字段时不发多余的 UPDATE（DB 列默认值兜底老口径）。
 *
 * 独立成新文件而不是改现有 mashup.test.ts——同样是任务铁律：只许碰指定文件 +
 * 新建测试，不动已注册的既有测试文件。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../services/walking-skeleton.service', () => ({ validateLicense: vi.fn() }));
vi.mock('../../db/connection', () => ({ default: { query: vi.fn() } }));

import { validateLicense } from '../../services/walking-skeleton.service';
import pool from '../../db/connection';
import { createMashupRouter } from '../mashup';

const TOKEN_A = 'ZJ-F-AAAA1111';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/mashup', createMashupRouter());
  return app;
}

const licenseOk = (tenantId: string) => ({
  ok: true as const,
  license: { id: 'lic', license_key: TOKEN_A, tenant_id: tenantId, status: 'active', expires_at: '2099-01-01T00:00:00Z' },
});

beforeEach(() => {
  vi.clearAllMocks();
});

function mockAssignSlotsHappyPath() {
  (pool.query as any).mockImplementation((sql: string) => {
    if (sql.includes('FROM zenithjoy.mashup_templates')) {
      return { rows: [{ id: 'tmpl-1', slots: [{ key: 'hook', required: true, match_tags: ['开场'] }] }] };
    }
    if (sql.includes('FROM zenithjoy.materials')) return { rows: [{ id: 'mat-1', ai_tags: ['开场'] }] };
    if (sql.includes('INSERT INTO zenithjoy.mashup_runs')) return { rows: [{ id: 'run-1' }] };
    return { rows: [] };
  });
}

describe('POST /api/mashup/runs — aspectRatio', () => {
  it('传合法 aspectRatio=portrait：成功创建 run，并额外发 UPDATE 把它落到该 run', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk('tenant-a'));
    mockAssignSlotsHappyPath();

    const r = await request(makeApp())
      .post('/api/mashup/runs')
      .set('X-Upload-Token', TOKEN_A)
      .send({ templateId: 'tmpl-1', materialIds: ['mat-1'], aspectRatio: 'portrait' });

    expect(r.status).toBe(200);
    expect(r.body.data.runId).toBe('run-1');
    expect(r.body.data.aspectRatio).toBe('portrait');

    const updateCall = (pool.query as any).mock.calls.find(
      (c: unknown[]) => String(c[0]).includes('UPDATE zenithjoy.mashup_runs') && String(c[0]).includes('aspect_ratio'),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[1]).toEqual(['run-1', 'portrait']);
  });

  it('传合法 aspectRatio=landscape：同样成功且落库', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk('tenant-a'));
    mockAssignSlotsHappyPath();

    const r = await request(makeApp())
      .post('/api/mashup/runs')
      .set('X-Upload-Token', TOKEN_A)
      .send({ templateId: 'tmpl-1', materialIds: ['mat-1'], aspectRatio: 'landscape' });

    expect(r.status).toBe(200);
    expect(r.body.data.aspectRatio).toBe('landscape');
  });

  it('不传 aspectRatio：仍然 200（老调用方/老口径不报错），不发多余 UPDATE，响应给默认值 landscape', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk('tenant-a'));
    mockAssignSlotsHappyPath();

    const r = await request(makeApp())
      .post('/api/mashup/runs')
      .set('X-Upload-Token', TOKEN_A)
      .send({ templateId: 'tmpl-1', materialIds: ['mat-1'] });

    expect(r.status).toBe(200);
    expect(r.body.data.aspectRatio).toBe('landscape');
    const updateCall = (pool.query as any).mock.calls.find(
      (c: unknown[]) => String(c[0]).includes('UPDATE zenithjoy.mashup_runs') && String(c[0]).includes('aspect_ratio'),
    );
    expect(updateCall).toBeUndefined();
  });

  it('非法 aspectRatio 值 → 400，且完全不碰 DB（校验先于一切查询）', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk('tenant-a'));

    const r = await request(makeApp())
      .post('/api/mashup/runs')
      .set('X-Upload-Token', TOKEN_A)
      .send({ templateId: 'tmpl-1', materialIds: [], aspectRatio: 'square' });

    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_BODY');
    expect(pool.query).not.toHaveBeenCalled();
  });
});
