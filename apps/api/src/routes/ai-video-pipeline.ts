import { Router } from 'express';
import multer from 'multer';
import { createJob, getJob, listJobs, completeJob, updateProgress } from '../controllers/ai-video-pipeline.controller';
import { transcribeAudio, designScenes, composeHtml, generateBgm, composeTemplate } from '../controllers/ai-video-pipeline-ai.controller';

const upload = multer({ storage: multer.memoryStorage() });

const router = Router();

router.post('/', createJob);
router.get('/', listJobs);
router.get('/:id', getJob);
router.patch('/:id/progress', updateProgress);
router.put('/:id/complete', completeJob);
router.post('/:id/transcribe', upload.single('audio'), transcribeAudio);
router.post('/:id/design', designScenes);
router.post('/:id/compose-html', composeHtml);
router.post('/:id/bgm', generateBgm);
router.post('/:id/compose-template', composeTemplate);

export default router;
