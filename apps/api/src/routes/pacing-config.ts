/**
 * /api/pacing-config 路由
 *
 * 所有路由受 internalAuth 中间件保护（Bearer token）
 */

import { Router } from 'express';
import { PacingConfigController } from '../controllers/pacing-config.controller';
import { internalAuth } from '../middleware/internal-auth';

const router = Router();
const controller = new PacingConfigController();

router.use(internalAuth);

router.get('/', controller.get);
router.patch('/', controller.patch);

export default router;
