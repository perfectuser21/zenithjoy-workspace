import { Router, type Request, type Response } from 'express';
import pool from '../db/connection';
import { internalAuth } from '../middleware/internal-auth';

export const brainSprintStateRouter = Router();

brainSprintStateRouter.use(internalAuth);

// POST /api/brain/sprint-state — 写快照到 sprint_states
brainSprintStateRouter.post('/sprint-state', async (req: Request, res: Response) => {
  const { journey_id, sprint_id, snapshot } = req.body as {
    journey_id?: string;
    sprint_id?: string;
    snapshot?: object;
  };

  if (!journey_id || !sprint_id || !snapshot) {
    return res.status(400).json({
      success: false,
      data: null,
      error: { code: 'INVALID_BODY', message: 'journey_id, sprint_id, snapshot are required' },
    });
  }

  try {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO zenithjoy.sprint_states (journey_id, sprint_id, snapshot)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [journey_id, sprint_id, JSON.stringify(snapshot)]
    );
    return res.status(201).json({ success: true, data: { id: rows[0].id } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[brain/sprint-state] DB error:', msg);
    return res.status(500).json({ success: false, data: null, error: { code: 'DB_ERROR', message: msg } });
  }
});

// POST /api/brain/journey-steps — upsert step 状态
brainSprintStateRouter.post('/journey-steps', async (req: Request, res: Response) => {
  const { journey_id, step_id, step_order, status, shared, notion_page_id } = req.body as {
    journey_id?: string;
    step_id?: string;
    step_order?: number;
    status?: string;
    shared?: boolean;
    notion_page_id?: string;
  };

  if (!journey_id || !step_id || step_order === undefined || !status) {
    return res.status(400).json({
      success: false,
      data: null,
      error: { code: 'INVALID_BODY', message: 'journey_id, step_id, step_order, status are required' },
    });
  }

  try {
    await pool.query(
      `INSERT INTO zenithjoy.journey_steps (journey_id, step_id, step_order, status, shared, notion_page_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (journey_id, step_id) DO UPDATE
         SET step_order = EXCLUDED.step_order,
             status = EXCLUDED.status,
             shared = EXCLUDED.shared,
             notion_page_id = EXCLUDED.notion_page_id,
             updated_at = now()`,
      [journey_id, step_id, step_order, status, shared ?? false, notion_page_id ?? null]
    );
    return res.status(200).json({ success: true, data: { journey_id, step_id, status } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[brain/journey-steps] DB error:', msg);
    return res.status(500).json({ success: false, data: null, error: { code: 'DB_ERROR', message: msg } });
  }
});

// GET /api/brain/journey-steps?journey_id=xxx — 查询 step 列表，按 step_order 排序
brainSprintStateRouter.get('/journey-steps', async (req: Request, res: Response) => {
  const { journey_id } = req.query as { journey_id?: string };

  if (!journey_id) {
    return res.status(400).json({
      success: false,
      data: null,
      error: { code: 'INVALID_QUERY', message: 'journey_id query param is required' },
    });
  }

  try {
    const { rows } = await pool.query(
      `SELECT step_id, step_order, status, shared, notion_page_id
         FROM zenithjoy.journey_steps
        WHERE journey_id = $1
        ORDER BY step_order ASC`,
      [journey_id]
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[brain/journey-steps GET] DB error:', msg);
    return res.status(500).json({ success: false, data: null, error: { code: 'DB_ERROR', message: msg } });
  }
});
