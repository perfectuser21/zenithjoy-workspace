import dotenv from 'dotenv';
import app from './app';

dotenv.config();

const PORT = process.env.PORT || 5200;

app.listen(PORT, () => {
  console.log(`🚀 Works Management API running on port ${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   API docs: http://localhost:${PORT}/api/works`);
  // 选题池 v1 阶段2：老 pipeline-scheduler 已废除，改由 topic-worker.py LaunchAgent 每日 09:00 触发
});
