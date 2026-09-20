/**
 * 批量混剪加厚 Sprint 测试夹具 —— 真 Postgres + 真 app（supertest）
 *
 * 禁 mock 边（合同 ## 禁 mock 边清单）：
 *   - 真 Postgres：tenants / licenses / materials / mashup_templates / mashup_runs /
 *     mashup_candidates / mashup_render_jobs 全部真插真查，不 stub DB 层；
 *   - route ↔ service（assignSlots / generateCandidates / renderCandidate / from-script 解析）真调，禁 vi.mock 顶替；
 *   - 鉴权：走真 X-Upload-Token → validateLicense（真查 zenithjoy.licenses），不伪造 tenantId。
 * 唯一允许 mock 的更外层无关依赖（登记在 ## 未覆盖真实链路清单）：
 *   TOAPIS/Gemini 上游、Xenova 向量模型、ffmpeg 二进制（抽帧/渲染）—— 属环境端点/算力边界，
 *   被测的 DB 写路径与状态机一行不 mock。
 *
 * INV [租户隔离]：每条隔离用例恒定种两家租户，单租户种子会让跨租户漏洞永远看不见。
 */
import request from 'supertest';
import { Client } from 'pg';
import app from '../../../apps/api/src/app';

export { app, request };

export const PGURL =
  process.env.E2E_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/zenithjoy_test';

export async function connect(): Promise<Client> {
  const client = new Client({ connectionString: PGURL });
  await client.connect();
  return client;
}

export interface TenantToken {
  tenantId: string;
  token: string;
}

/** 种一家租户 + 一把 active license（X-Upload-Token 反查的凭据）。 */
export async function seedTenantToken(client: Client, prefix: string): Promise<TenantToken> {
  const sfx = `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`;
  const t = await client.query(
    "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ($1, $2, 'free') RETURNING id",
    [`${prefix}-${sfx}`, `mx-lk-${sfx}`],
  );
  const tenantId = t.rows[0].id as string;
  const token = `ZJ-MX-${sfx}`;
  await client.query(
    `INSERT INTO zenithjoy.licenses (license_key, tier, max_machines, status, expires_at, tenant_id)
     VALUES ($1, 'pro', 5, 'active', NOW() + INTERVAL '1 year', $2)`,
    [token, tenantId],
  );
  return { tenantId, token };
}

/** 种一条素材（默认视频 mime，用于在线预览/候选槽位）。 */
export async function seedMaterial(
  client: Client,
  tenantId: string,
  opts: { mime?: string; tags?: string[] } = {},
): Promise<string> {
  const sfx = `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`;
  const mime = opts.mime ?? 'video/mp4';
  const r = await client.query(
    `INSERT INTO zenithjoy.materials
       (tenant_id, storage_key, file_name, mime_type, size_bytes, dedupe_key, ai_tags, tag_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'tagged') RETURNING id`,
    [
      tenantId,
      `mashup-test/${sfx}.mp4`,
      `${sfx}.mp4`,
      mime,
      1024 * 1024,
      `${tenantId}:${sfx}`,
      JSON.stringify(opts.tags ?? ['产品特写', '开场']),
    ],
  );
  return r.rows[0].id as string;
}

/** 种一条模板（供 run 挂 FK）。slots 为动态分段结构（不写死 4 槽）。 */
export async function seedTemplate(
  client: Client,
  tenantId: string | null,
  slots?: unknown,
): Promise<string> {
  const sfx = `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`;
  const defaultSlots = [
    { key: 'seg1', required: true, match_tags: ['开场'] },
    { key: 'seg2', required: false, match_tags: ['产品特写'] },
  ];
  const r = await client.query(
    'INSERT INTO zenithjoy.mashup_templates (tenant_id, name, slots) VALUES ($1, $2, $3) RETURNING id',
    [tenantId, `模板-${sfx}`, JSON.stringify(slots ?? defaultSlots)],
  );
  return r.rows[0].id as string;
}

export async function seedRun(client: Client, tenantId: string, templateId: string): Promise<string> {
  const r = await client.query(
    "INSERT INTO zenithjoy.mashup_runs (tenant_id, template_id, status) VALUES ($1, $2, 'completed') RETURNING id",
    [tenantId, templateId],
  );
  return r.rows[0].id as string;
}

/** 种一条候选（仅用既有列，不依赖新 thumbnail_url 列，便于 RED 时也能种子）。 */
export async function seedCandidate(
  client: Client,
  tenantId: string,
  runId: string,
  slotFill: Record<string, string>,
): Promise<string> {
  const sig = Object.keys(slotFill)
    .sort()
    .map((k) => `${k}:${slotFill[k]}`)
    .join('|');
  const r = await client.query(
    `INSERT INTO zenithjoy.mashup_candidates (run_id, tenant_id, slot_fill, score, signature)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [runId, tenantId, JSON.stringify(slotFill), 1.5, sig],
  );
  return r.rows[0].id as string;
}

/**
 * 种一条渲染作业（新表 mashup_render_jobs）。实现落地前该表不存在 → 抛错，
 * 正是 Step4 队列用例的 RED 信号（预期红：表/端点未实现）。
 */
export async function seedRenderJob(
  client: Client,
  tenantId: string,
  runId: string,
  candidateId: string,
  status: 'queued' | 'rendering' | 'completed' | 'render_failed',
): Promise<string> {
  const r = await client.query(
    `INSERT INTO zenithjoy.mashup_render_jobs (tenant_id, run_id, candidate_id, status)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenantId, runId, candidateId, status],
  );
  return r.rows[0].id as string;
}

/** 按租户清场，容忍新表尚未落地（try/catch 单表隔离，避免污染其它 suite）。 */
export async function cleanupTenant(client: Client, tenantId: string): Promise<void> {
  const stmts = [
    ['DELETE FROM zenithjoy.mashup_render_jobs WHERE tenant_id = $1', [tenantId]],
    ['DELETE FROM zenithjoy.contents WHERE tenant_id = $1', [tenantId]],
    [
      'DELETE FROM zenithjoy.mashup_candidates WHERE run_id IN (SELECT id FROM zenithjoy.mashup_runs WHERE tenant_id = $1)',
      [tenantId],
    ],
    ['DELETE FROM zenithjoy.mashup_runs WHERE tenant_id = $1', [tenantId]],
    ['DELETE FROM zenithjoy.mashup_templates WHERE tenant_id = $1', [tenantId]],
    ['DELETE FROM zenithjoy.materials WHERE tenant_id = $1', [tenantId]],
    ['DELETE FROM zenithjoy.licenses WHERE tenant_id = $1', [tenantId]],
    ['DELETE FROM zenithjoy.tenants WHERE id = $1', [tenantId]],
  ] as const;
  for (const [sql, params] of stmts) {
    try {
      await client.query(sql, params as unknown[]);
    } catch {
      /* 新表尚未落地或 FK 顺序差异，单表容错，不阻断其它清理 */
    }
  }
}
