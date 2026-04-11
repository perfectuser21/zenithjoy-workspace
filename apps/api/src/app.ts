import express from 'express';
import cors from 'cors';
import worksRouter from './routes/works';
import fieldsRouter from './routes/fields';
import publishRouter from './routes/publish';
import aiVideoRouter from './routes/ai-video';
import snapshotsRouter from './routes/snapshots';
import douyinAuthRouter from './routes/douyin-auth';
import pipelineRouter from './routes/pipeline';
import { errorHandler, notFoundHandler } from './middleware/error';

const app = express();

// Middleware
app.use(cors());
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

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
