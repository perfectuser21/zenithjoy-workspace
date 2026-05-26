import { Router } from 'express';
import { PublishController } from '../controllers/publish.controller';
import { validate } from '../middleware/validate';
import { feishuUser } from '../middleware/feishu-user';
import { createPublishLogSchema, updatePublishLogSchema } from '../models/schemas';

const router = Router();
const controller = new PublishController();

// GET /api/works/:workId/publish-logs - Get publish logs for a work
router.get('/works/:workId/publish-logs', feishuUser, controller.getPublishLogs);

// POST /api/works/:workId/publish-logs - Create publish log
router.post('/works/:workId/publish-logs', feishuUser, validate(createPublishLogSchema), controller.createPublishLog);

// PUT /api/publish-logs/:id - Update publish log
router.put('/publish-logs/:id', feishuUser, validate(updatePublishLogSchema), controller.updatePublishLog);

export default router;
