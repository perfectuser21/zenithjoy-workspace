// apps/api/src/routes/mashup.ts
//
// 批量混剪 S2（GP f6f96e17）：客户挑模板 → 触发槽位分配 → 查看分配结果。
// 鉴权与租户隔离口径与 routes/materials.ts 一致：租户永远从凭据反查，
// 绝不信客户端自报 tenant_id。

import { Router, type Request, type Response } from 'express';
import pool from '../db/connection';
import { validateLicense } from '../services/walking-skeleton.service';
import { assignSlots, generateTemplateFromScript } from '../services/mashup-slot-assignment';
import { generateCandidates } from '../services/mashup-candidate-generation';
import { enqueueRender } from '../services/mashup-render-queue';
import { enqueuePreview } from '../services/mashup-preview-queue';
import { createMaterialStorage } from '../services/material-storage';
import { extractFrameBase64 } from '../services/video-frame-extract';
import { simpleRateLimit, ipKeyFn } from '../middleware/simple-rate-limit';

/**
 * 候选缩略图拼贴：取候选首个填充素材，重签 → 下载 → 抽一帧编成 data URL。
 * 尽力而为——任何一步失败返回 null（前端占位，不阻断，合同 Step3）。真实缩略图
 * 由 hk-vps L3 E2E 覆盖；单进程内共享 storage 实例避免每次新建。
 */
function makeThumbnailBuilder(): (materialIds: string[], tenantId: string) => Promise<string | null> {
  const storage = createMaterialStorage();
  return async (materialIds: string[]): Promise<string | null> => {
    for (const materialId of materialIds) {
      try {
        const { rows } = await pool.query(
          `SELECT storage_key FROM zenithjoy.materials WHERE id = $1`,
          [materialId],
        );
        const key: string | undefined = rows[0]?.storage_key;
        if (!key) continue;
        const signedUrl = await storage.getSignedUrl(key);
        const resp = await fetch(signedUrl);
        if (!resp.ok) continue;
        const buffer = Buffer.from(await resp.arrayBuffer());
        const dataUrl = extractFrameBase64(buffer);
        if (dataUrl) return dataUrl;
      } catch {
        // 单个素材抽帧失败继续试下一个，不裸崩
      }
    }
    return null;
  };
}

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

  // Step1 文案动态分段：客户粘贴文案 → 动态分段模板落库（AI 不可用降级固定模板，非阻断）
  router.post('/templates/from-script', async (req: Request, res: Response) => {
    const auth = await authenticate(req, res);
    if (!auth) return;

    const { script } = req.body ?? {};
    if (typeof script !== 'string' || !script.trim()) {
      return fail(res, 400, 'INVALID_BODY', 'script 必填且不能为空');
    }

    try {
      const result = await generateTemplateFromScript({ tenantId: auth.tenantId, script });
      ok(res, result);
    } catch (err) {
      fail(res, 500, 'FROM_SCRIPT_FAILED', err instanceof Error ? err.message : 'unknown');
    }
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
      const result = await generateCandidates(
        { tenantId: auth.tenantId, runId: req.params.id, targetCount },
        { buildThumbnail: makeThumbnailBuilder() },
      );
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
      `SELECT id, slot_fill, score, thumbnail_url, render_status, preview_status, preview_url FROM zenithjoy.mashup_candidates WHERE run_id = $1 ORDER BY score DESC`,
      [run.id],
    );

    ok(res, {
      runId: run.id,
      generatedCount: candidateRows.length,
      selectedCandidateId: run.selected_candidate_id ?? undefined,
      candidates: candidateRows.map((c: { id: string; slot_fill: Record<string, string>; score: string | number; thumbnail_url: string | null; render_status: string; preview_status: string; preview_url: string | null }) => ({
        id: c.id,
        score: Number(c.score),
        slotFill: c.slot_fill,
        thumbnailUrl: c.thumbnail_url ?? null,
        renderStatus: c.render_status,
        previewStatus: c.preview_status,
        previewUrl: c.preview_url ?? null,
      })),
    });
  });

  // Step3 候选真实轻量预览：并发上限=1 独立队列（决策 623a81d7），点击才现渲染，
  // 不阻塞候选生成/终版渲染。返回当前预览态供前端轮询呈现「生成中 / 可播放」。
  router.post('/candidates/:id/preview', async (req: Request, res: Response) => {
    const auth = await authenticate(req, res);
    if (!auth) return;

    try {
      const result = await enqueuePreview({ tenantId: auth.tenantId, candidateId: req.params.id });
      ok(res, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      if (/candidate not found/i.test(message)) {
        return fail(res, 404, 'CANDIDATE_NOT_FOUND', message);
      }
      fail(res, 500, 'PREVIEW_CANDIDATE_FAILED', message);
    }
  });

  // 候选详情：合成前预览态 + 合成后终版态一起给，前端选中候选触发渲染后
  // 轮询这一个端点直到 renderStatus 落终态（rendered/render_failed），
  // 再从 content 字段拿 safety/watermark/exportUrl——修复候选渲染改异步队列
  // （PR#1905）后前端仍假设同步拿到终版结果的契约断层。
  router.get('/candidates/:id', async (req: Request, res: Response) => {
    const auth = await authenticate(req, res);
    if (!auth) return;

    const { rows: candidateRows } = await pool.query(
      `SELECT c.id, c.run_id, c.score, c.slot_fill, c.thumbnail_url, c.render_status, c.preview_status, c.preview_url
         FROM zenithjoy.mashup_candidates c
         JOIN zenithjoy.mashup_runs r ON r.id = c.run_id
        WHERE c.id = $1 AND r.tenant_id = $2`,
      [req.params.id, auth.tenantId],
    );
    const candidate = candidateRows[0];
    if (!candidate) return fail(res, 404, 'CANDIDATE_NOT_FOUND', '候选不存在或不属于当前租户');

    const { rows: contentRows } = await pool.query(
      `SELECT id, safety_check_status, watermark_check_status, export_url, download_url
         FROM zenithjoy.contents
        WHERE source_candidate_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [candidate.id],
    );
    const content = contentRows[0];

    ok(res, {
      id: candidate.id,
      runId: candidate.run_id,
      score: Number(candidate.score),
      slotFill: candidate.slot_fill,
      thumbnailUrl: candidate.thumbnail_url ?? null,
      renderStatus: candidate.render_status,
      previewStatus: candidate.preview_status,
      previewUrl: candidate.preview_url ?? null,
      content: content
        ? {
            contentId: content.id,
            safetyCheckStatus: content.safety_check_status,
            watermarkCheckStatus: content.watermark_check_status,
            exportUrl: content.export_url ?? undefined,
            downloadUrl: content.download_url ?? undefined,
          }
        : null,
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

  // Step4 按需渲染：并发上限=1 队列（决策 d6bedf80），第 2 个请求进排队；
  // 失败落 render_failed 可重新入队（非死路，INV-6）。真实渲染在后台推进，
  // 本端点即时回当前渲染态供前端轮询呈现「排队第 N 位 / 渲染中 / 渲染失败可重试」。
  router.post('/candidates/:id/render', async (req: Request, res: Response) => {
    const auth = await authenticate(req, res);
    if (!auth) return;

    try {
      const result = await enqueueRender({ tenantId: auth.tenantId, candidateId: req.params.id });
      ok(res, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown';
      if (/candidate not found/i.test(message)) {
        return fail(res, 404, 'CANDIDATE_NOT_FOUND', message);
      }
      fail(res, 500, 'RENDER_CANDIDATE_FAILED', message);
    }
  });

  return router;
}
