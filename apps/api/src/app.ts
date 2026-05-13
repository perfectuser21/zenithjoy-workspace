import express from 'express';
import cors from 'cors';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './auth';
import worksRouter from './routes/works';
import workPerformanceRouter from './routes/work-performance';
import fieldsRouter from './routes/fields';
import publishRouter from './routes/publish';
import aiVideoRouter from './routes/ai-video';
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
import { accountRouter } from './routes/account';
import { tasksRouter } from './routes/tasks';
import { tenantsRouter } from './routes/tenants';
import { skillsRouter } from './routes/skills';
import { creditsRouter } from './routes/credits';
import feishuOauthRouter from './routes/feishu-oauth';
import leadConfigRouter from './routes/lead-config';
import smokeFeishuSeedRouter from './routes/_smoke-feishu-seed';
// Path 2 Sprint B-1 — 抖音小号绑定 + 评论抓取
import agentBurnerRouter from './routes/agent-burner';
import smokeFakeAgentBurnerRouter from './routes/_smoke-fake-agent-burner';
// Path 2 Sprint B-1 architecture hotfix — DEV-only mock-agent helper
import smokeMockAgentRouter from './routes/_smoke-mock-agent';
// Path 4 Sprint 1 WS1 — wechat 3 endpoints (thin stub)
import { wechatRouter } from './routes/wechat';
import { errorHandler, notFoundHandler } from './middleware/error';

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
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/works', worksRouter);
app.use('/api/works/:id/performance', workPerformanceRouter);
app.use('/api/fields', fieldsRouter);
app.use('/api', publishRouter);
app.use('/api/ai-video', aiVideoRouter);
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
// Walking Skeleton #1：先挂 heartbeat / folder/bind，再挂旧 agentRouter（按顺序匹配）
app.use('/api/agent', heartbeatRouter);
app.use('/api/agent', agentRouter);
// Sprint 2.1e：install pack manifest + download
app.use('/api/agent/install-pack', agentInstallPackRouter);
// Walking Skeleton #1：publish task 队列（/api/publish/task /receipt /tasks/:id）
app.use('/api/publish', publishWsRouter);
app.use('/api/admin/license', adminLicenseRouter);
app.use('/api/admin/users', adminUsersRouter);
// Walking Skeleton #1：客户自查 license（better-auth session 鉴权）
app.use('/api/account', accountRouter);
app.use('/api/tenants', tenantsRouter);
app.use('/api/skills', skillsRouter);
app.use('/api/credits', creditsRouter);
// Path 2 Sprint A — 多租户飞书集成
app.use('/api/feishu/oauth', feishuOauthRouter);
app.use('/api/lead-config', leadConfigRouter);
// Path 2 Sprint A WS5 — DEV-only 飞书 seed helper（生产 NODE_ENV=production 必返 404）
app.use('/api/_smoke', smokeFeishuSeedRouter);
// Path 2 Sprint B-1 — 抖音小号绑定 6 路由 + smoke fake-agent helper
app.use('/api/agent/burner', agentBurnerRouter);
app.use('/api/_smoke', smokeFakeAgentBurnerRouter);
// Path 2 Sprint B-1 architecture hotfix — DEV-only mock-agent helper（lead 自验用）
app.use('/api/_smoke', smokeMockAgentRouter);
// Path 4 Sprint 1 WS1 — wechat 3 endpoints (qr-bind / draft-review-poll / scheduler-tick)
app.use('/api/wechat', wechatRouter);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
