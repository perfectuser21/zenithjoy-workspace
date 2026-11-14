/** 内容Worker只执行已由Brain认领的工作单；本地状态保存业务产物，不替代Brain租约。 */
import { Request, Response } from 'express';
import type { PoolClient } from 'pg';
import { resolve } from 'node:path';
import pool from '../db/connection';
import { BrainTaskError, PIPELINE_STAGES, UUID_RE, readBrainClaim, sameBrainClaim, validateBrainLease, confirmBrainFinish, resultDigest, BrainClaim } from '../services/pipeline-brain-tasks';
const ok = (data: unknown) => ({ success: true, data, error: null, timestamp: new Date().toISOString() });
const err = (code: string, message: string) => ({ success: false, data: null, error: { code, message }, timestamp: new Date().toISOString() });
const conflict = () => new BrainTaskError('工作单或认领身份已变化', 409);
function identityOf(req: Request): BrainClaim {
  const identity = readBrainClaim(req.body);
  if (!UUID_RE.test(req.params.id) || !identity) throw new BrainTaskError('有效工作单和Brain认领身份必填', 400);
  return identity;
}
function handleError(res: Response, error: unknown): void {
  res.status(error instanceof BrainTaskError ? error.status : 500).json(err('PIPELINE_HANDOFF_REJECTED', error instanceof BrainTaskError ? error.message : '内容工作单更新失败'));
}
export class PipelinesWorkerController {
  running = async (req: Request, res: Response): Promise<void> => {
    try {
      const limit = Math.max(1, Math.min(500, Number.parseInt(String(req.query.limit || '50'), 10) || 50));
      const offset = Math.max(0, Math.min(1_000_000, Number.parseInt(String(req.query.offset || '0'),10) || 0));
      const { rows } = await pool.query(`SELECT pr.id, pr.topic_id, pr.status, pr.created_at, pr.updated_at,
        pr.content_type, pr.topic, pr.output_dir, pr.triggered_by, pr.output_manifest, pr.cecelia_task_id,
        t.title AS topic_title, t.angle AS topic_angle, t.status AS topic_status,
        t.target_platforms AS topic_platforms, COALESCE(t.title,pr.topic) AS keyword,
        COALESCE(pr.notebook_id,t.notebook_id) AS notebook_id
        FROM zenithjoy.pipeline_runs pr LEFT JOIN zenithjoy.topics t ON pr.topic_id=t.id
        WHERE pr.status IN ('pending','running') AND pr.cecelia_task_id IS NOT NULL
        ORDER BY CASE WHEN pr.status='pending' THEN 0 ELSE 1 END,pr.created_at ASC,pr.id ASC LIMIT $1 OFFSET $2`, [limit,offset]);
      res.json(ok({ items: rows, total: rows.length, next_offset: rows.length === limit ? offset + limit : null }));
    } catch (error) { handleError(res, error); }
  };

  claim = async (req: Request, res: Response): Promise<void> => {
    let client: PoolClient | undefined;
    try {
      const identity = identityOf(req);
      await validateBrainLease(identity);
      client = await pool.connect();
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM zenithjoy.pipeline_runs WHERE id=$1 FOR UPDATE', [req.params.id]);
      const row = rows[0];
      if (!row || row.cecelia_task_id !== identity.brain_task_id || !['pending', 'running'].includes(row.status)) throw conflict();
      const prior = row.output_manifest?.brain_claim;
      if (prior && !sameBrainClaim(prior, identity)) throw conflict();
      const manifest = { ...(row.output_manifest || {}), brain_claim: identity };
      await client.query(`UPDATE zenithjoy.pipeline_runs SET status='running',output_manifest=$1::jsonb,updated_at=NOW()
        WHERE id=$2 AND cecelia_task_id=$3`, [JSON.stringify(manifest), row.id, identity.brain_task_id]);
      if (row.topic_id) await client.query(`UPDATE zenithjoy.topics SET status='研究中',pipeline_id=$1
        WHERE id=$2 AND deleted_at IS NULL`, [row.id, row.topic_id]);
      await client.query('COMMIT');
      res.json(ok({ id: row.id, status: 'running', brain_claim: identity }));
    } catch (error) { if (client) await client.query('ROLLBACK'); handleError(res, error); }
    finally { client?.release(); }
  };

  stageComplete = async (req: Request, res: Response): Promise<void> => {
    try {
      const identity = identityOf(req);
      const { stage, output, is_final: isFinal } = req.body || {};
      if (!PIPELINE_STAGES.includes(stage) || (isFinal && stage !== 'export')) throw new BrainTaskError('阶段无效', 400);
      if (isFinal) {
        const result = { pipeline_id: req.params.id, output_manifest: output ?? null };
        if (req.body.brain_result === undefined || resultDigest(req.body.brain_result) !== resultDigest(result)) throw new BrainTaskError('终态结果不匹配', 400);
        await confirmBrainFinish(identity, 'completed', result);
        await this.writeResult(req, res, identity, 'completed', stage, output);
      } else {
        await validateBrainLease(identity);
        await this.writeResult(req, res, identity, 'running', stage, output);
      }
    } catch (error) { handleError(res, error); }
  };

  fail = async (req: Request, res: Response): Promise<void> => {
    try {
      const identity = identityOf(req);
      const { error: message, stage = null } = req.body || {};
      if (typeof message !== 'string' || !message || (stage !== null && !PIPELINE_STAGES.includes(stage))) throw new BrainTaskError('错误及阶段无效', 400);
      const result = { pipeline_id: req.params.id, error: message, stage };
      if (req.body.brain_result === undefined || resultDigest(req.body.brain_result) !== resultDigest(result)) throw new BrainTaskError('终态结果不匹配', 400);
      await confirmBrainFinish(identity, 'failed', result);
      await this.writeResult(req, res, identity, 'failed', stage, { error: message, failed_stage: stage });
    } catch (error) { handleError(res, error); }
  };

  private writeResult = async (req: Request, res: Response, identity: BrainClaim, status: string, stage: string | null, output: unknown): Promise<void> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM zenithjoy.pipeline_runs WHERE id=$1 FOR UPDATE', [req.params.id]);
      const row = rows[0];
      if (!row || row.cecelia_task_id !== identity.brain_task_id || !sameBrainClaim(row.output_manifest?.brain_claim, identity)) throw conflict();
      if (row.status !== 'running' && row.status !== status) throw conflict();
      const old = row.output_manifest || {};
      const details = output && typeof output === 'object' && !Array.isArray(output) ? output as Record<string, unknown> : {};
      const manifest = status === 'running'
        ? { ...old, stages: { ...old.stages, [String(stage)]: { status: 'completed', output } } }
        : { ...old, ...details, status, brain_claim: identity };
      const nextDir = typeof details.output_dir === 'string' ? details.output_dir : null;
      if (nextDir && (!row.output_dir || resolve(nextDir) !== resolve(row.output_dir))) throw new BrainTaskError('产物目录不能离开本工作单',400);
      await client.query(`UPDATE zenithjoy.pipeline_runs SET status=$1,output_manifest=$2::jsonb,
        output_dir=COALESCE($3,output_dir),updated_at=NOW() WHERE id=$4 AND cecelia_task_id=$5`,
        [status, JSON.stringify(manifest), nextDir, row.id, identity.brain_task_id]);
      if (status === 'completed' && row.topic_id) await client.query(`UPDATE zenithjoy.topics SET status='待发布'
        WHERE id=$1 AND pipeline_id=$2 AND deleted_at IS NULL`, [row.topic_id,row.id]);
      await client.query('COMMIT');
      res.json(ok({ id: row.id, status, stage }));
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  };
}
