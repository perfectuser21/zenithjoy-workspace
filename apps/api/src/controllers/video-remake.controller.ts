import { Request, Response } from 'express';
import {
  createVideoRemakeJob,
  getVideoRemakeJob,
  approveN06Review,
  selectN07Frame,
  getVideoRemakeOutput,
  getRawVideoBuffer,
} from '../services/video-remake.service';

export async function createJob(req: Request, res: Response): Promise<void> {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No video file provided' });
      return;
    }
    const result = await createVideoRemakeJob({
      filename: file.originalname,
      fileSizeBytes: file.size,
      buffer: file.buffer,
    });
    res.status(200).json(result);
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    res.status(e.status ?? 400).json({ error: e.message ?? 'Unknown error' });
  }
}

export async function getJob(req: Request, res: Response): Promise<void> {
  try {
    const job = await getVideoRemakeJob(req.params.job_id);
    res.status(200).json(job);
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    res.status(e.status ?? 404).json({ error: e.message ?? 'Not found' });
  }
}

export async function continueN06(req: Request, res: Response): Promise<void> {
  try {
    const result = await approveN06Review({ jobId: req.params.job_id });
    res.status(200).json(result);
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    res.status(e.status ?? 400).json({ error: e.message ?? 'Unknown error' });
  }
}

export async function selectN07(req: Request, res: Response): Promise<void> {
  try {
    const ciAuto = process.env.CI === 'true' || req.body?.ci_auto === true;
    const result = await selectN07Frame({ jobId: req.params.job_id, ciAuto });
    res.status(200).json(result);
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    res.status(e.status ?? 400).json({ error: e.message ?? 'Unknown error' });
  }
}

export async function getOutput(req: Request, res: Response): Promise<void> {
  try {
    const output = await getVideoRemakeOutput(req.params.job_id);
    res.status(200).json(output);
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    res.status(e.status ?? 404).json({ error: e.message ?? 'Not found' });
  }
}

export function serveRawVideo(req: Request, res: Response): void {
  const buf = getRawVideoBuffer(req.params.job_id);
  if (!buf || buf.length === 0) {
    res.status(404).json({ error: 'Raw video not found' });
    return;
  }
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Length', buf.length);
  res.status(200).end(buf);
}
