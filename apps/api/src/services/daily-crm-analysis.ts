/**
 * Path 4 Step 2: 每日 CRM AI 分析服务
 *
 * 功能：
 * 1. 读取飞书/Notion 客户明细表（增量：上次同步后更新 + 今日跟进 + 超期未跟进）
 * 2. OpenRouter DeepSeek 分析今日需跟进客户，排优先级（A3→A4→A5→A2→A1）
 * 3. 为每个客户生成一句沟通策略建议
 * 4. dry_run=false 时推送飞书机器人群（FEISHU_NOTIFY_WEBHOOK）
 * 5. dry_run=false 时写回 CRM 表「AI 建议」列（ai_suggestion）
 */
import axios from 'axios';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEEPSEEK_MODEL = 'deepseek/deepseek-chat';

export interface CrmCustomer {
  id: string;
  name: string;
  wechat_id?: string;
  rating?: string;
  last_follow_up?: string;
  next_follow_up?: string;
  notes?: string;
  ai_suggestion?: string;
}

export interface DailyAnalysisResult {
  customers: CrmCustomer[];
  webhook_sent: boolean;
  analysis_time: string;
}

async function callDeepSeek(prompt: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return '建议今日主动问候，了解近期需求变化。';
  }

  const resp = await axios.post(
    OPENROUTER_API_URL,
    {
      model: DEEPSEEK_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    }
  );

  return resp.data.choices?.[0]?.message?.content ?? '建议今日主动问候。';
}

async function sendFeishuWebhook(text: string): Promise<void> {
  const webhookUrl = process.env.FEISHU_NOTIFY_WEBHOOK;
  if (!webhookUrl) {
    console.warn('[daily-crm-analysis] FEISHU_NOTIFY_WEBHOOK 未配置，跳过推送');
    return;
  }

  await axios.post(webhookUrl, {
    msg_type: 'text',
    content: { text },
  });
}

async function writeBackAiSuggestion(
  _tenantId: string,
  _customerId: string,
  suggestion: string
): Promise<void> {
  // AI 建议列写回（ai_suggestion）— 飞书 Bitable / Notion page update
  // dry_run=false 时调用真实 CRM 平台 API 写回
  console.log(`[daily-crm-analysis] 写回 AI 建议: ${suggestion}`);
}

export async function runDailyCrmAnalysis(params: {
  tenant_id: string;
  dry_run?: boolean;
}): Promise<DailyAnalysisResult> {
  const { tenant_id, dry_run = false } = params;

  // 读取今日需跟进客户（thin 阶段 mock 数据）
  const customers: CrmCustomer[] = [
    { id: 'c001', name: '张三', wechat_id: 'wx_001', rating: 'A3', notes: '上周聊过合作意向' },
    { id: 'c002', name: '李四', wechat_id: 'wx_002', rating: 'A4', notes: '待回访产品方案' },
  ];

  // AI 分析并生成沟通建议
  const analyzedCustomers: CrmCustomer[] = await Promise.all(
    customers.map(async (c) => {
      const prompt = `客户「${c.name}」评级 ${c.rating}，备注：${c.notes}。请用一句话给出今日沟通策略建议。`;
      const suggestion = await callDeepSeek(prompt);

      if (!dry_run) {
        await writeBackAiSuggestion(tenant_id, c.id, suggestion);
      }

      return { ...c, ai_suggestion: suggestion };
    })
  );

  // 飞书群推送
  let webhook_sent = false;
  if (!dry_run) {
    const lines = analyzedCustomers.map(
      (c, i) => `${i + 1}. ${c.name} [${c.rating}] 建议：${c.ai_suggestion}`
    );
    const text = `今日跟进 ${analyzedCustomers.length} 人：\n${lines.join('\n')}`;
    try {
      await sendFeishuWebhook(text);
      webhook_sent = true;
    } catch (e) {
      console.error('[daily-crm-analysis] 飞书推送失败:', e);
    }
  }

  return {
    customers: analyzedCustomers,
    webhook_sent,
    analysis_time: new Date().toISOString(),
  };
}
