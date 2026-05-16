import { Request, Response, NextFunction } from 'express';
import { AiVideoPipelineService } from '../services/ai-video-pipeline.service';

const svc = new AiVideoPipelineService();

export async function createJob(req: Request, res: Response, next: NextFunction) {
  try {
    const { local_path, topic } = req.body as { local_path?: string; topic?: string };
    if (!local_path) return res.status(400).json({ error: 'local_path required' });
    const job = await svc.createJob({
      srcVideo: local_path,
      srcLogo: null,
      topic: topic ?? null,
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

export async function updateProgress(req: Request, res: Response, next: NextFunction) {
  try {
    const job = await svc.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'job not found' });
    const { progress, status } = req.body as { progress?: number; status?: string };
    const allowedStatuses = ['pending', 'processing', 'completed', 'failed'] as const;
    if (status !== undefined && !allowedStatuses.includes(status as typeof allowedStatuses[number])) {
      return res.status(400).json({ error: `invalid status: ${status}` });
    }
    const safeStatus = (status as typeof allowedStatuses[number]) ?? 'processing';
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
    const { output_dir, error_msg } = req.body as { output_dir?: string; error_msg?: string };
    const updated = await svc.updateStatus(req.params.id, {
      status: error_msg ? 'failed' : 'completed',
      progress: error_msg ? job.progress : 100,
      outputDir: output_dir,
      errorMsg: error_msg,
    });
    res.json(updated);
  } catch (err) { next(err); }
}
