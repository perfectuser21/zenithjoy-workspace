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

export type Tier = 'basic' | 'matrix' | 'studio' | 'enterprise';
export type LicenseStatus = 'active' | 'expired' | 'revoked' | 'suspended';

export const TIER_QUOTA: Record<Tier, number> = {
  basic: 1,
  matrix: 3,
  studio: 10,
  enterprise: 30,
};

export const TIER_PREFIX: Record<Tier, string> = {
  basic: 'B',
  matrix: 'M',
  studio: 'S',
  enterprise: 'E',
};

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

const LICENSE_KEY_PATTERN = /^ZJ-[BMSE]-[A-Z2-9]{8}$/;

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
  if (!TIER_QUOTA[tier]) {
    throw new Error(`INVALID_TIER: ${tier}`);
  }
  const maxMachines = TIER_QUOTA[tier];
  const durationDays = input.duration_days ?? 365;
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

export async function revokeLicense(id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE zenithjoy.licenses
       SET status = 'revoked', revoked_at = now(), updated_at = now()
       WHERE id = $1 AND status != 'revoked'`,
    [id]
  );
  return (rowCount ?? 0) > 0;
}

// ---------- Agent 注册 ----------

export type RegisterErrorCode =
  | 'INVALID_LICENSE'
  | 'EXPIRED'
  | 'SUSPENDED'
  | 'QUOTA_EXCEEDED';

export interface RegisterSuccess {
  ok: true;
  license_id: string;
  tier: Tier;
  max_machines: number;
  registered_machine_id: string;
  ws_token: string;
}

export interface RegisterFailure {
  ok: false;
  code: RegisterErrorCode;
  message: string;
}

export type RegisterResult = RegisterSuccess | RegisterFailure;

export interface RegisterInput {
  license_key: string;
  machine_id: string;
  hostname?: string;
  agent_id?: string;
  version?: string;
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
    };
  }

  if (license.status === 'revoked' || license.status === 'expired') {
    return {
      ok: false,
      code: 'EXPIRED',
      message: `License 已 ${license.status}`,
    };
  }
  if (license.status === 'suspended') {
    return {
      ok: false,
      code: 'SUSPENDED',
      message: 'License 已暂停',
    };
  }

  if (new Date(license.expires_at).getTime() < Date.now()) {
    return {
      ok: false,
      code: 'EXPIRED',
      message: 'License 已过期',
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
    return {
      ok: true,
      license_id: license.id,
      tier: license.tier,
      max_machines: license.max_machines,
      registered_machine_id: input.machine_id,
      ws_token: signWsToken(license.id, input.machine_id),
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
    return {
      ok: false,
      code: 'QUOTA_EXCEEDED',
      message: `装机数已达上限 ${license.max_machines}（${license.tier}）`,
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

  return {
    ok: true,
    license_id: license.id,
    tier: license.tier,
    max_machines: license.max_machines,
    registered_machine_id: input.machine_id,
    ws_token: signWsToken(license.id, input.machine_id),
  };
}
