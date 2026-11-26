import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSafeDraft, matchesOwnerChange, runDraftProbe, smokeInputs } from '../dashboard-business-smoke.mjs';

const tenantId = 'bdb664fa-d38e-495a-90b9-09762d91b31e';
const marker = 'release-acceptance-123456';
const draft = {
  tenant_id: tenantId,
  company_id: '78efe79d-eb3e-48a7-93b6-6a92bed413ac',
  company_key: 'dashboard-release-acceptance',
  runtime_config: {},
  config_status: 'draft',
  config_owner: 'original owner',
  config_version: 3,
};

test('rejects an unrelated tenant and an enabled profile before a write', () => {
  assert.throws(() => assertSafeDraft({...draft, tenant_id: 'another tenant'}, tenantId), /tenant/);
  assert.throws(() => assertSafeDraft({...draft, config_status: 'enabled'}, tenantId), /draft/);
  assert.throws(() => assertSafeDraft({...draft, company_key: 'current customer'}, tenantId), /fixture/);
  assert.throws(() => assertSafeDraft({...draft, runtime_config: {binding: 'reserved'}}, tenantId), /fixture/);
});

test('validates the dedicated account, version stamps, attempt and output shape', () => {
  const env = {
    STAGING_ACCEPTANCE_EMAIL: 'ai-acceptance@zenithjoy.test',
    STAGING_ACCEPTANCE_PASSWORD: 'fixture',
    STAGING_ACCEPTANCE_TENANT_ID: tenantId,
    DASHBOARD_ACCEPTANCE_OUTPUT: '/tmp/acceptance-output.json',
    EXPECTED_DASHBOARD_SHA: 'a'.repeat(40),
    EXPECTED_API_SHA: 'b'.repeat(40),
    DASHBOARD_STAGING_RUN_ID: '12345',
    DASHBOARD_STAGING_RUN_ATTEMPT: '2',
    API_STAGING_RUN_ID: '12346',
    API_STAGING_RUN_ATTEMPT: '4',
  };
  assert.deepEqual(smokeInputs(env).staging.api, {sha: 'b'.repeat(40), run_id: 12346, run_attempt: 4});
  assert.throws(() => smokeInputs({...env, STAGING_ACCEPTANCE_EMAIL: 'regular@example.com'}), /dedicated staging account/);
  assert.throws(() => smokeInputs({...env, DASHBOARD_STAGING_RUN_ATTEMPT: '0'}), /staging run and attempt/);
});

test('only the draft owner and expected version may change in the browser payload', () => {
  const baseline = {...draft, runtime_config: {sample: true}};
  const payload = {expected_version: 3, config_status: 'draft', config_owner: marker, runtime_config: {sample: true}};
  assert.equal(matchesOwnerChange(payload, baseline, marker), true);
  assert.equal(matchesOwnerChange({...payload, expected_version: 4}, baseline, marker), false);
  assert.equal(matchesOwnerChange({...payload, tenant_id: tenantId}, baseline, marker), false);
  assert.equal(matchesOwnerChange({...payload, runtime_config: {sample: false}}, baseline, marker), false);
});

function fakeDraft({loseReceipt = false, concurrent = false, readbackFailure = false, apiDrift = false} = {}) {
  let current = {...draft};
  const writes = [];
  let reads = 0;
  return {
    writes,
    async read() {
      reads++;
      if (readbackFailure && reads === 2) throw new Error('independent read unavailable');
      return {...current};
    },
    async restore(before, owner) {
      if (apiDrift) throw new Error('API version changed');
      await this.save(before, owner);
    },
    async save(before, owner) {
      assert.equal(before.config_version, current.config_version);
      current = {...current, config_owner: owner, config_version: current.config_version + 1};
      writes.push(owner);
      if (owner === marker && concurrent) current.config_version++;
      if (owner === marker && loseReceipt) throw new Error('lost write response');
    },
  };
}

test('writes a marker, reads it independently, restores the owner and verifies the cleanup', async () => {
  const profile = fakeDraft();
  await runDraftProbe(profile, tenantId, marker);
  assert.deepEqual(profile.writes, [marker, draft.config_owner]);
  assert.equal((await profile.read()).config_owner, draft.config_owner);
});

test('cleans up a lost receipt but does not certify it as passed', async () => {
  const profile = fakeDraft({loseReceipt: true});
  await assert.rejects(runDraftProbe(profile, tenantId, marker), /lost write response/);
  assert.deepEqual(profile.writes, [marker, draft.config_owner]);
});

test('cleans up if the initial readback failed after write', async () => {
  const profile = fakeDraft({readbackFailure: true});
  await assert.rejects(runDraftProbe(profile, tenantId, marker), /independent read/);
  assert.deepEqual(profile.writes, [marker, draft.config_owner]);
});

test('does not overwrite a competing version during cleanup', async () => {
  const profile = fakeDraft({concurrent: true});
  await assert.rejects(runDraftProbe(profile, tenantId, marker), /cleanup refused/);
  assert.deepEqual(profile.writes, [marker]);
});

test('refuses restoration with uncertain API identity and does not submit a second write', async () => {
  const profile = fakeDraft({apiDrift: true});
  await assert.rejects(runDraftProbe(profile, tenantId, marker), /draft cleanup write/);
  assert.deepEqual(profile.writes, [marker]);
});
