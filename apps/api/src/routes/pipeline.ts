import { Router } from 'express';
import { simpleRateLimit, ipKeyFn } from '../middleware/simple-rate-limit';
import { PipelineController } from '../controllers/pipeline.controller';

const router = Router();
const controller = new PipelineController();
// Shared budget across list/poll and mutations; no caller-controlled topic/owner key.
const pipelineLimit = simpleRateLimit({ windowMs: 60_000, max: 240, keyFn: ipKeyFn });

// POST /api/pipeline/trigger
router.post('/trigger', pipelineLimit, controller.trigger);

// POST /api/pipeline/callback  ← cecelia 回调
router.post('/callback', pipelineLimit, controller.callback);

router.get('/capabilities', pipelineLimit, controller.capabilities);

// GET /api/pipeline/dashboard-stats
router.get('/dashboard-stats', pipelineLimit, controller.dashboardStats);

// GET /api/pipeline/:id/output  ← cecelia 透传
router.get('/:id/output', pipelineLimit, controller.getOutput);

// GET /api/pipeline/:id/stages  ← cecelia 透传
router.get('/:id/stages', pipelineLimit, controller.getStages);

// POST /api/pipeline/:id/rerun  ← cecelia 透传
router.post('/:id/rerun', pipelineLimit, controller.rerun);
router.post('/:id/register', pipelineLimit, controller.register);

// GET /api/pipeline/:id
router.get('/:id', pipelineLimit, controller.getOne);

// GET /api/pipeline
router.get('/', pipelineLimit, controller.list);

export default router;
