import express from 'express';
import cors from 'cors';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './auth';
import worksRouter from './routes/works';
import workPerformanceRouter from './routes/work-performance';
import publishRouter from './routes/publish';
import aiVideoRouter from './routes/ai-video';
import aiVideoPipelineRouter from './routes/ai-video-pipeline';
import snapshotsRouter from './routes/snapshots';
import douyinAuthRouter from './routes/douyin-auth';
import pipelineRouter from './routes/pipeline';
import contentImagesRouter from './routes/content-images';
import topicsRouter from './routes/topics';
import pacingConfigRouter from './routes/pacing-config';
import pipelinesWorkerRouter from './routes/pipelines-worker';
import competitorResearchRouter from './routes/competitor-research';
import { agentRouter } from './routes/agent';
import { heartbeatRouter, publishWsRouter } from './routes/walking-skeleton';
import { agentInstallPackRouter } from './routes/agent-install-pack';
import { adminLicenseRouter } from './routes/admin-license';
import { adminUsersRouter } from './routes/admin-users';
import { adminCustomersRouter } from './routes/admin-customers';
import { customerAdminRouter } from './routes/customer-admin';
import { operatorRouter } from './routes/operator';
import { accountRouter } from './routes/account';
import { profileRouter } from './routes/profile';
import { tasksRouter } from './routes/tasks';
import { tenantsRouter } from './routes/tenants';
import { skillsRouter } from './routes/skills';
import { creditsRouter } from './routes/credits';
import { agentCreditRouter } from './routes/agent-credit';
import feishuOauthRouter from './routes/feishu-oauth';
import crmRouter from './routes/crm';
// Path 2 Step4 — DEV-only fake-LLM 替身（根路径自托管，仅非生产挂载）
import { fakeLlmRouter } from './routes/_smoke-fake-llm';
// Path 2 Sprint B-1 — 抖音小号绑定 + 评论抓取
import agentBurnerRouter from './routes/agent-burner';
import agentMachinesRouter from './routes/agent-machines';
import agentEventsRouter from './routes/agent-events';
import smokeFakeAgentBurnerRouter from './routes/_smoke-fake-agent-burner';
// Path 2 Sprint B-1 architecture hotfix — DEV-only mock-agent helper
import smokeMockAgentRouter from './routes/_smoke-mock-agent';
// Line02 安卓真机采集 smoke 自愈 — DEV-only 幂等 seed 固定测试租户（抗 DB 重置）
import smokeAcquisitionSeedRouter from './routes/_smoke-acquisition-seed';
// Path 4 Sprint 1 WS1 — wechat 3 endpoints (thin stub)
import { wechatRouter } from './routes/wechat';
// Path 4 Sprint B — 微信客服中台配置（人设/企业知识库 CRUD + AI 帮填 A1-A5）
import { wechatConfigRouter } from './routes/wechat-config';
// Line04 对话记忆三层后端 — tenant 隔离的 写消息/取上下文/触发日收尾
import { wechatMemoryRouter } from './routes/wechat-memory';
// 作战窗 Agent Panel 刀1 — events 表薄写入端点
import { panelEventsRouter } from './routes/panel-events';
import clipsRouter from './routes/clips';
import clipsAuthRouter from './routes/clips-auth';
import { acquisitionRouter } from './routes/acquisition';
import { acquisitionDispatchRouter } from './routes/acquisition-dispatch';
import { companyProfileRouter } from './routes/company-profile';
import { line02Router } from './routes/line02';
import { brainSprintStateRouter } from './routes/brain-sprint-state';
// Line 00 Session Health Medium WS2 — 运营中枢 8 平台 session 端点
import { operatorSessionsRouter } from './routes/operator-sessions';
// Line 07 — AI 爆款视频翻拍 9节点流水线
import videoRemakeRouter from './routes/video-remake';
import staffRouter from './routes/staff';
// Line11 员工知识中枢 路① — 经验录入/最近沉淀/投影只读（挂 knowledgeAuthGuard，只信会话）
import { knowledgeRouter } from './routes/knowledge';
// Line11 路① — DEV-only 假飞书上游（生产不挂载）
import { fakeFeishuRouter, installFakeFeishuAxiosShim } from './routes/_smoke-fake-feishu';
import { skillDraftsRouter, skillDraftsInternalRouter } from './routes/skill-drafts';
import { agentOfflineScanRouter } from './routes/agent-offline-scan';
import { errorHandler, notFoundHandler } from './middleware/error';
import { simpleRateLimit, ipKeyFn } from './middleware/simple-rate-limit';
import { verifyStartupConfig } from './startup-check';
import { getBuildInfo } from './build-info';

const app = express();

// Better-auth 路由必须在 express.json() 之前 mount（否则 body 被消费两次会出错）
// CORS 须含 credentials 以让 session cookie 跨子域共享
app.use(
  cors({
    origin: (origin, cb) => cb(null, true),
    credentials: true,
  })
);
// vitest 单元测试跳过 auth 路由挂载：toNodeHandler(auth) 会立即 'handler' in auth 探测，
// 触发 Proxy lazy-init 然而单元测试 mock 了 pg.Pool → BetterAuthError.
// 用 VITEST env（vitest 自动设置 'true'）而不是 NODE_ENV（CI smoke 也设 test）。
// 真实 smoke / dev / prod 都正常 mount auth 路由。
if (!process.env.VITEST) {
  app.all('/api/auth/*', toNodeHandler(auth));
}

// 之后才挂 body parser
// limit: '1mb' —— 真机排查 2026-07-19：/judge-video 的音频判定(capture_type=audio)真实
// payload 约 870-880KB（20秒16kHz单声道16bit PCM base64后），默认100KB早期就被拒
// (PayloadTooLargeError)。1mb 是 hk-vps nginx 反代 /api/ 通用路径未覆盖 client_max_body_size
// 时的默认上限——设更大在 nginx 那层就先被截断，1mb 是不碰生产nginx配置前提下的安全上限。
app.use(express.json({ limit: '1mb' }));

// 截图静态服务（Sprint E2E 截图托管）
const screenshotsDir = process.env.SCREENSHOTS_DIR || '/opt/zenithjoy/screenshots';
app.use('/screenshots', express.static(screenshotsDir));

// Health check —— 含 env 自检状态 + 构建信息，让部署后冒烟能看到配置是否漏 key、跑的是哪个构建
app.get('/health', (req, res) => {
  const cfg = verifyStartupConfig();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    config: { ok: cfg.ok, missing: cfg.missing },
    build: getBuildInfo(),
  });
});

// Version —— 暴露真正在跑的构建（git sha / version / 构建时间）。
// 发版脚本干净重启后断言 /version.sha == 刚部署 commit，不一致 = 跑的是旧进程 → 发版红。
// D2 FR-3：/api/version 与 /version 同时挂载（capture.mjs fail-loud 路径为 /api/version）。
// /api/health 与 /health 同挂：反代下 /api 前缀是唯一稳定可达的路径，
// 部署/E2E 的就绪探测走它。
app.get('/api/health', simpleRateLimit({ windowMs: 60_000, max: 600, keyFn: ipKeyFn }), (req, res) => {
  const cfg = verifyStartupConfig();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    config: { ok: cfg.ok, missing: cfg.missing },
    build: getBuildInfo(),
  });
});

app.get('/version', (req, res) => {
  res.json(getBuildInfo());
});
app.get('/api/version', (req, res) => {
  res.json(getBuildInfo());
});

// Path 2 Step4 — fake-LLM 替身：仅非生产挂载于根路径，
// 供 evaluator/CI 把 OPENROUTER_BASE_URL 指向 apps/api 自身做端到端验证。
// 生产不挂载 → 真 OpenRouter 链路不受影响。router 对未匹配路径会 next() 透传。
if (process.env.NODE_ENV !== 'production') {
  app.use(fakeLlmRouter);
  // Line11 路① — 假飞书上游：HTTP 形态供 smoke/E2E，进程内形态供没有真监听端口的单测。
  // 生产两条都不挂，登录一律走真 open.feishu.cn。
  app.use('/api/_smoke/fake-feishu', fakeFeishuRouter);
  installFakeFeishuAxiosShim();
}

// API routes
app.use('/api/works', worksRouter);
app.use('/api/works/:id/performance', workPerformanceRouter);
app.use('/api', publishRouter);
app.use('/api/ai-video', aiVideoRouter);
// Path 1 Step 5 — AI 视频本地流水线（jobs CRUD + AI API 代理）
app.use('/api/ai-video/jobs', aiVideoPipelineRouter);
app.use('/api/ai-video-pipeline', aiVideoPipelineRouter);
app.use('/api/snapshots', snapshotsRouter);
app.use('/api', douyinAuthRouter);
app.use('/api/pipeline', pipelineRouter);
// content-images：公开访问（图片由 <img> 直接加载，不能加鉴权中间件）
app.use('/api/content-images', contentImagesRouter);
app.use('/api/topics', topicsRouter);
app.use('/api/pacing-config', pacingConfigRouter);
app.use('/api/pipelines', pipelinesWorkerRouter);
app.use('/api/competitor-research', competitorResearchRouter);
// /api/agent/tasks must be registered before /api/agent to avoid route conflict
app.use('/api/agent/tasks', tasksRouter);
// /api/agent/credit 必须在 /api/agent 之前注册（路径精确匹配，避免被 agentRouter 吞）
app.use('/api/agent/credit', agentCreditRouter);
// /api/agent/machines 同样必须在 /api/agent(agentRouter) 之前注册（按顺序匹配，避免被吞）
app.use('/api/agent/machines', agentMachinesRouter);
// 观测事件路由：POST /api/agent/events + GET /api/agent/machines/:id/events
// 必须在 agentMachinesRouter 之后、agentRouter 之前注册（路径写全，避免被吞）
app.use('/api/agent', agentEventsRouter);
// Walking Skeleton #1：先挂 heartbeat / folder/bind，再挂旧 agentRouter（按顺序匹配）
app.use('/api/agent', heartbeatRouter);
app.use('/api/agent', agentRouter);
// Sprint 2.1e：install pack manifest + download
app.use('/api/agent/install-pack', agentInstallPackRouter);
// Walking Skeleton #1：publish task 队列（/api/publish/task /receipt /tasks/:id）
app.use('/api/publish', publishWsRouter);
app.use('/api/admin/license', adminLicenseRouter);
app.use('/api/admin/users', adminUsersRouter);
app.use('/api/admin/customers', adminCustomersRouter);
// Line 10 客户管理后台 — 公司名 / 子账号 / 客服-PC 绑定 / 诊断（singular /api/tenant，区别于 /api/tenants 复数）
app.use('/api/tenant', customerAdminRouter);
// operatorSessionsRouter 必须在 operatorRouter 之前注册：
// operator.ts 有 router.use(superAdminGuard) 全局拦截所有 /api/operator/* 请求，
// 若先注册 operatorRouter，sessions 的 GET/POST 会被 superAdminGuard 401 终止，
// 永远到不了 operatorSessionsRouter。
app.use('/api/operator/sessions', operatorSessionsRouter);
app.use('/api/operator', operatorRouter);
// Walking Skeleton #1：客户自查 license（better-auth session 鉴权）
app.use('/api/account', accountRouter);
// Walking Skeleton #3：画像诊断（行业/受众/风格）
app.use('/api/profile', profileRouter);
app.use('/api/tenants', tenantsRouter);
app.use('/api/skills', skillsRouter);
app.use('/api/credits', creditsRouter);
// Path 2 Sprint A — 多租户飞书集成
app.use('/api/feishu/oauth', feishuOauthRouter);
// Line04 中台 AI-native CRM·客户列表页（/customers 读名册租户闸 + manage/status/POST 写接口）
app.use('/api/crm', crmRouter);
// Path 2 Sprint B-1 — 抖音小号绑定 6 路由 + smoke fake-agent helper
app.use('/api/agent/burner', agentBurnerRouter);
app.use('/api/_smoke', smokeFakeAgentBurnerRouter);
// Path 2 Sprint B-1 architecture hotfix — DEV-only mock-agent helper（lead 自验用）
app.use('/api/_smoke', smokeMockAgentRouter);
// Line02 安卓真机采集 smoke 自愈 seed helper（生产 NODE_ENV=production 必返 404）
app.use('/api/_smoke', smokeAcquisitionSeedRouter);
// Path 4 — wechat endpoints (qr-bind / scheduler-tick / draft-generate 去飞书自动直发)
app.use('/api/wechat', wechatRouter);
// Path 4 Sprint B — 微信客服配置 CRUD（/persona, /business-kb, /business-kb/suggest-audience）
app.use('/api/wechat', wechatConfigRouter);
// Line04 对话记忆三层后端 — /api/wechat/memory/{message,consolidate,context}
app.use('/api/wechat', wechatMemoryRouter);
app.use('/api/panel', panelEventsRouter);
app.use('/api/clips', clipsRouter);
app.use('/api/clips/auth', clipsAuthRouter);
// 智能获客「分析+指派」中台大脑（刀1）— 挂同前缀，路径(/config,/dispatch/*,/cookie-health)不与 acquisitionRouter 冲突
app.use('/api/acquisition', acquisitionDispatchRouter);
app.use('/api/acquisition', acquisitionRouter);
// Harness Sprint State — Walking Skeleton 本地持久化（Brain DB source of truth）
app.use('/api/brain', brainSprintStateRouter);
// Line 07 — AI 爆款视频翻拍 9节点流水线
app.use('/api/video-remake', videoRemakeRouter);
app.use('/api/staff/skill-drafts', skillDraftsRouter);
// 内部回调端点（子进程完成后通知终态，无 staffGuard，无公网暴露）
app.use('/internal/skill-drafts', skillDraftsInternalRouter);
// 内部 Agent 离线扫描触发端点（无鉴权，仅内部/smoke 调用）
app.use('/api/internal/agent-offline-scan', agentOfflineScanRouter);
// Line11 员工知识中枢 —— 必须排在 staffRouter 之前：staffRouter 内部 router.use(staffGuard)
// 会拦下 /api/staff/* 的一切后续请求，挂在它后面的话知识端点会被身份头闸接管，
// 「身份只来自会话」当场作废。
app.use('/api/staff/knowledge', knowledgeRouter);
// Line 00 运营中枢 — 员工工具（staff only，受 staffGuard 保护）
app.use('/api/staff', staffRouter);
// Line 02 — 公司信息页 + 账号状态
app.use('/api/company-profile', companyProfileRouter);
app.use('/api/line02', line02Router);
// (operatorSessionsRouter 已在 operatorRouter 之前注册，见上方)

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
