/**
 * worker 活动协议 · 执行器面（internalAuth）
 *   POST /api/workers/:agentId/tasks          开始任务
 *   POST /api/workers/tasks/:id/steps          上报步骤（failed 必带三件套）
 *   POST /api/workers/tasks/:id/complete       完成
 *   POST /api/workers/:agentId/frame           推画面帧（image/jpeg ≤120KB）
 * 设计：docs/superpowers/specs/2026-08-30-worker-control-tower-design.md
 */
import express, { Router, Request, Response, NextFunction } from 'express';
import { internalAuth } from '../middleware/internal-auth';
import { startTask, reportStep, completeTask, WorkerTaskError } from '../services/worker-tasks-service';
import { workerLive } from '../services/worker-live';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERR = (code: string, message: string) => ({ success: false, error: code, message });
const OK = (data: unknown) => ({ success: true, data });
/** WorkerTaskError.message 带 "CODE: " 前缀，对外响应去掉以免重复 */
const stripCode = (e: WorkerTaskError) => (e.message.startsWith(`${e.code}: `) ? e.message.slice(e.code.length + 2) : e.message);

function sendErr(res: Response, e: unknown, where: string) {
  if (e instanceof WorkerTaskError) return res.status(e.httpStatus).json(ERR(e.code, stripCode(e)));
  console.error(`[workers-executor] ${where} error:`, e);
  return res.status(500).json(ERR('DB_ERROR', '内部错误'));
}
function requireTaskUuid(req: Request, res: Response, next: NextFunction) {
  if (!UUID_RE.test(req.params.id ?? '')) return res.status(400).json(ERR('INVALID_TASK_ID', 'task id 须为 uuid'));
  next();
}

export const workersExecutorRouter = Router();
workersExecutorRouter.use(internalAuth);

workersExecutorRouter.post('/tasks/:id/steps', requireTaskUuid, async (req: Request, res: Response) => {
  try { return res.json(OK(await reportStep(req.params.id, req.body ?? {}))); }
  catch (e) { return sendErr(res, e, 'steps'); }
});

workersExecutorRouter.post('/tasks/:id/complete', requireTaskUuid, async (req: Request, res: Response) => {
  try { return res.json(OK(await completeTask(req.params.id, req.body ?? {}))); }
  catch (e) { return sendErr(res, e, 'complete'); }
});

workersExecutorRouter.post('/:agentId/tasks', async (req: Request, res: Response) => {
  const { title, steps, executor_id } = req.body ?? {};
  if (typeof title !== 'string' || !title || !Array.isArray(steps) || steps.length === 0
      || !steps.every((s) => typeof s === 'string') || typeof executor_id !== 'string' || !executor_id) {
    return res.status(400).json(ERR('INVALID_TASK', 'title、steps[string]、executor_id 必填'));
  }
  try {
    const r = await startTask({ agentId: req.params.agentId, title, steps, executorId: executor_id });
    return res.status(201).json(OK(r));
  } catch (e) { return sendErr(res, e, 'tasks'); }
});

workersExecutorRouter.post('/:agentId/frame',
  express.raw({ type: 'image/jpeg', limit: '120kb' }),
  (err: Error & { type?: string }, req: Request, res: Response, next: NextFunction) =>
    err?.type === 'entity.too.large' ? res.status(413).json(ERR('FRAME_TOO_LARGE', '帧 ≤120KB')) : next(err),
  (req: Request, res: Response) => {
    if (!req.is('image/jpeg') || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(415).json(ERR('UNSUPPORTED_MEDIA', '需要 image/jpeg 原始字节'));
    }
    const f = workerLive.pushFrame(req.params.agentId, req.body);
    return res.status(202).json(OK({ seq: f.seq }));
  });

export default workersExecutorRouter;
