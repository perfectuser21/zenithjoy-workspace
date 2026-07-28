/**
 * /api/panel/events — 作战窗 Agent Panel 刀1 薄写入端点
 *
 * PrepPRD: sprints/07280929-agent-panel-knife1/prep-prd.md
 * 鉴权：X-Internal-Token（内部Agent调用，env未设置时dev放行）+ X-Tenant-Id（租户隔离，必填）。
 * 中台侧写入失败的重试/本地缓存策略在 Agent 侧（判定点已登记），本端点本身只做简单 INSERT。
 */

import { Router, Request } from 'express';
import { internalAuth } from '../middleware/internal-auth';
import { writePanelEvent, PanelEventType } from '../services/panel/panel-events-service';

export const panelEventsRouter = Router();

panelEventsRouter.use(internalAuth);

const VALID_EVENTS: PanelEventType[] = ['task_started', 'step', 'waiting', 'stuck', 'done', 'failed'];

const MISSING_TENANT = {
  error: 'MISSING_TENANT',
  message: '缺 tenant_id（X-Tenant-Id 头）— 拒绝执行，不回退全量',
};

function resolveTenantId(req: Request): string {
  return (req.header('X-Tenant-Id') || '').trim();
}

panelEventsRouter.post('/events', async (req, res) => {
  const tenantId = resolveTenantId(req);
  if (!tenantId) return res.status(400).json(MISSING_TENANT);

  const {
    event, task_id: taskId, line, device, title, detail, progress, severity,
  } = req.body || {};

  if (!event || !taskId || !line || !device || !title) {
    return res.status(400).json({
      error: 'MISSING_FIELDS',
      message: '缺 event/task_id/line/device/title',
    });
  }
  if (!VALID_EVENTS.includes(event)) {
    return res.status(400).json({
      error: 'INVALID_EVENT',
      message: `event 必须是 ${VALID_EVENTS.join('/')} 之一`,
    });
  }

  try {
    const r = await writePanelEvent({
      tenantId,
      event,
      taskId,
      line,
      device,
      title,
      detail: detail ?? null,
      progress: progress ?? null,
      severity: severity ?? 'info',
    });
    return res.status(200).json({ ok: true, id: r.id });
  } catch (e) {
    console.error('[panel/events] error:', e);
    return res.status(500).json({ error: 'INTERNAL', message: 'write failed' });
  }
});
