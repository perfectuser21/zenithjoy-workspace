/**
 * 飞书多维表格（Bitable）写入服务
 */
import axios from 'axios';

const FEISHU_APP_ID = process.env.FEISHU_APP_ID || '';
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || '';

export const COMPETITOR_BITABLE = {
  appToken: process.env.FEISHU_COMPETITOR_APP_TOKEN || 'EK75bB3aca7YXqsXiQBch48Fnzd',
  tableId: process.env.FEISHU_COMPETITOR_TABLE_ID || 'tblUzPt9cWEi4EZH',
  url: 'https://p1bce1datcr.feishu.cn/base/EK75bB3aca7YXqsXiQBch48Fnzd',
};

async function getTenantToken(): Promise<string> {
  const resp = await axios.post<{ code: number; tenant_access_token: string }>(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    { app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET }
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
  if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
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
