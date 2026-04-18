import { Request, Response } from 'express';
import { readFileSync, existsSync, statSync } from 'fs';
import { resolve, sep } from 'path';
import pool from '../db/connection';

const CECELIA_BRAIN_URL = process.env.CECELIA_BRAIN_URL || 'http://localhost:5221';

// 安全地把 baseDir + relPath 拼成绝对路径，并确保结果仍在 baseDir 内。
// 失败返回 null。
function safeJoin(baseDir: string, relPath: string): string | null {
  if (!baseDir || !relPath) return null;
  if (relPath.includes('\0')) return null;
  const normalizedBase = resolve(baseDir);
  const full = resolve(normalizedBase, relPath);
  if (full !== normalizedBase && !full.startsWith(normalizedBase + sep)) {
    return null;
  }
  return full;
}

function readFileIfExists(baseDir: string, relPath: string | undefined): string | null {
  if (!relPath) return null;
  const full = safeJoin(baseDir, relPath);
  if (!full) return null;
  try {
    if (!existsSync(full) || !statSync(full).isFile()) return null;
    return readFileSync(full, 'utf-8');
  } catch {
    return null;
  }
}

interface ManifestImageSet {
  files?: string[];
  status?: string;
  framework?: string;
}

interface PipelineManifest {
  status?: string;
  keyword?: string;
  article?: { path?: string; status?: string };
  copy?: { path?: string; status?: string };
  image_set?: ManifestImageSet;
  platforms?: Record<string, string[]>;
  version?: string;
  pipeline_id?: string;
  content_type?: string;
  created_at?: string;
}

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

  // GET /api/pipeline/:id/output  ← 本地读 pipeline_runs.output_manifest + 文件系统
  getOutput = async (req: Request, res: Response): Promise<void> => {
    try {
      const pipelineId = req.params.id;
      const { rows } = await pool.query(
        `SELECT id, topic, status, output_dir, output_manifest, topic_id, notebook_id, cecelia_task_id
         FROM zenithjoy.pipeline_runs WHERE id = $1`,
        [pipelineId]
      );
      if (!rows.length) { res.status(404).json({ error: 'Not found' }); return; }

      const row = rows[0];
      const manifest: PipelineManifest | null = row.output_manifest || null;
      const outputDir: string | null = row.output_dir || null;

      // 若尚无 manifest（pipeline 还在跑或未产出）→ 返回 pending，不回退到 cecelia
      if (!manifest) {
        res.json({
          output: {
            pipeline_id: row.id,
            keyword: row.topic || '',
            status: row.status || 'pending',
            article_text: null,
            cards_text: null,
            image_urls: [],
            export_path: outputDir,
            images: null,
          },
        });
        return;
      }

      // 读正文
      const articleText = outputDir
        ? readFileIfExists(outputDir, manifest.article?.path)
        : null;
      const cardsText = outputDir
        ? readFileIfExists(outputDir, manifest.copy?.path)
        : null;

      const files = manifest.image_set?.files || [];
      // v=updated_at 作为 cache buster，绕开 Cloudflare 对旧 404 的 4h cache
      const cacheBuster = row.updated_at ? new Date(row.updated_at).getTime() : Date.now();
      const imageUrls = files.map((f) => ({
        type: f.toLowerCase().includes('cover') ? 'cover' : 'card',
        url: `/api/content-images/${row.id}/${encodeURIComponent(f)}?v=${cacheBuster}`,
      }));

      res.json({
        output: {
          pipeline_id: row.id,
          keyword: manifest.keyword || row.topic || '',
          status: manifest.status || row.status || 'unknown',
          article_text: articleText,
          cards_text: cardsText,
          image_urls: imageUrls,
          export_path: outputDir,
          images: manifest.image_set || null,
        },
      });
    } catch (err) {
      console.error('[pipeline] getOutput error:', err);
      res.status(500).json({ error: String(err) });
    }
  };

  // GET /api/pipeline/:id/stages  ← 本地读 pipeline_runs.status + manifest.status
  getStages = async (req: Request, res: Response): Promise<void> => {
    try {
      const pipelineId = req.params.id;
      const { rows } = await pool.query(
        `SELECT id, status, output_manifest FROM zenithjoy.pipeline_runs WHERE id = $1`,
        [pipelineId]
      );
      if (!rows.length) { res.status(404).json({ error: 'Not found' }); return; }

      const row = rows[0];
      const manifest: PipelineManifest | null = row.output_manifest || null;

      // 暂时不追踪每个阶段的单独状态（未来可扩展 pipeline_stages 表）
      // 先返回 overall status，供前端兜底显示
      res.json({
        stages: {},
        overall_status: manifest?.status || row.status || 'pending',
      });
    } catch (err) {
      console.error('[pipeline] getStages error:', err);
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
