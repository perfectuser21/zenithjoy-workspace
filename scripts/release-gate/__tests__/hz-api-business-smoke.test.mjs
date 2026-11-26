import assert from 'node:assert/strict';
import test from 'node:test';
import { runApiBusinessSmoke } from '../hz-api-business-smoke.mjs';

const candidate = 'a'.repeat(40);
const email = 'ai-acceptance@zenithjoy.test';
const token = '__Secure-better-auth.session_token=fixture-session';
const tenant = 'b456bd59-d3d4-45c7-afe7-ec326d342cff';
const env = {
  EXPECTED_API_SHA: candidate,
  API_STAGING_RUN_ID: '13',
  API_STAGING_RUN_ATTEMPT: '2',
  STAGING_ACCEPTANCE_EMAIL: email,
  STAGING_ACCEPTANCE_PASSWORD: 'fixture-password',
  STAGING_ACCEPTANCE_TENANT_ID: tenant,
};
const profilePath = '/api/company-profile';
const origin = 'https://staging-autopilot.zenjoymedia.media';

function fixture(opts = {}) {
  const draft = {
    company_id: 'a6dd18ac-3554-4a36-95eb-5aaa70b7a80d',
    tenant_id: tenant,
    company_key: 'dashboard-release-acceptance',
    config_status: 'draft',
    config_owner: 'fixture-operator',
    config_version: 7,
    runtime_config: {},
  };
  const writes = [];
  const requests = [];
  const checked = [];
  const success = data => Response.json({ success: true, data });
  const unauthorized = () => Response.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  const fetchImpl = async (url, request) => {
    const { method, headers, redirect, body } = request;
    const { pathname } = url;
    assert.equal(url.origin, origin);
    assert.equal(redirect, 'error');
    requests.push({ pathname, method });
    if (method === 'GET') checked.push(url.searchParams.get('release_probe'));
    if (pathname === '/api/version') {
      return Response.json({ sha: opts.resolveSha?.(writes.length) ?? candidate });
    }
    if (pathname === '/api/auth/sign-in/email') {
      assert.deepEqual(JSON.parse(body), { email, password: env.STAGING_ACCEPTANCE_PASSWORD });
      assert.equal(headers.cookie, undefined);
      assert.equal(headers.origin, origin);
      return Response.json({}, { headers: { 'set-cookie': token + '; Path=/; Secure; HttpOnly' } });
    }
    if (pathname === profilePath && !headers.cookie) return unauthorized();
    assert.equal(headers.cookie, token);
    switch (pathname) {
      case '/api/auth/get-session':
        return Response.json({ user: { email: opts.sessionEmail ?? email } });
      case profilePath + '/outreach-settings':
        return success(null);
      case profilePath + '/source-sync':
        return success({ sources: opts.sources ?? [], state: {} });
      case '/api/content-factory/topics/pacing/config':
        return success({ daily_limit: 1 });
      default:
        assert.equal(pathname, profilePath);
        if (method === 'GET') return success(draft);
        assert.equal(method, 'PUT');
        assert.equal(headers.origin, origin);
        const write = JSON.parse(body);
        assert.deepEqual(Object.keys(write).sort(), ['config_owner', 'config_status', 'expected_version']);
        assert.equal(write.config_status, 'draft');
        writes.push(write);
        if (write.expected_version !== draft.config_version) {
          if (opts.concurrentChange) {
            draft.config_owner = 'other-writer';
            draft.config_version++;
          }
          return Response.json({ error: { code: 'VERSION_CONFLICT' } }, { status: 409 });
        }
        if (!opts.unknownWithoutCommit || writes.length > 1) {
          draft.config_owner = write.config_owner;
          draft.config_version++;
        }
        if ((opts.unknownAfterCommit || opts.unknownWithoutCommit) && writes.length === 1) throw new TypeError('network lost');
        return success({ updated: true });
    }
  };
  return { fetchImpl, draft, writes, requests, checked };
}

test('uses the exact candidate, real API contract, independent reads and one safe refreshed-version retry', async () => {
  const f = fixture();
  const receipt = await runApiBusinessSmoke(env, f);
  assert.deepEqual(receipt.staging.api, { sha: candidate, run_id: 13, run_attempt: 2 });
  assert.equal(receipt.checks.safe_retry_and_cleanup, true);
  assert.deepEqual(f.writes.map(x => x.expected_version), [7, 7, 8]);
  assert.match(f.writes[0].config_owner, /^release-acceptance-/);
  assert.equal(f.draft.config_version, 9);
  assert.equal(f.draft.config_owner, 'fixture-operator');
  assert.equal(new Set(f.checked).size, f.checked.length);
  assert.ok(f.checked.every(Boolean));
  assert.equal(f.requests.at(-1).pathname, '/api/version');
});

test('cleans an observed committed marker after a network failure without replaying the unknown write', async () => {
  const f = fixture({ unknownAfterCommit: true });
  await assert.rejects(runApiBusinessSmoke(env, f), /network lost/);
  assert.deepEqual(f.writes.map(x => x.expected_version), [7, 8]);
  assert.equal(f.draft.config_owner, 'fixture-operator');
});

test('does not replay an uncertain write when no matching mutation is visible', async () => {
  const f = fixture({ unknownWithoutCommit: true });
  await assert.rejects(runApiBusinessSmoke(env, f), /network lost/);
  assert.equal(f.writes.length, 1);
  assert.equal(f.draft.config_version, 7);
});

test('does not overwrite an independently modified draft', async () => {
  const f = fixture({ concurrentChange: true });
  await assert.rejects(runApiBusinessSmoke(env, f), /changed concurrently/);
  assert.deepEqual(f.writes.map(x => x.expected_version), [7, 7]);
  assert.equal(f.draft.config_owner, 'other-writer');
});

test('blocks the wrong live API before login and refuses cleanup on version drift', async () => {
  const stale = fixture({ resolveSha: () => 'b'.repeat(40) });
  await assert.rejects(runApiBusinessSmoke(env, stale), /staging API SHA/);
  assert.deepEqual(stale.requests, [{ pathname: '/api/version', method: 'GET' }]);
  const drift = fixture({ resolveSha: writes => writes >= 1 ? 'b'.repeat(40) : candidate });
  await assert.rejects(runApiBusinessSmoke(env, drift), /staging API SHA/);
  assert.equal(drift.writes.length, 1);
});

test('refuses auth and fixture mismatches before writing', async () => {
  const identity = fixture({ sessionEmail: 'other@zenithjoy.test' });
  await assert.rejects(runApiBusinessSmoke(env, identity), /session readback/);
  assert.equal(identity.writes.length, 0);
  const workspace = fixture({ sources: [{ platform: 'notion' }] });
  await assert.rejects(runApiBusinessSmoke(env, workspace), /no configured source/);
  assert.equal(workspace.writes.length, 0);
  const otherTenant = fixture();
  await assert.rejects(runApiBusinessSmoke({ ...env, STAGING_ACCEPTANCE_TENANT_ID: '00aa00aa-00aa-00aa-00aa-00aa00aa00aa' }, otherTenant), /outside the designated/);
  assert.equal(otherTenant.writes.length, 0);
});
