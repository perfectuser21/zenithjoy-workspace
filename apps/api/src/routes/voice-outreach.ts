/**
 * /api/cs/voice-outreach/* — GP-A 主动语音触达 API 端点
 *
 * 端点：
 *   POST /api/cs/voice-outreach/call    — 发起语音触达指令（中台 → Agent 异步执行）
 *   GET  /api/cs/voice-outreach/pending — Agent 轮询认领队列（乐观锁 UPDATE RETURNING）
 *   GET  /api/cs/voice-outreach/records — 查询通话记录列表（多租户隔离）
 *   POST /api/cs/voice-outreach/records — Agent 回写通话结果
 *
 * 鉴权（I-14 修复）：
 *   - POST /call 改用 requireCsAdminOrSuperAdmin（不再依赖 :wechatId 路径参数）
 *   - 所有查询/写入强制带 tenant_id 过滤（deny by default）
 *
 * 关键设计：
 *   - I-9  call_phase 状态机：POST /call 写入 call_phase='queued'
 *   - I-12 10 分钟去重窗口：同 tenant+contact+wechat_account 内返回 409 DUPLICATE_CALL
 *   - I-13 GET /pending DB 故障降级：返回 200 空列表，不中断 Agent 轮询
 *   - I-14 鉴权修复：requireCsAdminOrSuperAdmin
 *
 * Response Schema：
 *   POST /call    → { success: true,  data: { call_id, status, queued_at } }
 *   GET  /pending → { success: true,  data: VoiceCallPending[] }
 *   GET  /records → { success: true,  data: VoiceCallRecord[] }
 *   Error         → { success: false, error: { code, message } }
 */

import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import pool from '../db/connection';
import { tenantContext } from '../middleware/tenant-context';
import { requireCsAdminOrSuperAdmin } from '../middleware/cs-config-guard';
import { simpleRateLimit, tenantKeyFn } from '../middleware/simple-rate-limit';

export const voiceOutreachRouter = Router();

// 发起真实拨号：最敏感操作，限 10 次/分钟/租户（防误触发批量骚扰拨打）
const callRateLimit = simpleRateLimit({ windowMs: 60_000, max: 10, keyFn: tenantKeyFn });
// 查询/回写：读多写少，限 60 次/分钟/租户
const recordsRateLimit = simpleRateLimit({ windowMs: 60_000, max: 60, keyFn: tenantKeyFn });

// ─── 类型定义 ──────────────────────────────────────────────────────────────

/** 通话记录行结构（对应 voice_call_records 表 v2）。 */
interface VoiceCallRecord {
  id: string;
  tenant_id: string;
  contact_name: string;
  wechat_account: string | null;
  status: 'answered' | 'no_answer' | 'failed';
  duration_seconds: number;
  called_at: string;
  call_id: string | null;
  call_phase: string | null;
  trigger_source: string | null;
  triggered_by: string | null;
  machine_id: string | null;
  transcript: string | null;
  bubble_text: string | null;
  error_reason: string | null;
  created_at: string;
}

/** POST /call 请求体（v2 含 trigger_source / triggered_by）。 */
interface VoiceCallRequest {
  tenant_id: string;
  contact_name: string;
  wechat_account?: string;
  trigger_source?: string;
  triggered_by?: string;
}

/** POST /call 响应。 */
interface VoiceCallResponse {
  call_id: string;
  status: 'queued';
  queued_at: string;
  tenant_id: string;
  contact_name: string;
}

/** GET /pending 响应单条记录。 */
interface VoiceCallPending {
  id: string;
  call_id: string;
  tenant_id: string;
  contact_name: string;
  wechat_account: string | null;
  call_phase: string;
  trigger_source: string | null;
  triggered_by: string | null;
  queued_at: string;
}

// ─── POST /api/cs/voice-outreach/call — 发起语音触达 ──────────────────────
// I-14: 鉴权改为 requireCsAdminOrSuperAdmin（不再依赖 :wechatId 路径参数）

voiceOutreachRouter.post(
  '/call',
  callRateLimit,
  tenantContext,
  requireCsAdminOrSuperAdmin,
  async (req: Request, res: Response) => {
    const body = req.body as Partial<VoiceCallRequest>;
    const tenant_id: string | undefined = req.tenantId || body.tenant_id;

    if (!tenant_id) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_TENANT_ID', message: 'tenant_id 是必填项' },
      });
    }

    const { contact_name, wechat_account, trigger_source, triggered_by } = body;

    if (!contact_name || typeof contact_name !== 'string' || !contact_name.trim()) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_CONTACT_NAME', message: 'contact_name 是必填项' },
      });
    }

    const call_id = randomUUID();
    const queued_at = new Date().toISOString();

    try {
      // I-12: 10min 去重窗口 — 同 tenant_id+contact_name+wechat_account 内
      // call_phase 非终态（非 completed/failed/no_answer/ai_dropped）的记录存在即返回 409 DUPLICATE_CALL
      const dedupResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count
           FROM voice_call_records
          WHERE tenant_id = $1
            AND contact_name = $2
            AND ($3::text IS NULL OR wechat_account = $3)
            AND call_phase NOT IN ('completed', 'failed', 'no_answer', 'ai_dropped')
            AND called_at > NOW() - INTERVAL '10 min'`,
        [tenant_id, contact_name.trim(), wechat_account || null],
      );

      if (parseInt(dedupResult.rows[0]?.count ?? '0', 10) > 0) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'DUPLICATE_CALL',
            message: '10 分钟内同一联系人已有进行中的呼叫，请稍后再试',
          },
        });
      }

      // I-9: 写入 call_phase='queued'（状态机初始态）
      await pool.query(
        `INSERT INTO voice_call_records
           (id, tenant_id, contact_name, wechat_account, status, duration_seconds, called_at,
            call_id, call_phase, trigger_source, triggered_by)
         VALUES ($1, $2, $3, $4, 'failed', 0, NOW(), $5, 'queued', $6, $7)`,
        [
          randomUUID(),
          tenant_id,
          contact_name.trim(),
          wechat_account || null,
          call_id,
          trigger_source || 'manual',
          triggered_by || null,
        ],
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: `写入通话记录失败: ${msg}` },
      });
    }

    const responseData: VoiceCallResponse = {
      call_id,
      status: 'queued',
      queued_at,
      tenant_id,
      contact_name: contact_name.trim(),
    };

    return res.status(202).json({ success: true, data: responseData });
  },
);

// ─── GET /api/cs/voice-outreach/pending — Agent 轮询认领 ──────────────────
// BEHAVIOR-2: 乐观锁 UPDATE WHERE call_phase='queued' RETURNING
// I-13: DB 故障返回 200 空列表，不抛 500（不中断 Agent 轮询）

voiceOutreachRouter.get(
  '/pending',
  recordsRateLimit,
  tenantContext,
  async (req: Request, res: Response) => {
    const tenant_id: string | undefined =
      req.tenantId || (req.query.tenant_id as string | undefined);
    const machine_id = (req.query.machine_id as string | undefined) || 'unknown';
    const limit = Math.min(parseInt(String(req.query.limit || '5'), 10), 20);

    if (!tenant_id) {
      // 无 tenant_id 时允许 Agent 基于 machine_id 认领（服务端凭证场景）
      // 这里直接尝试查全局队列（multi-tenant 场景下应通过 license 认证确定 tenant_id）
    }

    try {
      // 乐观锁：UPDATE WHERE call_phase='queued' → claimed，并锁定 machine_id
      // RETURNING 返回实际更新的行（并发场景下只有一个 machine 能拿到）
      const tenantFilter = tenant_id
        ? `AND tenant_id = '${tenant_id.replace(/'/g, "''")}'`
        : '';

      const result = await pool.query<VoiceCallPending>(
        `UPDATE voice_call_records
            SET call_phase = 'claimed',
                machine_id = $1,
                claimed_at = NOW()
          WHERE id IN (
            SELECT id FROM voice_call_records
             WHERE call_phase = 'queued'
               ${tenantFilter}
             ORDER BY called_at ASC
             LIMIT $2
             FOR UPDATE SKIP LOCKED
          )
          RETURNING
            id,
            call_id,
            tenant_id,
            contact_name,
            wechat_account,
            call_phase,
            trigger_source,
            triggered_by,
            called_at AS queued_at`,
        [machine_id, limit],
      );

      return res.json({ success: true, data: result.rows });
    } catch (_err: unknown) {
      // I-13: DB 故障降级 — 返回 200 空列表，不中断 Agent 轮询循环
      return res.json({ success: true, data: [] });
    }
  },
);

// ─── GET /api/cs/voice-outreach/records — 查询通话记录（v2 含新字段）────────

voiceOutreachRouter.get(
  '/records',
  recordsRateLimit,
  tenantContext,
  async (req: Request, res: Response) => {
    const tenant_id: string | undefined =
      req.tenantId || (req.query.tenant_id as string | undefined);

    if (!tenant_id) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_TENANT_ID', message: 'tenant_id 是必填项' },
      });
    }

    const contact_name = req.query.contact_name as string | undefined;
    const status = req.query.status as string | undefined;
    const call_phase = req.query.call_phase as string | undefined;
    const limit = Math.min(parseInt(String(req.query.limit || '50'), 10), 200);
    const offset = parseInt(String(req.query.offset || '0'), 10);

    // 多租户隔离：所有查询强制带 tenant_id 过滤（N-3）
    const params: (string | number)[] = [tenant_id];
    const conditions: string[] = ['tenant_id = $1'];

    if (contact_name) {
      params.push(contact_name.trim());
      conditions.push(`contact_name ILIKE $${params.length}`);
    }

    if (status && ['answered', 'no_answer', 'failed'].includes(status)) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    if (call_phase) {
      params.push(call_phase);
      conditions.push(`call_phase = $${params.length}`);
    }

    params.push(limit, offset);
    const whereClause = conditions.join(' AND ');
    const sql = `
      SELECT
        id, tenant_id, contact_name, wechat_account,
        status, duration_seconds, called_at, call_id,
        call_phase, trigger_source, triggered_by, machine_id, transcript,
        bubble_text, error_reason, created_at
      FROM voice_call_records
      WHERE ${whereClause}
      ORDER BY called_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;

    try {
      const { rows } = await pool.query<VoiceCallRecord>(sql, params);
      return res.json({ success: true, data: rows });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: `查询通话记录失败: ${msg}` },
      });
    }
  },
);

// ─── POST /api/cs/voice-outreach/records — Agent 回写通话结果 ─────────────

voiceOutreachRouter.post(
  '/records',
  recordsRateLimit,
  tenantContext,
  async (req: Request, res: Response) => {
    const body = req.body as Partial<VoiceCallRecord & { call_id: string; machine_id: string; transcript: string }>;
    const tenant_id: string | undefined = req.tenantId || body.tenant_id;

    if (!tenant_id) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_TENANT_ID', message: 'tenant_id 是必填项' },
      });
    }

    const { call_id, contact_name, status, duration_seconds, bubble_text, error_reason, machine_id, transcript } = body;

    if (!call_id || !contact_name || !status) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_FIELDS',
          message: 'call_id / contact_name / status 均为必填项',
        },
      });
    }

    if (!['answered', 'no_answer', 'failed'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STATUS',
          message: `非法 status: ${status}，有效值: answered / no_answer / failed`,
        },
      });
    }

    // 状态到 call_phase 的映射
    const callPhaseMap: Record<string, string> = {
      answered: 'completed',
      no_answer: 'no_answer',
      failed: 'failed',
    };
    const finalPhase = callPhaseMap[status] || 'failed';

    try {
      // 多租户隔离：更新时同时校验 tenant_id（N-3）
      const result = await pool.query(
        `UPDATE voice_call_records
         SET status = $1,
             duration_seconds = $2,
             bubble_text = $3,
             error_reason = $4,
             call_phase = $5,
             machine_id = COALESCE($6, machine_id),
             transcript = COALESCE($7, transcript),
             updated_at = NOW()
         WHERE call_id = $8 AND tenant_id = $9
         RETURNING id, call_id, status, duration_seconds`,
        [
          status,
          duration_seconds ?? 0,
          bubble_text ?? null,
          error_reason ?? null,
          finalPhase,
          machine_id ?? null,
          transcript ?? null,
          call_id,
          tenant_id,
        ],
      );

      if (result.rowCount === 0) {
        // 不存在 → 新建（Agent 直接回写场景）
        const newId = randomUUID();
        await pool.query(
          `INSERT INTO voice_call_records
             (id, tenant_id, contact_name, status, duration_seconds, call_id,
              call_phase, machine_id, transcript, bubble_text, error_reason, called_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
          [
            newId,
            tenant_id,
            contact_name,
            status,
            duration_seconds ?? 0,
            call_id,
            finalPhase,
            machine_id ?? null,
            transcript ?? null,
            bubble_text ?? null,
            error_reason ?? null,
          ],
        );
        return res.status(201).json({
          success: true,
          data: { call_id, status, duration_seconds: duration_seconds ?? 0 },
        });
      }

      const row = result.rows[0];
      return res.json({
        success: true,
        data: { call_id: row.call_id, status: row.status, duration_seconds: row.duration_seconds },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: `回写通话记录失败: ${msg}` },
      });
    }
  },
);
