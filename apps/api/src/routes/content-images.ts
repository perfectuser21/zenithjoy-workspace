import { Router } from 'express';
import { ContentImagesController } from '../controllers/content-images.controller';

const router = Router();
const controller = new ContentImagesController();

// GET /api/content-images/:pipelineId/:filename  ← 公开访问（图片需能从 <img> 直接加载）
router.get('/:pipelineId/:filename', controller.serve);

export default router;
