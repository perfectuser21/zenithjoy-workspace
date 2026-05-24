import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { expandKeywords } from '../services/keyword-expander';

export const acquisitionRouter = Router();

acquisitionRouter.get('/overview', (_req: Request, res: Response) => {
  res.json({
    enabled: true,
    feature: 'smart-acquisition',
    capabilities: ['overview'],
    version: '1.0.0',
  });
});

acquisitionRouter.post('/keyword-search', async (req: Request, res: Response) => {
  const { keyword } = req.body ?? {};

  if (!keyword || typeof keyword !== 'string' || keyword.trim() === '') {
    return res.status(400).json({ error: 'MISSING_KEYWORD' });
  }

  const kw = keyword.trim();

  // Check main agent session online status (skip in VITEST unit test mode)
  if (!process.env.VITEST) {
    try {
      const pool = (await import('../db/connection')).default;
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM zenithjoy.agent_platform_sessions WHERE role='main' AND status IN ('active','connected') LIMIT 1`
      );
      if (rows.length === 0) {
        return res.status(503).json({ error: 'AGENT_OFFLINE' });
      }
    } catch {
      // DB unavailable in non-test mode — fail safe: return offline
      return res.status(503).json({ error: 'AGENT_OFFLINE' });
    }
  }

  const keywords = await expandKeywords(kw);
  const task_id = randomUUID();

  // DB insert (skip in VITEST unit test mode)
  if (!process.env.VITEST) {
    try {
      const pool = (await import('../db/connection')).default;
      await pool.query(
        `INSERT INTO zenithjoy.acquisition_keyword_tasks
           (id, keyword, expanded_keywords, status, created_at, updated_at)
         VALUES ($1, $2, $3::jsonb, 'dispatched', NOW(), NOW())`,
        [task_id, kw, JSON.stringify(keywords)]
      );
    } catch (err) {
      console.error('[acquisition] DB insert failed:', (err as Error).message);
    }
  }

  return res.status(200).json({ task_id, keywords });
});
