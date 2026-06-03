/**
 * Path 4 Step 2: Notion CRM 服务
 *
 * 使用 Notion Internal Integration Token（thin 阶段，非 user OAuth）
 * 检测/建立客户明细表（Database）
 */
import axios from 'axios';

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

function getToken(): string {
  return process.env.NOTION_INTEGRATION_TOKEN || '';
}

export interface NotionTableInfo {
  database_id: string;
  title: string;
}

export async function detectOrCreateNotionTable(
  tenantId: string,
  parentPageId?: string
): Promise<{ table_id: string; created: boolean }> {
  const token = getToken();
  if (!token) {
    // token 未配置时，token_expired 状态
    const notifyWebhook = process.env.FEISHU_NOTIFY_WEBHOOK;
    if (notifyWebhook) {
      await axios.post(notifyWebhook, {
        msg_type: 'text',
        content: { text: `[CRM 告警] Notion integration token 未配置，租户: ${tenantId}` },
      }).catch(() => {});
    }
    throw Object.assign(new Error('NOTION_INTEGRATION_TOKEN 未配置'), { code: 'token_expired' });
  }

  const searchResp = await axios.post(
    `${NOTION_API_BASE}/search`,
    {
      query: `客户明细表_${tenantId}`,
      filter: { value: 'database', property: 'object' },
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
    }
  );

  const existing = searchResp.data.results?.[0];
  if (existing) {
    return { table_id: existing.id, created: false };
  }

  // 建新 Database
  const createResp = await axios.post(
    `${NOTION_API_BASE}/databases`,
    {
      parent: { type: 'page_id', page_id: parentPageId || process.env.NOTION_PARENT_PAGE_ID },
      title: [{ type: 'text', text: { content: `客户明细表_${tenantId}` } }],
      properties: {
        Name:           { title: {} },
        微信号:          { rich_text: {} },
        评级:            { select: { options: [{ name: 'A1' }, { name: 'A2' }, { name: 'A3' }, { name: 'A4' }, { name: 'A5' }] } },
        状态:            { select: { options: [{ name: '活跃' }, { name: '潜在' }, { name: '流失' }] } },
        下次跟进时间:      { date: {} },
        AI建议:          { rich_text: {} },
        备注:            { rich_text: {} },
      },
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
    }
  );

  return { table_id: createResp.data.id, created: true };
}

export async function updateNotionRowSuggestion(
  databaseId: string,
  pageId: string,
  suggestion: string
): Promise<void> {
  const token = getToken();
  if (!token) return;

  await axios.patch(
    `${NOTION_API_BASE}/pages/${pageId}`,
    {
      properties: {
        AI建议: { rich_text: [{ type: 'text', text: { content: suggestion } }] },
      },
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
    }
  );
}
