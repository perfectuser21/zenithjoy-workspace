/** Browser fixture: real staff router/guard; only the external Cecelia evaluator is local. */
import express from 'express';
import staffRouter from '../../src/routes/staff';

process.env.STAFF_EMAILS = 'staff@example.test';
process.env.CECELIA_SKILL_EVAL_URL = 'http://127.0.0.1:15312';
const upstream = express();
upstream.use(express.raw({ type: () => true, limit: '1mb' }));
upstream.post('/upload', (req, res) => {
  const body = req.body.toString();
  if (body.includes('timeout.zip')) return res.status(504).json({ error: { message: 'fixture timeout' } });
  return res.json({ task_id: 'fixture-eval-job', queue_position: 0 });
});
upstream.get('/status/fixture-eval-job', (_req, res) => res.json({ task_id: 'fixture-eval-job', status: 'completed' }));
upstream.get('/report/fixture-eval-job', (_req, res) => res.type('html').send('<html><body><h1>Fixture report</h1></body></html>'));
upstream.listen(15312, '127.0.0.1');
const app = express();
app.use(express.json());
// No real account/DB is used: current AuthContext falls back to a per-context fixture identity cookie.
app.get('/api/auth/get-session', (_req, res) => res.json(null));
app.use('/api/staff', staffRouter);
app.get('/health', (_req, res) => res.json({ ok: true }));
app.listen(15311, '127.0.0.1');
