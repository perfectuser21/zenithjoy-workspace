import { Request, Response, NextFunction } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { AiVideoService } from '../services/ai-video.service';
import { AiVideoUploadService } from '../services/ai-video-upload.service';

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
      res.json(generation);
    } catch (error) {
      next(error);
    }
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

      const jobId = (req as any).jobId as string;

      await uploadService.createJob({
        jobId,
        videoPath: videoFile.path,
        scriptText,
        logoPath: logoFile?.path,
      });

      // Fire and forget dispatch (async).
      // dispatch() uses execSync(ssh/scp) which blocks the Node.js event loop.
      // Calling getGenerationById() after this point risks pg-pool connectionTimeoutMillis
      // firing before the event loop unblocks. Return the known data instead.
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
      // Sanitize path components
      if (!/^[\w-]+$/.test(jobId) || !/^[\w.-]+$/.test(file)) {
        return res.status(400).json({ error: 'invalid path' });
      }
      const filePath = path.join(LOCAL_BASE, jobId, 'out', file);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'file not found' });
      }
      res.download(filePath);
    } catch (error) {
      next(error);
    }
  }
}
