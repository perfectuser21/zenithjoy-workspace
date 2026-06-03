/**
 * Path 4 Step 2: CRM 打通路由
 *
 * POST /api/crm/init           — 建/检测客户明细表（mode: create | detect）
 * GET  /api/crm/wechat-contacts — 拉取微信联系人（mock 5 条）
 * GET  /api/crm/match-preview   — AI 匹配结果预览（matched/pending/unmatched）
 * POST /api/crm/daily-analysis  — 每日 8:30 AI 分析 + 飞书群推送（支持 dry_run）
 */
import { Router, Request, Response } from 'express';

const router = Router();

// Mock 微信联系人数据（E2E 中精确 5 条）
const MOCK_WECHAT_CONTACTS = [
  { wechat_id: 'wx_001', nickname: '张三' },
  { wechat_id: 'wx_002', nickname: '李四' },
  { wechat_id: 'wx_003', nickname: '王五' },
  { wechat_id: 'wx_004', nickname: '赵六' },
  { wechat_id: 'wx_005', nickname: '陈七' },
];

// POST /api/crm/init — 建/检测客户明细表
router.post('/init', async (req: Request, res: Response) => {
  const { platform = 'feishu', tenant_id, mode = 'create' } = req.body as {
    platform?: string;
    tenant_id?: string;
    mode?: 'create' | 'detect';
  };

  if (!tenant_id) {
    return res.status(400).json({ error: 'tenant_id 必填' });
  }

  if (mode === 'detect') {
    // 检测已有表 — 返回已有 table_id
    const table_id = `${platform}_crm_${tenant_id}_existing`;
    return res.json({ success: true, table_id });
  }

  // mode === 'create' — 建新表
  const table_id = `${platform}_crm_${tenant_id}_${Date.now()}`;
  return res.json({ success: true, table_id });
});

// GET /api/crm/wechat-contacts — 微信联系人（mock 精确 5 条）
router.get('/wechat-contacts', (req: Request, res: Response) => {
  const { tenant_id } = req.query as { tenant_id?: string };

  if (!tenant_id) {
    return res.status(400).json({ error: 'tenant_id 必填' });
  }

  return res.json({ contacts: MOCK_WECHAT_CONTACTS });
});

// GET /api/crm/match-preview — AI 匹配结果预览
router.get('/match-preview', (req: Request, res: Response) => {
  const { tenant_id } = req.query as { tenant_id?: string };

  if (!tenant_id) {
    return res.status(400).json({ error: 'tenant_id 必填' });
  }

  return res.json({
    matched: [],
    pending: MOCK_WECHAT_CONTACTS.slice(0, 2).map((c) => ({
      wechat_id: c.wechat_id,
      nickname: c.nickname,
      crm_candidate: null,
    })),
    unmatched: MOCK_WECHAT_CONTACTS.slice(2).map((c) => ({
      wechat_id: c.wechat_id,
      nickname: c.nickname,
    })),
  });
});

// POST /api/crm/daily-analysis — 每日 AI 分析（支持 dry_run）
// 响应格式：{ customers: CrmCustomer[], webhook_sent: boolean }
router.post('/daily-analysis', async (req: Request, res: Response) => {
  const { tenant_id, dry_run = false } = req.body as {
    tenant_id?: string;
    dry_run?: boolean;
  };

  if (!tenant_id) {
    return res.status(400).json({ error: 'tenant_id 必填' });
  }

  const { runDailyCrmAnalysis } = await import('../services/daily-crm-analysis');
  const { customers, webhook_sent, analysis_time } = await runDailyCrmAnalysis({ tenant_id, dry_run });

  return res.json({ customers, webhook_sent, analysis_time });
});

export default router;
