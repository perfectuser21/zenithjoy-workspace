import { Router } from 'express';
import { PublishController } from '../controllers/publish.controller';
import { validate } from '../middleware/validate';
import { createPublishLogSchema, updatePublishLogSchema } from '../models/schemas';

const router = Router();
const controller = new PublishController();

// GET /api/works/:workId/publish-logs - Get publish logs for a work
router.get('/works/:workId/publish-logs', controller.getPublishLogs);

// POST /api/works/:workId/publish-logs - Create publish log
router.post('/works/:workId/publish-logs', validate(createPublishLogSchema), controller.createPublishLog);

// PUT /api/publish-logs/:id - Update publish log
router.put('/publish-logs/:id', validate(updatePublishLogSchema), controller.updatePublishLog);

export default router;
