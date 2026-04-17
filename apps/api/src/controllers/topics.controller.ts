/**
 * Topics Controller — 选题池 CRUD
 *
 * 对应端点：
 *   GET    /api/topics            list（分页 + status 过滤）
 *   GET    /api/topics/:id        单条
 *   POST   /api/topics            创建
 *   PATCH  /api/topics/:id        部分更新
 *   DELETE /api/topics/:id        软删/硬删
 *
 * 响应格式：{ success, data, error, timestamp } — 见 02-api-contract.md
 */

import { Request, Response } from 'express';
import pool from '../db/connection';

const VALID_STATUSES = [
  '待研究',
  '已通过',
  '研究中',
  '待发布',
  '已发布',
  '已拒绝',
] as const;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ok<T>(data: T) {
  return {
    success: true,
    data,
    error: null,
    timestamp: new Date().toISOString(),
  };
}

function err(code: string, message: string, details?: unknown) {
  return {
    success: false,
    data: null,
    error: { code, message, details: details ?? {} },
    timestamp: new Date().toISOString(),
  };
}

export class TopicsController {
  // GET /api/topics
  list = async (req: Request, res: Response): Promise<void> => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : null;
      const includeDeleted = req.query.include_deleted === 'true';
      let limit = parseInt((req.query.limit as string) || '50', 10);
      const offset = parseInt((req.query.offset as string) || '0', 10);
      if (isNaN(limit) || limit < 1) limit = 50;
      if (limit > 500) limit = 500;

      if (status && !VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
        res.status(400).json(err('INVALID_STATUS', `status 必须是 ${VALID_STATUSES.join(' / ')} 之一`));
        return;
      }

      const where: string[] = [];
      const params: unknown[] = [];
      if (!includeDeleted) {
        where.push('deleted_at IS NULL');
      }
      if (status) {
        params.push(status);
        where.push(`status = $${params.length}`);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      // total
      const totalRes = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM zenithjoy.topics ${whereSql}`,
        params
      );
      const total = parseInt(totalRes.rows[0]?.count || '0', 10);

      params.push(limit);
      const limitPlace = `$${params.length}`;
      params.push(offset);
      const offsetPlace = `$${params.length}`;

      const { rows } = await pool.query(
        `SELECT * FROM zenithjoy.topics
         ${whereSql}
         ORDER BY priority ASC, created_at DESC
         LIMIT ${limitPlace} OFFSET ${offsetPlace}`,
        params
      );

      res.json(ok({ items: rows, total, limit, offset }));
    } catch (e) {
      console.error('[topics] list error:', e);
      res.status(500).json(err('INTERNAL_ERROR', String(e)));
    }
  };

  // GET /api/topics/:id
  getOne = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      if (!UUID_REGEX.test(id)) {
        res.status(400).json(err('INVALID_ID', 'id 必须是 UUID'));
        return;
      }
      const { rows } = await pool.query('SELECT * FROM zenithjoy.topics WHERE id = $1', [id]);
      if (!rows.length) {
        res.status(404).json(err('NOT_FOUND', `topic ${id} 不存在`));
        return;
      }
      res.json(ok(rows[0]));
    } catch (e) {
      console.error('[topics] getOne error:', e);
      res.status(500).json(err('INTERNAL_ERROR', String(e)));
    }
  };

  // POST /api/topics
  create = async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        title,
        angle = null,
        priority = 100,
        status = '待研究',
        target_platforms,
        scheduled_date = null,
        notebook_id = null,
      } = req.body || {};

      if (!title || typeof title !== 'string' || title.trim().length === 0) {
        res.status(400).json(err('TITLE_REQUIRED', 'title 为必填字段'));
        return;
      }
      if (title.length > 500) {
        res.status(400).json(err('TITLE_TOO_LONG', 'title 长度不能超过 500'));
        return;
      }
      if (!VALID_STATUSES.includes(status)) {
        res.status(400).json(err('INVALID_STATUS', `status 必须是 ${VALID_STATUSES.join(' / ')} 之一`));
        return;
      }
      if (typeof priority !== 'number' || priority < 0 || priority > 999) {
        res.status(400).json(err('INVALID_PRIORITY', 'priority 必须是 0-999 的整数'));
        return;
      }
      // notebook_id：可选、字符串、长度 <=100
      let notebookIdClean: string | null = null;
      if (notebook_id !== null && notebook_id !== undefined && notebook_id !== '') {
        if (typeof notebook_id !== 'string' || notebook_id.length > 100) {
          res.status(400).json(err('INVALID_NOTEBOOK_ID', 'notebook_id 必须是长度 ≤100 的字符串或 null'));
          return;
        }
        notebookIdClean = notebook_id.trim();
      }

      const platforms =
        target_platforms === undefined || target_platforms === null
          ? null
          : Array.isArray(target_platforms)
            ? JSON.stringify(target_platforms)
            : null;

      const { rows } = await pool.query(
        `INSERT INTO zenithjoy.topics (title, angle, priority, status, target_platforms, scheduled_date, notebook_id)
         VALUES (
           $1, $2, $3, $4,
           COALESCE($5::jsonb, '["xiaohongshu","douyin","kuaishou","shipinhao","x","toutiao","weibo","wechat"]'::jsonb),
           $6::date,
           $7
         )
         RETURNING *`,
        [title.trim(), angle, priority, status, platforms, scheduled_date, notebookIdClean]
      );

      res.status(201).json(ok(rows[0]));
    } catch (e) {
      console.error('[topics] create error:', e);
      res.status(500).json(err('INTERNAL_ERROR', String(e)));
    }
  };

  // PATCH /api/topics/:id
  patch = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      if (!UUID_REGEX.test(id)) {
        res.status(400).json(err('INVALID_ID', 'id 必须是 UUID'));
        return;
      }

      const body = req.body || {};
      const sets: string[] = [];
      const params: unknown[] = [];

      if (body.title !== undefined) {
        if (typeof body.title !== 'string' || !body.title.trim()) {
          res.status(400).json(err('INVALID_TITLE', 'title 不能为空'));
          return;
        }
        params.push(body.title.trim());
        sets.push(`title = $${params.length}`);
      }
      if (body.angle !== undefined) {
        params.push(body.angle);
        sets.push(`angle = $${params.length}`);
      }
      if (body.priority !== undefined) {
        if (typeof body.priority !== 'number' || body.priority < 0 || body.priority > 999) {
          res.status(400).json(err('INVALID_PRIORITY', 'priority 必须是 0-999 的整数'));
          return;
        }
        params.push(body.priority);
        sets.push(`priority = $${params.length}`);
      }
      if (body.status !== undefined) {
        if (!VALID_STATUSES.includes(body.status)) {
          res.status(400).json(err('INVALID_STATUS', `status 必须是 ${VALID_STATUSES.join(' / ')} 之一`));
          return;
        }
        params.push(body.status);
        sets.push(`status = $${params.length}`);
      }
      if (body.target_platforms !== undefined) {
        if (!Array.isArray(body.target_platforms)) {
          res.status(400).json(err('INVALID_PLATFORMS', 'target_platforms 必须是数组'));
          return;
        }
        params.push(JSON.stringify(body.target_platforms));
        sets.push(`target_platforms = $${params.length}::jsonb`);
      }
      if (body.scheduled_date !== undefined) {
        params.push(body.scheduled_date);
        sets.push(`scheduled_date = $${params.length}::date`);
      }
      if (body.pipeline_id !== undefined) {
        if (body.pipeline_id !== null && !UUID_REGEX.test(body.pipeline_id)) {
          res.status(400).json(err('INVALID_PIPELINE_ID', 'pipeline_id 必须是 UUID 或 null'));
          return;
        }
        params.push(body.pipeline_id);
        sets.push(`pipeline_id = $${params.length}`);
      }
      if (body.published_at !== undefined) {
        params.push(body.published_at);
        sets.push(`published_at = $${params.length}::timestamptz`);
      }
      if (body.notebook_id !== undefined) {
        if (body.notebook_id !== null && body.notebook_id !== '') {
          if (typeof body.notebook_id !== 'string' || body.notebook_id.length > 100) {
            res.status(400).json(err('INVALID_NOTEBOOK_ID', 'notebook_id 必须是长度 ≤100 的字符串或 null'));
            return;
          }
          params.push(body.notebook_id.trim());
        } else {
          params.push(null);
        }
        sets.push(`notebook_id = $${params.length}`);
      }

      if (!sets.length) {
        res.status(400).json(err('NO_FIELDS', '至少提供一个可更新字段'));
        return;
      }

      params.push(id);
      const { rows } = await pool.query(
        `UPDATE zenithjoy.topics SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params
      );
      if (!rows.length) {
        res.status(404).json(err('NOT_FOUND', `topic ${id} 不存在`));
        return;
      }
      res.json(ok(rows[0]));
    } catch (e) {
      console.error('[topics] patch error:', e);
      res.status(500).json(err('INTERNAL_ERROR', String(e)));
    }
  };

  // DELETE /api/topics/:id
  remove = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      if (!UUID_REGEX.test(id)) {
        res.status(400).json(err('INVALID_ID', 'id 必须是 UUID'));
        return;
      }
      const hard = req.query.hard === 'true';

      if (hard) {
        const { rowCount } = await pool.query('DELETE FROM zenithjoy.topics WHERE id = $1', [id]);
        if (!rowCount) {
          res.status(404).json(err('NOT_FOUND', `topic ${id} 不存在`));
          return;
        }
        res.json(ok({ id, deleted: true, hard: true }));
        return;
      }

      // 软删
      const { rows } = await pool.query(
        `UPDATE zenithjoy.topics SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
        [id]
      );
      if (!rows.length) {
        // 区分：不存在 vs 已软删
        const check = await pool.query('SELECT id FROM zenithjoy.topics WHERE id = $1', [id]);
        if (!check.rows.length) {
          res.status(404).json(err('NOT_FOUND', `topic ${id} 不存在`));
          return;
        }
      }
      res.json(ok({ id, deleted: true, hard: false }));
    } catch (e) {
      console.error('[topics] remove error:', e);
      res.status(500).json(err('INTERNAL_ERROR', String(e)));
    }
  };
}
