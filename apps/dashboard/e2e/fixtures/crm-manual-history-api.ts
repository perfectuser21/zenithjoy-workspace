import express from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Pool } from 'pg';
import { createManualHistoryRouter } from '../../../api/src/routes/crm-manual-history';
import runtimePool from '../../../api/src/db/connection';

export async function closeFixturePools() { await runtimePool.end(); }

export const tenantA = '11111111-1111-4111-8111-111111111111';
export const tenantB = '22222222-2222-4222-8222-222222222222';
export function createFixture(db: Pool) {
  const state = { calls: 0, failModel: false, delayMs: 0, timeShift: 0 };
  const authenticate: express.RequestHandler = (req, res, next) => {
    const cookie = req.get('cookie') || '';
    const who = /crm_fixture_session=(a2|a|b)(?:;|$)/.exec(cookie)?.[1];
    if (!who) { res.sendStatus(401); return; }
    Object.assign(req, { tenantId: who.startsWith('a') ? tenantA : tenantB,
      feishuUserId: `fixture-user-${who}`, tenantRole: 'owner' });
    next();
  };
  const app = express();
  app.use(rateLimit({ windowMs: 60000, limit: 500, standardHeaders: 'draft-7', legacyHeaders: false }));
  app.use(express.json({ limit: '128kb' }));
  app.get('/api/crm/customers/:contact/profile', authenticate, async (req, res) => {
    const r = await db.query('SELECT id,contact FROM zenithjoy.crm_customers WHERE tenant_id=$1 AND contact=$2', [req.tenantId, req.params.contact]);
    if (!r.rows.length) { res.sendStatus(404); return; }
    res.json({ profile: { customer_id: String(r.rows[0].id), contact: r.rows[0].contact,
      name: r.rows[0].contact, status: 'A1', managed: false, messages: [], timeline: [], dailies: [] } });
  });
  app.use('/api/crm/manual-history', createManualHistoryRouter({ db, authenticate, now: () => Date.now() + state.timeShift, generate: process.env.CRM_MANUAL_REAL_AI === '1' ? undefined : async () => {
    state.calls++;
    if (state.delayMs) await new Promise(resolve => setTimeout(resolve, state.delayMs));
    if (state.failModel) throw new Error('synthetic-model-failure');
    return { content: JSON.stringify({ summary: '合成样品需求',
      needs: [{ text: '100件样品', evidence: '需要100件样品', speaker: null, occurred_at: null }],
      quotes: [], commitments: [], next_actions: [], uncertainties: ['历史时间未知'] }),
      model: 'deterministic-test-double', usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } };
  } }));
  return { app, state };
}
