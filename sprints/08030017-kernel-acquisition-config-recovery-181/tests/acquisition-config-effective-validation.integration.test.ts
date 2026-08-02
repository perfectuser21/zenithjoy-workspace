import { randomUUID } from 'node:crypto';
import express, { type Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

let app: Express;
let db: Pool;
let tenantsCreated = false;

const tenantA = `kernel-existing-a-${randomUUID()}`;
const tenantB = `kernel-existing-b-${randomUUID()}`;
const tenantNew = `kernel-new-${randomUUID()}`;
const tenantUuidA = randomUUID();
const tenantUuidB = randomUUID();
const tenantUuidNew = randomUUID();
const memberA = `kernel-member-a-${randomUUID()}`;
const memberB = `kernel-member-b-${randomUUID()}`;
const memberNew = `kernel-member-new-${randomUUID()}`;

const completeConfig = {
  collect_rounds_per_day: 4,
  keywords_per_round_min: 12,
  keywords_per_round_max: 12,
  collect_active_start: '08:00',
  collect_active_end: '20:00',
  burner_count: 4,
  dm_per_hour: 6,
  dm_per_day: 32,
  dm_interval_min_sec: 240,
  dm_interval_max_sec: 720,
  dm_active_start: '10:00',
  dm_active_end: '21:00',
  nurture_per_day_min: 2,
  nurture_per_day_max: 4,
  cookie_check_interval_hours: 8,
  dm_message: 'Kernel contract complete update',
};

function configureDatabaseFromDbUrl(): void {
  const raw = process.env.DB_URL;
  if (!raw) throw new Error('DB_URL 必填：合同测试禁止使用隐式数据库默认值');
  const url = new URL(raw);
  process.env.DATABASE_HOST = url.hostname;
  process.env.DATABASE_PORT = url.port || '5432';
  process.env.DATABASE_NAME = decodeURIComponent(url.pathname.replace(/^\//, ''));
  process.env.DATABASE_USER = decodeURIComponent(url.username);
  process.env.DATABASE_PASSWORD = decodeURIComponent(url.password);
}

async function readConfig(tenantId: string): Promise<Record<string, unknown> | undefined> {
  const result = await db.query(
    'SELECT * FROM zenithjoy.acquisition_config WHERE tenant_id = $1',
    [tenantId],
  );
  return result.rows[0];
}

function withoutUpdatedAt(row: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!row) return {};
  const { updated_at: _updatedAt, ...businessFields } = row;
  return businessFields;
}

function changedBusinessKeys(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => before[key] !== after[key]).sort();
}

function expectInvalidConfig(response: request.Response): void {
  expect(response.status).toBe(400);
  expect(response.body.success).toBe(false);
  expect(response.body.error?.code).toBe('INVALID_CONFIG');
  expect(typeof response.body.error?.message).toBe('string');
}

describe('Kernel acquisition effective-config guard [BEHAVIOR]', () => {
  beforeAll(async () => {
    configureDatabaseFromDbUrl();
    const [{ default: pool }, dispatchModule, acquisitionModule] = await Promise.all([
      import('../../../apps/api/src/db/connection'),
      import('../../../apps/api/src/routes/acquisition-dispatch'),
      import('../../../apps/api/src/routes/acquisition'),
    ]);
    db = pool;
    app = express();
    app.use(express.json());
    app.use('/api/acquisition', dispatchModule.acquisitionDispatchRouter);
    app.use('/api/acquisition', acquisitionModule.acquisitionRouter);
    await db.query(
      `INSERT INTO zenithjoy.tenants (id, name, license_key, plan)
       VALUES ($1, $2, $3, 'free'), ($4, $5, $6, 'free'), ($7, $8, $9, 'free')`,
      [
        tenantUuidA, tenantA, `license-${tenantUuidA}`,
        tenantUuidB, tenantB, `license-${tenantUuidB}`,
        tenantUuidNew, tenantNew, `license-${tenantUuidNew}`,
      ],
    );
    tenantsCreated = true;
    await db.query(
      `INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role)
       VALUES ($1, $2, 'owner'), ($3, $4, 'owner'), ($5, $6, 'owner')`,
      [tenantUuidA, memberA, tenantUuidB, memberB, tenantUuidNew, memberNew],
    );
  });

  beforeEach(async () => {
    await db.query(
      'DELETE FROM zenithjoy.acquisition_config WHERE tenant_id = ANY($1::text[])',
      [[tenantUuidA, tenantUuidB, tenantUuidNew]],
    );
    await db.query(
      `INSERT INTO zenithjoy.acquisition_config
         (tenant_id, keywords_per_round_min, keywords_per_round_max, dm_per_day)
       VALUES ($1, 3, 10, 30), ($2, 2, 8, 30)`,
      [tenantUuidA, tenantUuidB],
    );
  });

  afterAll(async () => {
    if (!db) return;
    if (tenantsCreated) {
      await db.query(
        'DELETE FROM zenithjoy.acquisition_config WHERE tenant_id = ANY($1::text[])',
        [[tenantUuidA, tenantUuidB, tenantUuidNew]],
      );
      await db.query('DELETE FROM zenithjoy.tenants WHERE id = ANY($1::uuid[])', [
        [tenantUuidA, tenantUuidB, tenantUuidNew],
      ]);
    }
    await db.end();
  });

  it('PUT 仅提高 min 的无效有效态返回 400 INVALID_CONFIG 且两租户整行零持久化', async () => {
    const beforeA = await readConfig(tenantUuidA);
    const beforeB = await readConfig(tenantUuidB);

    const response = await request(app)
      .put('/api/acquisition/config')
      .set('X-Feishu-User-Id', memberA)
      .send({ keywords_per_round_min: 11 });

    expectInvalidConfig(response);
    expect(await readConfig(tenantUuidA)).toEqual(beforeA);
    expect(await readConfig(tenantUuidB)).toEqual(beforeB);
  });

  it('PATCH 仅降低 max 的无效有效态返回 400 INVALID_CONFIG 且两租户整行零持久化', async () => {
    const beforeA = await readConfig(tenantUuidA);
    const beforeB = await readConfig(tenantUuidB);

    const response = await request(app)
      .patch('/api/acquisition/config')
      .set('X-Feishu-User-Id', memberA)
      .send({ keywords_per_round_max: 2 });

    expectInvalidConfig(response);
    expect(await readConfig(tenantUuidA)).toEqual(beforeA);
    expect(await readConfig(tenantUuidB)).toEqual(beforeB);
  });

  it('合法部分 PATCH 只改变请求字段且保持双租户隔离', async () => {
    const beforeA = withoutUpdatedAt(await readConfig(tenantUuidA));
    const beforeB = await readConfig(tenantUuidB);

    const response = await request(app)
      .patch('/api/acquisition/config')
      .set('X-Feishu-User-Id', memberA)
      .send({ keywords_per_round_min: 8 });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.keywords_per_round_min).toBe(8);
    expect(response.body.data.keywords_per_round_max).toBe(10);
    const afterA = withoutUpdatedAt(await readConfig(tenantUuidA));
    expect(changedBusinessKeys(beforeA, afterA)).toEqual(['keywords_per_round_min']);
    expect(await readConfig(tenantUuidB)).toEqual(beforeB);
  });

  it('合法非上下界部分 PUT 只改变请求字段且保持双租户隔离', async () => {
    const beforeA = withoutUpdatedAt(await readConfig(tenantUuidA));
    const beforeB = await readConfig(tenantUuidB);

    const response = await request(app)
      .put('/api/acquisition/config')
      .set('X-Feishu-User-Id', memberA)
      .send({ dm_per_day: 31 });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    const afterA = withoutUpdatedAt(await readConfig(tenantUuidA));
    expect(changedBusinessKeys(beforeA, afterA)).toEqual(['dm_per_day']);
    expect(afterA.keywords_per_round_min).toBe(3);
    expect(afterA.keywords_per_round_max).toBe(10);
    expect(await readConfig(tenantUuidB)).toEqual(beforeB);
  });

  it('合法完整 PUT 含全部配置字段且 min=max 时整行持久化可读回', async () => {
    const beforeB = await readConfig(tenantUuidB);

    const response = await request(app)
      .put('/api/acquisition/config')
      .set('X-Feishu-User-Id', memberA)
      .send(completeConfig);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({ tenant_id: tenantUuidA, ...completeConfig });
    expect(withoutUpdatedAt(await readConfig(tenantUuidA))).toMatchObject({ tenant_id: tenantUuidA, ...completeConfig });
    expect(await readConfig(tenantUuidB)).toEqual(beforeB);
  });

  it('已有租户并发部分更新按实际可见配置串行校验且最终合法', async () => {
    const beforeB = await readConfig(tenantUuidB);

    const responses = await Promise.all([
      request(app).patch('/api/acquisition/config').set('X-Feishu-User-Id', memberA)
        .send({ keywords_per_round_min: 9 }),
      request(app).patch('/api/acquisition/config').set('X-Feishu-User-Id', memberA)
        .send({ keywords_per_round_max: 8 }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
    expectInvalidConfig(responses.find((response) => response.status === 400)!);
    const finalA = await readConfig(tenantUuidA);
    expect(Number(finalA?.keywords_per_round_min)).toBeLessThanOrEqual(Number(finalA?.keywords_per_round_max));
    expect(await readConfig(tenantUuidB)).toEqual(beforeB);
  });

  it('新租户首次并发 upsert 串行校验且不会创建无效有效态', async () => {
    expect(await readConfig(tenantUuidNew)).toBeUndefined();
    const beforeB = await readConfig(tenantUuidB);

    const responses = await Promise.all([
      request(app).patch('/api/acquisition/config').set('X-Feishu-User-Id', memberNew)
        .send({ keywords_per_round_min: 5 }),
      request(app).patch('/api/acquisition/config').set('X-Feishu-User-Id', memberNew)
        .send({ keywords_per_round_max: 4 }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
    expectInvalidConfig(responses.find((response) => response.status === 400)!);
    const finalNew = await readConfig(tenantUuidNew);
    expect(finalNew).toBeDefined();
    expect(Number(finalNew?.keywords_per_round_min)).toBeLessThanOrEqual(Number(finalNew?.keywords_per_round_max));
    expect(await readConfig(tenantUuidB)).toEqual(beforeB);
  });
});
