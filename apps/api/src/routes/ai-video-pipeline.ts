import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import { createJob, getJob, listJobs, completeJob, updateProgress, getJobRaw } from '../controllers/ai-video-pipeline.controller';
import { transcribeAudio, analyzeTranscript, designScenes, composeHtml, generateBgm, composeTemplate, detectFrameOrientation } from '../controllers/ai-video-pipeline-ai.controller';
import { sseService } from '../services/sse.service';

const upload = multer({ storage: multer.memoryStorage() });

const router = Router();

router.post('/', createJob);
router.get('/', listJobs);
router.get('/:id', getJob);
router.patch('/:id/progress', updateProgress);
router.put('/:id/complete', completeJob);
router.post('/:id/transcribe', upload.single('audio'), transcribeAudio);
router.post('/:id/analyze-transcript', analyzeTranscript);
router.post('/:id/design', designScenes);
router.post('/:id/compose-html', composeHtml);
router.post('/:id/bgm', generateBgm);
router.post('/:id/compose-template', composeTemplate);
router.post('/:id/detect-frame-orientation', upload.single('frame'), detectFrameOrientation);

// GET /:id/sse — 实时进度推送
router.get('/:id/sse', async (req: Request, res: Response) => {
  const job = await getJobRaw(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'job not found' });
    return;
  }
  sseService.subscribe(req.params.id, req, res, {
    id: job.id,
    status: job.status,
    progress: job.progress,
    error: (job as { error_msg?: string }).error_msg ?? undefined,
  });
});

export default router;
