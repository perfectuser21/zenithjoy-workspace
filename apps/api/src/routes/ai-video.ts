import { Router } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { AiVideoController } from '../controllers/ai-video.controller';

const UPLOAD_BASE = `${process.env.HOME}/video-pipeline/jobs`;

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const jobId = (req as unknown as { jobId: string }).jobId;
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

// POST /api/ai-video/upload — Upload video for local Whisper+FFmpeg processing
router.post('/upload', (req, _res, next) => {
  (req as unknown as { jobId: string }).jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  next();
}, upload.fields([{ name: 'video', maxCount: 1 }, { name: 'logo', maxCount: 1 }]),
  controller.uploadAndProcess.bind(controller));

// GET /api/ai-video/download/:jobId/:file — Download processed video
router.get('/download/:jobId/:file', controller.downloadFile.bind(controller));

// GET /api/ai-video/history
router.get('/history', controller.getAllGenerations.bind(controller));

// GET /api/ai-video/active
router.get('/active', controller.getActiveGenerations.bind(controller));

// GET /api/ai-video/task/:id
router.get('/task/:id', controller.getGenerationById.bind(controller));

// POST /api/ai-video/generate
router.post('/generate', controller.createGeneration.bind(controller));

// PUT /api/ai-video/task/:id
router.put('/task/:id', controller.updateGeneration.bind(controller));

// DELETE /api/ai-video/task/:id
router.delete('/task/:id', controller.deleteGeneration.bind(controller));

export default router;
