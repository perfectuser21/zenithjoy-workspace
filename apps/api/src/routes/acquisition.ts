import { Router, Request, Response } from 'express';

export const acquisitionRouter = Router();

acquisitionRouter.get('/overview', (_req: Request, res: Response) => {
  res.json({
    enabled: true,
    feature: 'smart-acquisition',
    capabilities: ['overview'],
    version: '1.0.0',
  });
});
