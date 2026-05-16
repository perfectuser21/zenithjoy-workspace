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

// GET /:id/source — 下载原始视频文件给 Agent
export async function downloadSource(req: Request, res: Response, next: NextFunction) {
  try {
    const job = await svc.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'job not found' });
    if (!job.src_video) return res.status(404).json({ error: 'no source video' });
    if (!fs.existsSync(job.src_video)) return res.status(404).json({ error: 'source file missing' });
    res.download(job.src_video, 'source_video.mp4');
  } catch (err) { next(err); }
}

// POST /:id/upload-output — Agent 上传处理后的 MP4 存到 Mac 本机
export async function uploadOutput(req: Request, res: Response, next: NextFunction) {
  try {
    const job = await svc.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'job not found' });
    if (!job.src_video) return res.status(400).json({ error: 'job has no src_video' });

    const outDir = path.join(path.dirname(job.src_video), 'out');
    fs.mkdirSync(outDir, { recursive: true });

    const files = req.files as Record<string, Express.Multer.File[]>;
    const saved: string[] = [];
    for (const field of ['9_16', '16_9'] as const) {
      const f = files?.[field]?.[0];
      if (f) {
        const dest = path.join(outDir, `${field}.mp4`);
        fs.renameSync(f.path, dest);
        saved.push(`${field}.mp4`);
      }
    }

    if (saved.length === 0) return res.status(400).json({ error: 'no files received' });

    if (saved.length === 2) {
      await svc.updateStatus(req.params.id, {
        status: 'completed',
        progress: 100,
        resultUrl: outDir,
      });
    }

    res.json({ saved });
  } catch (err) { next(err); }
}
