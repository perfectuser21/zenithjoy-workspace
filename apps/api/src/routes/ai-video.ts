import { Router } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { AiVideoController } from '../controllers/ai-video.controller';

const UPLOAD_BASE = `${process.env.HOME}/video-pipeline/jobs`;

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const jobId = (req as any).jobId;
    const dir = path.join(UPLOAD_BASE, jobId, 'src');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = file.fieldname === 'video' ? `video${ext}` : `logo${ext}`;
    cb(null, name);
  },
});

const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

const router = Router();
const controller = new AiVideoController();

// POST /api/ai-video/upload - Upload video for local Whisper+FFmpeg processing
router.post('/upload', (req, _res, next) => {
  (req as any).jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  next();
}, upload.fields([{ name: 'video', maxCount: 1 }, { name: 'logo', maxCount: 1 }]),
  controller.uploadAndProcess);

// GET /api/ai-video/download/:jobId/:file - Download processed video
router.get('/download/:jobId/:file', controller.downloadFile);

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
