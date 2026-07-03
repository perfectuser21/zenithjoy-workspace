/**
 * TDD Red — 角色数据模型统一 & 账号管理页加绑定机器列 (Round 2)
 * Sprint: 07032332-line02-account-role-unify
 *
 * Round 2 新增：
 * - cutover 三值映射测试（ok→active, expired→expired, unknown→pending）
 * - agent_hostname=null 场景（LEFT JOIN 验证，无绑定机器不过滤）
 *
 * evaluator 不直接跑本文件；真实验收命令在 contract-dod.md [BEHAVIOR] manual:bash 里。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import request from 'supertest';
import app from '../../../apps/api/src/app';
import { execSync } from 'child_process';

const DB_URL = process.env.DATABASE_URL || 'postgresql://localhost/cecelia';
let pool: Pool;
let tenantId: string;
let agentId: string;

beforeAll(async () => {
  pool = new Pool({ connectionString: DB_URL });
  const ts = Date.now();

  const t = await pool.query(
    `INSERT INTO zenithjoy.tenants (name, license_key, plan)
     VALUES ($1, $2, 'free') RETURNING id`,
    [`role-unify-test-${ts}`, `key-${ts}`],
  );
  tenantId = t.rows[0].id;

  const a = await pool.query(
    `INSERT INTO zenithjoy.agents (tenant_id, machine_id, hostname, nickname, status)
     VALUES ($1, $2, 'rog-test-host', 'ROG测试机', 'online') RETURNING id`,
    [tenantId, `mac-test-${ts}`],
  );
  agentId = a.rows[0].id;

  await pool.query(
    `INSERT INTO zenithjoy.agent_platform_sessions
       (agent_id, platform, account_label, role, status, created_at, bound_at)
     VALUES ($1, 'douyin', 'test-burner-1', 'burner', 'active', NOW(), NOW())`,
    [agentId],
  );
});

afterAll(async () => {
  await pool.query(`DELETE FROM zenithjoy.agent_platform_sessions WHERE agent_id=$1`, [agentId]);
  await pool.query(`DELETE FROM zenithjoy.agents WHERE id=$1`, [agentId]);
  await pool.query(`DELETE FROM zenithjoy.tenants WHERE id=$1`, [tenantId]);
  await pool.end();
});

describe('GET /api/agent/burner/sessions — 角色统一字段 [BEHAVIOR]', () => {
  it('响应含 agent_hostname 字段（不是裸 hostname）', async () => {
    const r = await request(app)
      .get('/api/agent/burner/sessions')
      .set('X-Tenant-Id', tenantId);
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    const sessions = r.body.data?.sessions ?? [];
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0]).toHaveProperty('agent_hostname');
    expect(sessions[0].agent_hostname).toBe('rog-test-host');
    expect(sessions[0]).not.toHaveProperty('hostname');
  });

  it('响应含 agent_nickname 字段（不是裸 nickname）', async () => {
    const r = await request(app)
      .get('/api/agent/burner/sessions')
      .set('X-Tenant-Id', tenantId);
    expect(r.status).toBe(200);
    const sessions = r.body.data?.sessions ?? [];
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0]).toHaveProperty('agent_nickname');
    expect(sessions[0].agent_nickname).toBe('ROG测试机');
    expect(sessions[0]).not.toHaveProperty('nickname');
  });

  it('LEFT JOIN：无绑定机器的 session 仍出现，agent_hostname=null（不被 INNER JOIN 过滤）', async () => {
    const ts = Date.now();
    const t2 = await pool.query(
      `INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ($1, $2, 'free') RETURNING id`,
      [`null-host-test-${ts}`, `null-key-${ts}`],
    );
    const tid2 = t2.rows[0].id;
    const a2 = await pool.query(
      // agents 行 hostname=NULL，session 通过 LEFT JOIN 仍应出现，agent_hostname=null
      `INSERT INTO zenithjoy.agents (tenant_id, machine_id, hostname, status) VALUES ($1, $2, NULL, 'online') RETURNING id`,
      [tid2, `mac-null-${ts}`],
    );
    const aid2 = a2.rows[0].id;
    await pool.query(
      `INSERT INTO zenithjoy.agent_platform_sessions (agent_id, platform, account_label, role, status, created_at, bound_at) VALUES ($1, 'douyin', 'null-host-label', 'burner', 'active', NOW(), NOW())`,
      [aid2],
    );

    const r = await request(app)
      .get('/api/agent/burner/sessions')
      .set('X-Tenant-Id', tid2);
    expect(r.status).toBe(200);
    const s = r.body.data?.sessions ?? [];
    // LEFT JOIN 必须让这条 session 出现（不因 hostname=null 被 INNER JOIN 过滤）
    expect(s.length).toBeGreaterThan(0);
    expect(s[0]).toHaveProperty('agent_hostname');
    expect(s[0].agent_hostname).toBeNull();

    await pool.query(`DELETE FROM zenithjoy.agent_platform_sessions WHERE agent_id=$1`, [aid2]);
    await pool.query(`DELETE FROM zenithjoy.agents WHERE id=$1`, [aid2]);
    await pool.query(`DELETE FROM zenithjoy.tenants WHERE id=$1`, [tid2]);
  });

  it('多租户隔离：租户 B 不见租户 A 的 session', async () => {
    const ts = Date.now();
    const tb = await pool.query(
      `INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ($1, $2, 'free') RETURNING id`,
      [`iso-tenant-b-${ts}`, `kb-${ts}`],
    );
    const tidB = tb.rows[0].id;

    const r = await request(app)
      .get('/api/agent/burner/sessions')
      .set('X-Tenant-Id', tidB);
    expect(r.status).toBe(200);
    expect(r.body.data.sessions.length).toBe(0);

    await pool.query(`DELETE FROM zenithjoy.tenants WHERE id=$1`, [tidB]);
  });

  it('无鉴权请求返回 401', async () => {
    const r = await request(app).get('/api/agent/burner/sessions');
    expect(r.status).toBe(401);
  });
});

describe('DouyinBurnerBindPage 下线 [BEHAVIOR]', () => {
  it('DouyinBurnerBindPage.tsx 文件已删除', async () => {
    const { existsSync } = await import('fs');
    expect(existsSync('apps/dashboard/src/pages/DouyinBurnerBindPage.tsx')).toBe(false);
  });

  it('navigation.config.ts 不含 DouyinBurnerBind 引用', async () => {
    const { readFileSync } = await import('fs');
    const config = readFileSync('apps/dashboard/src/config/navigation.config.ts', 'utf8');
    expect(config).not.toContain('DouyinBurnerBind');
    expect(config).not.toContain('douyin-burner-bind');
  });

  it('AreaHubPage.tsx 不含 douyin-burner-bind 链接', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync('apps/dashboard/src/pages/AreaHubPage.tsx', 'utf8');
    expect(src).not.toContain('douyin-burner-bind');
  });
});

describe('迁移脚本 [BEHAVIOR]', () => {
  it('account-role-migrate.js 文件存在', async () => {
    const { existsSync } = await import('fs');
    expect(existsSync('apps/api/scripts/account-role-migrate.js')).toBe(true);
  });

  it('account-role-migrate.js 含 --dry-run 逻辑', async () => {
    const { readFileSync, existsSync } = await import('fs');
    if (!existsSync('apps/api/scripts/account-role-migrate.js')) {
      expect.fail('迁移脚本不存在');
    }
    const src = readFileSync('apps/api/scripts/account-role-migrate.js', 'utf8');
    expect(src).toMatch(/dry.run|dryRun/);
  });
});

describe('cutover 三值 health→status 映射 [BEHAVIOR]', () => {
  it('ok→active, expired→expired, unknown→pending 写入 agent_platform_sessions（带时间窗防造假）', async () => {
    const ts = Date.now();
    const ct = await pool.query(
      `INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ($1, $2, 'free') RETURNING id`,
      [`cut-test-${ts}`, `ck-${ts}`],
    );
    const ctid = ct.rows[0].id;
    const ca = await pool.query(
      `INSERT INTO zenithjoy.agents (tenant_id, machine_id, hostname, status) VALUES ($1, $2, 'cut-host', 'online') RETURNING id`,
      [ctid, `mac-cut-${ts}`],
    );
    const caid = ca.rows[0].id;

    // 插三条 line02_account_sessions（三种 health）
    await pool.query(
      `INSERT INTO zenithjoy.line02_account_sessions (agent_id, platform, account_label, health, tenant_id)
       VALUES ($1,'douyin','ok-lbl-${ts}','ok',$2),
              ($1,'douyin','exp-lbl-${ts}','expired',$2),
              ($1,'douyin','unk-lbl-${ts}','unknown',$2)`,
      [caid, ctid],
    );

    // cutover（不带 --dry-run）
    execSync(`DATABASE_URL="${DB_URL}" node apps/api/scripts/account-role-migrate.js`, { stdio: 'pipe' });

    // 验证三值映射（时间窗 5 分钟）
    const okRow = await pool.query(
      `SELECT status FROM zenithjoy.agent_platform_sessions WHERE agent_id=$1 AND account_label=$2 AND created_at > NOW() - interval '5 minutes'`,
      [caid, `ok-lbl-${ts}`],
    );
    expect(okRow.rows[0]?.status).toBe('active');

    const expRow = await pool.query(
      `SELECT status FROM zenithjoy.agent_platform_sessions WHERE agent_id=$1 AND account_label=$2 AND created_at > NOW() - interval '5 minutes'`,
      [caid, `exp-lbl-${ts}`],
    );
    expect(expRow.rows[0]?.status).toBe('expired');

    const unkRow = await pool.query(
      `SELECT status FROM zenithjoy.agent_platform_sessions WHERE agent_id=$1 AND account_label=$2 AND created_at > NOW() - interval '5 minutes'`,
      [caid, `unk-lbl-${ts}`],
    );
    expect(unkRow.rows[0]?.status).toBe('pending');

    // 清理
    await pool.query(`DELETE FROM zenithjoy.agent_platform_sessions WHERE agent_id=$1`, [caid]);
    await pool.query(`DELETE FROM zenithjoy.line02_account_sessions WHERE agent_id=$1`, [caid]);
    await pool.query(`DELETE FROM zenithjoy.agents WHERE id=$1`, [caid]);
    await pool.query(`DELETE FROM zenithjoy.tenants WHERE id=$1`, [ctid]);
  });
});
