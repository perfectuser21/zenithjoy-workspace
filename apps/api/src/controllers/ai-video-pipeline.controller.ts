import { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { AiVideoPipelineService } from '../services/ai-video-pipeline.service';

const svc = new AiVideoPipelineService();

export async function createJob(req: Request, res: Response, next: NextFunction) {
  try {
    const video = (req.files as Record<string, Express.Multer.File[]>)?.video?.[0];
    if (!video) return res.status(400).json({ error: 'video file required' });
    const logo = (req.files as Record<string, Express.Multer.File[]>)?.logo?.[0] ?? null;
    const topic = typeof req.body.topic === 'string' ? req.body.topic : null;
    const job = await svc.createJob({
      srcVideo: video.path,
      srcLogo: logo?.path ?? null,
      topic,
    });
    res.status(201).json(job);
  } catch (err) { next(err); }
}

export async function getJob(req: Request, res: Response, next: NextFunction) {
  try {
    const job = await svc.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'job not found' });
    res.json(job);
  } catch (err) { next(err); }
}

export async function listJobs(req: Request, res: Response, next: NextFunction) {
  try {
    const status = req.query.status as string | undefined;
    if (status === 'pending') {
      const jobs = await svc.listPending();
      return res.json({ data: jobs });
    }
    res.json({ data: [] });
  } catch (err) { next(err); }
}

export async function downloadOutput(req: Request, res: Response, next: NextFunction) {
  try {
    const job = await svc.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'job not found' });
    const { file } = req.params;
    if (!['9_16.mp4', '16_9.mp4'].includes(file)) return res.status(400).json({ error: 'invalid file name' });
    if (!job.src_video) return res.status(404).json({ error: 'job has no video' });
    const outPath = path.join(path.dirname(job.src_video), 'out', file);
    if (!fs.existsSync(outPath)) return res.status(404).json({ error: 'output not ready' });
    res.download(outPath, file);
  } catch (err) { next(err); }
}

export async function updateProgress(req: Request, res: Response, next: NextFunction) {
  try {
    const job = await svc.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'job not found' });
    const { progress, status } = req.body as { progress?: number; status?: string };
    const allowedStatuses = ['pending', 'processing', 'completed', 'failed'] as const;
    const safeStatus = allowedStatuses.includes(status as typeof allowedStatuses[number])
      ? (status as typeof allowedStatuses[number])
      : 'processing';
    const updated = await svc.updateStatus(req.params.id, {
      status: safeStatus,
      progress: typeof progress === 'number' ? progress : job.progress,
    });
    res.json(updated);
  } catch (err) { next(err); }
}

export async function completeJob(req: Request, res: Response, next: NextFunction) {
  try {
    const job = await svc.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'job not found' });
    const { result_url, error_msg } = req.body;
    const updated = await svc.updateStatus(req.params.id, {
      status: error_msg ? 'failed' : 'completed',
      progress: error_msg ? job.progress : 100,
      resultUrl: result_url,
      errorMsg: error_msg,
    });
    res.json(updated);
  } catch (err) { next(err); }
}
