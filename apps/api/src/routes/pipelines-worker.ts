/**
 * /api/pipelines 路由（pipeline-worker 专用）
 *
 * 路径：
 *   GET  /api/pipelines/running
 *   POST /api/pipelines/:id/stage-complete
 *   POST /api/pipelines/:id/fail
 *
 * 所有路由受 internalAuth 中间件保护（Bearer token）
 */

import { Router } from 'express';
import { PipelinesWorkerController } from '../controllers/pipelines-worker.controller';
import { internalAuth } from '../middleware/internal-auth';

const router = Router();
const controller = new PipelinesWorkerController();

router.use(internalAuth);

router.get('/running', controller.running);
router.post('/:id/stage-complete', controller.stageComplete);
router.post('/:id/fail', controller.fail);

export default router;
