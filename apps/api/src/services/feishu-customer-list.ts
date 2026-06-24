/**
 * Line04 微信智能客服 — 飞书「客户列表」表 + 飞书→本地单向同步（S5 第一刀）
 *
 * 与 Path2 的 feishu-bitable-multitenant.ts 隔离：那个建 4 张获客表（获客画像/对标视频/Lead/审批），
 * 本服务只管 Line04 专属的「客户列表」1 张表 + 单向同步进只读镜像 zenithjoy.feishu_customer_list。
 *
 * 核心 API：
 *  - provisionCustomerListTable(tenantId) — 为租户在飞书建「客户列表」表（幂等：已建复用 binding 里
 *    的 table_id_customer_list，不重复建）。返 { app_token, table_id }。
 *  - syncCustomerList(tenantId, opts?) — 飞书→本地单向同步：拉飞书该表全部行 → upsert 进镜像表
 *    （按 feishu_record_id 幂等不翻倍）→ 飞书已删的行软删 is_deleted=true（不物理删，不误伤别的）。
 *    拉取失败（FeishuFetchError）→ 直接抛，不动本地镜像（保留上次，绝不清空）。
 *
 * 决策（PrepPRD sprints/06240002-line04-feishu-customer-list）：
 *  · 独立镜像表，不覆盖 S2 的 wechat_cs_account_config.whitelist（避免和权限白名单打架）。
 *  · 单向：只飞书→本地，本地不回写飞书。
 *
 * 飞书凭据：生产走 getValidToken(tenantId)；非生产（CI/smoke）token 取失败时用确定性 fake token，
 * 让 fake-feishu 替身链路可跑（与 multitenant 服务同款护栏）。绝不硬编码真凭据。
 */
import axios from 'axios';
import pool from '../db/connection';
import { getValidToken } from './feishu-token';

const FEISHU_BASE = process.env.FEISHU_API_BASE || 'https://open.feishu.cn';

// 飞书「客户列表」表 schema —— 3 个文本字段（PRD 锁定：客户名/微信号/备注）
const CUSTOMER_LIST_TABLE = {
  name: '客户列表',
  fields: [
    { field_name: '客户名', type: 1 },
    { field_name: '微信号', type: 1 },
    { field_name: '备注', type: 1 },
  ],
};

/** 拉取飞书数据失败（表不存在 / 网络错 / token 失效）→ 抛此错，同步逻辑据此「不清空本地」。 */
export class FeishuFetchError extends Error {
  code = 'FEISHU_FETCH_FAILED';
  constructor(msg: string) {
    super(msg);
    this.name = 'FeishuFetchError';
  }
}

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

/** 取飞书 token：生产严格 getValidToken；非生产失败时回落确定性 fake token（让替身链路可跑）。 */
async function resolveToken(tenantId: string): Promise<string> {
  try {
    return await getValidToken(tenantId);
  } catch (tokenErr) {
    if (process.env.NODE_ENV === 'production') throw tokenErr;
    return `fake_t_customerlist_${tenantId.slice(0, 8)}`;
  }
}

interface BindingRow {
  app_token: string | null;
  table_id_customer_list: string | null;
}

async function loadBinding(tenantId: string): Promise<BindingRow | null> {
  const r = await pool.query(
    `SELECT app_token, table_id_customer_list
       FROM zenithjoy.tenant_feishu_bindings
      WHERE tenant_id = $1`,
    [tenantId]
  );
  if (!r.rows || r.rows.length === 0) return null;
  return r.rows[0] as BindingRow;
}

async function createBitable(token: string, tenantId: string): Promise<string> {
  const url = `${FEISHU_BASE}/open-apis/bitable/v1/apps`;
  const resp = await axios.post(
    url,
    { name: `ZenithJoy 客户列表 ${tenantId.slice(0, 8)}`, folder_token: '' },
    { headers: authHeader(token), timeout: 10000 }
  );
  const data = resp.data || {};
  if (data.code !== 0 || !data.data?.app?.app_token) {
    throw new Error(`createBitable failed: code=${data.code} msg=${data.msg || ''}`);
  }
  return data.data.app.app_token as string;
}

async function createTable(token: string, appToken: string): Promise<string> {
  const url = `${FEISHU_BASE}/open-apis/bitable/v1/apps/${appToken}/tables`;
  const resp = await axios.post(
    url,
    { table: { name: CUSTOMER_LIST_TABLE.name, default_view_name: '默认视图', fields: CUSTOMER_LIST_TABLE.fields } },
    { headers: authHeader(token), timeout: 10000 }
  );
  const data = resp.data || {};
  if (data.code !== 0 || !data.data?.table_id) {
    throw new Error(`createTable(客户列表) failed: code=${data.code} msg=${data.msg || ''}`);
  }
  return data.data.table_id as string;
}

export interface ProvisionCustomerListResult {
  app_token: string;
  table_id: string;
  reused: boolean;
}

/**
 * 为租户在飞书建「客户列表」表（幂等）。
 * 复用 tenant_feishu_bindings：app_token 若已存在直接用；table_id_customer_list 已缓存则不重复建表。
 */
export async function provisionCustomerListTable(
  tenantId: string
): Promise<ProvisionCustomerListResult> {
  const cached = await loadBinding(tenantId);
  if (cached && cached.app_token && cached.table_id_customer_list) {
    return { app_token: cached.app_token, table_id: cached.table_id_customer_list, reused: true };
  }

  const token = await resolveToken(tenantId);

  // 复用已有 app_token；没有则建一个新 Bitable
  let appToken = cached?.app_token || '';
  if (!appToken) {
    appToken = await createBitable(token, tenantId);
  }
  const tableId = await createTable(token, appToken);

  // 写回 binding（upsert：无行则插，有行则补 app_token + table_id_customer_list）
  await pool.query(
    `INSERT INTO zenithjoy.tenant_feishu_bindings (tenant_id, app_token, table_id_customer_list, bound_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (tenant_id) DO UPDATE
       SET app_token               = COALESCE(zenithjoy.tenant_feishu_bindings.app_token, EXCLUDED.app_token),
           table_id_customer_list  = EXCLUDED.table_id_customer_list`,
    [tenantId, appToken, tableId]
  );

  return { app_token: appToken, table_id: tableId, reused: false };
}

interface FeishuCustomerRecord {
  record_id: string;
  fields: Record<string, unknown>;
}

interface FeishuListResp {
  code: number;
  msg?: string;
  data?: { items?: FeishuCustomerRecord[] };
}

/** 拉飞书「客户列表」表全部行。失败 → 抛 FeishuFetchError（让同步层据此不清空本地）。 */
async function listCustomerRecords(
  token: string,
  appToken: string,
  tableId: string,
  injectError?: string
): Promise<FeishuCustomerRecord[]> {
  // smoke/CI 注入错误：模拟飞书表被删 / 拉取失败（不污染生产路径）
  const suffix =
    injectError && process.env.NODE_ENV !== 'production' ? `?inject_error=${injectError}` : '';
  const url = `${FEISHU_BASE}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records${suffix}`;

  let resp;
  try {
    resp = await axios.get<FeishuListResp>(url, { headers: authHeader(token), timeout: 10000 });
  } catch (e) {
    throw new FeishuFetchError(`list_records HTTP error: ${(e as Error).message}`);
  }
  const data = resp.data || ({} as FeishuListResp);
  if (data.code !== 0) {
    // 91402/91403 = 表不存在；其余非 0 一律当拉取失败
    throw new FeishuFetchError(`飞书拉取失败 code=${data.code} msg=${data.msg || ''}`);
  }
  return data.data?.items || [];
}

export interface SyncCustomerListResult {
  synced: number; // 本轮 upsert 的活跃行数
  soft_deleted: number; // 本轮软删的行数
}

export interface SyncCustomerListOptions {
  /** smoke/CI：注入飞书拉取错误（R3_NOT_FOUND 等）。生产忽略。 */
  injectError?: string;
  /** smoke/CI：直接用这批 record 覆盖飞书返回（模拟"飞书侧删了某行"）。生产忽略。 */
  mockRecords?: FeishuCustomerRecord[];
}

/**
 * 飞书→本地单向同步：拉飞书「客户列表」→ upsert 进 zenithjoy.feishu_customer_list。
 *
 * 幂等：按 (tenant_id, feishu_record_id) upsert，重复同步不翻倍。
 * 软删：本地有但本轮飞书没返的行 → is_deleted=true（不物理删，不误伤）。
 * 失败保护：拉取失败（FeishuFetchError）直接抛，绝不动本地镜像（保留上次，不清空）。
 */
export async function syncCustomerList(
  tenantId: string,
  opts: SyncCustomerListOptions = {}
): Promise<SyncCustomerListResult> {
  const binding = await loadBinding(tenantId);
  if (!binding || !binding.app_token || !binding.table_id_customer_list) {
    throw new Error('CUSTOMER_LIST_NOT_PROVISIONED');
  }

  // 先拉飞书（拉取失败在这里抛，下面的 DB 写一行都不会执行 → 本地镜像原样保留）
  let records: FeishuCustomerRecord[];
  if (opts.mockRecords && process.env.NODE_ENV !== 'production') {
    records = opts.mockRecords;
  } else {
    const token = await resolveToken(tenantId);
    records = await listCustomerRecords(
      token,
      binding.app_token,
      binding.table_id_customer_list,
      opts.injectError
    );
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const seenRecordIds: string[] = [];
    for (const rec of records) {
      const recordId = rec.record_id;
      if (!recordId) continue;
      seenRecordIds.push(recordId);
      const f = rec.fields || {};
      await client.query(
        `INSERT INTO zenithjoy.feishu_customer_list
           (tenant_id, feishu_record_id, customer_name, customer_wechat, note, is_deleted, synced_at)
         VALUES ($1, $2, $3, $4, $5, false, NOW())
         ON CONFLICT (tenant_id, feishu_record_id) DO UPDATE
           SET customer_name   = EXCLUDED.customer_name,
               customer_wechat = EXCLUDED.customer_wechat,
               note            = EXCLUDED.note,
               is_deleted      = false,
               synced_at       = NOW()`,
        [
          tenantId,
          recordId,
          String((f as Record<string, unknown>)['客户名'] ?? ''),
          String((f as Record<string, unknown>)['微信号'] ?? ''),
          ((f as Record<string, unknown>)['备注'] ?? null) as string | null,
        ]
      );
    }

    // 软删：本地活跃行里、本轮飞书没返的 → is_deleted=true（只动本租户，不误伤别的租户）
    let softDeleted = 0;
    if (seenRecordIds.length > 0) {
      const del = await client.query(
        `UPDATE zenithjoy.feishu_customer_list
            SET is_deleted = true, synced_at = NOW()
          WHERE tenant_id = $1
            AND is_deleted = false
            AND feishu_record_id <> ALL($2::text[])`,
        [tenantId, seenRecordIds]
      );
      softDeleted = del.rowCount || 0;
    } else {
      // 飞书返 0 条：本刀保守不全软删（避免飞书空表/异常误判清空），仅记录无新增。
      // 真清空走二期"显式确认删除"，本刀 YAGNI。
      softDeleted = 0;
    }

    await client.query('COMMIT');
    return { synced: seenRecordIds.length, soft_deleted: softDeleted };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
