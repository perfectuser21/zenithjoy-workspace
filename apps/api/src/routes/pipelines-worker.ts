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
import { simpleRateLimit, ipKeyFn } from '../middleware/simple-rate-limit';
import { PipelinesWorkerController } from '../controllers/pipelines-worker.controller';
import { internalAuth } from '../middleware/internal-auth';

const router = Router();
const controller = new PipelinesWorkerController();

// Independent worker budget: 10 requests/s leaves room for polling + six-stage receipts.
// Brain heartbeat/finish have their own endpoint; this does not alter lease duration.
const workerLimit = simpleRateLimit({ windowMs: 60_000, max: 600, keyFn: ipKeyFn });

router.get('/running', workerLimit, internalAuth, controller.running);
router.post('/:id/claim', workerLimit, internalAuth, controller.claim);
router.post('/:id/stage-complete', workerLimit, internalAuth, controller.stageComplete);
router.post('/:id/fail', workerLimit, internalAuth, controller.fail);

export default router;
