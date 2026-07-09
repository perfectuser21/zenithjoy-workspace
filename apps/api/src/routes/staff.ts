/**
 * 员工工具路由（staff only）
 *
 * POST /api/staff/skill-eval/upload         — 上传 skill zip，转发到 Cecelia skill-eval 服务
 * GET  /api/staff/skill-eval/status/:jobId  — 查询评测状态，转发到同一服务
 * GET  /api/staff/skill-eval/report/:jobId  — 拉取评测报告（report_data JSON），转发到同一服务
 *
 * 所有路由受 staffGuard 保护（STAFF_EMAILS 白名单）
 *
 * 下游 Cecelia /api/skill-eval/* 契约（packages/brain/src/routes/eval.js）：
 * - upload 必须带 multipart 字段 skill_name（必填）+ file；成功返回 { task_id, queue_position, message }
 * - status 返回 { task_id, status, report_url, failure_reason, queue_position, created_at, updated_at }
 *   （没有内联的 result.score/summary/details——那是本路由早期实现的臆造字段，从未匹配过真实下游）
 * - report_url 是下游 Brain 自己的 localhost 地址，浏览器不可达；报告内容改走本路由的
 *   /report/:jobId 转发（复用 SKILL_EVAL_BASE 通用反代前缀，不依赖 report_url 字面值）
 */
import { Router } from 'express';
import multer from 'multer';
import axios from 'axios';
import { staffGuard } from '../middleware/staff';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

// 反代地址：CECELIA_SKILL_EVAL_URL env var 优先（含协议+主机+端口+路径前缀），缺省走 9100
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

  const fd = new globalThis.FormData();
  fd.append('file', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);
  fd.append('skill_name', deriveSkillName(req.file.originalname));
  fd.append('submitter', submitter);

  try {
    const upstream = await axios.post(`${SKILL_EVAL_BASE()}/upload`, fd, {
      timeout: 30000,
    });
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
    const upstream = await axios.get(`${SKILL_EVAL_BASE()}/status/${jobId}`, {
      timeout: 30000,
    });
    res.status(upstream.status).json({
      success: true,
      data: {
        job_id: upstream.data?.task_id,
        status: upstream.data?.status,
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
  try {
    const upstream = await axios.get(`${SKILL_EVAL_BASE()}/report/${jobId}`, {
      params: { format: 'json' },
      timeout: 30000,
    });
    res.status(upstream.status).json({ success: true, data: upstream.data });
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

export default router;
