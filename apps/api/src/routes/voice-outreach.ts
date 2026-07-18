/**
 * /api/cs/voice-outreach/* — GP-A 主动语音触达 API 端点
 *
 * 端点：
 *   POST /api/cs/voice-outreach/call    — 发起语音触达指令（中台 → Agent 异步执行）
 *   GET  /api/cs/voice-outreach/records — 查询通话记录列表（多租户隔离）
 *
 * 鉴权（N-3 多租户隔离）：
 *   - requireCsWriteAccess('wechatId')：确保操作者是本租户管理员
 *   - 所有查询/写入强制带 tenant_id 过滤（deny by default）
 *
 * Response Schema：
 *   POST /call   → { success: true,  data: { call_id, status, queued_at } }
 *   GET /records → { success: true,  data: VoiceCallRecord[] }
 *   Error        → { success: false, error: { code, message } }
 */

import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import pool from '../db/connection';
import { tenantContext } from '../middleware/tenant-context';
import { requireCsWriteAccess } from '../middleware/cs-config-guard';
import { simpleRateLimit, tenantKeyFn } from '../middleware/simple-rate-limit';

export const voiceOutreachRouter = Router();

// 发起真实拨号：最敏感操作，限 10 次/分钟/租户（防误触发批量骚扰拨打）
const callRateLimit = simpleRateLimit({ windowMs: 60_000, max: 10, keyFn: tenantKeyFn });
// 查询/回写：读多写少，限 60 次/分钟/租户
const recordsRateLimit = simpleRateLimit({ windowMs: 60_000, max: 60, keyFn: tenantKeyFn });

// ─── 类型定义 ──────────────────────────────────────────────────────────────

/** 通话记录行结构（对应 voice_call_records 表）。 */
interface VoiceCallRecord {
  id: string;
  tenant_id: string;
  contact_name: string;
  wechat_account: string | null;
  status: 'answered' | 'no_answer' | 'failed';
  duration_seconds: number;
  called_at: string;
  call_id: string | null;
  bubble_text: string | null;
  error_reason: string | null;
  created_at: string;
}

/** POST /call 请求体。 */
interface VoiceCallRequest {
  tenant_id: string;
  contact_name: string;
  wechat_account?: string;
}

/** POST /call 响应。 */
interface VoiceCallResponse {
  call_id: string;
  status: 'queued';
  queued_at: string;
  tenant_id: string;
  contact_name: string;
}

// ─── POST /api/cs/voice-outreach/call — 发起语音触达 ──────────────────────

voiceOutreachRouter.post(
  '/call',
  tenantContext,
  callRateLimit,
  requireCsWriteAccess('wechatId'),
  async (req: Request, res: Response) => {
    const body = req.body as Partial<VoiceCallRequest>;
    const tenant_id: string | undefined = req.tenantId || body.tenant_id;

    if (!tenant_id) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_TENANT_ID', message: 'tenant_id 是必填项' },
      });
    }

    const { contact_name, wechat_account } = body;

    if (!contact_name || typeof contact_name !== 'string' || !contact_name.trim()) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_CONTACT_NAME', message: 'contact_name 是必填项' },
      });
    }

    const call_id = randomUUID();
    const queued_at = new Date().toISOString();

    // 落库（status=queued 过渡状态，Agent 回写后更新为最终状态）
    try {
      await pool.query(
        `INSERT INTO voice_call_records
           (id, tenant_id, contact_name, wechat_account, status, duration_seconds, called_at, call_id)
         VALUES ($1, $2, $3, $4, 'failed', 0, NOW(), $5)`,
        [randomUUID(), tenant_id, contact_name.trim(), wechat_account || null, call_id],
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: `写入通话记录失败: ${msg}` },
      });
    }

    // TODO(agent-dispatch): 通过 SSE / WebSocket 派发指令到 Agent 执行
    // Agent 完成后调用 POST /api/cs/voice-outreach/records 回写最终状态

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

// ─── GET /api/cs/voice-outreach/records — 查询通话记录 ────────────────────

voiceOutreachRouter.get(
  '/records',
  tenantContext,
  recordsRateLimit,
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

    params.push(limit, offset);
    const whereClause = conditions.join(' AND ');
    const sql = `
      SELECT
        id, tenant_id, contact_name, wechat_account,
        status, duration_seconds, called_at, call_id,
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
  tenantContext,
  recordsRateLimit,
  async (req: Request, res: Response) => {
    const body = req.body as Partial<VoiceCallRecord & { call_id: string }>;
    const tenant_id: string | undefined = req.tenantId || body.tenant_id;

    if (!tenant_id) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_TENANT_ID', message: 'tenant_id 是必填项' },
      });
    }

    const { call_id, contact_name, status, duration_seconds, bubble_text, error_reason } = body;

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

    try {
      // 多租户隔离：更新时同时校验 tenant_id（N-3）
      const result = await pool.query(
        `UPDATE voice_call_records
         SET status = $1,
             duration_seconds = $2,
             bubble_text = $3,
             error_reason = $4,
             updated_at = NOW()
         WHERE call_id = $5 AND tenant_id = $6
         RETURNING id, call_id, status, duration_seconds`,
        [
          status,
          duration_seconds ?? 0,
          bubble_text ?? null,
          error_reason ?? null,
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
              bubble_text, error_reason, called_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
          [
            newId,
            tenant_id,
            contact_name,
            status,
            duration_seconds ?? 0,
            call_id,
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
