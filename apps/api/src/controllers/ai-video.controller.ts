import { Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { AiVideoService } from '../services/ai-video.service';
import { AiVideoUploadService } from '../services/ai-video-upload.service';
import { sseService } from '../services/sse.service';

const aiVideoService = new AiVideoService();
const uploadService = new AiVideoUploadService();
const LOCAL_BASE = `${process.env.HOME}/video-pipeline/jobs`;

export class AiVideoController {
  async getAllGenerations(req: Request, res: Response, next: NextFunction) {
    try {
      const { status, limit, offset } = req.query;

      const result = await aiVideoService.getAllGenerations({
        status: status as string,
        limit: limit ? parseInt(limit as string) : 20,
        offset: offset ? parseInt(offset as string) : 0,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async getGenerationById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const generation = await aiVideoService.getGenerationById(id);

      if (!generation) {
        return res.status(404).json({ error: 'Video generation not found' });
      }

      res.json(generation);
    } catch (error) {
      next(error);
    }
  }

  async getActiveGenerations(req: Request, res: Response, next: NextFunction) {
    try {
      const generations = await aiVideoService.getActiveGenerations();
      res.json(generations);
    } catch (error) {
      next(error);
    }
  }

  async createGeneration(req: Request, res: Response, next: NextFunction) {
    try {
      const generation = await aiVideoService.createGeneration(req.body);
      res.status(201).json(generation);
    } catch (error) {
      next(error);
    }
  }

  async updateGeneration(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const generation = await aiVideoService.updateGeneration(id, req.body);
      const TERMINAL_VIDEO = ['completed', 'failed'];
      const emitData = { id: generation.id, status: generation.status, progress: (generation as { progress?: number }).progress ?? 0, error: (generation as { error_message?: string }).error_message ?? undefined };
      if (TERMINAL_VIDEO.includes(generation.status)) {
        sseService.close(generation.id, emitData);
      } else {
        sseService.emit(generation.id, emitData);
      }
      res.json(generation);
    } catch (error) {
      next(error);
    }
  }

  async getGenerationByIdRaw(id: string) {
    return aiVideoService.getGenerationById(id);
  }

  async deleteGeneration(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await aiVideoService.deleteGeneration(id);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  async uploadAndProcess(req: Request, res: Response, next: NextFunction) {
    try {
      const files = req.files as Record<string, Express.Multer.File[]>;
      const videoFile = files?.['video']?.[0];
      const logoFile  = files?.['logo']?.[0];

      if (!videoFile) {
        return res.status(400).json({ error: 'video file is required' });
      }
      const scriptText = (req.body.script || req.body.title || '').trim();
      if (!scriptText) {
        return res.status(400).json({ error: 'script or title is required' });
      }

      const jobId = (req as unknown as { jobId: string }).jobId;

      await uploadService.createJob({
        jobId,
        videoPath: videoFile.path,
        scriptText,
        logoPath: logoFile?.path,
      });

      // dispatch() uses execSync(ssh/scp) which blocks the event loop.
      // Calling getGenerationById() after this point risks pg-pool connectionTimeout.
      // Return known data instead.
      uploadService.dispatch({
        jobId,
        videoPath: videoFile.path,
        scriptText,
        logoPath: logoFile?.path,
      }).catch((err) => {
        console.error(`[upload] dispatch error for ${jobId}:`, err);
      });

      res.status(201).json({ id: jobId, status: 'queued', progress: 0, script_text: scriptText });
    } catch (error) {
      next(error);
    }
  }

  async downloadFile(req: Request, res: Response, next: NextFunction) {
    try {
      const { jobId, file } = req.params;
      if (!jobId || !file || file.includes('..') || file.includes('/')) {
        return res.status(400).json({ error: 'invalid params' });
      }
      const filePath = path.join(LOCAL_BASE, jobId, 'out', file);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'file not found' });
      }
      res.sendFile(filePath);
    } catch (error) {
      next(error);
    }
  }
}
