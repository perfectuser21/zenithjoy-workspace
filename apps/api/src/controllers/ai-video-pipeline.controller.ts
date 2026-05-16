import { Request, Response, NextFunction } from 'express';
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
