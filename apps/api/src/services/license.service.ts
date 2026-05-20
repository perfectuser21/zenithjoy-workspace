/**
 * License 业务服务 — v1.2 Day 1-2
 *
 * 职责：
 *  - 生成 license key（ZJ-{tierPrefix}-{random}，crypto.randomBytes 防猜）
 *  - 创建 / 列出 / 吊销 license（admin 用）
 *  - Agent 注册：校验 key + 检查 expired + 检查 quota，签发 ws_token
 *
 * ws_token = HMAC-SHA256(LICENSE_HMAC_SECRET, license_id + ':' + machine_id)
 *   - Agent 拿这个 token 连 wss
 *   - 服务端在 ws upgrade 时验证（v1.2 Day 3-4 接，本 PR 只签发不验证 — 向后兼容旧 v1.1 Agent）
 */

import crypto from 'node:crypto';
import pool from '../db/connection';

export type Tier = 'free' | 'basic' | 'matrix' | 'studio' | 'enterprise';
export type LicenseStatus = 'active' | 'expired' | 'revoked' | 'suspended';

/**
 * 装机配额（max_machines）
 *  - free：1（注册即试用 walking skeleton；medium 阶段再 review 商业模式）
 *  - basic：1 / matrix：3 / studio：10 / enterprise：30（付费）
 *
 * 2026-05-07 主理人决策：把 free 从 0 改为 1。之前 0 → Agent heartbeat
 * 必撞 QUOTA_EXCEEDED → walking skeleton 客户视角第一刀就断在装机这步。
 */
export const TIER_QUOTA: Record<Tier, number> = {
  free: 1,
  basic: 1,
  matrix: 3,
  studio: 10,
  enterprise: 30,
};

export const TIER_PREFIX: Record<Tier, string> = {
  free: 'F',
  basic: 'B',
  matrix: 'M',
  studio: 'S',
  enterprise: 'E',
};

/** Free tier license 默认有效期（10 年），注册时不让用户感受到过期 */
export const FREE_TIER_DURATION_DAYS = 365 * 10;

export interface LicenseRow {
  id: string;
  license_key: string;
  tier: Tier;
  max_machines: number;
  customer_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  status: LicenseStatus;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface LicenseMachineRow {
  id: string;
  license_id: string;
  machine_id: string;
  agent_id: string | null;
  hostname: string | null;
  first_seen: string;
  last_seen: string;
  status: string;
}

// ---------- License key 生成 ----------

/**
 * 生成 license key：ZJ-{prefix}-{8 chars random base32-ish}
 * 例：ZJ-B-A1B2C3D4 (basic) / ZJ-M-E5F6G7H8 (matrix)
 *
 * 32^8 ≈ 1.1 万亿，crypto.randomBytes 不可预测 → 不可猜。
 */
export function generateLicenseKey(tier: Tier): string {
  const prefix = TIER_PREFIX[tier];
  const bytes = crypto.randomBytes(8);
  // base32 字母表：去掉 I O 0 1 等易混淆字符
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 8; i++) {
    suffix += ALPHA[bytes[i] % ALPHA.length];
  }
  return `ZJ-${prefix}-${suffix}`;
}

// Sprint 2.1f Fix 3 — 兼容历史 hex license（含 0/1）
const LICENSE_KEY_PATTERN = /^ZJ-[FBMSE]-[A-Z0-9]{8}$/;

export function isValidLicenseKeyFormat(key: string): boolean {
  return typeof key === 'string' && LICENSE_KEY_PATTERN.test(key);
}

// ---------- ws_token 签发（HMAC，无状态可校验） ----------

function getHmacSecret(): string {
  const secret = process.env.LICENSE_HMAC_SECRET;
  if (secret && secret.length >= 16) return secret;
  // dev 兜底：固定 dev secret，生产必须设环境变量
  if (process.env.NODE_ENV !== 'production') {
    return 'dev-only-license-hmac-secret-change-me';
  }
  throw new Error(
    'LICENSE_HMAC_SECRET 必须在生产环境设置（≥ 16 字符）'
  );
}

export function signWsToken(licenseId: string, machineId: string): string {
  const secret = getHmacSecret();
  const data = `${licenseId}:${machineId}`;
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

export function verifyWsToken(
  licenseId: string,
  machineId: string,
  token: string
): boolean {
  if (!token || typeof token !== 'string') return false;
  const expected = signWsToken(licenseId, machineId);
  // 常量时间比较，防 timing attack
  if (expected.length !== token.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(token, 'hex')
    );
  } catch {
    return false;
  }
}

// ---------- DB CRUD ----------

export interface CreateLicenseInput {
  tier: Tier;
  customer_name?: string;
  customer_email?: string;
  customer_id?: string;
  notes?: string;
  duration_days?: number; // 默认 365
}

export async function createLicense(
  input: CreateLicenseInput
): Promise<LicenseRow> {
  const tier = input.tier;
  if (!(tier in TIER_QUOTA)) {
    throw new Error(`INVALID_TIER: ${tier}`);
  }
  const maxMachines = TIER_QUOTA[tier];
  // free tier 默认 10 年，付费默认 1 年；外部 input 优先
  const defaultDays = tier === 'free' ? FREE_TIER_DURATION_DAYS : 365;
  const durationDays = input.duration_days ?? defaultDays;
  const expiresAt = new Date(Date.now() + durationDays * 86400_000);

  // 防极小概率冲突：最多重试 5 次
  for (let attempt = 0; attempt < 5; attempt++) {
    const licenseKey = generateLicenseKey(tier);
    try {
      const { rows } = await pool.query<LicenseRow>(
        `INSERT INTO zenithjoy.licenses
           (license_key, tier, max_machines, customer_id, customer_name,
            customer_email, expires_at, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          licenseKey,
          tier,
          maxMachines,
          input.customer_id ?? null,
          input.customer_name ?? null,
          input.customer_email ?? null,
          expiresAt.toISOString(),
          input.notes ?? null,
        ]
      );
      return rows[0];
    } catch (err: unknown) {
      // unique_violation = 23505
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === '23505'
      ) {
        continue;
      }
      throw err;
    }
  }
  throw new Error('LICENSE_KEY_COLLISION: 无法生成唯一 license key');
}

export async function listLicenses(): Promise<LicenseRow[]> {
  const { rows } = await pool.query<LicenseRow>(
    `SELECT * FROM zenithjoy.licenses ORDER BY created_at DESC LIMIT 500`
  );
  return rows;
}

export async function findLicenseByKey(
  key: string
): Promise<LicenseRow | null> {
  const { rows } = await pool.query<LicenseRow>(
    `SELECT * FROM zenithjoy.licenses WHERE license_key = $1 LIMIT 1`,
    [key]
  );
  return rows[0] ?? null;
}

export async function revokeLicense(id: string): Promise<LicenseRow | null> {
  const { rows } = await pool.query<LicenseRow>(
    `UPDATE zenithjoy.licenses
       SET status = 'revoked', revoked_at = now(), updated_at = now()
       WHERE id = $1 AND status != 'revoked'
       RETURNING *`,
    [id]
  );
  return rows[0] ?? null;
}

/**
 * 按客户飞书 open_id 查询其 license 与已激活机器列表
 * 返回 license=null 表示该客户尚无 license
 */
export async function getLicenseByCustomerId(
  customerId: string
): Promise<{ license: LicenseRow | null; machines: LicenseMachineRow[] }> {
  const licRes = await pool.query<LicenseRow>(
    `SELECT * FROM zenithjoy.licenses
       WHERE customer_id = $1
       ORDER BY status = 'active' DESC, created_at DESC
       LIMIT 1`,
    [customerId]
  );
  const license = licRes.rows[0] ?? null;
  if (!license) {
    return { license: null, machines: [] };
  }
  const macRes = await pool.query<LicenseMachineRow>(
    `SELECT * FROM zenithjoy.license_machines
       WHERE license_id = $1
       ORDER BY last_seen DESC`,
    [license.id]
  );
  return { license, machines: macRes.rows };
}

// ---------- Agent 注册 ----------

export type RegisterErrorCode =
  | 'INVALID_LICENSE'
  | 'EXPIRED'
  | 'SUSPENDED'
  | 'QUOTA_EXCEEDED';

/**
 * RegisterSuccess — 双 schema (H-1):
 * - 老字段 (rog v1.0 Agent 仍依赖): ok / license_id / tier / max_machines / registered_machine_id / ws_token
 * - 新字段 (H-1 加, 自验脚本验): success / agent_id (UUID) / license_tier / device_count / device_limit
 *
 * 改写 PRD line 77 "顶层 keys 完全等于" 为 "包含" 子集校验，向后兼容 rog v1.0 Agent
 */
export interface RegisterSuccess {
  // 老字段 (backwards compat)
  ok: true;
  license_id: string;
  tier: Tier;
  max_machines: number;
  registered_machine_id: string;
  ws_token: string;
  // 新字段 (H-1)
  success: true;
  agent_id: string;          // UUID = agents.id
  license_tier: Tier;
  device_count: number;      // INSERT 后的 active count (含本次)
  device_limit: number;
}

/**
 * RegisterFailure — 双 schema (H-1):
 * - 老字段: ok / code / message
 * - 新字段: success / error / current_count / limit
 */
export interface RegisterFailure {
  // 老字段
  ok: false;
  code: RegisterErrorCode;
  message: string;
  // 新字段 (H-1, 仅 QUOTA_EXCEEDED 返完整 current_count/limit)
  success: false;
  error: 'INVALID_LICENSE' | 'EXPIRED' | 'SUSPENDED' | 'LICENSE_DEVICE_LIMIT_EXCEEDED';
  current_count?: number;    // 仅 LICENSE_DEVICE_LIMIT_EXCEEDED 时填
  limit?: number;
}

export type RegisterResult = RegisterSuccess | RegisterFailure;

export interface RegisterInput {
  license_key: string;
  machine_id: string;
  hostname?: string;
  agent_id?: string;
  version?: string;
}

/**
 * H-1 helper：upsert agents 行返 UUID（agents.id）
 *
 * 用 ON CONFLICT (agent_id) DO UPDATE 一句搞定避免竞态。
 * agent_id 列是 hostname-derived display name，本 register 用 input.machine_id 作 fallback。
 *
 * H-2 Bug 9 layer 3: 必须填 license_id + hostname 列 — heartbeat path
 * (walking-skeleton.service heartbeatUpsert) 用 `WHERE license_id=$1 AND hostname=$2`
 * 找现有 row。若 license register 留空 → heartbeat 找不到 → 走"创新 ws1-XXX row"path
 * → 第二个 agent row 出现 → agentContext middleware 派 task 到错的 row → chrome 没弹。
 */
async function upsertAgentRowGetUuid(input: RegisterInput, licenseId: string): Promise<string> {
  // 直接从 licenses.tenant_id 取（比 tenants.license_key 反查更可靠）
  const tenantRes = await pool.query<{ tenant_id: string }>(
    `SELECT tenant_id FROM zenithjoy.licenses WHERE id = $1`,
    [licenseId]
  );
  const tenantId = tenantRes.rows[0]?.tenant_id;
  if (!tenantId) {
    throw new Error('LICENSE_NO_TENANT: license 没有关联的 tenant，无法注册 agent');
  }
  const displayName = input.agent_id || input.hostname || `m-${input.machine_id.slice(0, 16)}`;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO zenithjoy.agents (tenant_id, agent_id, license_id, hostname, capabilities, version, status, last_seen)
     VALUES ($1, $2, $3, $4, $5, $6, 'online', now())
     ON CONFLICT (agent_id) DO UPDATE
       SET tenant_id = COALESCE(EXCLUDED.tenant_id, zenithjoy.agents.tenant_id),
           license_id = COALESCE(EXCLUDED.license_id, zenithjoy.agents.license_id),
           hostname = COALESCE(EXCLUDED.hostname, zenithjoy.agents.hostname),
           capabilities = EXCLUDED.capabilities,
           version = EXCLUDED.version,
           status = 'online',
           last_seen = now(),
           updated_at = now()
     RETURNING id`,
    [tenantId ?? null, displayName, licenseId, input.hostname ?? null, [], input.version ?? '0.1.0']
  );
  return r.rows[0]?.id ?? '00000000-0000-0000-0000-000000000000';
}

export async function registerAgent(
  input: RegisterInput
): Promise<RegisterResult> {
  const license = await findLicenseByKey(input.license_key);
  if (!license) {
    return {
      ok: false,
      code: 'INVALID_LICENSE',
      message: 'License key 不存在',
      success: false,
      error: 'INVALID_LICENSE',
    };
  }

  if (license.status === 'revoked' || license.status === 'expired') {
    return {
      ok: false,
      code: 'EXPIRED',
      message: `License 已 ${license.status}`,
      success: false,
      error: 'EXPIRED',
    };
  }
  if (license.status === 'suspended') {
    return {
      ok: false,
      code: 'SUSPENDED',
      message: 'License 已暂停',
      success: false,
      error: 'SUSPENDED',
    };
  }

  if (new Date(license.expires_at).getTime() < Date.now()) {
    return {
      ok: false,
      code: 'EXPIRED',
      message: 'License 已过期',
      success: false,
      error: 'EXPIRED',
    };
  }

  // 已绑定的 machine？直接续签
  const existing = await pool.query<LicenseMachineRow>(
    `SELECT * FROM zenithjoy.license_machines
       WHERE license_id = $1 AND machine_id = $2 LIMIT 1`,
    [license.id, input.machine_id]
  );

  if (existing.rows[0]) {
    await pool.query(
      `UPDATE zenithjoy.license_machines
         SET last_seen = now(),
             agent_id = COALESCE($1, agent_id),
             hostname = COALESCE($2, hostname)
         WHERE id = $3`,
      [input.agent_id ?? null, input.hostname ?? null, existing.rows[0].id]
    );
    // reconnect 时 device_count 不变（仍是 active count）
    const countRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count
         FROM zenithjoy.license_machines
         WHERE license_id = $1 AND status = 'active'`,
      [license.id]
    );
    const deviceCount = parseInt(countRes.rows[0]?.count ?? '1', 10);
    const agentUuid = await upsertAgentRowGetUuid(input, license.id);
    return {
      ok: true,
      license_id: license.id,
      tier: license.tier,
      max_machines: license.max_machines,
      registered_machine_id: input.machine_id,
      ws_token: signWsToken(license.id, input.machine_id),
      success: true,
      agent_id: agentUuid,
      license_tier: license.tier,
      device_count: deviceCount,
      device_limit: license.max_machines,
    };
  }

  // 新装机：检查配额
  const countResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::int AS count
       FROM zenithjoy.license_machines
       WHERE license_id = $1 AND status = 'active'`,
    [license.id]
  );
  const currentCount = parseInt(countResult.rows[0]?.count ?? '0', 10);

  if (currentCount >= license.max_machines) {
    // current_count = 不含本次（拒绝时未实际 INSERT）
    return {
      ok: false,
      code: 'QUOTA_EXCEEDED',
      message: `装机数已达上限 ${license.max_machines}（${license.tier}）`,
      success: false,
      error: 'LICENSE_DEVICE_LIMIT_EXCEEDED',
      current_count: currentCount,
      limit: license.max_machines,
    };
  }

  await pool.query(
    `INSERT INTO zenithjoy.license_machines
       (license_id, machine_id, agent_id, hostname)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (license_id, machine_id) DO NOTHING`,
    [
      license.id,
      input.machine_id,
      input.agent_id ?? null,
      input.hostname ?? null,
    ]
  );

  // 新装机后 device_count = INSERT 前 + 1（含本次）
  const newDeviceCount = currentCount + 1;
  const agentUuid = await upsertAgentRowGetUuid(input, license.id);
  return {
    ok: true,
    license_id: license.id,
    tier: license.tier,
    max_machines: license.max_machines,
    registered_machine_id: input.machine_id,
    ws_token: signWsToken(license.id, input.machine_id),
    success: true,
    agent_id: agentUuid,
    license_tier: license.tier,
    device_count: newDeviceCount,
    device_limit: license.max_machines,
  };
}
