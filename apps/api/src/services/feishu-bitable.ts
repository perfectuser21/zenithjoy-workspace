/**
 * 飞书多维表格（Bitable）写入服务
 * 用于将对标账号搜索结果推送到飞书
 */
import https from 'https';

const FEISHU_APP_ID = process.env.FEISHU_APP_ID || '';
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || '';

// 对标账号多维表格（固定，初次创建后不变）
export const COMPETITOR_BITABLE = {
  appToken: process.env.FEISHU_COMPETITOR_APP_TOKEN || 'EK75bB3aca7YXqsXiQBch48Fnzd',
  tableId: process.env.FEISHU_COMPETITOR_TABLE_ID || 'tblUzPt9cWEi4EZH',
  url: 'https://p1bce1datcr.feishu.cn/base/EK75bB3aca7YXqsXiQBch48Fnzd',
};

function feishuPost(path: string, body: unknown, token?: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const options: https.RequestOptions = {
      hostname: 'open.feishu.cn',
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error(`解析响应失败: ${data}`)); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function getTenantToken(): Promise<string> {
  const resp = await feishuPost('/open-apis/auth/v3/tenant_access_token/internal', {
    app_id: FEISHU_APP_ID,
    app_secret: FEISHU_APP_SECRET,
  }) as { code: number; tenant_access_token: string };
  if (resp.code !== 0) throw new Error(`飞书获取 Token 失败: code=${resp.code}`);
  return resp.tenant_access_token;
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

/**
 * 批量写入账号记录到多维表格
 * 每批最多 500 条（飞书限制）
 */
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

  // 分批（每批 100 条）
  const BATCH = 100;
  let successCount = 0;

  for (let i = 0; i < accounts.length; i += BATCH) {
    const batch = accounts.slice(i, i + BATCH);
    const records = batch.map((acc) => ({
      fields: {
        '创作者名称': acc.creatorName,
        '抖音号': acc.douyinId || '—',
        '粉丝数': acc.followers,
        '简介': acc.bio.slice(0, 500),
        '主页链接': acc.profileUrl,
        '轮次': acc.round,
        '关键词': acc.keyword,
        'Topic': acc.topic,
        '通过二筛': acc.passedSecondary,
        '采集时间': acc.executedAt,
      },
    }));

    const resp = await feishuPost(
      `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`,
      { records },
      token
    ) as { code: number; msg: string };

    if (resp.code !== 0) throw new Error(`飞书写入失败: code=${resp.code} msg=${resp.msg}`);
    successCount += batch.length;
  }

  return { successCount, url: COMPETITOR_BITABLE.url };
}
