import { Request, Response } from 'express';
import { readFileSync, existsSync, statSync } from 'fs';
import { resolve, sep } from 'path';
import pool from '../db/connection';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { extractArticlePath, extractCopyPath, extractImageFiles } from '../services/langgraph-adapter';
import { BrainTaskError, PIPELINE_CAPABILITIES, registerPipelineTask } from '../services/pipeline-brain-tasks';

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

      if (!['solo-company-case', 'post'].includes(content_type)) {
        res.status(400).json(fail('CONTENT_TYPE_UNSUPPORTED', '当前仅支持案例内容流程')); return;
      }

      if (typeof topic_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(topic_id)) {
        res.status(400).json(fail('TOPIC_ID_REQUIRED','有效topic_id为必填')); return;
      }
      const client = await pool.connect();
      let pipelineRun: Record<string, unknown>;
      try {
        await client.query('BEGIN');
        // 只锁Topic，读取已有run不反向锁它，避免与Worker的run→Topic锁序相撞。
        const locked = await client.query('SELECT id,notebook_id FROM zenithjoy.topics WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[topic_id]);
        if (!locked.rows.length) { await client.query('ROLLBACK');res.status(404).json(fail('TOPIC_NOT_FOUND','选题不存在'));return; }
        const existing = await client.query('SELECT * FROM zenithjoy.pipeline_runs WHERE topic_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[topic_id]);
        if (existing.rows.length) pipelineRun=existing.rows[0];
        else {
          const pipelineId=randomUUID();
          const outputDir=resolve(process.env.CONTENT_OUTPUT_DIR || `${process.env.HOME}/content-output`,'runs',pipelineId);
          pipelineRun=(await client.query(`INSERT INTO zenithjoy.pipeline_runs
            (id,content_type,topic,topic_id,status,output_dir,triggered_by,notebook_id)
            VALUES ($7,$1,$2,$3,'pending',$4,$5,$6) RETURNING *`,
            [content_type,topic || null,topic_id,outputDir,triggered_by,locked.rows[0].notebook_id ?? null,pipelineId])).rows[0];
        }
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK');throw error; }
      finally { client.release(); }
      if (pipelineRun.cecelia_task_id) { res.status(200).json(ok(pipelineRun));return; }
      if (!['pending','failed'].includes(String(pipelineRun.status))) {
        res.status(409).json(fail('EXISTING_PIPELINE','选题已有工作单，请显式重跑',{pipeline_run_id:pipelineRun.id}));return;
      }
      await this.registerAndReply(pipelineRun,res,201);
    } catch (err) {
      console.error('[pipeline] trigger error:', err);
      res.status(500).json(fail('INTERNAL_ERROR', String(err)));
    }
  };

  private registerAndReply = async (run: Record<string, unknown>, res: Response, status: number): Promise<void> => {
    try {
      const taskId = await registerPipelineTask(run);
      const updated = await pool.query(`UPDATE zenithjoy.pipeline_runs SET cecelia_task_id=$1,status='pending',
        output_manifest=COALESCE(output_manifest,'{}'::jsonb)||jsonb_build_object('brain_dispatch','registered'),updated_at=NOW()
        WHERE id=$2 AND cecelia_task_id IS NULL AND status IN ('pending','failed') RETURNING *`, [taskId,run.id]);
      if (!updated.rows.length) {
        const current = await pool.query('SELECT * FROM zenithjoy.pipeline_runs WHERE id=$1', [run.id]);
        if (current.rows[0]?.cecelia_task_id !== taskId) throw new BrainTaskError('工作单绑定已变化',409);
        res.status(status).json(ok(current.rows[0])); return;
      }
      res.status(status).json(ok({ ...run,...updated.rows[0],cecelia_task_id:taskId,status:'pending' }));
    } catch (error) {
      const registrationStatus = error instanceof BrainTaskError ? error.registrationStatus : 'unknown';
      await pool.query(`UPDATE zenithjoy.pipeline_runs SET status=$1,
        output_manifest=COALESCE(output_manifest,'{}'::jsonb)||jsonb_build_object('brain_dispatch',$2::text),updated_at=NOW()
        WHERE id=$3 AND cecelia_task_id IS NULL`, [registrationStatus === 'unknown' ? 'pending' : 'failed',registrationStatus,run.id]);
      res.status(error instanceof BrainTaskError ? error.status : 502).json(fail('BRAIN_TASK_UNAVAILABLE','内容工作单挂号未确认',
        {pipeline_run_id:run.id,registration_status:registrationStatus}));
    }
  };

  register = async (req: Request, res: Response): Promise<void> => {
    try {
      const { rows } = await pool.query('SELECT * FROM zenithjoy.pipeline_runs WHERE id=$1', [req.params.id]);
      const run = rows[0];
      if (!run) { res.status(404).json(fail('NOT_FOUND','工作单不存在')); return; }
      if (run.cecelia_task_id) { res.status(200).json(ok(run)); return; }
      if (!['pending','failed'].includes(run.status)) { res.status(409).json(fail('PIPELINE_ACTIVE','工作单不可重新挂号')); return; }
      await this.registerAndReply(run,res,201);
    } catch { res.status(500).json(fail('INTERNAL_ERROR','无法读取工作单')); }
  };

  capabilities = (_req: Request, res: Response): void => { res.json(PIPELINE_CAPABILITIES); };

  getOne = async (req: Request, res: Response): Promise<void> => {
    try {
      const { rows } = await pool.query('SELECT * FROM zenithjoy.pipeline_runs WHERE id = $1', [req.params.id]);
      if (!rows.length) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(rows[0]);
    } catch { res.status(500).json(fail('INTERNAL_ERROR', '无法读取内容工作单')); }
  };

  list = async (_req: Request, res: Response): Promise<void> => {
    try {
      const { rows } = await pool.query('SELECT * FROM zenithjoy.pipeline_runs ORDER BY created_at DESC LIMIT 50');
      res.json(rows.map(row => ({ ...row, source: 'zenithjoy' })));
    } catch { res.status(500).json(fail('INTERNAL_ERROR', '无法读取内容工作单')); }
  };

  // 旧Brain业务回调已退出；终态只能由持有有效公共租约的Worker提交。
  callback = (_req: Request, res: Response): void => {
    res.status(410).json(fail('LEGACY_CALLBACK_RETIRED', '请使用公共任务认领与Worker回执'));
  };

  // GET /api/pipeline/:id/output  ← 本地读 pipeline_runs.output_manifest + 文件系统
  getOutput = async (req: Request, res: Response): Promise<void> => {
    try {
      const pipelineId = req.params.id;
      const { rows } = await pool.query(
        `SELECT id, topic, status, output_dir, output_manifest, topic_id, notebook_id, cecelia_task_id, updated_at
         FROM zenithjoy.pipeline_runs WHERE id = $1`,
        [pipelineId]
      );
      const row = rows[0] || null;

      if (!row) { res.status(404).json({ error: 'Not found' }); return; }
      const manifest: PipelineManifest | null = row.output_manifest || null;

      const outputDir: string | null = row.output_dir || null;

      // 若尚无 manifest（pipeline 还在跑或未产出）→ 返回 pending
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
        ? readFileIfExists(outputDir, extractArticlePath(manifest))
        : null;
      const cardsText = outputDir
        ? readFileIfExists(outputDir, extractCopyPath(manifest))
        : null;

      const files = extractImageFiles(manifest);
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

  // GET /api/pipeline/:id/stages  ← pipeline_runs.status + manifest.status + cecelia_events 兜底
  getStages = async (req: Request, res: Response): Promise<void> => {
    try {
      const pipelineId = req.params.id;
      const { rows } = await pool.query(
        `SELECT id, status, output_manifest, cecelia_task_id FROM zenithjoy.pipeline_runs WHERE id = $1`,
        [pipelineId]
      );
      const row = rows[0] || null;
      if (!row) { res.status(404).json({ error: 'Not found' }); return; }
      const manifest: PipelineManifest | null = row.output_manifest || null;
      res.json({
        stages: (manifest as PipelineManifest & { stages?: unknown })?.stages || {},
        overall_status: manifest?.status || row.status || 'pending',
        events: [],
      });
    } catch (err) {
      console.error('[pipeline] getStages error:', err);
      res.status(500).json({ error: String(err) });
    }
  };

  // 重跑创建新的本地工作单和Brain任务，不复用旧尝试或旧产物目录。
  rerun = async (req: Request, res: Response): Promise<void> => {
    let client: PoolClient | undefined;
    let run: Record<string, unknown>;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM zenithjoy.pipeline_runs WHERE id=$1 FOR UPDATE',[req.params.id]);
      const previous=rows[0];
      if (!previous) { await client.query('ROLLBACK');res.status(404).json(fail('NOT_FOUND','工作单不存在'));return; }
      if (!['completed','failed'].includes(previous.status)) { await client.query('ROLLBACK');res.status(409).json(fail('PIPELINE_ACTIVE','工作单仍在等待或执行'));return; }
      const prior=await client.query(`SELECT * FROM zenithjoy.pipeline_runs WHERE triggered_by=$1
        AND (status IN ('pending','running') OR cecelia_task_id IS NULL) ORDER BY created_at DESC LIMIT 1`,[`rerun:${previous.id}`]);
      if (prior.rows[0]?.cecelia_task_id) { await client.query('ROLLBACK');res.status(409).json(fail('RERUN_ACTIVE','重跑已登记'));return; }
      if (prior.rows[0]) run=prior.rows[0];
      else {
        const id=randomUUID();
        const outputDir=resolve(process.env.CONTENT_OUTPUT_DIR || `${process.env.HOME}/content-output`,'runs',id);
        run=(await client.query(`INSERT INTO zenithjoy.pipeline_runs
          (id,content_type,topic,topic_id,status,output_dir,triggered_by,notebook_id)
          VALUES ($1,$2,$3,$4,'pending',$5,$6,$7) RETURNING *`,
          [id,previous.content_type,previous.topic,previous.topic_id,outputDir,`rerun:${previous.id}`,previous.notebook_id])).rows[0];
      }
      await client.query('COMMIT');
    } catch { if (client) await client.query('ROLLBACK');res.status(500).json(fail('RERUN_UNAVAILABLE','重跑意图未登记'));return; }
    finally { client?.release(); }
    // 先持久保存本地意图，再调用远端；网络未知可以重试同一个run而不丢失身份。
    await this.registerAndReply(run,res,202);
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
