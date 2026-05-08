/**
 * 飞书多维表格（Bitable）写入服务
 */
import axios from 'axios';

const getAppId = () => process.env.FEISHU_APP_ID || '';
const getAppSecret = () => process.env.FEISHU_APP_SECRET || '';

export const COMPETITOR_BITABLE = {
  appToken: process.env.FEISHU_COMPETITOR_APP_TOKEN || 'EK75bB3aca7YXqsXiQBch48Fnzd',
  tableId: process.env.FEISHU_COMPETITOR_TABLE_ID || 'tblUzPt9cWEi4EZH',
  url: 'https://p1bce1datcr.feishu.cn/base/EK75bB3aca7YXqsXiQBch48Fnzd',
};

async function getTenantToken(): Promise<string> {
  const resp = await axios.post<{ code: number; tenant_access_token: string }>(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    { app_id: getAppId(), app_secret: getAppSecret() }
  );
  if (resp.data.code !== 0) throw new Error(`飞书获取 Token 失败: code=${resp.data.code}`);
  return resp.data.tenant_access_token;
}

export interface AccountForFeishu {
  creatorName: string;
  douyinId: string;
  followers: number;
  bio: string;
  profileUrl: string;
  round: number;
  keyword: string;
  topic: string;
  passedSecondary: boolean;
  executedAt: string;
}

export async function pushAccountsToBitable(accounts: AccountForFeishu[]): Promise<{
  successCount: number;
  url: string;
}> {
  if (!getAppId() || !getAppSecret()) {
    throw new Error('FEISHU_APP_ID / FEISHU_APP_SECRET 未配置');
  }
  if (accounts.length === 0) return { successCount: 0, url: COMPETITOR_BITABLE.url };

  const token = await getTenantToken();
  const { appToken, tableId } = COMPETITOR_BITABLE;
  const BATCH = 100;
  let successCount = 0;

  for (let i = 0; i < accounts.length; i += BATCH) {
    const batch = accounts.slice(i, i + BATCH);
    const records = batch.map((acc) => ({
      fields: {
        '创作者名称': acc.creatorName || '—',
        '抖音号': acc.douyinId || '—',
        '粉丝数': acc.followers,
        '简介': (acc.bio || '').slice(0, 500),
        '主页链接': acc.profileUrl,
        '轮次': acc.round,
        '关键词': acc.keyword,
        'Topic': acc.topic,
        '通过二筛': acc.passedSecondary,
        '采集时间': acc.executedAt,
      },
    }));

    const resp = await axios.post<{ code: number; msg: string }>(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`,
      { records },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (resp.data.code !== 0) {
      throw new Error(`飞书写入失败: code=${resp.data.code} msg=${resp.data.msg}`);
    }
    successCount += batch.length;
  }

  return { successCount, url: COMPETITOR_BITABLE.url };
}

// ─── Path 4 Sprint 1 ws2 — 4 张 Bitable 表自动初始化 ─────────────────────────

/**
 * Path 4 Bitable 字段类型常量（飞书 OpenAPI bitable.field.type）。
 * - 1 = 多行文本（适合大多数文本字段）
 * - 5 = 日期（毫秒时间戳）
 */
const FT_TEXT = 1;
const FT_DATE = 5;

export interface Path4FieldSpec {
  name: string;
  type: number;
}

export interface Path4TableSchema {
  fields: Path4FieldSpec[];
}

export type Path4BitableSchema = Record<string, Path4TableSchema>;

/**
 * Path 4 飞书 Bitable 4 张表 schema（客户档案 / 营销画像 / 内容排期 / 互动记录）。
 * 字段总数：5 + 3 + 5 + 6 = 19。
 */
export function getPath4BitableSchema(): Path4BitableSchema {
  return {
    客户档案: {
      fields: [
        { name: '客户名', type: FT_TEXT },
        { name: '微信号', type: FT_TEXT },
        { name: '行业', type: FT_TEXT },
        { name: '备注', type: FT_TEXT },
        { name: '加入日期', type: FT_DATE },
      ],
    },
    营销画像: {
      fields: [
        { name: '行业', type: FT_TEXT },
        { name: '受众', type: FT_TEXT },
        { name: '钩子文案', type: FT_TEXT },
      ],
    },
    内容排期: {
      fields: [
        { name: '草稿 ID', type: FT_TEXT },
        { name: '生成时间', type: FT_DATE },
        { name: '文案', type: FT_TEXT },
        { name: '排期时间', type: FT_DATE },
        { name: '状态', type: FT_TEXT },
      ],
    },
    互动记录: {
      fields: [
        { name: '客户名', type: FT_TEXT },
        { name: '客户原话', type: FT_TEXT },
        { name: 'AI 草稿', type: FT_TEXT },
        { name: '生成时间', type: FT_DATE },
        { name: '状态', type: FT_TEXT },
        { name: '真发时间', type: FT_DATE },
      ],
    },
  };
}

export interface CreatePath4BitablesParams {
  appId: string;
  appToken: string;
}

export interface Path4CreatedTable {
  name: string;
  app_token: string;
  table_id: string;
}

/**
 * 在指定 Bitable App 下创建 Path 4 的 4 张表。
 *
 * 调用流程：
 *   1. POST /open-apis/auth/v3/tenant_access_token/internal → tenant_access_token
 *   2. for each table in schema:
 *        POST /open-apis/bitable/v1/apps/{appToken}/tables
 *        body: { table: { name, default_view_name: "Grid", fields: [...] } }
 *
 * @returns { tables: [{name, app_token, table_id}, ...] }
 */
export async function createPath4Bitables(
  params: CreatePath4BitablesParams,
): Promise<{ tables: Path4CreatedTable[] }> {
  // 1) 拿 tenant_access_token（兼容现有 getTenantToken 但允许传入临时 appId 用作 audit log）
  const tokenResp = await axios.post<{
    code: number;
    msg?: string;
    tenant_access_token?: string;
  }>('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    app_id: getAppId() || params.appId,
    app_secret: getAppSecret(),
  });
  if (tokenResp.data.code !== 0 || !tokenResp.data.tenant_access_token) {
    throw new Error(
      `飞书获取 Token 失败: code=${tokenResp.data.code} msg=${tokenResp.data.msg ?? ''}`,
    );
  }
  const token = tokenResp.data.tenant_access_token;

  const schema = getPath4BitableSchema();
  const tables: Path4CreatedTable[] = [];

  for (const [tableName, spec] of Object.entries(schema)) {
    const resp = await axios.post<{
      code: number;
      msg?: string;
      data?: { table_id?: string };
    }>(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${params.appToken}/tables`,
      {
        table: {
          name: tableName,
          default_view_name: 'Grid',
          fields: spec.fields.map((f) => ({ field_name: f.name, type: f.type })),
        },
      },
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (resp.data.code !== 0) {
      throw new Error(
        `飞书建表失败 (table=${tableName}): code=${resp.data.code} msg=${resp.data.msg ?? ''}`,
      );
    }
    const tableId = resp.data.data?.table_id;
    if (!tableId) {
      throw new Error(`飞书建表失败 (table=${tableName}): 缺 table_id`);
    }
    tables.push({ name: tableName, app_token: params.appToken, table_id: tableId });
  }

  return { tables };
}
