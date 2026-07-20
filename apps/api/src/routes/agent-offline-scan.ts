/**
 * 内部触发端点：POST /api/internal/agent-offline-scan
 *
 * 无鉴权（内部/smoke 调用），不暴露给 dashboard 前端。
 * 供 CI smoke 脚本和人工排查调用，绕过 setInterval 直接触发一次扫描。
 *
 * 合同: sprints/07201705-agent-offline-alert/contract-draft.md
 * task_id: 027e6bba-9b00-4b9f-b3b9-33b2e3807717
 */

import { Router, Request, Response } from 'express';
import { scanAndAlert } from '../services/agent-offline-monitor';

const router = Router();

/**
 * POST /api/internal/agent-offline-scan
 *
 * Body (optional):
 *   threshold_hours: number   — 覆盖 AGENT_OFFLINE_THRESHOLD_HOURS（默认 4）
 *   webhook_override: string  — 覆盖 FEISHU_ALERT_WEBHOOK（smoke 测试用）
 *
 * Response:
 *   { success: true, data: { scanned, alerted, recovered, send_errors? } }
 *   或失败时:
 *   { success: false, error: string, data?: { send_errors } }
 */
router.post('/', async (req: Request, res: Response) => {
  const body = req.body || {};
  const thresholdHours = body.threshold_hours
    ? Number(body.threshold_hours)
    : undefined;
  const webhookOverride = body.webhook_override
    ? String(body.webhook_override)
    : undefined;

  let result;
  try {
    result = await scanAndAlert({ thresholdHours, webhookOverride });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[agent-offline-scan] scanAndAlert 失败:', err);
    return res.status(500).json({
      success: false,
      error: message,
      timestamp: new Date().toISOString(),
    });
  }

  // INV-01：send_errors 非空时，在响应顶层反映错误信号（不静默吞错）
  if (result.send_errors && result.send_errors.length > 0) {
    return res.status(200).json({
      success: false,
      error: `${result.send_errors.length} 个 webhook 发送失败`,
      data: {
        scanned: result.scanned,
        alerted: result.alerted,
        recovered: result.recovered,
        send_errors: result.send_errors,
      },
      timestamp: new Date().toISOString(),
    });
  }

  return res.json({
    success: true,
    data: {
      scanned: result.scanned,
      alerted: result.alerted,
      recovered: result.recovered,
    },
    timestamp: new Date().toISOString(),
  });
});

export default router;
export { router as agentOfflineScanRouter };
