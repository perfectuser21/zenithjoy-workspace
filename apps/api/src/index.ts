import dotenv from 'dotenv';
import app from './app';
import { startPipelineScheduler } from './services/pipeline-scheduler.service';

dotenv.config();

const PORT = process.env.PORT || 5200;

app.listen(PORT, () => {
  console.log(`🚀 Works Management API running on port ${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   API docs: http://localhost:${PORT}/api/works`);
  startPipelineScheduler();
});
