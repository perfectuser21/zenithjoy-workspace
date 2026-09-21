/**
 * 排程执行器面（task 3abb7f8c）—— 工作机上的领单器调这两个端点
 *
 *   POST /api/schedule/claim              按机身序列号认领一条到期的活
 *   POST /api/schedule/jobs/:id/finish    回执：完成 / 失败
 *
 * 鉴权用 internalAuth（内部 token），不走租户 —— 领单器跑在工作机上，
 * 它没有登录态。让工作机拿生产库密码是更坏的选择，所以认领逻辑留在中台，
 * 工作机只揣一个内部 token。
 *
 * 两条硬要求：
 *  1. **认领必须原子**：`UPDATE ... WHERE status='queued'`（invariant 761f242b）。
 *     先 SELECT 再 UPDATE 会让两台机器同时领走同一单，同一个人被私信两次。
 *  2. **只认一次性单**：`source='oneoff'`。周期活仍归 Mac 上的 crontab，本刀不碰它 ——
 *     两套调度同时盯同一批活，一件活会跑两遍。
 */
import { Router, Request, Response, NextFunction } from 'express';
import { internalAuth } from '../middleware/internal-auth';
import { simpleRateLimit, ipKeyFn } from '../middleware/simple-rate-limit';
import { getBrainPool } from '../db/brain-pool';

const ERR = (code: string, message: string) => ({ success: false, error: code, message });
const OK = (data: unknown) => ({ success: true, data });

/**
 * internalAuth 在未配 ZENITHJOY_INTERNAL_TOKEN 时会放行所有请求（dev 模式）。
 * 领单器是对外动作的扳机——生产上缺 token 必须拒服务，而不是敞开。
 * 与设备指令桥（routes/devices.ts）同款守卫。
 */
function requireTokenInProd(_req: Request, res: Response, next: NextFunction) {
  if (process.env.NODE_ENV === 'production' && !process.env.ZENITHJOY_INTERNAL_TOKEN) {
    return res.status(503).json(ERR('SERVICE_UNAVAILABLE', 'ZENITHJOY_INTERNAL_TOKEN 未配置，排程执行器面拒绝服务'));
  }
  next();
}

/** 领单器每分钟一轮 × 少数几台工作机，60/分钟足够且能挡住失控重试 */
const execRateLimit = simpleRateLimit({ windowMs: 60_000, max: 60, keyFn: ipKeyFn });

export const scheduleExecutorRouter = Router();
scheduleExecutorRouter.use(execRateLimit);
scheduleExecutorRouter.use(requireTokenInProd);
scheduleExecutorRouter.use(internalAuth);

scheduleExecutorRouter.post('/claim', execRateLimit, async (req: Request, res: Response) => {
  const { serials, claimer } = req.body ?? {};
  if (!Array.isArray(serials) || serials.length === 0 || !serials.every((s) => typeof s === 'string')) {
    return res.status(400).json(ERR('BAD_SERIALS', '缺本机手机序列号列表'));
  }
  if (typeof claimer !== 'string' || !claimer) {
    return res.status(400).json(ERR('BAD_CLAIMER', '缺认领者标识'));
  }
  const brain = getBrainPool();
  if (!brain) return res.status(503).json(ERR('BRAIN_UNAVAILABLE', '排程后台未连通'));

  try {
    // 原子认领：谓词里带 status='queued'，两台机器同时来只有一台拿得到。
    // 一次只领一条 —— 手机是独占资源，领多了只会排队等自己。
    const { rows } = await brain.query(
      `UPDATE tasks
          SET status = 'in_progress',
              claimed_by = $2,
              claimed_at = NOW(),
              started_at = NOW(),
              row_version = row_version + 1,
              updated_at = NOW()
        WHERE id = (
          SELECT id FROM tasks
           WHERE task_type = 'device_job'
             AND status = 'queued'
             AND payload->>'source' = 'oneoff'
             AND payload->>'serial' = ANY($1::text[])
             AND (due_at IS NULL OR due_at <= NOW())
           ORDER BY due_at NULLS FIRST
           FOR UPDATE SKIP LOCKED
           LIMIT 1
        )
        RETURNING id, title, dept, payload, row_version`,
      [serials, claimer],
    );
    if (rows.length === 0) return res.json(OK({ job: null }));
    const r = rows[0];
    return res.json(OK({
      job: {
        id: r.id,
        title: r.title,
        dept: r.dept,
        serial: r.payload?.serial ?? null,
        params: r.payload?.params ?? {},
        row_version: r.row_version,
      },
    }));
  } catch (e) {
    console.error('[schedule-executor] 认领失败:', e);
    return res.status(500).json(ERR('CLAIM_FAILED', '认领失败'));
  }
});

scheduleExecutorRouter.post('/jobs/:id/finish', execRateLimit, async (req: Request, res: Response) => {
  const { ok, error_code, evidence } = req.body ?? {};
  if (typeof ok !== 'boolean') return res.status(400).json(ERR('BAD_OUTCOME', '缺 ok'));
  const brain = getBrainPool();
  if (!brain) return res.status(503).json(ERR('BRAIN_UNAVAILABLE', '排程后台未连通'));

  const status = ok ? 'completed' : 'failed';
  try {
    // 只认自己那条在跑的活；迟到的回执（这条已被重排/取消）不许覆盖当前状态。
    // jsonb `||` 是浅合并（invariant 55f0d846），回执塞进固定子键，不打散别人的 payload。
    const { rows } = await brain.query(
      `UPDATE tasks
          SET status = $2,
              completed_at = NOW(),
              row_version = row_version + 1,
              updated_at = NOW(),
              error_message = $3,
              payload = COALESCE(payload,'{}'::jsonb) || jsonb_build_object(
                'executed_at', NOW()::text,
                'receipt', $4::jsonb
              )
        WHERE id = $1
          AND task_type = 'device_job'
          AND status = 'in_progress'
        RETURNING id, status`,
      [
        req.params.id,
        status,
        ok ? null : (typeof error_code === 'string' ? error_code : 'UNKNOWN'),
        JSON.stringify({ ok, error_code: error_code ?? null, evidence: evidence ?? null }),
      ],
    );
    if (rows.length === 0) {
      // 不是错，是"这条已经不归你了"。领单器据此不再重试，避免打转。
      return res.status(409).json(ERR('NOT_RUNNING', '这条活已不在执行中（可能已被重排或取消）'));
    }
    return res.json(OK({ id: rows[0].id, status: rows[0].status }));
  } catch (e) {
    console.error('[schedule-executor] 回执失败:', e);
    return res.status(500).json(ERR('FINISH_FAILED', '回执失败'));
  }
});

export default scheduleExecutorRouter;
