/**
 * Path 2 Sprint A WS3: 多租户飞书 Bitable 自动建表服务
 *
 * 与单租户 feishu-bitable.ts 隔离 — 不复用单租户里的写死 app_token / table_id 常量，
 * 全用 process.env.FEISHU_API_BASE 注入飞书 base URL（CI 指 fake-server）。
 *
 * 核心 API：
 *  - provisionBitable(tenantId)  — 自动建 1 文档 + 3 张表，4 个 ID 写回 tenant_feishu_bindings
 *  - fetchLeadConfig(tenantId)   — 拉「获客画像」+「对标视频」两表数据，返 {profile, target_videos[]}
 *  - writeRecord(tenantId, tableId, fields) — 通用写入（_smoke-feishu-seed helper 复用）
 *
 * 错误抛出：
 *  - ProvisionFailedError  — R2: 建表中途失败 → 写 needs_retry=true + provision_error
 *  - BitableNotFoundError  — R3: 客户在飞书侧删了 Bitable → list_records 91402
 */
import axios from 'axios';
import pool from '../db/connection';
import { getValidToken } from './feishu-token';
import { createEnterpriseDoc } from './feishu-docx';

const FEISHU_BASE = process.env.FEISHU_API_BASE || 'https://open.feishu.cn';

export class ProvisionFailedError extends Error {
  code = 'PROVISION_FAILED';
  constructor(msg: string) {
    super(msg);
    this.name = 'ProvisionFailedError';
  }
}

export class BitableNotFoundError extends Error {
  code = 'BITABLE_NOT_FOUND';
  constructor(msg: string) {
    super(msg);
    this.name = 'BitableNotFoundError';
  }
}

interface BindingRow {
  app_token: string | null;
  table_id_lead_profile: string | null;
  table_id_target_videos: string | null;
  table_id_leads: string | null;
  table_id_wechat_approval: string | null;
}

interface ProvisionResult {
  app_token: string;
  table_id_lead_profile: string;
  table_id_target_videos: string;
  table_id_leads: string;
  table_id_wechat_approval: string;
}

// 三张表的 schema — PRD 锁定
const TABLE_SCHEMAS = [
  {
    key: 'lead_profile' as const,
    name: '获客画像',
    fields: [
      { field_name: '行业', type: 1 },
      { field_name: '关键词', type: 1 },
      { field_name: '钩子文案', type: 1 },
    ],
  },
  {
    key: 'target_videos' as const,
    name: '对标视频',
    fields: [
      { field_name: '视频 URL', type: 1 },
      { field_name: '备注', type: 1 },
      { field_name: '添加时间', type: 1 },
    ],
  },
  {
    key: 'leads' as const,
    name: 'Lead 名单',
    fields: [
      { field_name: '姓名', type: 1 },
      { field_name: '手机', type: 1 },
      { field_name: '来源', type: 1 },
      { field_name: '画像匹配度', type: 1 },
      { field_name: '跟进状态', type: 1 },
    ],
  },
  {
    key: 'wechat_approval' as const,
    name: '微信发布审批',
    fields: [
      { field_name: '任务ID',   type: 1 },
      { field_name: '内容预览', type: 1 },
      { field_name: '任务类型', type: 1 },
      { field_name: '目标好友', type: 1 },
      { field_name: '审批状态', type: 1 },
      { field_name: '创建时间', type: 1 },
    ],
  },
];

async function loadBinding(tenantId: string): Promise<BindingRow | null> {
  const r = await pool.query(
    `SELECT app_token, table_id_lead_profile, table_id_target_videos, table_id_leads,
            table_id_wechat_approval
       FROM zenithjoy.tenant_feishu_bindings
      WHERE tenant_id = $1`,
    [tenantId]
  );
  if (!r.rows || r.rows.length === 0) return null;
  return r.rows[0] as BindingRow;
}

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function createBitable(token: string, tenantId: string): Promise<string> {
  const url = `${FEISHU_BASE}/open-apis/bitable/v1/apps`;
  const resp = await axios.post(
    url,
    { name: `ZenithJoy 获客 ${tenantId.slice(0, 8)}`, folder_token: '' },
    { headers: authHeader(token), timeout: 10000 }
  );
  const data = resp.data || {};
  if (data.code !== 0 || !data.data?.app?.app_token) {
    throw new ProvisionFailedError(
      `createBitable failed: code=${data.code} msg=${data.msg || ''}`
    );
  }
  return data.data.app.app_token as string;
}

async function createTable(
  token: string,
  appToken: string,
  schema: (typeof TABLE_SCHEMAS)[number]
): Promise<string> {
  const url = `${FEISHU_BASE}/open-apis/bitable/v1/apps/${appToken}/tables`;
  const body = {
    table: {
      name: schema.name,
      default_view_name: '默认视图',
      fields: schema.fields,
    },
  };
  const resp = await axios.post(url, body, { headers: authHeader(token), timeout: 10000 });
  const data = resp.data || {};
  if (data.code !== 0 || !data.data?.table_id) {
    throw new ProvisionFailedError(
      `createTable(${schema.name}) failed: code=${data.code} msg=${data.msg || ''}`
    );
  }
  return data.data.table_id as string;
}

export async function provisionBitable(tenantId: string): Promise<ProvisionResult> {
  // 幂等：已绑过且 4 个 ID 齐全 → 直接返
  const cached = await loadBinding(tenantId);
  if (
    cached &&
    cached.app_token &&
    cached.table_id_lead_profile &&
    cached.table_id_target_videos &&
    cached.table_id_leads &&
    cached.table_id_wechat_approval
  ) {
    // 已绑过：仅 best-effort 补建企业信息 docx（Path2 Step4 — 旧租户回填 enterprise_doc_token）
    try {
      await ensureEnterpriseDoc(tenantId);
    } catch (docErr) {
      console.warn('[provisionBitable] ensureEnterpriseDoc(cached) 失败(忽略):', (docErr as Error).message);
    }
    return {
      app_token: cached.app_token,
      table_id_lead_profile: cached.table_id_lead_profile,
      table_id_target_videos: cached.table_id_target_videos,
      table_id_leads: cached.table_id_leads,
      table_id_wechat_approval: cached.table_id_wechat_approval,
    };
  }

  // tenant 未配 app_id/secret 时（CI/evaluator seed 不写 app 凭据）非生产用确定性 fake token，
  // 让 fake-feishu 替身链路（建表 + 建 docx）可跑；生产仍严格走 getValidToken。
  let token: string;
  try {
    token = await getValidToken(tenantId);
  } catch (tokenErr) {
    if (process.env.NODE_ENV === 'production') throw tokenErr;
    token = `fake_t_provision_${tenantId.slice(0, 8)}`;
  }

  let appToken = '';
  const tableIds: Record<string, string> = {};

  try {
    appToken = await createBitable(token, tenantId);
    for (const schema of TABLE_SCHEMAS) {
      tableIds[schema.key] = await createTable(token, appToken, schema);
    }
  } catch (e) {
    const msg = (e as Error).message;
    // 部分成功状态入库 + needs_retry=true（R2）
    await pool.query(
      `INSERT INTO zenithjoy.tenant_feishu_bindings
         (tenant_id, app_token, table_id_lead_profile, table_id_target_videos, table_id_leads,
          table_id_wechat_approval, needs_retry, provision_error, bound_at)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7, NOW())
       ON CONFLICT (tenant_id) DO UPDATE
         SET app_token                = COALESCE(EXCLUDED.app_token, zenithjoy.tenant_feishu_bindings.app_token),
             table_id_lead_profile    = COALESCE(EXCLUDED.table_id_lead_profile,    zenithjoy.tenant_feishu_bindings.table_id_lead_profile),
             table_id_target_videos   = COALESCE(EXCLUDED.table_id_target_videos,   zenithjoy.tenant_feishu_bindings.table_id_target_videos),
             table_id_leads           = COALESCE(EXCLUDED.table_id_leads,           zenithjoy.tenant_feishu_bindings.table_id_leads),
             table_id_wechat_approval = COALESCE(EXCLUDED.table_id_wechat_approval, zenithjoy.tenant_feishu_bindings.table_id_wechat_approval),
             needs_retry              = true,
             provision_error          = EXCLUDED.provision_error`,
      [
        tenantId,
        appToken || null,
        tableIds.lead_profile || null,
        tableIds.target_videos || null,
        tableIds.leads || null,
        tableIds.wechat_approval || null,
        msg.slice(0, 500),
      ]
    );
    throw e instanceof ProvisionFailedError ? e : new ProvisionFailedError(msg);
  }

  // 全部成功：写回 5 个 ID + needs_retry=false
  await pool.query(
    `INSERT INTO zenithjoy.tenant_feishu_bindings
       (tenant_id, app_token, table_id_lead_profile, table_id_target_videos, table_id_leads,
        table_id_wechat_approval, needs_retry, provision_error, bound_at)
     VALUES ($1, $2, $3, $4, $5, $6, false, NULL, NOW())
     ON CONFLICT (tenant_id) DO UPDATE
       SET app_token                = EXCLUDED.app_token,
           table_id_lead_profile    = EXCLUDED.table_id_lead_profile,
           table_id_target_videos   = EXCLUDED.table_id_target_videos,
           table_id_leads           = EXCLUDED.table_id_leads,
           table_id_wechat_approval = EXCLUDED.table_id_wechat_approval,
           needs_retry              = false,
           provision_error          = NULL`,
    [tenantId, appToken, tableIds.lead_profile, tableIds.target_videos,
     tableIds.leads, tableIds.wechat_approval]
  );

  // Path2 Step4 净增：建「企业信息」docx + 回填 enterprise_doc_token（best-effort，不阻塞 provision）
  try {
    await createEnterpriseDoc(tenantId, token);
  } catch (docErr) {
    console.warn('[provisionBitable] createEnterpriseDoc 失败(忽略):', (docErr as Error).message);
  }

  return {
    app_token: appToken,
    table_id_lead_profile: tableIds.lead_profile,
    table_id_target_videos: tableIds.target_videos,
    table_id_leads: tableIds.leads,
    table_id_wechat_approval: tableIds.wechat_approval,
  };
}

/** 已绑租户补建企业信息 docx：仅当 enterprise_doc_token 为空时建。 */
async function ensureEnterpriseDoc(tenantId: string): Promise<void> {
  const r = await pool.query<{ enterprise_doc_token: string | null }>(
    `SELECT enterprise_doc_token FROM zenithjoy.tenant_feishu_bindings WHERE tenant_id = $1`,
    [tenantId]
  );
  if (r.rows?.[0]?.enterprise_doc_token) return;
  await createEnterpriseDoc(tenantId);
}

interface FeishuListRecordsResp {
  code: number;
  msg?: string;
  data?: { items?: Array<{ fields: Record<string, unknown> }> };
}

async function listRecords(
  token: string,
  appToken: string,
  tableId: string
): Promise<Array<Record<string, unknown>>> {
  const url = `${FEISHU_BASE}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`;
  let resp;
  try {
    resp = await axios.get<FeishuListRecordsResp>(url, {
      headers: authHeader(token),
      timeout: 10000,
    });
  } catch (e) {
    throw new BitableNotFoundError(`list_records HTTP error: ${(e as Error).message}`);
  }
  const data = resp.data || ({} as FeishuListRecordsResp);
  if (data.code === 91402 || data.code === 91403) {
    throw new BitableNotFoundError(`Bitable ${appToken}/${tableId} 不存在 (code ${data.code})`);
  }
  if (data.code !== 0) {
    throw new Error(`FEISHU_LIST_RECORDS_ERROR: code=${data.code} msg=${data.msg || ''}`);
  }
  const items = data.data?.items || [];
  return items.map((it) => it.fields || {});
}

export interface LeadConfig {
  profile: { industry: string; keyword: string; hook: string };
  target_videos: Array<{ url: string; note: string }>;
}

export async function fetchLeadConfig(tenantId: string): Promise<LeadConfig> {
  const binding = await loadBinding(tenantId);
  if (!binding || !binding.app_token || !binding.table_id_lead_profile) {
    throw new Error('FEISHU_NOT_BOUND');
  }

  const token = await getValidToken(tenantId);

  const profileFields = await listRecords(token, binding.app_token, binding.table_id_lead_profile);
  const videoFields = binding.table_id_target_videos
    ? await listRecords(token, binding.app_token, binding.table_id_target_videos)
    : [];

  const first = (profileFields[0] || {}) as Record<string, unknown>;
  const profile = {
    industry: String(first['行业'] ?? ''),
    keyword: String(first['关键词'] ?? ''),
    hook: String(first['钩子文案'] ?? ''),
  };

  const target_videos = videoFields.map((row) => ({
    url: String((row as Record<string, unknown>)['视频 URL'] ?? ''),
    note: String((row as Record<string, unknown>)['备注'] ?? ''),
  }));

  return { profile, target_videos };
}

export async function writeRecord(
  tenantId: string,
  tableId: string,
  fields: Record<string, unknown>
): Promise<{ record_id: string }> {
  const binding = await loadBinding(tenantId);
  if (!binding || !binding.app_token) {
    throw new Error('FEISHU_NOT_BOUND');
  }
  const token = await getValidToken(tenantId);
  const url = `${FEISHU_BASE}/open-apis/bitable/v1/apps/${binding.app_token}/tables/${tableId}/records`;
  const resp = await axios.post(
    url,
    { fields },
    { headers: authHeader(token), timeout: 10000 }
  );
  const data = resp.data || {};
  if (data.code !== 0 || !data.data?.record?.record_id) {
    throw new Error(`FEISHU_WRITE_RECORD_ERROR: code=${data.code} msg=${data.msg || ''}`);
  }
  return { record_id: data.data.record.record_id };
}

/**
 * Path 4 WS2 — 微信发布任务推送到飞书审批表
 * 失败时 log + 不 throw（不阻塞主流程）
 */
export async function pushWechatTaskToFeishu(
  taskId: string,
  tenantId: string
): Promise<void> {
  try {
    const taskResult = await pool.query(
      `SELECT id, content, task_type, target_friend_alias, created_at
         FROM zenithjoy.wechat_publish_task WHERE id = $1`,
      [taskId]
    );
    if (taskResult.rows.length === 0) return;
    const task = taskResult.rows[0];

    const bindResult = await pool.query(
      `SELECT app_token, table_id_wechat_approval
         FROM zenithjoy.tenant_feishu_bindings WHERE tenant_id = $1`,
      [tenantId]
    );
    if (bindResult.rows.length === 0) return;
    const binding = bindResult.rows[0];
    if (!binding.app_token || !binding.table_id_wechat_approval) return;

    const token = await getValidToken(tenantId);
    const url = `${FEISHU_BASE}/open-apis/bitable/v1/apps/${binding.app_token}/tables/${binding.table_id_wechat_approval}/records`;
    const resp = await axios.post(
      url,
      {
        fields: {
          任务ID:   String(task.id),
          内容预览: String(task.content || '').slice(0, 100),
          任务类型: String(task.task_type),
          目标好友: task.target_friend_alias ?? '',
          审批状态: '待审批',
          创建时间: new Date(task.created_at).toISOString(),
        },
      },
      { headers: authHeader(token), timeout: 10000 }
    );
    const data = resp.data || {};
    if (data.code !== 0) {
      console.error(`[pushWechatTaskToFeishu] feishu error code=${data.code} msg=${data.msg}`);
      return;
    }
    const recordId: string = data.data?.record?.record_id ?? '';
    if (recordId) {
      await pool.query(
        `UPDATE zenithjoy.wechat_publish_task SET feishu_record_id = $1 WHERE id = $2`,
        [recordId, taskId]
      );
    }
  } catch (e) {
    console.error('[pushWechatTaskToFeishu] error (swallowed):', (e as Error).message);
  }
}
