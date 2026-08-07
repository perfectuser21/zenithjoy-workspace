/**
 * 员工工具路由（staff only）
 *
 * POST /api/staff/skill-eval/upload         — 上传 skill zip，转发到 Cecelia skill-eval 服务
 * GET  /api/staff/skill-eval/status/:jobId  — 查询评测状态，转发到同一服务
 * GET  /api/staff/skill-eval/report/:jobId  — 拉取评测报告，转发到同一服务
 *
 * 所有路由受 staffGuard 保护（STAFF_EMAILS 或 STAFF_FEISHU_OPENIDS 白名单，任一命中放行）
 *
 * 下游 Cecelia /api/skill-eval/* 契约（packages/brain/src/routes/eval.js）：
 * - upload 必须带 multipart 字段 skill_name（必填）+ file；成功返回 { task_id, queue_position, message }
 * - status 返回 { task_id, status, report_url, failure_reason, queue_position, created_at, updated_at }
 *   （没有内联的 result.score/summary/details——那是本路由早期实现的臆造字段，从未匹配过真实下游）
 * - report_url 是下游 Brain 自己的 localhost 地址，浏览器不可达；报告内容改走本路由的
 *   /report/:jobId 转发（复用 SKILL_EVAL_BASE 通用反代前缀，不依赖 report_url 字面值）
 * - report 默认返回下游团队做好的完整可视化 HTML 报告（skill-eval-report-render.js，
 *   SVG 输入盒→圆核→输出盒图 + 折叠详解表），原样透传，不再重新臆造一个更差的展示层；
 *   ?format=json 时改拉原始 report_data JSON（调试/兼容用）
 */
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import axios from 'axios';
import { staffGuard } from '../middleware/staff';
import { simpleRateLimit } from '../middleware/simple-rate-limit';
import { ipKeyGenerator } from 'express-rate-limit';
import {
  buildLineAbilities,
  buildLineDeployment,
  buildLineHealthOverview,
  findLineDef,
} from '../services/line-health';
import {
  fetchPendingRuns,
  fetchHistoryByGpId,
  submitResults,
  type SubmitResultItem,
} from '../services/acceptance';
import { fetchWorkbenchSummary, submitWorkbenchFeedback } from '../services/workbench';

const router = Router();
// 登录端点身份未知，按来源 IP 限流（不能按 tenant/user，此时还没有）：
// 5次/5分钟/IP，防暴力枚举白名单邮箱 + 防止刷爆真实飞书 API 调用配额
// 用库自带 ipKeyGenerator 而非裸 req.ip，避免 IPv6 地址被当成互不相同的独立 key 绕过限流
const feishuLoginRateLimit = simpleRateLimit({
  windowMs: 5 * 60_000,
  max: 5,
  keyFn: (req) => ipKeyGenerator(req.ip || 'unknown'),
});
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

// 反代地址：CECELIA_SKILL_EVAL_URL env var 优先（含协议+主机+端口+路径前缀），缺省走 9100
const SKILL_EVAL_BASE = () => process.env.CECELIA_SKILL_EVAL_URL ?? 'http://hk-vps:9100';

function deriveSkillName(originalname: string): string {
  return originalname.replace(/\.zip$/i, '').trim() || 'unnamed-skill';
}

// ─── 飞书登录（公开路由，不受 staffGuard 保护 —— 登录前谈不上"已登录"）───────
const FEISHU_API_BASE = process.env.FEISHU_API_BASE ?? 'https://open.feishu.cn';

function parseStaffEmailsForLogin(): string[] {
  const raw = process.env.STAFF_EMAILS ?? '';
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function parseStaffFeishuOpenIdsForLogin(): string[] {
  const raw = process.env.STAFF_FEISHU_OPENIDS ?? '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

interface FeishuAppAccessTokenResp {
  code: number;
  msg?: string;
  app_access_token?: string;
  expire?: number;
}

interface FeishuUserInfoResp {
  code: number;
  msg?: string;
  data?: {
    open_id?: string;
    name?: string;
    email?: string;
    enterprise_email?: string;
    access_token?: string;
  };
}

async function fetchFeishuAppAccessToken(appId: string, appSecret: string): Promise<string> {
  const resp = await axios.post<FeishuAppAccessTokenResp>(
    `${FEISHU_API_BASE}/open-apis/auth/v3/app_access_token/internal`,
    { app_id: appId, app_secret: appSecret },
    { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
  );
  const data = resp.data || ({} as FeishuAppAccessTokenResp);
  if (data.code !== 0 || !data.app_access_token) {
    throw new Error(`FEISHU_APP_TOKEN_ERROR: code=${data.code ?? 'unknown'} msg=${data.msg ?? ''}`);
  }
  return data.app_access_token;
}

async function fetchFeishuUserByCode(
  appAccessToken: string,
  code: string
): Promise<{ openId: string; name: string; email: string; accessToken: string }> {
  const resp = await axios.post<FeishuUserInfoResp>(
    `${FEISHU_API_BASE}/open-apis/authen/v1/access_token`,
    { grant_type: 'authorization_code', code },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${appAccessToken}`,
      },
      timeout: 10000,
    }
  );
  const data = resp.data || ({} as FeishuUserInfoResp);
  if (data.code !== 0 || !data.data) {
    throw new Error(`FEISHU_USER_INFO_ERROR: code=${data.code ?? 'unknown'} msg=${data.msg ?? ''}`);
  }
  const { open_id, name, email, enterprise_email, access_token } = data.data;
  if (!open_id || !access_token) {
    throw new Error('FEISHU_USER_INFO_EMPTY: 飞书返回缺少 open_id/access_token');
  }
  const resolvedEmail = email || enterprise_email || '';
  return { openId: open_id, name: name ?? '', email: resolvedEmail.toLowerCase(), accessToken: access_token };
}

router.post('/feishu-login', feishuLoginRateLimit, async (req, res): Promise<void> => {
  const code = typeof req.body?.code === 'string' ? req.body.code : '';
  if (!code) {
    res.status(400).json({ success: false, error: '缺少飞书授权 code' });
    return;
  }

  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) {
    res.status(500).json({ success: false, error: '服务端未配置 FEISHU_APP_ID/FEISHU_APP_SECRET' });
    return;
  }

  try {
    const appAccessToken = await fetchFeishuAppAccessToken(appId, appSecret);
    const feishuUser = await fetchFeishuUserByCode(appAccessToken, code);
    console.log(`[feishu-login] 换到用户信息: openId=${feishuUser.openId} email=${feishuUser.email || '(空)'}`);

    const staffOpenIds = parseStaffFeishuOpenIdsForLogin();
    const staffEmails = parseStaffEmailsForLogin();
    const openIdOk = staffOpenIds.includes(feishuUser.openId);
    const emailOk = feishuUser.email !== '' && staffEmails.includes(feishuUser.email);

    if (!openIdOk && !emailOk) {
      console.warn(`[feishu-login] 拒绝: openId=${feishuUser.openId} email=${feishuUser.email || '(空)'} 均不在白名单`);
      res.status(403).json({ success: false, error: '该飞书账号不在员工白名单内' });
      return;
    }

    console.log(`[feishu-login] 登录成功: openId=${feishuUser.openId}${emailOk ? ` email=${feishuUser.email}` : ''}`);
    res.json({
      success: true,
      user: {
        id: feishuUser.openId,
        name: feishuUser.name || feishuUser.email || feishuUser.openId,
        email: feishuUser.email,
        feishu_user_id: feishuUser.openId,
        access_token: feishuUser.accessToken,
      },
    });
  } catch (err) {
    const message = axios.isAxiosError(err) ? err.message : (err as Error).message;
    const respBody = axios.isAxiosError(err) ? JSON.stringify(err.response?.data) : '';
    console.error(`[feishu-login] 失败: ${message} ${respBody}`);
    res.status(502).json({ success: false, error: `飞书登录失败：${message}` });
  }
});

router.use(staffGuard);

router.post('/skill-eval/upload', upload.single('file'), async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ success: false, error: { code: 'NO_FILE', message: '缺少 file 字段' } });
    return;
  }

  const submitter = typeof req.headers['x-user-email'] === 'string' ? req.headers['x-user-email'] : '';
  // 来源平台 + 归属线：前端下拉选择传来的字段（multer 把非 file 字段放进 req.body）
  const platform = typeof req.body?.platform === 'string' ? req.body.platform : '';
  const journeyId = typeof req.body?.journey_id === 'string' ? req.body.journey_id : '';

  const fd = new globalThis.FormData();
  fd.append('file', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);
  fd.append('skill_name', deriveSkillName(req.file.originalname));
  fd.append('submitter', submitter);
  fd.append('platform', platform);
  fd.append('journey_id', journeyId);

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

// ─── 业务线健康看板（GP3 / line_health）────────────────────────────────────
// 原「Path 健康」页面（/path-health，PATH_DEFS）与本页面是同一件事——业务线清单更权威
// （product-map.json SSOT）、详情页多了部署/能力两个 tab，Path 健康已下线并入本页面。
// 聚合逻辑在 services/line-health.ts，本处只做路由注册 + HTTP 语义（404 / 200 降级）。
// 三个端点都在 router.use(staffGuard) 之后注册，因此都受员工白名单保护。

function lineNotFound(res: Response): void {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'unknown line_key' },
  });
}

router.get('/line-health', async (_req, res): Promise<void> => {
  const overview = await buildLineHealthOverview();
  res.status(200).json({
    success: true,
    data: overview.data,
    deployment: overview.deployment,
    source: overview.source,
    fallback_reason: overview.fallback_reason,
  });
});

router.get('/line-health/:lineKey/deployment', async (req, res): Promise<void> => {
  const def = findLineDef(req.params.lineKey);
  // 未知 lineKey 明确 404，不静默返回 200 空数据（否则前端会误判成"这条线没数据"）
  if (!def) {
    lineNotFound(res);
    return;
  }
  const data = await buildLineDeployment(def);
  res.status(200).json({ success: true, data });
});

router.get('/line-health/:lineKey/abilities', async (req, res): Promise<void> => {
  const def = findLineDef(req.params.lineKey);
  if (!def) {
    lineNotFound(res);
    return;
  }
  const data = await buildLineAbilities(def);
  res.status(200).json({ success: true, data });
});

// ─── 验收模块（Staff Hub 直连 Brain，决策 fc7b5dc0）───────────────────────
// 反代逻辑在 services/acceptance.ts，本处只做 HTTP 语义 + 身份透传。

router.get('/acceptance/pending', async (_req, res): Promise<void> => {
  const result = await fetchPendingRuns();
  res.status(200).json({ success: true, ...result });
});

router.get('/acceptance/history', async (req, res): Promise<void> => {
  const gpId = typeof req.query.gp_id === 'string' ? req.query.gp_id : '';
  if (!gpId) {
    res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'gp_id query param required' } });
    return;
  }
  const result = await fetchHistoryByGpId(gpId);
  res.status(200).json({ success: true, ...result });
});

router.post('/acceptance/results', async (req, res): Promise<void> => {
  const items = req.body?.results as SubmitResultItem[] | undefined;
  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'results must be a non-empty array' } });
    return;
  }
  // run_key 是写入作用域：同批合并的 cecelia D1 PR 把 Brain 的 submitAcceptanceResults
  // 改成无 run_key 一律 400，这里先挡住，不白跑一趟网络。
  // 作用域的真正校验（check_key 属不属于该 run）在 Brain 侧按 run_id 做，网关不重复判。
  const runKey = typeof req.body?.run_key === 'string' ? req.body.run_key.trim() : '';
  if (!runKey) {
    res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'run_key required（写入必须限定在单个 run 作用域内）' } });
    return;
  }
  const submittedBy = (req as Request & { staffIdentity?: string }).staffIdentity ?? 'unknown';
  try {
    const result = await submitResults(items, submittedBy, runKey);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    const message = axios.isAxiosError(err) ? err.message : (err as Error).message || 'submit failed';
    res.status(502).json({ success: false, error: { code: 'BRAIN_UNAVAILABLE', message } });
  }
});

// ─── 员工工作台（Workbench，任务 9cc10ff2 · 决策 af0d0818 执行层）────────────
// 汇总"今天轮到我判断什么" + 反馈网关（→Brain captures 进箱走去向链）。

router.get('/workbench/summary', async (_req, res): Promise<void> => {
  const result = await fetchWorkbenchSummary();
  res.status(200).json({ success: true, ...result });
});

router.post('/workbench/feedback', async (req, res): Promise<void> => {
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  if (!content) {
    res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'content is required' } });
    return;
  }
  const nature = req.body?.nature === 'issue' ? 'issue' as const : undefined;
  const link = typeof req.body?.link === 'string' && req.body.link.trim() ? req.body.link.trim() : undefined;
  const email = (req as Request & { staffIdentity?: string }).staffIdentity;
  try {
    const capture = await submitWorkbenchFeedback({ content, nature, link, email });
    res.status(200).json({ success: true, capture });
  } catch (err) {
    const message = axios.isAxiosError(err) ? err.message : (err as Error).message || 'feedback failed';
    res.status(502).json({ success: false, error: { code: 'BRAIN_UNAVAILABLE', message } });
  }
});

export default router;
