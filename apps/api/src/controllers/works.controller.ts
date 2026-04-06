import { Request, Response, NextFunction } from 'express';
import { WorksService } from '../services/works.service';

const worksService = new WorksService();

export class WorksController {
  async getWorks(req: Request, res: Response, next: NextFunction) {
    try {
      const { type, status, limit, offset, sort, order } = req.query;

      const result = await worksService.getWorks({
        type: type as string,
        status: status as string,
        limit: limit ? parseInt(limit as string) : undefined,
        offset: offset ? parseInt(offset as string) : undefined,
        sort: sort as string,
        order: order as 'asc' | 'desc'
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  async getWorkById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const work = await worksService.getWorkById(id);
      res.json(work);
    } catch (error) {
      next(error);
    }
  }

  async createWork(req: Request, res: Response, next: NextFunction) {
    try {
      const work = await worksService.createWork(req.body);
      res.status(201).json(work);
    } catch (error) {
      next(error);
    }
  }

  async updateWork(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const work = await worksService.updateWork(id, req.body);
      res.json(work);
    } catch (error) {
      next(error);
    }
  }

  async deleteWork(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await worksService.deleteWork(id);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
}
