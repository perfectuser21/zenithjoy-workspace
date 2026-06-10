import { Router } from 'express';
import multer from 'multer';
import {
  createJob,
  getJob,
  continueN06,
  selectN07,
  getOutput,
  serveRawVideo,
} from '../controllers/video-remake.controller';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 110 * 1024 * 1024 } });

const router = Router();

router.post('/jobs', upload.single('video'), createJob);
router.get('/jobs/:job_id', getJob);
router.post('/jobs/:job_id/nodes/N06/continue', continueN06);
router.post('/jobs/:job_id/nodes/N07/select', selectN07);
router.get('/jobs/:job_id/output', getOutput);
router.get('/jobs/:job_id/raw-video', serveRawVideo);

export default router;
