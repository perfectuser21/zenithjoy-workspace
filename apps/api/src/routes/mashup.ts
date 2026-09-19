// apps/api/src/routes/mashup.ts
//
// 批量混剪 S2（GP f6f96e17）：客户挑模板 → 触发槽位分配 → 查看分配结果。
// 鉴权与租户隔离口径与 routes/materials.ts 一致：租户永远从凭据反查，
// 绝不信客户端自报 tenant_id。

import { Router, type Request, type Response } from 'express';
import pool from '../db/connection';
import { validateLicense } from '../services/walking-skeleton.service';
import { assignSlots } from '../services/mashup-slot-assignment';
import { generateCandidates } from '../services/mashup-candidate-generation';
import { simpleRateLimit, ipKeyFn } from '../middleware/simple-rate-limit';

function extractUploadToken(req: Request): string | null {
  const h = req.header('X-Upload-Token');
  return h && h.trim() ? h.trim() : null;
}

function fail(res: Response, status: number, code: string, message: string) {
  res.status(status).json({
    success: false,
    data: null,
    error: { code, message },
    timestamp: new Date().toISOString(),
  });
}

function ok(res: Response, data: unknown) {
  res.status(200).json({ success: true, data, error: null, timestamp: new Date().toISOString() });
}

async function authenticate(req: Request, res: Response): Promise<{ tenantId: string } | null> {
  const token = extractUploadToken(req);
  if (!token) {
    fail(res, 401, 'UNAUTHORIZED', '缺少上传凭据。请在请求头加 X-Upload-Token: <token>');
    return null;
  }
  let r;
  try {
    r = await validateLicense(token);
  } catch (err) {
    fail(res, 500, 'LICENSE_LOOKUP_FAILED', err instanceof Error ? err.message : 'unknown');
    return null;
  }
  if (!r.ok) {
    fail(res, r.code === 'INVALID_LICENSE' ? 401 : 403, r.code, r.message);
    return null;
  }
  return { tenantId: r.license.tenant_id as string };
}

export function createMashupRouter(): Router {
  const router = Router();

  // 与 materials.ts 同口径：限流器建一次、复用同一实例，不建在请求处理函数里
  // （否则每个请求都新建计数器，express-rate-limit 会直接报
  // ERR_ERL_CREATED_IN_REQUEST_HANDLER，限流也完全不生效）。
  router.use(simpleRateLimit({ windowMs: 60_000, max: 60, keyFn: ipKeyFn }));

  router.get('/templates', async (req: Request, res: Response) => {
    const auth = await authenticate(req, res);
    if (!auth) return;
    const { rows } = await pool.query(
      `SELECT id, name, slots FROM zenithjoy.mashup_templates WHERE tenant_id IS NULL OR tenant_id = $1 ORDER BY created_at ASC`,
      [auth.tenantId],
    );
    ok(res, rows);
  });

  router.post('/runs', async (req: Request, res: Response) => {
    const auth = await authenticate(req, res);
    if (!auth) return;

    const { templateId, materialIds } = req.body ?? {};
    if (typeof templateId !== 'string' || !templateId) {
      return fail(res, 400, 'INVALID_BODY', 'templateId 必填');
    }
    if (materialIds !== undefined && !Array.isArray(materialIds)) {
      return fail(res, 400, 'INVALID_BODY', 'materialIds 必须是数组');
    }

    try {
      const result = await assignSlots({ tenantId: auth.tenantId, templateId, materialIds: materialIds ?? [] });
      ok(res, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      if (/template not found/i.test(message)) {
        return fail(res, 404, 'TEMPLATE_NOT_FOUND', message);
      }
      fail(res, 500, 'ASSIGN_SLOTS_FAILED', message);
    }
  });

  router.get('/runs/:id', async (req: Request, res: Response) => {
    const auth = await authenticate(req, res);
    if (!auth) return;

    const { rows: runRows } = await pool.query(
      `SELECT id, status, template_id FROM zenithjoy.mashup_runs WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, auth.tenantId],
    );
    const run = runRows[0];
    if (!run) return fail(res, 404, 'RUN_NOT_FOUND', 'run 不存在或不属于当前租户');

    const { rows: assignmentRows } = await pool.query(
      `SELECT slot_key, material_id, status, reason FROM zenithjoy.mashup_slot_assignments WHERE run_id = $1`,
      [run.id],
    );

    ok(res, {
      runId: run.id,
      templateId: run.template_id,
      status: run.status,
      assignments: assignmentRows.map((r: { slot_key: string; material_id: string | null; status: string; reason: string | null }) => ({
        slotKey: r.slot_key,
        materialId: r.material_id ?? undefined,
        status: r.status,
        reason: r.reason ?? undefined,
      })),
    });
  });

  router.post('/runs/:id/candidates', async (req: Request, res: Response) => {
    const auth = await authenticate(req, res);
    if (!auth) return;

    const { targetCount } = req.body ?? {};
    if (targetCount !== undefined && (typeof targetCount !== 'number' || targetCount <= 0)) {
      return fail(res, 400, 'INVALID_BODY', 'targetCount 必须是正数');
    }

    try {
      const result = await generateCandidates({ tenantId: auth.tenantId, runId: req.params.id, targetCount });
      ok(res, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      if (/run not found/i.test(message)) {
        return fail(res, 404, 'RUN_NOT_FOUND', message);
      }
      fail(res, 500, 'GENERATE_CANDIDATES_FAILED', message);
    }
  });

  router.get('/runs/:id/candidates', async (req: Request, res: Response) => {
    const auth = await authenticate(req, res);
    if (!auth) return;

    const { rows: runRows } = await pool.query(
      `SELECT id, selected_candidate_id FROM zenithjoy.mashup_runs WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, auth.tenantId],
    );
    const run = runRows[0];
    if (!run) return fail(res, 404, 'RUN_NOT_FOUND', 'run 不存在或不属于当前租户');

    const { rows: candidateRows } = await pool.query(
      `SELECT id, slot_fill, score FROM zenithjoy.mashup_candidates WHERE run_id = $1 ORDER BY score DESC`,
      [run.id],
    );

    ok(res, {
      runId: run.id,
      selectedCandidateId: run.selected_candidate_id ?? undefined,
      candidates: candidateRows.map((c: { id: string; slot_fill: Record<string, string>; score: string | number }) => ({
        id: c.id,
        score: Number(c.score),
        slotFill: c.slot_fill,
      })),
    });
  });

  router.post('/candidates/:id/select', async (req: Request, res: Response) => {
    const auth = await authenticate(req, res);
    if (!auth) return;

    const { rows: candidateRows } = await pool.query(
      `SELECT c.id, c.run_id FROM zenithjoy.mashup_candidates c
         JOIN zenithjoy.mashup_runs r ON r.id = c.run_id
        WHERE c.id = $1 AND r.tenant_id = $2`,
      [req.params.id, auth.tenantId],
    );
    const candidate = candidateRows[0];
    if (!candidate) return fail(res, 404, 'CANDIDATE_NOT_FOUND', '候选不存在或不属于当前租户');

    const { rows: updated } = await pool.query(
      `UPDATE zenithjoy.mashup_runs SET selected_candidate_id = $2 WHERE id = $1 RETURNING id, selected_candidate_id`,
      [candidate.run_id, candidate.id],
    );

    ok(res, { runId: updated[0].id, selectedCandidateId: updated[0].selected_candidate_id });
  });

  return router;
}
