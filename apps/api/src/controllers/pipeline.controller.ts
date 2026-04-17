import { Request, Response } from 'express';
import pool from '../db/connection';

const CECELIA_BRAIN_URL = process.env.CECELIA_BRAIN_URL || 'http://localhost:5221';

// PR-e/5: 统一响应契约 { success, data, error, timestamp }
function ok<T>(data: T) {
  return { success: true, data, error: null, timestamp: new Date().toISOString() };
}

function fail(code: string, message: string, details?: unknown) {
  return {
    success: false,
    data: null,
    error: { code, message, details: details ?? {} },
    timestamp: new Date().toISOString(),
  };
}

export class PipelineController {
  // POST /api/pipeline/trigger
  trigger = async (req: Request, res: Response): Promise<void> => {
    try {
      const { content_type, topic, topic_id, triggered_by = 'manual' } = req.body;
      if (!content_type) {
        res.status(400).json(fail('CONTENT_TYPE_REQUIRED', 'content_type 为必填字段'));
        return;
      }

      // 选题池 v1：拒绝无 topic_id 的请求；除非 X-Manual-Override: true
      const manualOverride = (req.headers['x-manual-override'] || '').toString().toLowerCase() === 'true';
      if (!topic_id && !manualOverride) {
        res.status(400).json(
          fail(
            'TOPIC_ID_REQUIRED',
            'topic_id 为必填（选题池 v1 强校验）。如确需手动创建，请加 header X-Manual-Override: true'
          )
        );
        return;
      }

      const outputDir = process.env.CONTENT_OUTPUT_DIR || `${process.env.HOME}/content-output`;

      // 阶段 A+：从 topic 复制 notebook_id 到 pipeline_runs，方便 pipeline-worker 直接读
      let notebookId: string | null = null;
      if (topic_id) {
        try {
          const { rows: topicRows } = await pool.query<{ notebook_id: string | null }>(
            'SELECT notebook_id FROM zenithjoy.topics WHERE id = $1 AND deleted_at IS NULL',
            [topic_id]
          );
          notebookId = topicRows[0]?.notebook_id ?? null;
        } catch (lookupErr) {
          // 查询失败不阻断 pipeline 创建（worker 会 fallback 到 env），仅记录
          console.warn('[pipeline] trigger 查 topic.notebook_id 失败（忽略，继续）:', lookupErr);
        }
      }

      // 在 zenithjoy DB 创建 pipeline_run 记录
      const { rows } = await pool.query(
        `INSERT INTO zenithjoy.pipeline_runs (content_type, topic, topic_id, status, output_dir, triggered_by, notebook_id)
         VALUES ($1, $2, $3, 'pending', $4, $5, $6) RETURNING *`,
        [content_type, topic || null, topic_id || null, outputDir, triggered_by, notebookId]
      );
      const pipelineRun = rows[0];

      // 调 cecelia Brain 创建 task
      const ceceliaRes = await fetch(`${CECELIA_BRAIN_URL}/api/brain/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Content Pipeline: ${content_type}${topic ? ' - ' + topic : ''}`,
          task_type: 'content-pipeline',
          priority: 'P2',
          payload: {
            content_type,
            topic,
            output_dir: outputDir,
            zenithjoy_pipeline_run_id: pipelineRun.id,
            callback_url: `${process.env.ZENITHJOY_API_URL || 'http://localhost:5200'}/api/pipeline/callback`,
          },
        }),
      });

      if (!ceceliaRes.ok) {
        const err = await ceceliaRes.text();
        // cecelia 调用失败 → 更新状态为 failed
        await pool.query(
          `UPDATE zenithjoy.pipeline_runs SET status = 'failed', updated_at = NOW() WHERE id = $1`,
          [pipelineRun.id]
        );
        res.status(502).json(fail('CECELIA_CALL_FAILED', `cecelia Brain 调用失败: ${err}`));
        return;
      }

      const ceceliaTask = (await ceceliaRes.json()) as { id: string };
      // 记录 cecelia task id
      await pool.query(
        `UPDATE zenithjoy.pipeline_runs SET cecelia_task_id = $1, status = 'running', updated_at = NOW() WHERE id = $2`,
        [ceceliaTask.id, pipelineRun.id]
      );

      res.status(201).json(ok({ ...pipelineRun, cecelia_task_id: ceceliaTask.id, status: 'running' }));
    } catch (err) {
      console.error('[pipeline] trigger error:', err);
      res.status(500).json(fail('INTERNAL_ERROR', String(err)));
    }
  };

  // GET /api/pipeline/:id
  getOne = async (req: Request, res: Response): Promise<void> => {
    try {
      const { rows } = await pool.query(
        'SELECT * FROM zenithjoy.pipeline_runs WHERE id = $1',
        [req.params.id]
      );
      if (!rows.length) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  };

  // GET /api/pipeline (list, recent 50)
  list = async (_req: Request, res: Response): Promise<void> => {
    try {
      const { rows } = await pool.query(
        'SELECT * FROM zenithjoy.pipeline_runs ORDER BY created_at DESC LIMIT 50'
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  };

  // POST /api/pipeline/callback  ← cecelia 回调
  callback = async (req: Request, res: Response): Promise<void> => {
    try {
      const { zenithjoy_pipeline_run_id, cecelia_task_id, status, output_manifest } = req.body;
      const runId = zenithjoy_pipeline_run_id;
      if (!runId) { res.status(400).json({ error: 'zenithjoy_pipeline_run_id 为必填' }); return; }

      const dbStatus = status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'running';
      await pool.query(
        `UPDATE zenithjoy.pipeline_runs
         SET status = $1, output_manifest = $2, cecelia_task_id = COALESCE($3, cecelia_task_id), updated_at = NOW()
         WHERE id = $4`,
        [dbStatus, output_manifest ? JSON.stringify(output_manifest) : null, cecelia_task_id || null, runId]
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  };

  // GET /api/pipeline/:id/output  ← 透传到 cecelia
  getOutput = async (req: Request, res: Response): Promise<void> => {
    try {
      const { rows } = await pool.query(
        'SELECT cecelia_task_id FROM zenithjoy.pipeline_runs WHERE id = $1',
        [req.params.id]
      );
      if (!rows.length) { res.status(404).json({ error: 'Not found' }); return; }
      const ceceliaTaskId = rows[0].cecelia_task_id;
      if (!ceceliaTaskId) { res.status(404).json({ error: '尚无 cecelia task' }); return; }
      const upstream = await fetch(`${CECELIA_BRAIN_URL}/api/brain/pipelines/${ceceliaTaskId}/output`);
      if (!upstream.ok) { res.status(upstream.status).json({ error: 'upstream error' }); return; }
      res.json(await upstream.json());
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  };

  // GET /api/pipeline/:id/stages  ← 透传到 cecelia
  getStages = async (req: Request, res: Response): Promise<void> => {
    try {
      const { rows } = await pool.query(
        'SELECT cecelia_task_id FROM zenithjoy.pipeline_runs WHERE id = $1',
        [req.params.id]
      );
      if (!rows.length) { res.status(404).json({ error: 'Not found' }); return; }
      const ceceliaTaskId = rows[0].cecelia_task_id;
      if (!ceceliaTaskId) { res.json({ stages: {} }); return; }
      const upstream = await fetch(`${CECELIA_BRAIN_URL}/api/brain/pipelines/${ceceliaTaskId}/stages`);
      if (!upstream.ok) { res.json({ stages: {} }); return; }
      res.json(await upstream.json());
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  };

  // POST /api/pipeline/:id/rerun  ← 透传到 cecelia
  rerun = async (req: Request, res: Response): Promise<void> => {
    try {
      const { rows } = await pool.query(
        'SELECT cecelia_task_id FROM zenithjoy.pipeline_runs WHERE id = $1',
        [req.params.id]
      );
      if (!rows.length) { res.status(404).json({ error: 'Not found' }); return; }
      const ceceliaTaskId = rows[0].cecelia_task_id;
      if (!ceceliaTaskId) { res.status(400).json({ error: '尚无 cecelia task，无法重跑' }); return; }
      const upstream = await fetch(`${CECELIA_BRAIN_URL}/api/brain/pipelines/${ceceliaTaskId}/run`, { method: 'POST' });
      if (!upstream.ok) { res.status(upstream.status).json({ error: 'upstream error' }); return; }
      res.json(await upstream.json());
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  };

  // GET /api/pipeline/dashboard-stats
  dashboardStats = async (_req: Request, res: Response): Promise<void> => {
    try {
      const { rows } = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending')   AS pending,
          COUNT(*) FILTER (WHERE status = 'running')   AS running,
          COUNT(*) FILTER (WHERE status = 'completed') AS completed,
          COUNT(*) FILTER (WHERE status = 'failed')    AS failed,
          COUNT(*) AS total
        FROM zenithjoy.pipeline_runs
        WHERE created_at >= (NOW() AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai')::date
      `);
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  };
}
