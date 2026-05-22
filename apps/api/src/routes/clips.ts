import { Router } from 'express';
import {
  submitClip, listClips, getClipDetail, retryClip,
  handleCallback, getUserSettings, saveUserSettings,
  saveNotionToken, deleteFeishuBinding, deleteNotionBinding,
} from '../controllers/clips.controller';

const router = Router();
router.post('/', submitClip);
router.get('/', listClips);
router.get('/settings', getUserSettings);
router.put('/settings', saveUserSettings);
router.put('/settings/notion-token', saveNotionToken);
router.delete('/settings/feishu', deleteFeishuBinding);
router.delete('/settings/notion', deleteNotionBinding);
router.get('/:id', getClipDetail);
router.post('/:id/retry', retryClip);
router.post('/:id/callback', handleCallback);

export default router;
