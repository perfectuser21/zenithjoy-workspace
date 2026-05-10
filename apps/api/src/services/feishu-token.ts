/**
 * Path 2 Sprint A WS2: 多租户飞书 OAuth + token 自动续期
 *
 * 与单租户 feishu-bitable.ts 隔离 — 这里所有 app_id / app_secret 从 tenants 表读，
 * 不读全局环境变量里的 FEISHU 应用 ID（多租户每个客户自己的 app）。
 *
 * 端点：
 *  - getAuthorizeUrl(tenantId, appId) — 生成 authorize URL，state 用 HMAC 签 tenant_id
 *  - handleCallback(code, state) — 校 state、用 tenants.app_id/secret 换 tenant_access_token、UPSERT bindings
 *  - getValidToken(tenantId) — 若 expires_at < NOW + 5min 自动用 app_id/secret 重换；否则直接返
 */
import axios from 'axios';
import crypto from 'crypto';
import pool from '../db/connection';

const FEISHU_BASE = process.env.FEISHU_API_BASE || 'https://open.feishu.cn';
const FEISHU_AUTHORIZE_BASE = 'https://open.feishu.cn/open-apis/authen/v1/authorize';
const STATE_SECRET =
  process.env.FEISHU_STATE_SECRET || 'path2-feishu-state-default-please-override-in-prod';
const REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // 5min — 与合同 Step 3 阈值一致
const DEFAULT_EXPIRES_SEC = 7200;

export class TokenRefreshError extends Error {
  code = 'TOKEN_REFRESH_FAILED';
  constructor(msg: string) {
    super(msg);
    this.name = 'TokenRefreshError';
  }
}

function signState(tenantId: string): string {
  // 8h 时间窗口防长期重放；HMAC SHA256 hex
  const ts = Date.now();
  const payload = `${tenantId}.${ts}`;
  const sig = crypto.createHmac('sha256', STATE_SECRET).update(payload).digest('hex');
  // base64url 编码避免 URL 转义
  return Buffer.from(`${payload}.${sig}`).toString('base64url');
}

function verifyState(state: string): { tenantId: string; ts: number } {
  let decoded: string;
  try {
    decoded = Buffer.from(state, 'base64url').toString('utf8');
  } catch {
    throw new Error('INVALID_STATE: state base64 解码失败');
  }
  const parts = decoded.split('.');
  if (parts.length !== 3) {
    throw new Error('INVALID_STATE: state 段数错误');
  }
  const [tenantId, tsStr, sig] = parts;
  const expected = crypto
    .createHmac('sha256', STATE_SECRET)
    .update(`${tenantId}.${tsStr}`)
    .digest('hex');
  if (sig !== expected) {
    throw new Error('INVALID_STATE: HMAC 签名不匹配');
  }
  const ts = parseInt(tsStr, 10);
  if (Number.isNaN(ts) || Date.now() - ts > 8 * 3600 * 1000) {
    throw new Error('INVALID_STATE: state 过期或时间戳错误');
  }
  return { tenantId, ts };
}

export async function getAuthorizeUrl(tenantId: string, appId: string): Promise<string> {
  const state = signState(tenantId);
  // 三层 fallback：
  //   1. FEISHU_REDIRECT_URI — 完整 URL，直接用（生产显式配公网）
  //   2. ${DASHBOARD_BASE_URL}/api/feishu/oauth/callback — 生产 dashboard 与 api 同域 nginx 反代场景
  //   3. http://localhost:5200/api/feishu/oauth/callback — dev 默认
  // 历史上还有 PUBLIC_API_BASE 路径，但已被 DASHBOARD_BASE_URL 取代（callback 跳回 dashboard，同域）
  const redirectUri =
    process.env.FEISHU_REDIRECT_URI ||
    (process.env.DASHBOARD_BASE_URL
      ? `${process.env.DASHBOARD_BASE_URL}/api/feishu/oauth/callback`
      : 'http://localhost:5200/api/feishu/oauth/callback');
  const u = new URL(FEISHU_AUTHORIZE_BASE);
  u.searchParams.set('app_id', appId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('state', state);
  return u.toString();
}

interface TenantsRow {
  feishu_app_id: string | null;
  feishu_app_secret: string | null;
}

async function loadTenantApp(tenantId: string): Promise<TenantsRow> {
  const r = await pool.query(
    `SELECT feishu_app_id, feishu_app_secret FROM zenithjoy.tenants WHERE id = $1`,
    [tenantId]
  );
  if (!r.rows || r.rows.length === 0) {
    throw new Error(`TENANT_NOT_FOUND: ${tenantId}`);
  }
  return r.rows[0];
}

interface FeishuTokenResp {
  code: number;
  msg?: string;
  tenant_access_token?: string;
  expire?: number;
}

async function fetchTenantAccessToken(
  appId: string,
  appSecret: string
): Promise<{ token: string; expiresAt: Date }> {
  const url = `${FEISHU_BASE}/open-apis/auth/v3/tenant_access_token/internal`;
  const resp = await axios.post<FeishuTokenResp>(
    url,
    { app_id: appId, app_secret: appSecret },
    { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
  );
  const data = resp.data || ({} as FeishuTokenResp);
  if (data.code !== 0) {
    throw new Error(
      `FEISHU_TOKEN_ERROR: code=${data.code ?? 'unknown'} msg=${data.msg ?? ''}`
    );
  }
  if (!data.tenant_access_token) {
    throw new Error('FEISHU_TOKEN_EMPTY: 飞书返回空 token');
  }
  const expireSec = data.expire ?? DEFAULT_EXPIRES_SEC;
  const expiresAt = new Date(Date.now() + expireSec * 1000);
  return { token: data.tenant_access_token, expiresAt };
}

export async function handleCallback(
  code: string,
  state: string
): Promise<{ tenant_id: string }> {
  const { tenantId } = verifyState(state);
  const tenantsRow = await loadTenantApp(tenantId);
  const appId = tenantsRow.feishu_app_id;
  const appSecret = tenantsRow.feishu_app_secret;
  if (!appId || !appSecret) {
    throw new Error('FEISHU_APP_NOT_CONFIGURED: tenants 表未填 feishu_app_id/secret');
  }
  const { token, expiresAt } = await fetchTenantAccessToken(appId, appSecret);

  await pool.query(
    `INSERT INTO zenithjoy.tenant_feishu_bindings
       (tenant_id, tenant_access_token, expires_at, bound_at, last_refreshed_at)
     VALUES ($1, $2, $3, NOW(), NOW())
     ON CONFLICT (tenant_id) DO UPDATE
       SET tenant_access_token = EXCLUDED.tenant_access_token,
           expires_at          = EXCLUDED.expires_at,
           last_refreshed_at   = NOW()`,
    [tenantId, token, expiresAt]
  );

  // 静默使用 code 参数（飞书新版 OAuth 也支持只用 app_id/app_secret 走 internal token 路径）
  void code;

  return { tenant_id: tenantId };
}

export async function getValidToken(tenantId: string): Promise<string> {
  const r = await pool.query(
    `SELECT tenant_access_token, expires_at
       FROM zenithjoy.tenant_feishu_bindings
      WHERE tenant_id = $1`,
    [tenantId]
  );

  // [ARCH hotfix] 0 行时 fallback：用 tenants.feishu_app_id/secret 直接拿 token + UPSERT 初始 binding 行。
  // 旧 OAuth flow 由 handleCallback 提前 INSERT；新 /bind flow 跳过 OAuth 直接调 provisionBitable，
  // 所以 binding 行可能不存在 — 这里自动初始化。
  if (!r.rows || r.rows.length === 0) {
    const tenantsRow = await loadTenantApp(tenantId).catch((e) => {
      throw new Error(`FEISHU_NOT_BOUND: tenant ${tenantId} (load tenant fail: ${(e as Error).message})`);
    });
    const appId = tenantsRow.feishu_app_id;
    const appSecret = tenantsRow.feishu_app_secret;
    if (!appId || !appSecret) {
      throw new Error(`FEISHU_NOT_BOUND: tenant ${tenantId} 且 tenants 表未填 app_id/secret`);
    }
    let fresh: { token: string; expiresAt: Date };
    try {
      fresh = await fetchTenantAccessToken(appId, appSecret);
    } catch (e) {
      throw new TokenRefreshError((e as Error).message);
    }
    await pool.query(
      `INSERT INTO zenithjoy.tenant_feishu_bindings
         (tenant_id, tenant_access_token, expires_at, bound_at, last_refreshed_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (tenant_id) DO UPDATE
         SET tenant_access_token = EXCLUDED.tenant_access_token,
             expires_at          = EXCLUDED.expires_at,
             last_refreshed_at   = NOW()`,
      [tenantId, fresh.token, fresh.expiresAt]
    );
    return fresh.token;
  }

  const row = r.rows[0];
  const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
  const stillValid =
    expiresAt && expiresAt.getTime() - Date.now() > REFRESH_THRESHOLD_MS && !!row.tenant_access_token;
  if (stillValid) {
    return row.tenant_access_token;
  }

  // 需要刷新
  const tenantsRow = await loadTenantApp(tenantId).catch((e) => {
    throw new TokenRefreshError(`load tenant app failed: ${(e as Error).message}`);
  });
  const appId = tenantsRow.feishu_app_id;
  const appSecret = tenantsRow.feishu_app_secret;
  if (!appId || !appSecret) {
    throw new TokenRefreshError('FEISHU_APP_NOT_CONFIGURED');
  }

  let fresh: { token: string; expiresAt: Date };
  try {
    fresh = await fetchTenantAccessToken(appId, appSecret);
  } catch (e) {
    throw new TokenRefreshError((e as Error).message);
  }

  await pool.query(
    `UPDATE zenithjoy.tenant_feishu_bindings
        SET tenant_access_token = $2,
            expires_at          = $3,
            last_refreshed_at   = NOW()
      WHERE tenant_id = $1`,
    [tenantId, fresh.token, fresh.expiresAt]
  );

  return fresh.token;
}
