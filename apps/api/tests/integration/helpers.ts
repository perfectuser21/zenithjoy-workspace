/**
 * Integration test helpers — shared Pool + test-data factories.
 *
 * Pool 直连 zenithjoy_test，独立于 apps/api 应用内部的 pool，
 * 专门用于 beforeAll 准备数据 + afterAll 清理。
 */
import { Pool } from 'pg';
import { randomUUID } from 'crypto';

export const testPool = new Pool({
  host: process.env.DATABASE_HOST ?? 'localhost',
  port: parseInt(process.env.DATABASE_PORT ?? '5432'),
  database: process.env.DATABASE_NAME ?? 'zenithjoy_test',
  user: process.env.DATABASE_USER ?? 'postgres',
  password: process.env.DATABASE_PASSWORD ?? 'postgres',
});

/** 清空指定表（CASCADE），用于每个 suite 的 afterAll */
export async function truncateTables(...tables: string[]) {
  for (const table of tables) {
    await testPool.query(`TRUNCATE ${table} CASCADE`);
  }
}

/** 创建测试 tenant，返回 { id, name, licenseKey } */
export async function createTestTenant(name = `test-tenant-${randomUUID().slice(0, 8)}`) {
  const licenseKey = `ZJ-TEST-${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  const { rows } = await testPool.query<{ id: string; name: string; license_key: string }>(
    `INSERT INTO zenithjoy.tenants (name, license_key, plan)
     VALUES ($1, $2, 'free')
     RETURNING id, name, license_key`,
    [name, licenseKey]
  );
  return { id: rows[0].id, name: rows[0].name, licenseKey: rows[0].license_key };
}

/** 把飞书 user_id 关联到 tenant */
export async function addTenantMember(tenantId: string, feishuUserId: string, role = 'member') {
  await testPool.query(
    `INSERT INTO zenithjoy.tenant_members (tenant_id, feishu_user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, feishu_user_id) DO NOTHING`,
    [tenantId, feishuUserId, role]
  );
}
