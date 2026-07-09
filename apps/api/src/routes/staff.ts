/**
 * 员工工具路由（staff only）
 *
 * POST /api/staff/skill-eval/upload              — 上传 skill zip，转发到 Cecelia skill-eval 服务
 * GET  /api/staff/skill-eval/status/:jobId       — 查询评测状态（含 wizard_status）
 * GET  /api/staff/skill-eval/report/:jobId       — 拉取评测报告
 * GET  /api/staff/skill-eval/wizard/:jobId       — 获取梳理向导问题
 * POST /api/staff/skill-eval/wizard/:jobId/answers — 提交向导回答
 * GET  /api/staff/skill-eval/library             — 技能库列表
 * GET  /api/staff/skill-eval/library/:journeyId  — 某条线的历史评估
 *
 * 所有路由受 staffGuard 保护（STAFF_EMAILS 白名单）
 */
import { Router } from 'express';
import multer from 'multer';
import axios from 'axios';
import { staffGuard } from '../middleware/staff';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

const SKILL_EVAL_BASE = () => process.env.CECELIA_SKILL_EVAL_URL ?? 'http://hk-vps:9100';

function deriveSkillName(originalname: string): string {
  return originalname.replace(/\.zip$/i, '').trim() || 'unnamed-skill';
}

router.use(staffGuard);

router.post('/skill-eval/upload', upload.single('file'), async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ success: false, error: { code: 'NO_FILE', message: '缺少 file 字段' } });
    return;
  }

  const submitter = typeof req.headers['x-user-email'] === 'string' ? req.headers['x-user-email'] : '';
  const platform = typeof req.body?.platform === 'string' ? req.body.platform : '';
  const journeyId = typeof req.body?.journey_id === 'string' ? req.body.journey_id : '';
  const area = typeof req.body?.area === 'string' ? req.body.area : '';
  const lineName = typeof req.body?.line_name === 'string' ? req.body.line_name : '';
  const ability = typeof req.body?.ability === 'string' ? req.body.ability : '';

  const fd = new globalThis.FormData();
  fd.append('file', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);
  fd.append('skill_name', deriveSkillName(req.file.originalname));
  fd.append('submitter', submitter);
  fd.append('platform', platform);
  fd.append('journey_id', journeyId);
  fd.append('area', area);
  fd.append('line_name', lineName);
  fd.append('ability', ability);

  try {
    const upstream = await axios.post(`${SKILL_EVAL_BASE()}/upload`, fd, { timeout: 30000 });
    const jobId = upstream.data?.task_id;
    res.status(upstream.status).json({
      success: true,
      data: { job_id: jobId, queue_position: upstream.data?.queue_position ?? null },
    });
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status ?? 504;
      const data = err.response?.data ?? { success: false, error: { message: err.message } };
      res.status(status).json(data);
      return;
    }
    res.status(504).json({ success: false, error: { code: 'GATEWAY_TIMEOUT', message: '评测服务暂不可用' } });
  }
});

router.get('/skill-eval/status/:jobId', async (req, res): Promise<void> => {
  const { jobId } = req.params;
  try {
    const upstream = await axios.get(`${SKILL_EVAL_BASE()}/status/${jobId}`, { timeout: 30000 });
    res.status(upstream.status).json({
      success: true,
      data: {
        job_id: upstream.data?.task_id,
        status: upstream.data?.status,
        wizard_status: upstream.data?.wizard_status ?? null,
        wizard_questions: upstream.data?.wizard_questions ?? null,
        report_url: upstream.data?.report_url ?? null,
        failure_reason: upstream.data?.failure_reason ?? null,
      },
    });
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status ?? 504;
      const data = err.response?.data ?? { success: false, error: { message: err.message } };
      res.status(status).json(data);
      return;
    }
    res.status(504).json({ success: false, error: { code: 'GATEWAY_TIMEOUT', message: '评测服务暂不可用' } });
  }
});

router.get('/skill-eval/report/:jobId', async (req, res): Promise<void> => {
  const { jobId } = req.params;
  const wantsJson = req.query.format === 'json';
  try {
    const upstream = await axios.get(`${SKILL_EVAL_BASE()}/report/${jobId}`, {
      params: wantsJson ? { format: 'json' } : undefined,
      timeout: 30000,
      responseType: wantsJson ? 'json' : 'text',
    });
    if (wantsJson) {
      res.status(upstream.status).json({ success: true, data: upstream.data });
      return;
    }
    res.status(upstream.status).set('Content-Type', 'text/html; charset=utf-8').send(upstream.data);
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status ?? 504;
      const data = err.response?.data ?? { success: false, error: { message: err.message } };
      res.status(status).json(data);
      return;
    }
    res.status(504).json({ success: false, error: { code: 'GATEWAY_TIMEOUT', message: '评测服务暂不可用' } });
  }
});

router.get('/skill-eval/wizard/:jobId', async (req, res): Promise<void> => {
  const { jobId } = req.params;
  try {
    const upstream = await axios.get(`${SKILL_EVAL_BASE()}/wizard/${jobId}`, { timeout: 30000 });
    res.status(upstream.status).json({ success: true, data: upstream.data });
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status ?? 504;
      res.status(status).json(err.response?.data ?? { success: false, error: { message: (err as Error).message } });
      return;
    }
    res.status(504).json({ success: false, error: { code: 'GATEWAY_TIMEOUT', message: '评测服务暂不可用' } });
  }
});

router.post('/skill-eval/wizard/:jobId/answers', async (req, res): Promise<void> => {
  const { jobId } = req.params;
  try {
    const upstream = await axios.post(
      `${SKILL_EVAL_BASE()}/wizard/${jobId}/answers`,
      req.body,
      { timeout: 15000, headers: { 'Content-Type': 'application/json' } }
    );
    res.status(upstream.status).json({ success: true, data: upstream.data });
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status ?? 504;
      res.status(status).json(err.response?.data ?? { success: false, error: { message: (err as Error).message } });
      return;
    }
    res.status(504).json({ success: false, error: { code: 'GATEWAY_TIMEOUT', message: '评测服务暂不可用' } });
  }
});

router.get('/skill-eval/library', async (req, res): Promise<void> => {
  try {
    const upstream = await axios.get(`${SKILL_EVAL_BASE()}/library`, {
      params: req.query,
      timeout: 30000,
    });
    res.status(upstream.status).json({ success: true, data: upstream.data });
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status ?? 504;
      res.status(status).json(err.response?.data ?? { success: false, error: { message: (err as Error).message } });
      return;
    }
    res.status(504).json({ success: false, error: { code: 'GATEWAY_TIMEOUT', message: '评测服务暂不可用' } });
  }
});

router.get('/skill-eval/library/:journeyId', async (req, res): Promise<void> => {
  const { journeyId } = req.params;
  try {
    const upstream = await axios.get(`${SKILL_EVAL_BASE()}/library/${journeyId}`, { timeout: 30000 });
    res.status(upstream.status).json({ success: true, data: upstream.data });
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status ?? 504;
      res.status(status).json(err.response?.data ?? { success: false, error: { message: (err as Error).message } });
      return;
    }
    res.status(504).json({ success: false, error: { code: 'GATEWAY_TIMEOUT', message: '评测服务暂不可用' } });
  }
});

export default router;
