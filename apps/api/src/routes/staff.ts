/**
 * 员工工具路由（staff only）
 *
 * POST /api/staff/skill-eval/upload  — 上传 skill zip，转发到 HK Cecelia skill-eval 服务（9100 端口）
 * GET  /api/staff/skill-eval/status/:jobId — 查询评测状态，转发到同一服务
 *
 * 所有路由受 staffGuard 保护（STAFF_EMAILS 白名单）
 */
import { Router } from 'express';
import multer from 'multer';
import axios from 'axios';
import { staffGuard } from '../middleware/staff';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

// HK 反代地址：CECELIA_SKILL_EVAL_URL env var 优先（含协议+主机+端口），缺省走 9100
const SKILL_EVAL_BASE = () => process.env.CECELIA_SKILL_EVAL_URL ?? 'http://hk-vps:9100';

router.use(staffGuard);

router.post('/skill-eval/upload', upload.single('file'), async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ success: false, error: { code: 'NO_FILE', message: '缺少 file 字段' } });
    return;
  }

  const fd = new globalThis.FormData();
  fd.append('file', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);

  try {
    const upstream = await axios.post(`${SKILL_EVAL_BASE()}/upload`, fd, {
      timeout: 30000,
    });
    res.status(upstream.status).json(upstream.data);
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
    res.status(upstream.status).json(upstream.data);
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
