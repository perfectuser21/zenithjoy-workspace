import test from 'node:test';
import assert from 'node:assert/strict';
import settings from '../dm-rate-ramp-lib.js';
const { readOutreachSettings, assertOutreachWindow } = settings;

test('reads the saved company settings every time and keeps tenant identity explicit', async () => {
  let row = { daily_cap: 80, paused: false, start_local: '09:00', end_local: '18:00' };
  const pool = { query: async (_sql, params) => {
    assert.deepEqual(params, ['yuesheng', 'company-one', 'tenant-one']);
    return { rows: [row] };
  } };
  const scope = { companyId: 'company-one', tenantId: 'tenant-one' };
  assert.equal((await readOutreachSettings(pool, 'yuesheng', scope)).daily_cap, 80);
  row = { ...row, daily_cap: 50 };
  assert.equal((await readOutreachSettings(pool, 'yuesheng', scope)).daily_cap, 50);
});

test('Shanghai send window supports overnight and rejects a paused company', () => {
  const settings = { paused: false, start_local: '22:00', end_local: '02:00' };
  assert.doesNotThrow(() => assertOutreachWindow(settings, new Date('2026-11-25T17:59:00Z')));
  assert.throws(() => assertOutreachWindow(settings, new Date('2026-11-25T18:00:00Z')), /OUTREACH_WINDOW_CLOSED/);
  assert.throws(() => assertOutreachWindow({ ...settings, paused: true }), /OUTREACH_PAUSED/);
});
