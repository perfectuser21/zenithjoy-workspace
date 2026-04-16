/**
 * Pacing Config Controller
 *
 * 对应端点：
 *   GET   /api/pacing-config     读取所有 key-value（含 daily_limit）
 *   PATCH /api/pacing-config     修改 daily_limit 等
 *
 * 响应格式：{ success, data, error, timestamp }
 */

import { Request, Response } from 'express';
import pool from '../db/connection';

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

export class PacingConfigController {
  // GET /api/pacing-config
  get = async (_req: Request, res: Response): Promise<void> => {
    try {
      const { rows } = await pool.query<{ key: string; value: string }>(
        'SELECT key, value FROM zenithjoy.pacing_config'
      );
      const data: Record<string, number | string> = {};
      for (const row of rows) {
        // 约定：daily_limit 等数值型字段存 TEXT，返回时转 int
        const asInt = parseInt(row.value, 10);
        data[row.key] = isNaN(asInt) ? row.value : asInt;
      }
      // 缺省保底
      if (data.daily_limit === undefined) {
        data.daily_limit = 1;
      }
      res.json(ok(data));
    } catch (e) {
      console.error('[pacing] get error:', e);
      res.status(500).json(err('INTERNAL_ERROR', String(e)));
    }
  };

  // PATCH /api/pacing-config
  patch = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body || {};

      if (body.daily_limit === undefined) {
        res.status(400).json(err('NO_FIELDS', '至少提供一个可更新字段（如 daily_limit）'));
        return;
      }

      const limit = body.daily_limit;
      if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 0 || limit > 100) {
        res.status(400).json(err('INVALID_DAILY_LIMIT', 'daily_limit 必须是 0-100 的整数'));
        return;
      }

      await pool.query(
        `INSERT INTO zenithjoy.pacing_config (key, value, updated_at)
         VALUES ('daily_limit', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [String(limit)]
      );

      res.json(ok({ daily_limit: limit }));
    } catch (e) {
      console.error('[pacing] patch error:', e);
      res.status(500).json(err('INTERNAL_ERROR', String(e)));
    }
  };
}
