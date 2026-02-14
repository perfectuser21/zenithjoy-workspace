import { Router } from 'express';
import { AiVideoController } from '../controllers/ai-video.controller';

const router = Router();
const controller = new AiVideoController();

// GET /api/ai-video/history - Get all video generations with optional filters
router.get('/history', controller.getAllGenerations);

// GET /api/ai-video/active - Get active (in-progress/queued) generations
router.get('/active', controller.getActiveGenerations);

// GET /api/ai-video/task/:id - Get specific video generation by ID
router.get('/task/:id', controller.getGenerationById);

// POST /api/ai-video/generate - Create new video generation
router.post('/generate', controller.createGeneration);

// PUT /api/ai-video/task/:id - Update video generation status
router.put('/task/:id', controller.updateGeneration);

// DELETE /api/ai-video/task/:id - Delete video generation
router.delete('/task/:id', controller.deleteGeneration);

export default router;
