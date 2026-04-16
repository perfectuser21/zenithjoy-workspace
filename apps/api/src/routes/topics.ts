/**
 * /api/topics 路由
 *
 * 所有路由受 internalAuth 中间件保护（Bearer token）
 */

import { Router } from 'express';
import { TopicsController } from '../controllers/topics.controller';
import { internalAuth } from '../middleware/internal-auth';

const router = Router();
const controller = new TopicsController();

router.use(internalAuth);

router.get('/', controller.list);
router.get('/:id', controller.getOne);
router.post('/', controller.create);
router.patch('/:id', controller.patch);
router.delete('/:id', controller.remove);

export default router;
