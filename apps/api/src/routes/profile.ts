import { Router, Request, Response } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import pool from '../db/connection';
import { auth } from '../auth';

export const profileRouter = Router();

async function getAuthUserId(req: Request): Promise<string | null> {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    const id = session?.user?.id;
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

// GET /api/profile — 读画像
profileRouter.get('/', async (req: Request, res: Response) => {
  const userId = await getAuthUserId(req);
  if (!userId) return res.status(401).json({ error: { message: '未登录' } });

  const { rows } = await pool.query<{ industry: string; audience: string; style: string }>(
    `SELECT industry, audience, style FROM zenithjoy.user_profiles WHERE user_id = $1`,
    [userId],
  );
  if (rows.length === 0) return res.status(404).json({ error: { message: '画像未填写' } });
  return res.json(rows[0]);
});

// POST /api/profile — 写/更新画像（UPSERT）
profileRouter.post('/', async (req: Request, res: Response) => {
  const userId = await getAuthUserId(req);
  if (!userId) return res.status(401).json({ error: { message: '未登录' } });

  const { industry, audience, style } = req.body as { industry?: string; audience?: string; style?: string };
  if (!industry || !audience || !style) {
    return res.status(400).json({ error: { message: 'industry / audience / style 三个字段必填' } });
  }

  const { rows } = await pool.query<{ industry: string; audience: string; style: string }>(
    `INSERT INTO zenithjoy.user_profiles (user_id, industry, audience, style)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE
       SET industry = EXCLUDED.industry,
           audience = EXCLUDED.audience,
           style    = EXCLUDED.style,
           updated_at = now()
     RETURNING industry, audience, style`,
    [userId, industry, audience, style],
  );
  return res.status(201).json(rows[0]);
});
