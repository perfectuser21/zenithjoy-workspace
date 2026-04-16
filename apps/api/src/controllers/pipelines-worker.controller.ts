/**
 * Pipelines Worker Controller — 专供 pipeline-worker (Python) 调用
 *
 * 对应端点：
 *   GET  /api/pipelines/running                      列出所有 running pipeline + topic 关联
 *   POST /api/pipelines/:id/stage-complete           阶段完成上报（含 is_final 终态处理）
 *   POST /api/pipelines/:id/fail                     整个 pipeline 失败上报
 *
 * 响应格式：{ success, data, error, timestamp }
 *
 * 核心 SQL 参考：/tmp/pipeline-migration-plan/02-api-contract.md § 8/9/10
 */

import { Request, Response } from 'express';
import pool from '../db/connection';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_STAGES = [
  'research',
  'copywriting',
  'copy_review',
  'generate',
  'image_review',
  'export',
] as const;
type Stage = (typeof VALID_STAGES)[number];

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

export class PipelinesWorkerController {
  // GET /api/pipelines/running
  running = async (req: Request, res: Response): Promise<void> => {
    try {
      let limit = parseInt((req.query.limit as string) || '50', 10);
      if (isNaN(limit) || limit < 1) limit = 50;
      if (limit > 500) limit = 500;

      const { rows } = await pool.query(
        `SELECT pr.id, pr.topic_id, pr.status,
                pr.created_at, pr.updated_at,
                pr.content_type, pr.topic, pr.output_dir, pr.triggered_by,
                pr.output_manifest,
                pr.cecelia_task_id,
                t.title AS keyword, t.angle, t.status AS topic_status
         FROM zenithjoy.pipeline_runs pr
         LEFT JOIN zenithjoy.topics t
                ON pr.topic_id IS NOT NULL
               AND pr.topic_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               AND t.id = pr.topic_id::uuid
         WHERE pr.status = 'running'
         ORDER BY pr.created_at ASC
         LIMIT $1`,
        [limit]
      );
      res.json(ok({ items: rows, total: rows.length }));
    } catch (e) {
      console.error('[pipelines-worker] running error:', e);
      res.status(500).json(err('INTERNAL_ERROR', String(e)));
    }
  };

  // POST /api/pipelines/:id/stage-complete
  stageComplete = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      if (!UUID_REGEX.test(id)) {
        res.status(400).json(err('INVALID_ID', 'id 必须是 UUID'));
        return;
      }

      const { stage, output, is_final } = req.body || {};

      if (!stage) {
        res.status(400).json(err('STAGE_REQUIRED', 'stage 为必填字段'));
        return;
      }
      if (!VALID_STAGES.includes(stage as Stage)) {
        res.status(400).json(err('STAGE_INVALID', `stage 必须是 ${VALID_STAGES.join('/')} 之一`));
        return;
      }

      const isFinal = Boolean(is_final) && stage === 'export';

      // 查当前 pipeline 存在性
      const cur = await pool.query(
        'SELECT id, status, topic_id FROM zenithjoy.pipeline_runs WHERE id = $1',
        [id]
      );
      if (!cur.rows.length) {
        res.status(404).json(err('NOT_FOUND', `pipeline ${id} 不存在`));
        return;
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        if (isFinal) {
          const { rows } = await client.query(
            `UPDATE zenithjoy.pipeline_runs
             SET status = 'completed',
                 output_manifest = COALESCE($1::jsonb, output_manifest),
                 updated_at = NOW()
             WHERE id = $2
             RETURNING *`,
            [output ? JSON.stringify(output) : null, id]
          );

          // 若 topic_id 指向合法 topic，同步置为 '待发布'
          const topicId = rows[0]?.topic_id;
          if (topicId && UUID_REGEX.test(String(topicId))) {
            await client.query(
              `UPDATE zenithjoy.topics
               SET status = '待发布'
               WHERE id = $1::uuid AND deleted_at IS NULL`,
              [topicId]
            );
          }

          await client.query('COMMIT');
          res.json(ok({ id: rows[0].id, status: 'completed', topic_id: topicId ?? null }));
          return;
        }

        // 非终态：仅 touch updated_at（current_stage 字段在 pipeline_runs 暂未有列，按幂等策略）
        const { rows } = await client.query(
          `UPDATE zenithjoy.pipeline_runs
           SET updated_at = NOW(),
               status = CASE WHEN status = 'pending' THEN 'running' ELSE status END
           WHERE id = $1
           RETURNING id, status`,
          [id]
        );
        await client.query('COMMIT');
        res.json(ok({ id: rows[0].id, status: rows[0].status, stage }));
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }
    } catch (e) {
      console.error('[pipelines-worker] stageComplete error:', e);
      res.status(500).json(err('INTERNAL_ERROR', String(e)));
    }
  };

  // POST /api/pipelines/:id/fail
  fail = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      if (!UUID_REGEX.test(id)) {
        res.status(400).json(err('INVALID_ID', 'id 必须是 UUID'));
        return;
      }

      const { error: errorMessage, stage } = req.body || {};
      if (!errorMessage || typeof errorMessage !== 'string') {
        res.status(400).json(err('ERROR_REQUIRED', 'error 字段必填（字符串）'));
        return;
      }
      if (stage !== undefined && !VALID_STAGES.includes(stage as Stage)) {
        res.status(400).json(err('STAGE_INVALID', `stage 必须是 ${VALID_STAGES.join('/')} 之一`));
        return;
      }

      // 把 error 写入 output_manifest.error（pipeline_runs 目前没有 error_message 列）
      const { rows } = await pool.query(
        `UPDATE zenithjoy.pipeline_runs
         SET status = 'failed',
             output_manifest = COALESCE(output_manifest, '{}'::jsonb) ||
                               jsonb_build_object('error', $1::text, 'failed_stage', $2::text),
             updated_at = NOW()
         WHERE id = $3
         RETURNING id, status, output_manifest`,
        [errorMessage, stage || null, id]
      );
      if (!rows.length) {
        res.status(404).json(err('NOT_FOUND', `pipeline ${id} 不存在`));
        return;
      }
      res.json(ok({ id: rows[0].id, status: rows[0].status, error: errorMessage, stage: stage || null }));
    } catch (e) {
      console.error('[pipelines-worker] fail error:', e);
      res.status(500).json(err('INTERNAL_ERROR', String(e)));
    }
  };
}
