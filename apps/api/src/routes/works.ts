import { Router } from 'express';
import { WorksController } from '../controllers/works.controller';
import { validate } from '../middleware/validate';
import { feishuUser } from '../middleware/feishu-user';
import { tenantBypass } from '../middleware/tenant-bypass';
import { createWorkSchema, updateWorkSchema } from '../models/schemas';

const router = Router();
const controller = new WorksController();

// 多租户隔离：所有 works 端点强制飞书登录态 + 可选 super-admin bypass
router.use(feishuUser);
router.use(tenantBypass);

// GET /api/works - List works
router.get('/', controller.getWorks);

// GET /api/works/:id - Get single work
router.get('/:id', controller.getWorkById);

// POST /api/works - Create work
router.post('/', validate(createWorkSchema), controller.createWork);

// PUT /api/works/:id - Update work
router.put('/:id', validate(updateWorkSchema), controller.updateWork);

// DELETE /api/works/:id - Delete work
router.delete('/:id', controller.deleteWork);

export default router;
