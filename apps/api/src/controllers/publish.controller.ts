import { Request, Response, NextFunction } from 'express';
import { PublishService } from '../services/publish.service';

const publishService = new PublishService();

export class PublishController {
  async getPublishLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const { workId } = req.params;
      const logs = await publishService.getPublishLogsByWorkId(workId);
      res.json(logs);
    } catch (error) {
      next(error);
    }
  }

  async createPublishLog(req: Request, res: Response, next: NextFunction) {
    try {
      const { workId } = req.params;
      const log = await publishService.createPublishLog({
        ...req.body,
        work_id: workId
      });
      res.status(201).json(log);
    } catch (error) {
      next(error);
    }
  }

  async updatePublishLog(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const log = await publishService.updatePublishLog(id, req.body);
      res.json(log);
    } catch (error) {
      next(error);
    }
  }
}
