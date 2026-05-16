import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { createJob, getJob, listJobs, completeJob, updateProgress, downloadOutput } from '../controllers/ai-video-pipeline.controller';
import { transcribeAudio, designScenes, composeHtml, generateBgm } from '../controllers/ai-video-pipeline-ai.controller';

const UPLOAD_DIR = `${process.env.HOME}/video-pipeline/jobs`;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(UPLOAD_DIR, `job-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname === 'video' ? `video${ext}` : `logo${ext}`);
  },
});

const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

const router = Router();

router.post('/', upload.fields([{ name: 'video', maxCount: 1 }, { name: 'logo', maxCount: 1 }]), createJob);
router.get('/', listJobs);
router.get('/:id', getJob);
router.patch('/:id/progress', updateProgress);
router.put('/:id/complete', completeJob);
router.post('/:id/transcribe', upload.single('audio'), transcribeAudio);
router.post('/:id/design', designScenes);
router.post('/:id/compose-html', composeHtml);
router.post('/:id/bgm', generateBgm);

router.get('/:id/output/:file', downloadOutput);

export default router;
