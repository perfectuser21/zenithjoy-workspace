import { Router } from 'express';
import { PipelineController } from '../controllers/pipeline.controller';

const router = Router();
const controller = new PipelineController();

// POST /api/pipeline/trigger
router.post('/trigger', controller.trigger);

// POST /api/pipeline/callback  ← cecelia 回调
router.post('/callback', controller.callback);

// GET /api/pipeline/dashboard-stats
router.get('/dashboard-stats', controller.dashboardStats);

// GET /api/pipeline/:id
router.get('/:id', controller.getOne);

// GET /api/pipeline
router.get('/', controller.list);

export default router;
