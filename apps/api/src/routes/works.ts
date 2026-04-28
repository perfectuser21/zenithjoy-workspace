import { Router } from 'express';
import { WorksController } from '../controllers/works.controller';
import { validate } from '../middleware/validate';
import { tenantContext } from '../middleware/tenant-context';
import { tenantBypass } from '../middleware/tenant-bypass';
import { createWorkSchema, updateWorkSchema } from '../models/schemas';

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

export default router;
