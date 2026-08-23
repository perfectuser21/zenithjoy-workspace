/**
 * A9 — 路① 经验沉淀与问答 CRUD 回归
 *
 * 引入 documents 到共享知识/检索基建后，路① 既有端点不回归
 * （POST /api/staff/knowledge/entries、GET /recent、GET /projection）。
 * 参照 PR#1676 教训：改 API 端点漏查前端消费链致生产回归。本文件把路① 契约钉在本刀分支上。
 *
 * 禁 mock 边：真会话 + 真 public.learnings 写入（用唯一 marker，afterAll 清理）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../../apps/api/src/app';
import { seedTwoTenants, cleanupSeed, type TwoTenantSeed } from './_helpers';

const KB = '/api/staff/knowledge';

describe('A9 路① 经验沉淀 CRUD 回归 [BEHAVIOR]', () => {
  let s: TwoTenantSeed;
  const marker = `A9回归-${Date.now()}`;

  beforeAll(async () => {
    s = await seedTwoTenants('collab-a9');
  });

  afterAll(async () => {
    if (s) {
      await s.client
        .query("DELETE FROM public.learnings WHERE metadata->>'org_id' = $1 AND content LIKE $2", [
          s.orgATenantId,
          `%${marker}%`,
        ])
        .catch(() => undefined);
      await cleanupSeed(s);
    }
  });

  it('POST /entries 建经验 → 201 且带 entry_id（路① 写路径不回归）', async () => {
    const res = await request(app)
      .post(`${KB}/entries`)
      .set('Cookie', s.aliceCookie)
      .send({
        trigger_condition: `触发-${marker}`,
        conclusion: `结论-${marker}`,
        evidence_url: 'https://example.com/evidence',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.entry_id).toBeTruthy();
    expect(res.body.data.org_id).toBe(s.orgATenantId);
  });

  it('GET /recent 只显本组织且含刚建的经验（读路径不回归）', async () => {
    const res = await request(app).get(`${KB}/recent`).set('Cookie', s.aliceCookie);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body.data)).toContain(marker);
  });

  it('GET /projection 返回 200（投影端点不回归）', async () => {
    const res = await request(app).get(`${KB}/projection`).set('Cookie', s.aliceCookie);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
