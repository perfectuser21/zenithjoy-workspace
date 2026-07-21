/**
 * 员工工具路由（staff only）
 *
 * POST /api/staff/skill-eval/upload         — 上传 skill zip，转发到 Cecelia skill-eval 服务
 * GET  /api/staff/skill-eval/status/:jobId  — 查询评测状态，转发到同一服务
 * GET  /api/staff/skill-eval/report/:jobId  — 拉取评测报告，转发到同一服务
 *
 * 所有路由受 staffGuard 保护（STAFF_EMAILS 白名单）
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
import { Router } from 'express';
import multer from 'multer';
import axios from 'axios';
import { staffGuard } from '../middleware/staff';
import { simpleRateLimit } from '../middleware/simple-rate-limit';
import { ipKeyGenerator } from 'express-rate-limit';

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

type PathKey = 'path1' | 'path2' | 'path4';

type JourneyFeature = {
  id: string;
  name: string;
  status?: string | null;
  thickness?: string | null;
  kind?: string | null;
  updated_at?: string | null;
};

type GitHubRun = {
  id: number;
  html_url: string;
  status: string;
  conclusion: string | null;
  name: string;
  display_title?: string | null;
  run_started_at?: string | null;
  updated_at?: string | null;
};

const PATH_DEFS: Array<{
  pathKey: PathKey;
  label: string;
  journeyId: string;
  journeyName: string;
  smokeWorkflowHints: string[];
}> = [
  {
    pathKey: 'path1',
    label: 'Path 1',
    journeyId: 'c019cdeb-d90b-4f8b-a658-ae333663ac35',
    journeyName: '智能发布',
    smokeWorkflowHints: ['golden-path-1', 'path1', 'publish'],
  },
  {
    pathKey: 'path2',
    label: 'Path 2',
    journeyId: 'afa6abca-53c0-4815-8594-b7fb81ca547f',
    journeyName: '客户智能获客路径',
    smokeWorkflowHints: ['golden-path-2', 'path2', 'acquisition'],
  },
  {
    pathKey: 'path4',
    label: 'Path 4',
    journeyId: 'bfeed805-deed-46c3-8624-87f0028101d4',
    journeyName: '客户私域 AI 接管',
    smokeWorkflowHints: ['golden-path-4', 'path4', 'wechat'],
  },
];

// 反代地址：CECELIA_SKILL_EVAL_URL env var 优先（含协议+主机+端口+路径前缀），缺省走 9100
const SKILL_EVAL_BASE = () => process.env.CECELIA_SKILL_EVAL_URL ?? 'http://hk-vps:9100';
const CECELIA_BRAIN_BASE = () => process.env.CECELIA_BRAIN_URL ?? 'http://host.docker.internal:5221';
const GITHUB_REPO = process.env.STAFF_HUB_GITHUB_REPO ?? 'perfectuser21/zenithjoy-workspace';

function deriveSkillName(originalname: string): string {
  return originalname.replace(/\.zip$/i, '').trim() || 'unnamed-skill';
}

function maturityFromCounts(done: number, total: number): 'thin' | 'medium' | 'thick' | 'mature' {
  if (total <= 0 || done <= 0) return 'thin';
  const ratio = done / total;
  if (ratio >= 1) return 'mature';
  if (ratio >= 0.66) return 'thick';
  if (ratio >= 0.33) return 'medium';
  return 'thin';
}

async function fetchJourneyFeatures(journeyId: string): Promise<JourneyFeature[]> {
  const upstream = await axios.get(`${CECELIA_BRAIN_BASE()}/api/brain/journey_features`, {
    params: { journey_id: journeyId },
    timeout: 20000,
  });
  return Array.isArray(upstream.data) ? upstream.data as JourneyFeature[] : [];
}

async function fetchLatestSmokeRun(hints: string[]): Promise<GitHubRun | null> {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'zenithjoy-staff-hub',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const upstream = await axios.get(`https://api.github.com/repos/${GITHUB_REPO}/actions/runs`, {
    headers,
    params: { per_page: 30 },
    timeout: 20000,
  });
  const runs = Array.isArray(upstream.data?.workflow_runs) ? upstream.data.workflow_runs as GitHubRun[] : [];
  const matched = runs.find((run) => {
    const hay = `${run.name} ${run.display_title ?? ''}`.toLowerCase();
    return hints.some((hint) => hay.includes(hint.toLowerCase()));
  });
  return matched ?? null;
}

// ─── 飞书登录（公开路由，不受 staffGuard 保护 —— 登录前谈不上"已登录"）───────
const FEISHU_API_BASE = process.env.FEISHU_API_BASE ?? 'https://open.feishu.cn';

function parseStaffEmailsForLogin(): string[] {
  const raw = process.env.STAFF_EMAILS ?? '';
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
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
  const { open_id, name, email, access_token } = data.data;
  if (!open_id || !access_token) {
    throw new Error('FEISHU_USER_INFO_EMPTY: 飞书返回缺少 open_id/access_token');
  }
  return { openId: open_id, name: name ?? '', email: (email ?? '').toLowerCase(), accessToken: access_token };
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

    if (!feishuUser.email) {
      res.status(403).json({ success: false, error: '飞书账号未绑定邮箱，无法核对员工白名单' });
      return;
    }

    const staffEmails = parseStaffEmailsForLogin();
    if (!staffEmails.includes(feishuUser.email)) {
      res.status(403).json({ success: false, error: '该飞书账号邮箱不在员工白名单内' });
      return;
    }

    res.json({
      success: true,
      user: {
        id: feishuUser.openId,
        name: feishuUser.name || feishuUser.email,
        email: feishuUser.email,
        feishu_user_id: feishuUser.openId,
        access_token: feishuUser.accessToken,
      },
    });
  } catch (err) {
    const message = axios.isAxiosError(err) ? err.message : (err as Error).message;
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

router.get('/path-health', async (_req, res): Promise<void> => {
  const items = await Promise.all(PATH_DEFS.map(async (pathDef) => {
    let features: JourneyFeature[] = [];
    let smoke: GitHubRun | null = null;
    const messages: string[] = [];

    try {
      features = await fetchJourneyFeatures(pathDef.journeyId);
    } catch (err) {
      const message = axios.isAxiosError(err) ? err.message : 'brain unavailable';
      messages.push(`Brain: ${message}`);
    }

    try {
      smoke = await fetchLatestSmokeRun(pathDef.smokeWorkflowHints);
      if (!smoke) messages.push('GitHub: no recent smoke run matched');
    } catch (err) {
      const message = axios.isAxiosError(err) ? err.message : 'github unavailable';
      messages.push(`GitHub: ${message}`);
    }

    const doneCount = features.filter((feature) => feature.status === 'done').length;
    const featureCounts = {
      total: features.length,
      done: doneCount,
      working: features.filter((feature) => feature.status === 'working').length,
      planned: features.filter((feature) => feature.status === 'planned').length,
    };

    return {
      path_key: pathDef.pathKey,
      label: pathDef.label,
      journey_id: pathDef.journeyId,
      journey_name: pathDef.journeyName,
      maturity: maturityFromCounts(doneCount, features.length),
      availability: messages.length > 0 ? 'degraded' : 'ready',
      message: messages.length > 0 ? messages.join('; ') : null,
      feature_counts: featureCounts,
      features: features.map((feature) => ({
        id: feature.id,
        name: feature.name,
        status: feature.status ?? 'unknown',
        thickness: feature.thickness ?? 'unknown',
        kind: feature.kind ?? 'feature',
        updated_at: feature.updated_at ?? null,
      })),
      smoke: smoke ? {
        id: smoke.id,
        name: smoke.name,
        status: smoke.status,
        conclusion: smoke.conclusion,
        html_url: smoke.html_url,
        started_at: smoke.run_started_at ?? null,
        updated_at: smoke.updated_at ?? null,
      } : null,
    };
  }));

  res.status(200).json({
    success: true,
    data: items,
  });
});

export default router;
