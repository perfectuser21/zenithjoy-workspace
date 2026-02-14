import { Request, Response, NextFunction } from 'express';
import { AiVideoService } from '../services/ai-video.service';

const aiVideoService = new AiVideoService();

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
}
