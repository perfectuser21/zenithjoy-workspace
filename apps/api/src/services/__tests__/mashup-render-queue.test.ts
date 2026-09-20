/**
 * Step4 渲染队列并发=1 + 失败态（真 Postgres — 禁 mock 边：渲染队列 ↔ mashup_candidates 状态迁移）。
 *
 * 覆盖：渲染并发上限为 1 第二个入队 queued / render_failed 可重新入队。
 * 真实 ffmpeg 渲染叶子由注入的 renderFn 顶替（允许的外层叶子），真实 ffmpeg 成片由 hk-vps L3 E2E 覆盖；
 * 被改的边（队列并发原语 + DB render_status 迁移）全程真跑，不 mock。
 *
 * 与 sprints/09201034-batch-mashup-script-preview-candidates/tests/mashup-render-queue.test.ts
 * 同源（sprint 阶段 TDD Red/Green 产物毕业到源码同级 __tests__，供 lint-test-pairing 配对）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import { enqueueRender } from '../mashup-render-queue';

const PGURL = process.env.E2E_DATABASE_URL ?? process.env.DB_URL ?? 'postgresql://postgres@localhost:5432/cecelia';
const TENANT = 'q-tenant-' + Math.random().toString(16).slice(2, 8);
let client: Client;
let templateId = '';
let runId = '';
let candA = '';
let candB = '';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function seedCandidate(sig: string): Promise<string> {
  const r = await client.query(
    `INSERT INTO zenithjoy.mashup_candidates (run_id, tenant_id, slot_fill, score, signature)
     VALUES ($1, $2, '{}'::jsonb, 1.0, $3) RETURNING id`,
    [runId, TENANT, sig],
  );
  return r.rows[0].id;
}

beforeAll(async () => {
  client = new Client({ connectionString: PGURL });
  await client.connect();
  templateId = (
    await client.query(
      `INSERT INTO zenithjoy.mashup_templates (tenant_id, name, slots) VALUES ($1, 'q-test', '[]'::jsonb) RETURNING id`,
      [TENANT],
    )
  ).rows[0].id;
  runId = (
    await client.query(
      `INSERT INTO zenithjoy.mashup_runs (tenant_id, template_id, status) VALUES ($1, $2, 'pending') RETURNING id`,
      [TENANT, templateId],
    )
  ).rows[0].id;
  candA = await seedCandidate('sigA-' + runId);
  candB = await seedCandidate('sigB-' + runId);
});

afterAll(async () => {
  await client.query(`DELETE FROM zenithjoy.mashup_runs WHERE id = $1`, [runId]).catch(() => {});
  await client.query(`DELETE FROM zenithjoy.mashup_templates WHERE id = $1`, [templateId]).catch(() => {});
  await client.end();
});

describe('Step4 渲染队列并发=1', () => {
  it('渲染并发上限为 1 第二个入队 queued', async () => {
    const gate = deferred<void>();
    const slowRender = async () => { await gate.promise; return { contentId: 'c', renderStatus: 'rendered' as const }; };

    const a = await enqueueRender({ tenantId: TENANT, candidateId: candA }, { render: slowRender });
    expect(['rendering', 'queued']).toContain(a.renderStatus);

    // A 的渲染被 gate 卡住占用唯一 slot 时，B 入队必须是 queued（并发=1）
    const b = await enqueueRender({ tenantId: TENANT, candidateId: candB }, { render: slowRender });
    expect(b.renderStatus).toBe('queued');
    expect(b.queuePosition).toBeGreaterThanOrEqual(1);

    gate.resolve();
    // 放行后 DB 里 A 终态应流转出 pending（rendering/rendered），验状态机真写库
    await new Promise((r) => setTimeout(r, 50));
    const row = await client.query(`SELECT render_status FROM zenithjoy.mashup_candidates WHERE id = $1`, [candA]);
    expect(['rendering', 'rendered', 'queued']).toContain(row.rows[0].render_status);
  });

  it('render_failed 可重新入队（非死路）', async () => {
    const failRender = async () => { throw new Error('ffmpeg boom'); };
    await enqueueRender({ tenantId: TENANT, candidateId: candA }, { render: failRender });
    await new Promise((r) => setTimeout(r, 50));
    const failed = await client.query(`SELECT render_status FROM zenithjoy.mashup_candidates WHERE id = $1`, [candA]);
    expect(failed.rows[0].render_status).toBe('render_failed');

    // 从 render_failed 再次入队应被接受（重新入队），不报错
    const okRender = async () => ({ contentId: 'c2', renderStatus: 'rendered' as const });
    const retry = await enqueueRender({ tenantId: TENANT, candidateId: candA }, { render: okRender });
    expect(['queued', 'rendering', 'rendered']).toContain(retry.renderStatus);
  });
});
