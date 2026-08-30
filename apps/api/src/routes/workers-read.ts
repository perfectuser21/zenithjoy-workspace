/**
 * worker 活动协议 · 读面（登录/租户，跨租户一律 404）
 *   GET /api/workers                              本租户 worker 卡片
 *   GET /api/workers/:agentId/activity            当前任务+步骤+历史 20 条
 *   GET /api/workers/:agentId/live                MJPEG（multipart/x-mixed-replace）
 *   GET /api/workers/shots/:tenant/:task/:file    截图
 */
import { Router, Request, Response } from 'express';
import fs from 'node:fs';
import { tenantContextOptional } from '../middleware/tenant-context';
import { listWorkers, getActivity, agentBelongsToTenant } from '../services/worker-tasks-service';
import { workerLive, type LiveFrame } from '../services/worker-live';
import { shotPath } from '../services/worker-shots';

const ERR = (code: string, message: string) => ({ success: false, error: code, message });
const OK = (data: unknown) => ({ success: true, data });

export const workersReadRouter = Router();
workersReadRouter.use(tenantContextOptional);

function requireTenant(req: Request, res: Response): string | null {
  const t = req.tenantId;
  if (!t) { res.status(401).json(ERR('NO_TENANT', '缺租户上下文')); return null; }
  return t;
}

workersReadRouter.get('/', async (req: Request, res: Response) => {
  const tenantId = requireTenant(req, res); if (!tenantId) return;
  try {
    const rows = await listWorkers(tenantId);
    return res.json(OK(rows.map((r: Record<string, unknown>) => ({
      id: r.id, agent_id: r.agent_id, hostname: r.hostname, nickname: r.nickname, machine_role: r.machine_role,
      os_type: r.os_type ?? null, owner_type: r.owner_type ?? 'customer', version: r.version, last_seen: r.last_seen, status: r.status,
      running: r.running_task_id
        ? { task_id: r.running_task_id, title: r.running_title, current_step: Number(r.current_step ?? 0), steps_total: Number(r.steps_total ?? 0) }
        : null,
      completed_today: Number(r.completed_today ?? 0),
    }))));
  } catch (e) { console.error('[workers-read] list error:', e); return res.status(500).json(ERR('DB_ERROR', '查询失败')); }
});

workersReadRouter.get('/shots/:tenant/:task/:file', async (req: Request, res: Response) => {
  const tenantId = requireTenant(req, res); if (!tenantId) return;
  const ref = `${req.params.tenant}/${req.params.task}/${req.params.file}`;
  const p = shotPath(ref);
  if (!p) return res.status(400).json(ERR('BAD_REF', '截图引用非法'));
  if (req.params.tenant !== tenantId || !fs.existsSync(p)) return res.status(404).json(ERR('NOT_FOUND', '截图不存在'));
  res.type('image/jpeg');
  return fs.createReadStream(p).pipe(res);
});

workersReadRouter.get('/:agentId/activity', async (req: Request, res: Response) => {
  const tenantId = requireTenant(req, res); if (!tenantId) return;
  try {
    const a = await getActivity(tenantId, req.params.agentId);
    if (!a) return res.status(404).json(ERR('NOT_FOUND', 'worker 不存在'));
    const withUrl = (s: Record<string, unknown>) => ({ ...s, screenshot_url: s.screenshot_ref ? `/api/workers/shots/${s.screenshot_ref}` : null });
    return res.json(OK({ current: a.current, steps: a.steps.map(withUrl), history: a.history }));
  } catch (e) { console.error('[workers-read] activity error:', e); return res.status(500).json(ERR('DB_ERROR', '查询失败')); }
});

workersReadRouter.get('/:agentId/live', async (req: Request, res: Response) => {
  const tenantId = requireTenant(req, res); if (!tenantId) return;
  const agentId = req.params.agentId;
  if (!(await agentBelongsToTenant(tenantId, agentId))) return res.status(404).json(ERR('NOT_FOUND', 'worker 不存在'));
  res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame', 'Cache-Control': 'no-cache, no-store', Connection: 'keep-alive', Pragma: 'no-cache' });
  const write = (f: LiveFrame) => {
    res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${f.bytes.length}\r\n\r\n`);
    res.write(f.bytes); res.write('\r\n');
  };
  const first = workerLive.latest(agentId);
  if (first) write(first);
  const off = workerLive.subscribe(agentId, write);
  req.on('close', () => { off(); });
});

export default workersReadRouter;
