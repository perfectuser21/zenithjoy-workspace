import express from 'express';
import cors from 'cors';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './auth';
import worksRouter from './routes/works';
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
import { adminLicenseRouter } from './routes/admin-license';
import { tasksRouter } from './routes/tasks';
import { tenantsRouter } from './routes/tenants';
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
app.use('/api/agent', agentRouter);
app.use('/api/admin/license', adminLicenseRouter);
app.use('/api/tenants', tenantsRouter);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
