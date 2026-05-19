import { Router, Request, Response } from 'express';
import { WorksController } from '../controllers/works.controller';
import { validate } from '../middleware/validate';
import { tenantContext } from '../middleware/tenant-context';
import { tenantBypass } from '../middleware/tenant-bypass';
import { createWorkSchema, updateWorkSchema } from '../models/schemas';
import {
  dispatchPublishTask,
  NoAgentError,
} from '../services/walking-skeleton.service';

const router = Router();
const controller = new WorksController();

// 多租户隔离（v2，2026-04-28 决策）：tenant 级隔离 + super-admin bypass
// 中间件按 per-route 挂（避免 /api/works/<id>/publish-logs 等嵌套路径被 router-level
// 中间件意外拦截—— Express 会在路径前缀命中 worksRouter 时跑 router.use 中间件，即使
// 路由表里没有对应 handler）

const tenantMiddleware = [tenantContext, tenantBypass];

// GET /api/works - List works
router.get('/', tenantMiddleware, controller.getWorks);

// GET /api/works/:id - Get single work
router.get('/:id', tenantMiddleware, controller.getWorkById);

// POST /api/works - Create work
router.post('/', tenantMiddleware, validate(createWorkSchema), controller.createWork);

// PUT /api/works/:id - Update work
router.put('/:id', tenantMiddleware, validate(updateWorkSchema), controller.updateWork);

// DELETE /api/works/:id - Delete work
router.delete('/:id', tenantMiddleware, controller.deleteWork);

// POST /api/works/:id/publish — 派发发布任务（step 6 dispatch chain）
router.post('/:id/publish', tenantMiddleware, async (req: Request, res: Response) => {
  const workId = req.params.id;
  const tenantId = req.tenantId;
  if (!tenantId) {
    return res.status(403).json({ ok: false, code: 'NO_TENANT', message: '用户未关联 tenant' });
  }
  try {
    const result = await dispatchPublishTask({ workId, tenantId });
    return res.status(201).json(result);
  } catch (err) {
    if (err instanceof NoAgentError) {
      return res.status(422).json({ ok: false, code: 'NO_AGENT', message: err.message });
    }
    const msg = err instanceof Error ? err.message : 'unknown';
    return res.status(500).json({ ok: false, code: 'DISPATCH_FAILED', message: msg });
  }
});

export default router;
